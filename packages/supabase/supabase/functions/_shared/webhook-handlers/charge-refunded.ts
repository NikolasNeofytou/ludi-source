// _shared/webhook-handlers/charge-refunded.ts
//
// `charge.refunded` — fires after a refund (ours or a dispute-triggered one).
// Update payments.refunded_amount_cents to match Stripe's running total,
// flip the booking to `refunded` if the refund is full - for a single-payer
// booking only; a split fixture's share is one seat, not the booking.

import type Stripe from 'stripe';
import type { Handler } from './types.ts';

export const chargeRefunded: Handler = async ({ supa, event }) => {
  const charge = event.data.object as Stripe.Charge;
  const eventIsoAt = new Date(event.created * 1000).toISOString();

  if (!charge.payment_intent) {
    return { status: 400, notes: 'charge-without-payment-intent' };
  }
  const piId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent.id;

  const { data: payment, error: pErr } = await supa
    .from('payments')
    .select('id, booking_id, amount_cents, kind')
    .eq('stripe_payment_intent_id', piId)
    .maybeSingle();
  if (pErr) throw new Error(`payments lookup failed: ${pErr.message}`);
  if (!payment) {
    console.error('refund event for unknown payment_intent', piId);
    return { status: 404, notes: 'unknown-payment-intent' };
  }

  const isFullRefund = charge.amount_refunded >= payment.amount_cents;
  const { error: upErr } = await supa
    .from('payments')
    .update({
      status: isFullRefund ? 'refunded' : 'partially_refunded',
      refunded_amount_cents: charge.amount_refunded,
      stripe_latest_event_at: eventIsoAt,
    })
    .eq('id', payment.id);
  if (upErr) throw new Error(`payments update failed: ${upErr.message}`);

  // Only a single-payer booking's own payment speaks for the booking. A
  // split fixture's share or cover refunds one seat's money - a leaver,
  // a late surplus, a swap - and must never flip the whole fixture
  // (found 2026-10-13: a late-share refund on a confirmed fixture would
  // have marked it refunded and freed the slot).
  if (isFullRefund && payment.kind === 'booking') {
    // Only flip if we're moving from an active state — don't overwrite
    // `refunded_by_admin` or `cancelled_no_refund` which the admin flow set
    // on purpose.
    const { error: bErr } = await supa
      .from('bookings')
      .update({ state: 'refunded' })
      .eq('id', payment.booking_id)
      .in('state', ['paid', 'confirmed', 'completed', 'cancelled']);
    if (bErr) throw new Error(`booking refunded update failed: ${bErr.message}`);
  }

  return { status: 200, notes: isFullRefund ? 'full-refund' : 'partial-refund' };
};
