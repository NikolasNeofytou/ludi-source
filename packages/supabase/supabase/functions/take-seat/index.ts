// take-seat/index.ts
// POST /take-seat — take a seat whose player asked for a replacement
// (plans/find-my-replacement.md, ADR-0044).
//
// The free swap (a non-split fixture, or a seat nobody paid for) is the
// take_seat RPC; this function exists for the paid one, and answers the
// free one too so a client on a split fixture has one door.
//
// Control flow at a glance:
//   CORS preflight
//   → extract + validate JWT              (401 UNAUTHORIZED)
//   → parse + Zod-validate body           (400 VALIDATION_FAILED)
//   → idempotency read/lookup             (409 IDEMPOTENCY_MISMATCH)
//   → a pending swap of mine already?     → hand back the same PaymentIntent
//   → begin_seat_swap (seat moves now)    (404/409 typed refusals)
//   → free? done                          → 200 { taken: true, payment: null }
//   → Stripe PI for the frozen share      (revert the swap on error)
//   → INSERT payments + link the swap     (cancel PI + revert on error)
//   → 200 { taken: false, payment{...} }
//
// The seat moves before the money, claim-share's order. If the taker never
// pays, the sweeper (expire-collecting, pass d) reverts the swap and the
// leaver is back on the seat, still asking. When the share settles, the
// webhook gives the leaver's share back.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { getUserFromRequest } from '../_shared/auth.ts';
import {
  corsHeaders,
  errorResponse,
  jsonResponse,
  preflightResponse,
} from '../_shared/errors.ts';
import {
  canonicalJson,
  IdempotencyMismatch,
  lookupIdempotentResponse,
  readIdempotencyKey,
  sha256Hex,
  storeIdempotentResponse,
} from '../_shared/idempotency.ts';
import { TakeSeatInput } from '../_shared/schemas/seat-swap.ts';
import { swapRefusalFromPg } from '../_shared/seat-swap.ts';
import { createStripeClient, stripePublishableKey } from '../_shared/stripe.ts';
import { createServiceClient } from '../_shared/supabase.ts';

