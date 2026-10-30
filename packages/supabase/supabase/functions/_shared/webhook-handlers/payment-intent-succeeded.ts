// _shared/webhook-handlers/payment-intent-succeeded.ts
//
// `payment_intent.succeeded` — the happy path, in two shapes keyed on the
// payment row's `kind` (C2 W3):
//
//   booking — the single-payer path, unchanged: pending → paid → confirmed.
//   share/cover — a slice of a split fixture. The payment row flips to
//     succeeded, then settle_split_booking() (FOR UPDATE, race-safe) decides
//     what the sum means: anchor → collecting, full sum → confirmed. When it
//     says confirmed, THIS handler creates the one venue Transfer
//     (ADR-0027), idempotency key transfer:{booking_id} — safe under every
//     race and redelivery because Stripe dedups the create.
//
// Orphan-PI cases: the booking died before payment settled. Single-payer
// orphans refund with reverse_transfer (destination charge); share orphans
// are plain platform refunds — an SCT share has no transfer to reverse.
//
// Every PaymentIntent Ludi creates is the platform's own, so an event from
// a connected account (event.account set — the Connect destination shares
// this URL) is never one of ours and is ignored. A single-payer booking is
// confirmed only when our payments row for this PI exists, names the same
// booking, and agrees with Stripe on amount and currency.

import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import type { Handler, HandlerResult } from './types.ts';

const DEAD_STATES = new Set([
  'cancelled',
  'cancelled_no_refund',
  'refunded',
  'refunded_by_admin',
]);

/** Why a single-payer PI may not confirm its booking, or null if it may.
 *  The payments row is ours; PI metadata is only a pointer to it. */
export function singlePayerMismatch(
  pi: { amount: number; currency: string },
  payRow: { booking_id: string; amount_cents: number; kind: string } | null,
  bookingId: string,
): string | null {
  if (!payRow) return 'no-payment-row';
  if (payRow.kind !== 'booking') return `unexpected-kind:${payRow.kind}`;
  if (payRow.booking_id !== bookingId) return 'booking-mismatch';
  if (pi.currency !== 'eur') return 'currency-mismatch';
  if (pi.amount !== payRow.amount_cents) return 'amount-mismatch';
  return null;
}

