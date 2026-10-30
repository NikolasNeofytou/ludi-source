// cancel-booking/index.ts
// POST /cancel-booking — user-initiated cancellation.
//
// Contract: docs/api-contract.md §5.5.
// Policy table: _shared/cancellation-policy.ts (mirrors the contract).
//
// Three booking states the caller can be in:
//
//   pending     → no charge ever happened. Cancel the open PaymentIntent
//                 at Stripe (so it doesn't sit there indefinitely until
//                 the cleanup cron expires it) and flip state='cancelled'.
//                 Refund is N/A.
//
//   paid /      → money was captured. Compute refund per the policy +
//   confirmed     hours-to-slot. Issue a Stripe refund (with Stripe
//                 idempotency key scoped to booking.id so client retries
//                 don't double-refund). Eager-flip state='refunded' (or
//                 'cancelled_no_refund' if refund=0). The charge.refunded
//                 webhook syncs payments.refunded_amount_cents shortly.
//
//   completed   → slot already played. Reject ALREADY_COMPLETED — admin
//                 refund is a separate flow (#16).
//
//   kicked off  → any state but pending, from starts_at on. The hourly
//                 cron only flips a played game to `completed` later, so
//                 the state alone doesn't say the game happened. Reject
//                 ALREADY_STARTED.
//
//   cancelled / → terminal. Reject ALREADY_CANCELLED.
//   refunded /
//   refunded_by_admin /
//   cancelled_no_refund
//
// Idempotency-Key handling matches create-booking: same key + same body
// = cached response; same key + different body = 409 IDEMPOTENCY_MISMATCH.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { getUserFromRequest } from '../_shared/auth.ts';
import {
  cancelBlockedByKickoff,
  computeRefund,
  hoursBetween,
  refundBpsForPolicy,
  type CancellationPolicy,
} from '../_shared/cancellation-policy.ts';
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
import { CancelBookingInput } from '../_shared/schemas/cancellation.ts';
import { proRataCents } from '../_shared/share-math.ts';
import { createStripeClient } from '../_shared/stripe.ts';
import { createServiceClient } from '../_shared/supabase.ts';

