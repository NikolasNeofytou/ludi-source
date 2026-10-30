// leave-share/index.ts
// POST /leave-share — give up a seat on a split fixture that is still
// collecting, and get the share back (plans/find-my-replacement.md).
//
// split-payment.md promised "leaving after paying = leaving + a share
// refund (100% while collecting)". Leaving shipped as a plain status flip,
// so the paid share stayed behind, the next claimant over-collected, and
// settle_split_booking refused to confirm a fixture that had filled. The
// database now refuses that flip (LEAVE_NEEDS_REFUND); this is the door.
//
//   CORS preflight → JWT → Zod
//   → caller's seat on the booking            (404 NOT_ON_ROSTER)
//   → organiser?                              (409 ORGANISER_CANNOT_LEAVE)
//   → a share PI still open at the card sheet → cancel it at Stripe first
//                                               (409 PAYMENT_IN_FLIGHT if
//                                               it already settled)
//   → begin_leave_share (20261020000102): lock the booking, re-check it
//     is collecting, mark the settled share `refunding` — which
//     settle_split_booking does not count — and seat the player out,
//     in one transaction
//   → refund each `refunding` share at Stripe, outside any lock
//   → 200 { left: true, refunded_cents, refund_pending_cents }
//
// A refund Stripe refuses stays `refunding`: the player is already out,
// so the response says the money is on its way (refund_pending_cents),
// and the expire-collecting sweeper retries it with the same key. A retry
// of this call finds the seat out and the share owed, and tries again.
//
// Off a collecting split fixture this is the same status flip the client
// already makes, so one call is always right.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { getUserFromRequest } from '../_shared/auth.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/errors.ts';
import { LeaveShareInput } from '../_shared/schemas/seat-swap.ts';
import { createStripeClient } from '../_shared/stripe.ts';
import { createServiceClient } from '../_shared/supabase.ts';

const LIVE_PI = ['requires_payment_method', 'requires_confirmation', 'processing'];

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
  const parsed = LeaveShareInput.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, {
      issues: parsed.error.issues,
    });
  }

  const supa = createServiceClient();

  const { data: booking, error: bookingErr } = await supa
    .from('bookings')
    .select('id, user_id, state, is_split')
    .eq('id', parsed.data.booking_id)
    .maybeSingle();
  if (bookingErr) return errorResponse('DB_ERROR', 'Failed to load fixture', 500);
  if (!booking) return errorResponse('NOT_ON_ROSTER', 'You are not on this match', 404);
  if (booking.user_id === user.id) {
    return errorResponse('ORGANISER_CANNOT_LEAVE', 'The organiser cancels instead', 409);
  }

  const { data: seat, error: seatErr } = await supa
    .from('booking_participants')
    .select('id, status')
    .eq('booking_id', booking.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (seatErr) return errorResponse('DB_ERROR', 'Failed to load roster', 500);
  if (!seat) return errorResponse('NOT_ON_ROSTER', 'You are not on this match', 404);

  // 1. A card sheet still open: kill the PI so it cannot settle on an
  //    empty seat. Done before the lock — no row lock waits on Stripe. If
  //    it already settled, Stripe refuses the cancel and the caller
  //    retries; by then it is `succeeded` and goes through the lock below.
  if (seat.status === 'in' && booking.is_split && booking.state === 'collecting') {
    const { data: live, error: liveErr } = await supa
      .from('payments')
      .select('id, stripe_payment_intent_id')
      .eq('participant_id', seat.id)
      .eq('kind', 'share')
      .in('status', LIVE_PI);
    if (liveErr) return errorResponse('DB_ERROR', 'Failed to load share', 500);
    const stripe = createStripeClient();
    for (const share of live ?? []) {
      try {
        await stripe.paymentIntents.cancel(share.stripe_payment_intent_id);
      } catch (_) {
        return errorResponse('PAYMENT_IN_FLIGHT', 'Your payment is still going through; try again', 409);
      }
      await supa.from('payments').update({ status: 'cancelled' }).eq('id', share.id);
    }
  }

  // 2. The locked half: seat out, share marked for refund.
  const { data: owedRows, error: leaveErr } = await supa.rpc('begin_leave_share', {
    p_booking_id: booking.id,
    p_user_id: user.id,
  });
  if (leaveErr) {
    const reason = leaveErr.message ?? '';
    if (reason.includes('LEAVE_NOT_ON_ROSTER')) {
      return errorResponse('NOT_ON_ROSTER', 'You are not on this match', 404);
    }
    if (reason.includes('LEAVE_ORGANISER')) {
      return errorResponse('ORGANISER_CANNOT_LEAVE', 'The organiser cancels instead', 409);
    }
    if (reason.includes('LEAVE_PAYMENT_IN_FLIGHT')) {
      return errorResponse('PAYMENT_IN_FLIGHT', 'Your payment is still going through; try again', 409);
    }
    console.error('begin_leave_share failed', { code: leaveErr.code });
    return errorResponse('DB_ERROR', 'Failed to leave', 500);
  }

  // 3. The money back. Nothing has been transferred while collecting
  //    (ADR-0027): a plain platform refund, keyed per payment so a retry
  //    here or in the sweeper is a no-op at Stripe.
  let refundedCents = 0;
  let pendingCents = 0;
  const owed = (owedRows ?? []) as Array<{
    payment_id: string;
    stripe_payment_intent_id: string;
    amount_cents: number;
  }>;
  const stripe = owed.length > 0 ? createStripeClient() : null;
  for (const share of owed) {
    try {
      await stripe!.refunds.create(
        { payment_intent: share.stripe_payment_intent_id },
        { idempotencyKey: `leave-refund:${share.payment_id}` },
      );
    } catch (err) {
      console.error('leave refund failed; the sweeper retries', {
        payment: share.payment_id,
        stripe_code: (err as { code?: string })?.code,
      });
      pendingCents += share.amount_cents;
      continue;
    }
    await supa
      .from('payments')
      .update({ status: 'refunded', refunded_amount_cents: share.amount_cents })
      .eq('id', share.payment_id)
      .eq('status', 'refunding');
    refundedCents += share.amount_cents;
  }

  console.log(JSON.stringify({
    level: 'info',
    event: 'leave_share',
    booking: booking.id.slice(0, 8),
    refunded_cents: refundedCents,
    refund_pending_cents: pendingCents,
  }));
  return jsonResponse(
    { left: true, refunded_cents: refundedCents, refund_pending_cents: pendingCents },
    200,
  );
}));
