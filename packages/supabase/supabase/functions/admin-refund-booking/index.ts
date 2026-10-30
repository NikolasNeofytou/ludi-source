// admin-refund-booking/index.ts
// POST /admin-refund-booking — staff-initiated override refund.
//
// Contract: docs/api-contract.md §7.3.
// Distinct from cancel-booking, which is the user-facing policy refund:
//
//   cancel-booking    → caller is the booking owner. Amount is derived
//                       from the policy snapshot + hours-to-slot.
//   admin-refund      → caller is staff. Amount is admin-specified
//                       (null = full remaining). Reason is required and
//                       persisted to admin_actions as the audit trail.
//
// Allowed prior states: paid, confirmed, completed.
// Other states are intentionally rejected for v1 — see below.
//
// A refund that brings the running total to the full amount ends the
// booking (refunded_by_admin). A partial one leaves it standing — same
// state, same slot — and can be followed by another (step 9).
//
// Idempotency-Key is REQUIRED here (cancel-booking treats it as optional
// because the user UI only triggers once per booking; admin refunds can
// be partial and repeated, so accidental double-submit risk is higher).
// The key also seeds the Stripe idempotency token, so a client retry of
// the same admin action is deduped end-to-end.

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
import { AdminRefundInput } from '../_shared/schemas/admin-refund.ts';
import { createStripeClient } from '../_shared/stripe.ts';
import { createServiceClient } from '../_shared/supabase.ts';