// States that already represent a closed booking — second cancel attempt
// should be a no-op error, not another Stripe call.
const TERMINAL_STATES = new Set([
  'cancelled',
  'cancelled_no_refund',
  'refunded',
  'refunded_by_admin',
]);

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
  }

  // 1. Auth.
  const user = await getUserFromRequest(req);
  if (!user) return errorResponse('UNAUTHORIZED', 'Missing or invalid token', 401);

  // 2. Parse + validate body.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }
  const parsed = CancelBookingInput.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, {
      issues: parsed.error.issues,
    });
  }
  const input = parsed.data;

  // 3. Idempotency.
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
      const cached = await lookupIdempotentResponse(
        supa,
        idempotencyKey,
        user.id,
        requestHash,
      );
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

  // 4. Load booking. Service role bypasses RLS so we can return a precise
  //    NOT_AUTHORIZED rather than the misleading BOOKING_NOT_FOUND that
  //    RLS would surface for someone else's booking.
  const { data: booking, error: bookingErr } = await supa
    .from('bookings')
    .select(
      'id, user_id, state, starts_at, total_cents, cancellation_refund_cents, cancellation_policy, is_split, platform_fee_cents, stripe_transfer_id, origin',
    )
    .eq('id', input.booking_id)
    .maybeSingle();
  if (bookingErr) {
    console.error('booking lookup failed', bookingErr);
    return errorResponse('DB_ERROR', 'Failed to load booking', 500);
  }
  if (!booking) {
    return errorResponse('BOOKING_NOT_FOUND', 'Booking not found', 404);
  }
  if (booking.user_id !== user.id) {
    // Caller authenticated but not the owner. Don't leak the booking's
    // existence — but the 403 vs 404 is fine here because the booking_id
    // is a UUID; you don't get to enumerate other users' bookings without
    // already knowing their UUIDs.
    return errorResponse('NOT_AUTHORIZED', 'You can only cancel your own bookings', 403);
  }

  // 4b. Walk-ins carry the acting owner as user_id, so they pass the check
  //     above — but they are the owner's own bookkeeping, paid at the venue
  //     with a synthetic `offline_<id>` intent. This path would either 502
  //     on the Stripe refund or cancel the booking while the offline payment
  //     stays 'succeeded' (earnings overcount). create-walk-in-booking's
  //     action='cancel' is their one cancel path.
  if (booking.origin === 'walk_in') {
    return errorResponse(
      'INVALID_BOOKING_STATE',
      'Walk-ins are cancelled from the venue dashboard',
      409,
    );
  }

  // 5. Terminal-state guards.
  if (TERMINAL_STATES.has(booking.state)) {
    return errorResponse(
      'ALREADY_CANCELLED',
      'This booking is already cancelled or refunded',
      409,
    );
  }
  if (booking.state === 'completed') {
    return errorResponse(
      'ALREADY_COMPLETED',
      'This booking has already been played; contact support for an admin refund',
      409,
    );
  }
  // Anything else must be one of: pending, paid, confirmed — plus
  // collecting for split fixtures (the census row this closes).
  if (!['pending', 'paid', 'confirmed', 'collecting'].includes(booking.state)) {
    console.error('unexpected booking state for cancellation', booking.state);
    return errorResponse('INTERNAL_ERROR', 'Unexpected booking state', 500);
  }

  // 5b. Kickoff closes the cancellation for every state that holds money,
  //     single-payer and split alike. Without it a played game still reads
  //     `confirmed` until the hourly cron and would refund on policy.
  if (cancelBlockedByKickoff(booking.state, new Date(booking.starts_at), new Date())) {
    return errorResponse(
      'ALREADY_STARTED',
      'This game has already started, so it can no longer be cancelled.',
      409,
    );
  }

  const stripe = createStripeClient();
  const nowIso = new Date().toISOString();

  // ── Split fixtures route to their own fan-outs (C2 W5) before the
  //    single-payer branches, whose `.maybeSingle()` payment lookups
  //    would choke on a split booking's many payment rows anyway. ──────
  //
  // Collecting: the fixture dies pre-confirm. Flip FIRST (claims and
  // settle stop instantly), then refund every succeeded share/cover 100%
  // — plain platform refunds, nothing has transferred (ADR-0027). The
  // refund keys are the SWEEPER'S keys (`expire-refund:{payment_id}`), so
  // a crash mid-loop is healed by the next 5-minute tick with Stripe
  // dedup making the overlap harmless.
  if (booking.is_split && booking.state === 'collecting') {
    const { data: sumRows, error: sumErr } = await supa
      .from('payments')
      .select('id, stripe_payment_intent_id, amount_cents, status, kind')
      .eq('booking_id', booking.id)
      .in('kind', ['share', 'cover']);
    if (sumErr) {
      console.error('split payments load failed (collecting cancel)', sumErr);
      return errorResponse('DB_ERROR', 'Failed to load payments', 500);
    }
    const payments = sumRows ?? [];
    const succeeded = payments.filter((p) => p.status === 'succeeded');
    const refundTotal = succeeded.reduce((a, p) => a + p.amount_cents, 0);

    const { data: flipped, error: flipErr } = await supa
      .from('bookings')
      .update({
        state: 'cancelled',
        cancelled_at: nowIso,
        cancellation_refund_cents: refundTotal,
      })
      .eq('id', booking.id)
      .eq('state', 'collecting')
      .select('id')
      .maybeSingle();
    if (flipErr) {
      console.error('collecting cancel flip failed', flipErr);
      return errorResponse('DB_ERROR', 'Failed to update booking', 500);
    }
    if (!flipped) {
      // Confirmed or expired between load and flip. Tell the truth and let
      // the client re-read; a retry lands in the right branch.
      return errorResponse('INVALID_BOOKING_STATE', 'Fixture changed state — retry', 409);
    }

    for (const p of succeeded) {
      try {
        await stripe.refunds.create(
          { payment_intent: p.stripe_payment_intent_id },
          { idempotencyKey: `expire-refund:${p.id}` },
        );
      } catch (err) {
        // Logged and left for the sweeper: the booking is already
        // cancelled, and pass (b) selects exactly this row next tick.
        console.error('share refund failed; sweeper will retry', p.id, err);
        continue;
      }
      await supa
        .from('payments')
        .update({ status: 'refunded', refunded_amount_cents: p.amount_cents })
        .eq('id', p.id);
    }

    // Best-effort: kill the PIs still sitting at someone's card sheet so
    // they can't settle into the orphan-refund path minutes later.
    for (const p of payments.filter((x) =>
      ['requires_payment_method', 'requires_confirmation', 'processing'].includes(x.status)
    )) {
      try {
        await stripe.paymentIntents.cancel(p.stripe_payment_intent_id);
        await supa.from('payments').update({ status: 'cancelled' }).eq('id', p.id);
      } catch (err) {
        console.warn('live share PI cancel failed (webhook will orphan-refund)', p.id, err);
      }
    }

    const responseBody = {
      booking: {
        id: booking.id,
        state: 'cancelled' as const,
        cancellation_refund_cents: refundTotal,
      },
    };
    if (idempotencyKey) {
      await storeIdempotentResponse(supa, idempotencyKey, user.id, requestHash, 200, responseBody);
    }
    return jsonResponse(responseBody, 200);
  }

  // Confirmed split: policy math on the total, fanned out pro-rata across
  // every succeeded share/cover, plus ONE proportional reversal of the
  // venue Transfer (ADR-0026 semantics, applied once). Stripe work first,
  // state flip last: a crash mid-fan-out leaves state 'confirmed', so the
  // client's retry re-runs the whole branch and Stripe's per-payment keys
  // dedup everything already done.
  if (booking.is_split && booking.state === 'confirmed') {
    if (!booking.stripe_transfer_id) {
      // Confirmed split money with no recorded Transfer is corruption, not
      // a case to guess through.
      console.error('confirmed split booking missing stripe_transfer_id', booking.id);
      return errorResponse('INTERNAL_ERROR', 'Fixture payout record missing', 500);
    }

    const policy = booking.cancellation_policy as CancellationPolicy;
    const bps = refundBpsForPolicy(policy, hoursBetween(new Date(booking.starts_at), new Date()));

    const { data: shareRows, error: shareErr } = await supa
      .from('payments')
      .select('id, stripe_payment_intent_id, amount_cents')
      .eq('booking_id', booking.id)
      .in('kind', ['share', 'cover'])
      .eq('status', 'succeeded');
    if (shareErr) {
      console.error('split payments load failed (confirmed cancel)', shareErr);
      return errorResponse('DB_ERROR', 'Failed to load payments', 500);
    }

    let refundTotal = 0;
    if (bps > 0) {
      for (const p of shareRows ?? []) {
        const part = proRataCents(p.amount_cents, bps);
        if (part <= 0) continue;
        try {
          await stripe.refunds.create(
            { payment_intent: p.stripe_payment_intent_id, amount: part },
            { idempotencyKey: `cancel-share:${p.id}` },
          );
        } catch (err) {
          const stripeCode = (err as { code?: string })?.code;
          console.error('pro-rata share refund failed', p.id, err);
          return errorResponse(
            'STRIPE_ERROR',
            'Share refund failed — retry the cancellation',
            502,
            stripeCode ? { stripe_code: stripeCode } : undefined,
          );
        }
        await supa
          .from('payments')
          .update({
            status: bps === 10_000 ? 'refunded' : 'partially_refunded',
            refunded_amount_cents: part,
          })
          .eq('id', p.id);
        refundTotal += part;
      }

      // The one reversal: the venue gives back the same fraction of the
      // one Transfer. That Transfer was NET of the fee (total −
      // platform_fee_cents), so reversing X% of it leaves Ludi (1 − X%) of
      // the fee through the balance math — no fee refund exists or is
      // needed, unlike the single-payer destination charge, whose transfer
      // is the full amount (ADR-0026 amendment).
      const reversal = proRataCents(booking.total_cents - booking.platform_fee_cents, bps);
      if (reversal > 0) {
        try {
          await stripe.transfers.createReversal(
            booking.stripe_transfer_id,
            { amount: reversal },
            { idempotencyKey: `cancel-reversal:${booking.id}` },
          );
        } catch (err) {
          const stripeCode = (err as { code?: string })?.code;
          console.error('transfer reversal failed', booking.id, err);
          return errorResponse(
            'STRIPE_ERROR',
            'Venue reversal failed — retry the cancellation',
            502,
            stripeCode ? { stripe_code: stripeCode } : undefined,
          );
        }
      }
    }

    const terminal = bps > 0 ? 'refunded' : 'cancelled_no_refund';
    const { error: flipErr } = await supa
      .from('bookings')
      .update({
        state: terminal,
        cancelled_at: nowIso,
        cancellation_refund_cents: refundTotal,
      })
      .eq('id', booking.id)
      .eq('state', 'confirmed');
    if (flipErr) {
      console.error('confirmed split cancel flip failed', flipErr);
      return errorResponse('DB_ERROR', 'Failed to update booking', 500);
    }

    const responseBody = {
      booking: {
        id: booking.id,
        state: terminal,
        cancellation_refund_cents: refundTotal,
      },
    };
    if (idempotencyKey) {
      await storeIdempotentResponse(supa, idempotencyKey, user.id, requestHash, 200, responseBody);
    }
    return jsonResponse(responseBody, 200);
  }

  // 6a. Pending: cancel the PaymentIntent (no charge to refund), set
  //     state='cancelled'. Cleanup cron would have done this anyway after
  //     15 min of inactivity, but explicit cancel gives the user immediate
  //     UI feedback and frees the slot now.
  if (booking.state === 'pending') {
    const { data: payment, error: payErr } = await supa
      .from('payments')
      .select('stripe_payment_intent_id')
      .eq('booking_id', booking.id)
      .maybeSingle();
    if (payErr) {
      console.error('payment lookup failed (pending cancel)', payErr);
      return errorResponse('DB_ERROR', 'Failed to load payment', 500);
    }

    if (payment?.stripe_payment_intent_id) {
      // Best-effort — if the PI was already canceled by the cleanup cron
      // (or never existed in a degenerate state), Stripe returns a
      // resource-error which we tolerate. Logging is enough; the booking
      // state matters more than the Stripe state for what the user sees.
      try {
        await stripe.paymentIntents.cancel(payment.stripe_payment_intent_id);
      } catch (err) {
        // A cancel can also fail because the player just PAID — the webhook
        // hasn't flipped the booking yet. Cancelling the booking then would
        // strand the money: the webhook only auto-refunds
        // `cancelled_no_refund`, so a `cancelled` booking keeps the charge.
        // Refuse, and let the cancel be retried once the booking confirms.
        const pi = await stripe.paymentIntents
          .retrieve(payment.stripe_payment_intent_id)
          .catch(() => null);
        if (pi && ['succeeded', 'processing', 'requires_capture'].includes(pi.status)) {
          return errorResponse(
            'INVALID_BOOKING_STATE',
            'Payment is completing — try again in a moment',
            409,
          );
        }
        console.warn('PI cancel failed (likely already cancelled)', err);
      }
    }

    const { error: bErr } = await supa
      .from('bookings')
      .update({
        state: 'cancelled',
        cancelled_at: nowIso,
        cancellation_refund_cents: 0,
      })
      .eq('id', booking.id)
      .eq('state', 'pending'); // optimistic: don't overwrite a webhook that beat us
    if (bErr) {
      console.error('booking cancel update failed', bErr);
      return errorResponse('DB_ERROR', 'Failed to update booking', 500);
    }

    const responseBody = {
      booking: {
        id: booking.id,
        state: 'cancelled' as const,
        cancellation_refund_cents: 0,
      },
    };
    if (idempotencyKey) {
      await storeIdempotentResponse(
        supa,
        idempotencyKey,
        user.id,
        requestHash,
        200,
        responseBody,
      );
    }
    return jsonResponse(responseBody, 200);
  }

  // 6b. Paid / confirmed: compute refund, issue via Stripe, eager-flip
  //     booking state. The charge.refunded webhook arrives ~seconds later
  //     and syncs payments.refunded_amount_cents (+ would also flip
  //     bookings.state, but we already did, and its filter excludes our
  //     terminal states so it no-ops without overwriting).
  const policy = booking.cancellation_policy as CancellationPolicy;
  const hoursToSlot = hoursBetween(new Date(booking.starts_at), new Date());
  const refund = computeRefund({
    totalCents: booking.total_cents,
    policy,
    hoursToSlot,
  });
  // An admin goodwill refund (admin-refund-booking, partial) leaves the
  // booking standing with money already returned. The policy amount is
  // computed on the whole booking, so cap it at what is still refundable —
  // Stripe refuses a refund beyond the charge's remaining balance, which
  // would leave the player unable to cancel at all.
  const alreadyRefunded = booking.cancellation_refund_cents ?? 0;
  const refundNowCents = Math.min(
    refund.refundCents,
    Math.max(booking.total_cents - alreadyRefunded, 0),
  );
  const refundTotalCents = alreadyRefunded + refundNowCents;

  const { data: payment, error: payErr } = await supa
    .from('payments')
    .select('stripe_payment_intent_id')
    .eq('booking_id', booking.id)
    .maybeSingle();
  if (payErr) {
    console.error('payment lookup failed (refund cancel)', payErr);
    return errorResponse('DB_ERROR', 'Failed to load payment', 500);
  }
  if (!payment?.stripe_payment_intent_id) {
    // Schema says payment row is created alongside paid bookings. If
    // missing, something upstream is broken — better to fail loud than
    // mark the booking refunded without actually refunding anyone.
    console.error('paid booking has no payment row', booking.id);
    return errorResponse('PAYMENT_NOT_FOUND', 'Payment row missing for booking', 500);
  }

  if (refundNowCents > 0) {
    try {
      await stripe.refunds.create(
        {
          payment_intent: payment.stripe_payment_intent_id,
          amount: refundNowCents,
          // Destination charge (ADR-0026, amended 2026-09-13). The transfer
          // carried the FULL amount to the venue, so reverse_transfer alone
          // takes the whole refund from the venue while Ludi keeps its whole
          // fee — measured in test mode: €43 refunded 50% left venue €17.20
          // / Ludi €4.30. refund_application_fee returns the fee pro-rata,
          // landing on the contract's €19.35 / €2.15: commission only on
          // what the venue kept (agreement clause 6.4).
          reverse_transfer: true,
          refund_application_fee: true,
        },
        // Scope idempotency to the booking, NOT the request key — that
        // way a client that re-issues the cancel after losing the
        // response gets the same refund (Stripe-side dedup) instead of
        // a second one.
        { idempotencyKey: `cancel:${booking.id}` },
      );
    } catch (err) {
      const stripeCode = (err as { code?: string })?.code;
      console.error('stripe refund failed', err);
      return errorResponse(
        'STRIPE_ERROR',
        'The refund could not be issued just now. Try cancelling again in a minute.',
        502,
        stripeCode ? { stripe_code: stripeCode } : undefined,
      );
    }
  }

  const newState = refund.terminalState; // 'refunded' or 'cancelled_no_refund'
  const { error: bErr } = await supa
    .from('bookings')
    .update({
      state: newState,
      cancelled_at: nowIso,
      cancellation_refund_cents: refundTotalCents,
    })
    .eq('id', booking.id)
    .in('state', ['paid', 'confirmed']); // don't clobber an admin-set state
  if (bErr) {
    // Stripe already refunded; the webhook will sync the row when it
    // arrives. Log and still return success so the user sees their
    // money's on its way.
    console.error('booking refund update failed (webhook will sync)', bErr);
  }

  const responseBody = {
    booking: {
      id: booking.id,
      state: newState,
      cancellation_refund_cents: refundTotalCents,
    },
  };
  if (idempotencyKey) {
    await storeIdempotentResponse(
      supa,
      idempotencyKey,
      user.id,
      requestHash,
      200,
      responseBody,
    );
  }
  return jsonResponse(responseBody, 200);
}));