interface SwapRow {
  swap_id: string;
  booking_id: string;
  participant_id: string;
  needs_payment: boolean;
  share_amount_cents: number | null;
  from_payment_id: string | null;
}

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
  }

  const user = await getUserFromRequest(req);
  if (!user) return errorResponse('UNAUTHORIZED', 'Missing or invalid token', 401);

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }
  const parsed = TakeSeatInput.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, {
      issues: parsed.error.issues,
    });
  }
  const input = parsed.data;

  let idempotencyKey: string | null;
  try {
    idempotencyKey = readIdempotencyKey(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid Idempotency-Key';
    return errorResponse('VALIDATION_FAILED', message, 400);
  }
  const requestHash = await sha256Hex(canonicalJson(input));
  const supa = createServiceClient();

  if (idempotencyKey) {
    try {
      const cached = await lookupIdempotentResponse(supa, idempotencyKey, user.id, requestHash);
      if (cached) {
        return new Response(JSON.stringify(cached.body), {
          status: cached.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    } catch (err) {
      if (err instanceof IdempotencyMismatch) {
        return errorResponse('IDEMPOTENCY_MISMATCH', err.message, 409);
      }
      console.error('idempotency lookup error', err);
      return errorResponse('INTERNAL_ERROR', 'Idempotency lookup failed', 500);
    }
  }

  const stripe = createStripeClient();
  const respond = async (body: Record<string, unknown>) => {
    if (idempotencyKey) {
      await storeIdempotentResponse(supa, idempotencyKey, user.id, requestHash, 200, body);
    }
    return jsonResponse(body, 200);
  };

  // A re-tap after the card sheet was dismissed: the seat is already mine,
  // pending; hand back the same PaymentIntent rather than refusing ALREADY_IN.
  const { data: booking, error: bookingErr } = await supa
    .from('bookings')
    .select('id, code, share_amount_cents')
    .eq('invite_token', input.invite_token)
    .maybeSingle();
  if (bookingErr) {
    console.error(JSON.stringify({ level: 'error', event: 'take_seat_booking_lookup_failed' }));
    return errorResponse('DB_ERROR', 'Failed to load fixture', 500);
  }
  if (!booking) return errorResponse('INVALID_INVITE', 'This invite is not valid', 404);

  const { data: mine } = await supa
    .from('booking_participants')
    .select('id')
    .eq('booking_id', booking.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (mine) {
    const { data: pending } = await supa
      .from('seat_swaps')
      .select('id, payment_id')
      .eq('to_participant_id', mine.id)
      .eq('status', 'pending')
      .maybeSingle();
    if (pending?.payment_id) {
      const { data: pay } = await supa
        .from('payments')
        .select('stripe_payment_intent_id')
        .eq('id', pending.payment_id)
        .maybeSingle();
      if (pay) {
        const pi = await stripe.paymentIntents.retrieve(pay.stripe_payment_intent_id);
        return respond({
          booking_id: booking.id,
          taken: false,
          share_amount_cents: booking.share_amount_cents,
          payment: {
            payment_intent_id: pi.id,
            client_secret: pi.client_secret,
            publishable_key: stripePublishableKey(),
          },
        });
      }
    }
  }

  // The seat moves now, under the booking lock.
  const { data: swapData, error: swapErr } = await supa.rpc('begin_seat_swap', {
    p_invite_token: input.invite_token,
    p_user_id: user.id,
    p_slot_kind: input.slot_kind ?? null,
  });
  if (swapErr) {
    const refusal = swapRefusalFromPg(swapErr);
    if (refusal) return errorResponse(refusal.code, refusal.message, refusal.status);
    console.error(JSON.stringify({ level: 'error', event: 'begin_seat_swap_failed', code: swapErr.code }));
    return errorResponse('DB_ERROR', 'Failed to take the seat', 500);
  }
  const swap = (Array.isArray(swapData) ? swapData[0] : swapData) as SwapRow | null;
  if (!swap) return errorResponse('DB_ERROR', 'Swap returned nothing', 500);

  if (!swap.needs_payment) {
    return respond({ booking_id: swap.booking_id, taken: true, share_amount_cents: null, payment: null });
  }
  if (!swap.share_amount_cents) {
    await supa.rpc('revert_seat_swap', { p_swap_id: swap.swap_id });
    return errorResponse('DB_ERROR', 'Paid seat without a share price', 500);
  }

  // Plain platform charge, like every share (ADR-0027). The venue was paid
  // at confirmation; this money stands in for the leaver's, which the
  // webhook gives back when this one settles.
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: swap.share_amount_cents,
        currency: 'eur',
        automatic_payment_methods: { enabled: true },
        metadata: {
          booking_id: swap.booking_id,
          booking_code: booking.code,
          user_id: user.id,
          participant_id: swap.participant_id,
          kind: 'share',
          swap_id: swap.swap_id,
        },
      },
      { idempotencyKey: `swap:${swap.swap_id}` },
    );
  } catch (err) {
    const stripeCode = (err as { code?: string })?.code;
    console.error(JSON.stringify({ level: 'error', event: 'swap_pi_failed', swap: swap.swap_id.slice(0, 8) }));
    await supa.rpc('revert_seat_swap', { p_swap_id: swap.swap_id });
    return errorResponse(
      'STRIPE_ERROR',
      "Payment couldn't be started just now. Try again in a minute.",
      502,
      stripeCode ? { stripe_code: stripeCode } : undefined,
    );
  }

  const { data: payRow, error: payErr } = await supa
    .from('payments')
    .insert({
      booking_id: swap.booking_id,
      stripe_payment_intent_id: paymentIntent.id,
      amount_cents: swap.share_amount_cents,
      application_fee_cents: 0,
      status: 'requires_payment_method',
      kind: 'share',
      participant_id: swap.participant_id,
    })
    .select('id')
    .single();
  if (payErr || !payRow) {
    console.error(JSON.stringify({ level: 'error', event: 'swap_payment_insert_failed', swap: swap.swap_id.slice(0, 8) }));
    try {
      await stripe.paymentIntents.cancel(paymentIntent.id);
    } catch (_) {
      // the sweeper's pass d cancels it again
    }
    await supa.rpc('revert_seat_swap', { p_swap_id: swap.swap_id });
    return errorResponse('DB_ERROR', 'Payment row insert failed', 500);
  }

  const { error: linkErr } = await supa
    .from('seat_swaps')
    .update({ payment_id: payRow.id })
    .eq('id', swap.swap_id);
  if (linkErr) {
    // Without the link the webhook cannot tell this share is a swap's and
    // would refund it as a late surplus; fail loudly instead.
    try {
      await stripe.paymentIntents.cancel(paymentIntent.id);
    } catch (_) {
      // best effort
    }
    await supa.from('payments').update({ status: 'cancelled' }).eq('id', payRow.id);
    await supa.rpc('revert_seat_swap', { p_swap_id: swap.swap_id });
    return errorResponse('DB_ERROR', 'Swap link failed', 500);
  }

  return respond({
    booking_id: swap.booking_id,
    taken: false,
    share_amount_cents: swap.share_amount_cents,
    payment: {
      payment_intent_id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      publishable_key: stripePublishableKey(),
    },
  });
}));