export const paymentIntentSucceeded: Handler = async ({ supa, stripe, event }) => {
  const pi = event.data.object as Stripe.PaymentIntent;
  const bookingId = pi.metadata?.booking_id;
  const eventIsoAt = new Date(event.created * 1000).toISOString();

  if (event.account) {
    console.warn('payment_intent.succeeded from a connected account ignored', {
      pi: pi.id,
      account: event.account,
    });
    return { status: 200, notes: 'connected-account-ignored' };
  }

  if (!bookingId) {
    console.error('PI without booking_id metadata', pi.id);
    return { status: 400, notes: 'missing-booking-id' };
  }

  const { data: booking, error: bookingErr } = await supa
    .from('bookings')
    .select('id, state, total_cents')
    .eq('id', bookingId)
    .maybeSingle();
  if (bookingErr) throw new Error(`booking load failed: ${bookingErr.message}`);
  if (!booking) {
    console.error('PI for unknown booking', { pi: pi.id, bookingId });
    return { status: 404, notes: 'unknown-booking' };
  }

  // The payment row's kind decides which shape this event takes. Trusting
  // the row over PI metadata: the row is ours.
  const { data: payRow, error: payRowErr } = await supa
    .from('payments')
    .select('id, kind, status, booking_id, amount_cents')
    .eq('stripe_payment_intent_id', pi.id)
    .maybeSingle();
  if (payRowErr) throw new Error(`payment row load failed: ${payRowErr.message}`);

  if (payRow && payRow.kind === 'share') {
    // ── Swap branch (ADR-0044) ────────────────────────────────────────
    // A share paid to take a seat someone asked to hand over. It must be
    // caught before the late-surplus branch below, which would otherwise
    // refund it as an over-payment on a confirmed fixture.
    const { data: swap, error: swapErr } = await supa
      .from('seat_swaps')
      .select('id, status, from_payment_id')
      .eq('payment_id', payRow.id)
      .maybeSingle();
    if (swapErr) throw new Error(`swap lookup failed: ${swapErr.message}`);
    if (swap) return settleSwap({ supa, stripe, pi, payRowId: payRow.id, swap, bookingState: booking.state, eventIsoAt });
  }

  if (payRow && (payRow.kind === 'share' || payRow.kind === 'cover')) {
    // ── Share branch ──────────────────────────────────────────────────
    // Orphan: the fixture died (expired, cancelled) before this share
    // settled. Plain platform refund — no transfer exists to reverse.
    if (DEAD_STATES.has(booking.state)) {
      const refund = await stripe.refunds.create(
        { payment_intent: pi.id, reason: 'requested_by_customer' },
        { idempotencyKey: `orphan-share-refund:${pi.id}` },
      );
      await supa
        .from('payments')
        .update({
          status: 'refunded',
          refunded_amount_cents: pi.amount,
          stripe_latest_event_at: eventIsoAt,
        })
        .eq('id', payRow.id);
      return { status: 200, notes: `orphan-share-refunded:${refund.id}` };
    }

    // Late surplus: the fixture already confirmed (usually via the
    // organiser's cover) and this share settled after — the seat was
    // already bought, so the money goes straight back (C2 W4). The seat
    // itself stays: the claimant is on the roster either way.
    if (booking.state === 'confirmed' || booking.state === 'completed') {
      const refund = await stripe.refunds.create(
        { payment_intent: pi.id },
        { idempotencyKey: `late-share-refund:${pi.id}` },
      );
      await supa
        .from('payments')
        .update({
          status: 'refunded',
          refunded_amount_cents: pi.amount,
          stripe_latest_event_at: eventIsoAt,
        })
        .eq('id', payRow.id);
      return { status: 200, notes: `late-share-refunded:${refund.id}` };
    }

    const { error: shareUpdErr } = await supa
      .from('payments')
      .update({ status: 'succeeded', stripe_latest_event_at: eventIsoAt })
      .eq('id', payRow.id);
    if (shareUpdErr) throw new Error(`share payment update failed: ${shareUpdErr.message}`);

    const { data: settleData, error: settleErr } = await supa.rpc('settle_split_booking', {
      p_booking_id: booking.id,
    });
    if (settleErr) throw new Error(`settle failed: ${settleErr.message}`);
    const settle = (Array.isArray(settleData) ? settleData[0] : settleData) as {
      state: string;
      should_transfer: boolean;
      transfer_cents: number;
      destination: string | null;
    } | null;
    if (!settle) throw new Error('settle returned no row');

    if (settle.should_transfer) {
      if (!settle.destination) {
        // Confirmed with nowhere to send the venue's money — refuse to
        // swallow it; a thrown error means Stripe redelivers and retries.
        throw new Error(`no venue destination for confirmed split booking ${booking.id}`);
      }
      const transfer = await stripe.transfers.create(
        {
          amount: settle.transfer_cents,
          currency: 'eur',
          destination: settle.destination,
          metadata: { booking_id: booking.id },
        },
        { idempotencyKey: `transfer:${booking.id}` },
      );
      // Recorded because W5's cancellation reverses BY id, and because
      // "has the venue been paid" becomes a column, not an inference —
      // the sweeper's refund pass keys on its absence. Idempotent: the
      // dedup'd transfer id is the same on every redelivery.
      const { error: tidErr } = await supa
        .from('bookings')
        .update({ stripe_transfer_id: transfer.id })
        .eq('id', booking.id);
      if (tidErr) throw new Error(`transfer id record failed: ${tidErr.message}`);
      return { status: 200, notes: `split-confirmed:${transfer.id}` };
    }
    return { status: 200, notes: `split-settled:${settle.state}` };
  }
  // ── Single-payer branch ─────────────────────────────────────────────
  const mismatch = singlePayerMismatch(pi, payRow, booking.id);
  if (mismatch) {
    console.error('PI does not match its payment row; booking left alone', {
      pi: pi.id,
      booking: booking.id,
      reason: mismatch,
    });
    return { status: 409, notes: `payment-mismatch:${mismatch}` };
  }

  // Orphan: cleanup fired before PI settled. Refund in full.
  if (booking.state === 'cancelled_no_refund') {
    const refund = await stripe.refunds.create(
      {
        payment_intent: pi.id,
        reason: 'requested_by_customer',
        refund_application_fee: true,
        reverse_transfer: true,
      },
      { idempotencyKey: `orphan-refund:${pi.id}` },
    );
    await supa
      .from('payments')
      .update({
        status: 'refunded',
        refunded_amount_cents: pi.amount,
        stripe_latest_event_at: eventIsoAt,
      })
      .eq('stripe_payment_intent_id', pi.id);
    return { status: 200, notes: `orphan-refunded:${refund.id}` };
  }

  // Dedup fallback — we should have caught this at the event-id layer, but
  // if a duplicate event got through, a no-op is the right move.
  if (
    booking.state === 'paid' ||
    booking.state === 'confirmed' ||
    booking.state === 'completed'
  ) {
    return { status: 200, notes: `already:${booking.state}` };
  }

  if (booking.state !== 'pending') {
    console.error('unexpected booking state for PI succeeded', booking.state);
    return { status: 409, notes: `unexpected-state:${booking.state}` };
  }

  // Two-step state transition preserves the state machine's shape for
  // future manual-confirm hooks. `.eq('state', ...)` is optimistic
  // concurrency — if a concurrent writer already moved the row, we skip.
  const { error: paidErr, data: paidRow } = await supa
    .from('bookings')
    .update({ state: 'paid' })
    .eq('id', booking.id)
    .eq('state', 'pending')
    .select('id')
    .maybeSingle();
  if (paidErr) throw new Error(`flip to paid failed: ${paidErr.message}`);
  if (!paidRow) {
    // Someone else won the race. Re-read and defer to their outcome.
    return { status: 200, notes: 'race-lost-to-concurrent-writer' };
  }

  const { error: confErr } = await supa
    .from('bookings')
    .update({ state: 'confirmed' })
    .eq('id', booking.id)
    .eq('state', 'paid');
  if (confErr) throw new Error(`flip to confirmed failed: ${confErr.message}`);

  const { error: payErr } = await supa
    .from('payments')
    .update({
      status: 'succeeded',
      stripe_latest_event_at: eventIsoAt,
    })
    .eq('stripe_payment_intent_id', pi.id);
  if (payErr) throw new Error(`payments update failed: ${payErr.message}`);

  return { status: 200, notes: 'confirmed' };
};

