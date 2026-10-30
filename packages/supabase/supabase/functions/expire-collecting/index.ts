// expire-collecting/index.ts
// POST /expire-collecting — the split-payment sweeper (C2 W4).
//
// Invoked every 5 minutes by pg_cron + pg_net (the spike-proven path,
// docs/spikes/scheduled-edge-function.md), authenticated by a shared
// secret header, NOT a Supabase JWT — the stripe-webhook precedent.
//
// Three idempotent passes; a tick that dies mid-pass is healed by the
// next one, which is why pass (b) selects by observable state rather
// than remembering what pass (a) was doing:
//   a. collecting fixtures past T-24h + 2h grace → cancelled. The
//      organiser had their cover window (split-payment.md decision 3);
//      the screen was the channel.
//   b. succeeded share/cover money on dead split fixtures → 100% plain
//      platform refunds (nothing transferred yet — ADR-0027 makes this
//      the trivially-safe path).
//   c. seats whose share PI died at the card sheet (15-minute grace,
//      mirroring stale pending bookings) → back on the market.
//   d. seat swaps whose taker never paid (same grace, ADR-0044) → the seat
//      goes back to the player who asked, still asking.
//   e. leavers' shares still `refunding` five minutes on (leave-share
//      marked them under the booking lock, then Stripe refused or the
//      call died) → refunded with leave-share's own key.
//
// Selection lives in SQL helpers (migration 20260830000003) so pgtap can
// clock-inject rows; this function owns only the Stripe calls and the
// row flips.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/errors.ts';
import { secretMatches } from '../_shared/secrets.ts';
import { createStripeClient } from '../_shared/stripe.ts';
import { createServiceClient } from '../_shared/supabase.ts';

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
  }

  const secret = Deno.env.get('EXPIRE_COLLECTING_SECRET');
  if (!secret) {
    console.error('EXPIRE_COLLECTING_SECRET is not set');
    return errorResponse('INTERNAL_ERROR', 'Sweeper is not configured', 500);
  }
  if (!secretMatches(req.headers.get('x-expire-secret'), secret)) {
    return errorResponse('UNAUTHORIZED', 'Bad sweeper secret', 401);
  }

  const supa = createServiceClient();
  const stripe = createStripeClient();
  const counts = {
    expired: 0,
    refunded: 0,
    unseated: 0,
    swaps_reverted: 0,
    leave_refunds: 0,
    errors: 0,
  };

  // ── a. Cover-or-die: the grace ran out ──────────────────────────────
  const { data: expiring, error: expErr } = await supa.rpc('expiring_split_bookings');
  if (expErr) throw new Error(`expiring_split_bookings failed: ${expErr.message}`);
  for (const row of (expiring ?? []) as Array<{ booking_id: string }>) {
    // Sum first, flip second: the flip is optimistic (.eq state), so a
    // fixture that confirmed between select and update is left alone.
    const { data: sumRows } = await supa
      .from('payments')
      .select('amount_cents')
      .eq('booking_id', row.booking_id)
      .in('kind', ['share', 'cover'])
      .eq('status', 'succeeded');
    const refundTotal = (sumRows ?? []).reduce((a, r) => a + r.amount_cents, 0);

    const { data: flipped, error: flipErr } = await supa
      .from('bookings')
      .update({
        state: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_refund_cents: refundTotal,
      })
      .eq('id', row.booking_id)
      .eq('state', 'collecting')
      .select('id')
      .maybeSingle();
    if (flipErr) {
      console.error('expire flip failed', row.booking_id, flipErr);
      counts.errors++;
      continue;
    }
    if (flipped) counts.expired++;
  }

  // ── b. Refund the money the dead fixtures still hold ────────────────
  const { data: refundables, error: refErr } = await supa.rpc('refundable_split_payments');
  if (refErr) throw new Error(`refundable_split_payments failed: ${refErr.message}`);
  for (const row of (refundables ?? []) as Array<{
    payment_id: string;
    stripe_payment_intent_id: string;
    amount_cents: number;
  }>) {
    try {
      await stripe.refunds.create(
        { payment_intent: row.stripe_payment_intent_id },
        // Keyed per payment row: every tick may retry, Stripe dedups.
        { idempotencyKey: `expire-refund:${row.payment_id}` },
      );
    } catch (err) {
      console.error('expire refund failed; next tick retries', row.payment_id, err);
      counts.errors++;
      continue;
    }
    const { error: updErr } = await supa
      .from('payments')
      .update({ status: 'refunded', refunded_amount_cents: row.amount_cents })
      .eq('id', row.payment_id);
    if (updErr) {
      // Stripe refunded but the row didn't flip: the next tick re-selects
      // it and the idempotency key makes the repeat refund a no-op.
      console.error('refund row update failed', row.payment_id, updErr);
      counts.errors++;
      continue;
    }
    counts.refunded++;
  }

  // ── c. Stale claims: free the seat, kill the PI ─────────────────────
  const { data: stale, error: staleErr } = await supa.rpc('stale_share_claims');
  if (staleErr) throw new Error(`stale_share_claims failed: ${staleErr.message}`);
  for (const row of (stale ?? []) as Array<{
    participant_id: string;
    payment_id: string;
    stripe_payment_intent_id: string;
  }>) {
    try {
      await stripe.paymentIntents.cancel(row.stripe_payment_intent_id);
    } catch (err) {
      // A cancel that races an actual payment success loses correctly:
      // leave the seat alone and let the webhook seat the money.
      console.error('stale PI cancel failed; skipping unseat', row.payment_id, err);
      counts.errors++;
      continue;
    }
    await supa.from('payments').update({ status: 'cancelled' }).eq('id', row.payment_id);
    const { error: seatErr } = await supa
      .from('booking_participants')
      .update({ status: 'out', left_at: new Date().toISOString() })
      .eq('id', row.participant_id)
      .eq('status', 'in');
    if (seatErr) {
      console.error('unseat failed', row.participant_id, seatErr);
      counts.errors++;
      continue;
    }
    counts.unseated++;
  }

  // ── d. Swaps whose taker walked away from the card sheet ────────────
  const { data: staleSwaps, error: swapSelErr } = await supa.rpc('stale_seat_swaps');
  if (swapSelErr) throw new Error(`stale_seat_swaps failed: ${swapSelErr.message}`);
  for (const row of (staleSwaps ?? []) as Array<{
    swap_id: string;
    payment_id: string | null;
    stripe_payment_intent_id: string | null;
  }>) {
    if (row.stripe_payment_intent_id) {
      try {
        await stripe.paymentIntents.cancel(row.stripe_payment_intent_id);
      } catch (err) {
        // Lost the race to a real payment: the webhook completes the swap.
        console.error('stale swap PI cancel failed; leaving it', row.swap_id, err);
        counts.errors++;
        continue;
      }
      await supa.from('payments').update({ status: 'cancelled' }).eq('id', row.payment_id);
    }
    const { error: revErr } = await supa.rpc('revert_seat_swap', { p_swap_id: row.swap_id });
    if (revErr) {
      console.error('swap revert failed', row.swap_id, revErr);
      counts.errors++;
      continue;
    }
    counts.swaps_reverted++;
  }

  // ── e. Leave refunds that didn't land ───────────────────────────────
  // Five minutes of grace so a leave-share still mid-call isn't raced; the
  // shared idempotency key would make the overlap harmless anyway. A
  // charge already refunded (the row update was what failed) counts as
  // done.
  const leaveCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: owedLeaves, error: owedErr } = await supa
    .from('payments')
    .select('id, stripe_payment_intent_id, amount_cents')
    .eq('kind', 'share')
    .eq('status', 'refunding')
    .lt('updated_at', leaveCutoff)
    .limit(50);
  if (owedErr) throw new Error(`refunding shares lookup failed: ${owedErr.message}`);
  for (const row of owedLeaves ?? []) {
    try {
      await stripe.refunds.create(
        { payment_intent: row.stripe_payment_intent_id },
        { idempotencyKey: `leave-refund:${row.id}` },
      );
    } catch (err) {
      if ((err as { code?: string })?.code !== 'charge_already_refunded') {
        console.error('leave refund retry failed; next tick retries', row.id, err);
        counts.errors++;
        continue;
      }
    }
    const { error: updErr } = await supa
      .from('payments')
      .update({ status: 'refunded', refunded_amount_cents: row.amount_cents })
      .eq('id', row.id)
      .eq('status', 'refunding');
    if (updErr) {
      console.error('leave refund row update failed', row.id, updErr);
      counts.errors++;
      continue;
    }
    counts.leave_refunds++;
  }

  return jsonResponse(counts, 200);
}));
