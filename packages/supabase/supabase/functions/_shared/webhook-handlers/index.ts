// _shared/webhook-handlers/index.ts
// Registry of Stripe event types we process. Keeping this table small and
// explicit forces a conscious decision every time a new event type becomes
// interesting — no silent "we started handling this three months ago".

import type { Handler } from './types.ts';
import { paymentIntentSucceeded } from './payment-intent-succeeded.ts';
import { paymentIntentPaymentFailed } from './payment-intent-payment-failed.ts';
import { chargeRefunded } from './charge-refunded.ts';
import { accountUpdated } from './account-updated.ts';
import { payoutFailed, payoutPaid } from './payout-events.ts';

export const HANDLERS: Record<string, Handler> = {
  'payment_intent.succeeded': paymentIntentSucceeded,
  'payment_intent.payment_failed': paymentIntentPaymentFailed,
  'charge.refunded': chargeRefunded,
  'account.updated': accountUpdated,
  'payout.paid': payoutPaid,
  'payout.failed': payoutFailed,
};

export type { Handler, HandlerContext, HandlerResult } from './types.ts';
