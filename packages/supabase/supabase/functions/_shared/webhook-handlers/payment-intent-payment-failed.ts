// _shared/webhook-handlers/payment-intent-payment-failed.ts
//
// `payment_intent.payment_failed` — record the failure on the payment row,
// leave the booking in `pending` so the user can retry. The cleanup cron
// eventually expires abandoned pending bookings.

import type Stripe from 'stripe';
import type { Handler } from './types.ts';

export const paymentIntentPaymentFailed: Handler = async ({ supa, event }) => {
  const pi = event.data.object as Stripe.PaymentIntent;
  const eventIsoAt = new Date(event.created * 1000).toISOString();
  const failureCode = pi.last_payment_error?.code ?? null;
  const failureMessage = pi.last_payment_error?.message ?? null;

  const { error } = await supa
    .from('payments')
    .update({
      status: 'failed',
      failure_code: failureCode,
      failure_message: failureMessage,
      stripe_latest_event_at: eventIsoAt,
    })
    .eq('stripe_payment_intent_id', pi.id);
  if (error) throw new Error(`payments update failed: ${error.message}`);

  return { status: 200, notes: `failed:${failureCode ?? 'unknown'}` };
};