const ALLOWED_PRIOR_STATES = new Set(['paid', 'confirmed', 'completed']);

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
  }

  // 1. Auth — caller must be signed in AND have role='admin'.
  const user = await getUserFromRequest(req);
  if (!user) return errorResponse('UNAUTHORIZED', 'Missing or invalid token', 401);

  const supa = createServiceClient();

  const { data: callerRow, error: callerErr } = await supa
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (callerErr) {
    console.error('admin role lookup failed', callerErr);
    return errorResponse('DB_ERROR', 'Failed to verify role', 500);
  }
  if (callerRow?.role !== 'admin') {
    return errorResponse('NOT_AUTHORIZED', 'Admin role required', 403);
  }

  // 2. Parse + validate body.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }
  const parsed = AdminRefundInput.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, {
      issues: parsed.error.issues,
    });
  }
  const input = parsed.data;

  // 3. Idempotency — REQUIRED. Without a key we can't dedupe Stripe-side,
  //    and a duplicate admin click would issue a second refund. Bounce.
  let idempotencyKey: string | null;
  try {
    idempotencyKey = readIdempotencyKey(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid Idempotency-Key';
    return errorResponse('VALIDATION_FAILED', message, 400);
  }
  if (!idempotencyKey) {
    return errorResponse(
      'VALIDATION_FAILED',
      'Idempotency-Key header is required for admin refunds',
      400,
    );
  }
  const requestHash = await sha256Hex(canonicalJson(input));

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

  // 4. Load booking.
  const { data: booking, error: bookingErr } = await supa
    .from('bookings')
    .select(
      'id, state, total_cents, cancellation_refund_cents, cancelled_at, is_split, origin',
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

  // 4b. Split fixtures are N payments and one Transfer — this function's
  //     single-PI arithmetic (and its `.maybeSingle()` payment lookup)
  //     would be quietly wrong on them. Their refunds fan out through
  //     cancel-booking and the sweeper (C2 W5); an admin override path
  //     for split money needs its own audit semantics, not this one's.
  if (booking.is_split) {
    return errorResponse(
      'INVALID_BOOKING_STATE',
      'Split fixtures refund share-by-share; the admin single-refund path does not apply',
      409,
    );
  }

  // 4c. Walk-ins were paid at the venue — their payment row is bookkeeping
  //     with a synthetic `offline_<id>` intent, so a Stripe refund can only
  //     502. They are cancelled through create-walk-in-booking
  //     (action='cancel'), which flips the offline payment too.
  if (booking.origin === 'walk_in') {
    return errorResponse(
      'INVALID_BOOKING_STATE',
      'Walk-ins were paid at the venue; cancel them from the bookings page instead',
      409,
    );
  }

  // 5. State guard. v1 only supports refunding bookings that actually
  //    captured money and aren't already in a refund terminal state.
  //    Edge cases (top-up on partial user refund, override on
  //    cancelled_no_refund) deliberately deferred — they need their own
  //    audit semantics.
  if (!ALLOWED_PRIOR_STATES.has(booking.state)) {
    return errorResponse(
      'INVALID_BOOKING_STATE',
      `Booking is in state '${booking.state}'; admin refund requires paid, confirmed, or completed`,
      409,
    );
  }

  // 6. Compute refund amount + remaining-balance guard.
  const alreadyRefunded = booking.cancellation_refund_cents ?? 0;
  const remaining = booking.total_cents - alreadyRefunded;
  if (remaining <= 0) {
    // Defensive: ALLOWED_PRIOR_STATES shouldn't produce this, but if a
    // prior code path bumped cancellation_refund_cents without flipping
    // state, surface it cleanly rather than calling Stripe with 0.
    return errorResponse(
      'REFUND_AMOUNT_EXCEEDS_REMAINING',
      'Booking has no remaining refundable amount',
      409,
    );
  }
  const refundCents = input.amount_cents ?? remaining;
  if (refundCents > remaining) {
    return errorResponse(
      'REFUND_AMOUNT_EXCEEDS_REMAINING',
      `Requested refund (${refundCents}c) exceeds remaining refundable (${remaining}c)`,
      400,
    );
  }

  // 7. Load payment to get the PaymentIntent.
  const { data: payment, error: payErr } = await supa
    .from('payments')
    .select('stripe_payment_intent_id')
    .eq('booking_id', booking.id)
    .maybeSingle();
  if (payErr) {
    console.error('payment lookup failed', payErr);
    return errorResponse('DB_ERROR', 'Failed to load payment', 500);
  }
  if (!payment?.stripe_payment_intent_id) {
    console.error('paid-state booking has no payment row', booking.id);
    return errorResponse('PAYMENT_NOT_FOUND', 'Payment row missing for booking', 500);
  }

  // 8. Stripe refund — same funds-flow posture as cancel-booking
  //    (ADR-0026, amended 2026-09-13): reverse the transfer AND refund the
  //    application fee, both pro-rata. The destination charge transferred
  //    the full amount, so the reversal alone takes the whole refund from
  //    the venue while Ludi keeps its whole fee; the fee refund returns
  //    Ludi's share, leaving commission on the retained amount only
  //    (agreement clause 6.4).
  const stripe = createStripeClient();
  try {
    await stripe.refunds.create(
      {
        payment_intent: payment.stripe_payment_intent_id,
        amount: refundCents,
        reverse_transfer: true,
        refund_application_fee: true,
      },
      // Scope to the HTTP idempotency key so each distinct admin action
      // (different key on same booking) maps to a distinct Stripe
      // refund; a retried action (same key) is deduped end-to-end.
      { idempotencyKey: `admin-refund:${idempotencyKey}` },
    );
  } catch (err) {
    const stripeCode = (err as { code?: string })?.code;
    console.error('stripe refund failed', err);
    return errorResponse(
      'STRIPE_ERROR',
      'Stripe did not accept the refund. The reason is in the function log.',
      502,
      stripeCode ? { stripe_code: stripeCode } : undefined,
    );
  }

  // 9. Accumulate refund cents; only a FULL refund ends the booking.
  //    A partial refund is goodwill on a game that still happens — a fiver
  //    back for a broken floodlight — so the booking stands and keeps its
  //    slot. Flipping it to refunded_by_admin (as v1 did) took it out of
  //    the overlap constraint and get_available_slots, put the hour back
  //    on sale, and dropped it from the owner's Today view: two groups at
  //    one pitch. Mirrors charge.refunded, which also flips on full only.
  const nowIso = new Date().toISOString();
  const newRefundTotal = alreadyRefunded + refundCents;
  const isFullRefund = newRefundTotal >= booking.total_cents;
  const newState = isFullRefund ? 'refunded_by_admin' : booking.state;
  const { error: bErr } = await supa
    .from('bookings')
    .update(
      isFullRefund
        ? {
          state: 'refunded_by_admin',
          cancelled_at: booking.cancelled_at ?? nowIso,
          cancellation_refund_cents: newRefundTotal,
        }
        : { cancellation_refund_cents: newRefundTotal },
    )
    .eq('id', booking.id)
    // Don't overwrite a concurrent state change (e.g. a webhook landing
    // mid-flight). Stripe already refunded; the webhook will reconcile.
    .in('state', Array.from(ALLOWED_PRIOR_STATES));
  if (bErr) {
    console.error('booking refund update failed (webhook will sync)', bErr);
  }

  // 10. Audit row. The refund itself already happened — if the audit
  //     insert fails, we still return 200 (refund is done) but log loud:
  //     manual reconciliation against Stripe will be required.
  const auditPayload = {
    refund_cents: refundCents,
    prior_state: booking.state,
    prior_refund_cents: alreadyRefunded,
    full_refund: isFullRefund,
    stripe_payment_intent_id: payment.stripe_payment_intent_id,
    idempotency_key: idempotencyKey,
  };
  const { data: audit, error: auditErr } = await supa
    .from('admin_actions')
    .insert({
      admin_user_id: user.id,
      action_type: 'refund_booking',
      target_type: 'booking',
      target_id: booking.id,
      reason: input.reason,
      payload: auditPayload,
    })
    .select('id')
    .single();
  if (auditErr || !audit) {
    console.error('admin_actions insert failed — manual reconciliation required', {
      booking_id: booking.id,
      admin_user_id: user.id,
      refund_cents: refundCents,
      err: auditErr,
    });
  }

  const responseBody = {
    booking: {
      id: booking.id,
      state: newState,
      refund_cents: refundCents,
      total_refunded_cents: newRefundTotal,
    },
    admin_action_id: audit?.id ?? null,
  };
  await storeIdempotentResponse(
    supa,
    idempotencyKey,
    user.id,
    requestHash,
    200,
    responseBody,
  );
  return jsonResponse(responseBody, 200);
}));