// The taker's share settled. Give the leaver's share back (the taker's
// money stands in for it; the venue was paid at confirmation and is not
// touched), then mark the swap done. Every step is keyed or conditional,
// so a redelivery after a crash finishes the job rather than repeating it.
//
//   swap failed  — the sweeper put the seat back before this money landed:
//                  the taker has no seat, so their share goes straight back.
//   fixture dead — cancelled while the card sheet was open: the taker's
//                  share goes back (the cancellation fan-out already
//                  handled the leaver's), and the swap is failed.
async function settleSwap(args: {
  supa: SupabaseClient;
  stripe: Stripe;
  pi: Stripe.PaymentIntent;
  payRowId: string;
  swap: { id: string; status: string; from_payment_id: string | null };
  bookingState: string;
  eventIsoAt: string;
}): Promise<HandlerResult> {
  const { supa, stripe, pi, payRowId, swap, bookingState, eventIsoAt } = args;

  if (swap.status === 'failed' || DEAD_STATES.has(bookingState)) {
    const refund = await stripe.refunds.create(
      { payment_intent: pi.id },
      { idempotencyKey: `swap-void-refund:${pi.id}` },
    );
    await supa
      .from('payments')
      .update({ status: 'refunded', refunded_amount_cents: pi.amount, stripe_latest_event_at: eventIsoAt })
      .eq('id', payRowId);
    if (swap.status === 'pending') {
      await supa
        .from('seat_swaps')
        .update({ status: 'failed', settled_at: new Date().toISOString() })
        .eq('id', swap.id)
        .eq('status', 'pending');
    }
    return { status: 200, notes: `swap-void-refunded:${refund.id}` };
  }

  const { error: payErr } = await supa
    .from('payments')
    .update({ status: 'succeeded', stripe_latest_event_at: eventIsoAt })
    .eq('id', payRowId);
  if (payErr) throw new Error(`swap payment update failed: ${payErr.message}`);

  if (swap.from_payment_id) {
    const { data: from, error: fromErr } = await supa
      .from('payments')
      .select('id, status, amount_cents, refunded_amount_cents, stripe_payment_intent_id')
      .eq('id', swap.from_payment_id)
      .maybeSingle();
    if (fromErr) throw new Error(`leaver payment load failed: ${fromErr.message}`);
    if (from && from.status !== 'refunded') {
      const owed = from.amount_cents - (from.refunded_amount_cents ?? 0);
      if (owed > 0) {
        await stripe.refunds.create(
          { payment_intent: from.stripe_payment_intent_id, amount: owed },
          { idempotencyKey: `swap-refund:${from.id}` },
        );
      }
      const { error: fromUpdErr } = await supa
        .from('payments')
        .update({ status: 'refunded', refunded_amount_cents: from.amount_cents })
        .eq('id', from.id);
      if (fromUpdErr) throw new Error(`leaver payment update failed: ${fromUpdErr.message}`);
    }
  }

  const { error: doneErr } = await supa
    .from('seat_swaps')
    .update({ status: 'done', settled_at: new Date().toISOString() })
    .eq('id', swap.id)
    .eq('status', 'pending');
  if (doneErr) throw new Error(`swap done update failed: ${doneErr.message}`);

  return { status: 200, notes: `swap-done:${swap.id.slice(0, 8)}` };
}
