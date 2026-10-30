// _shared/webhook-handlers/payout-events.ts
//
// `payout.paid` / `payout.failed` — 41l. These fire on the venue's
// CONNECTED account, not the platform account, so `event.account` carries
// the acct_… id that resolves to venues.stripe_account_id. (The webhook
// endpoint must be configured to listen to connected-account events in the
// Stripe dashboard, or these never arrive — see docs/api-contract.md §5.3.)
//
// Each event upserts one row in venue_payouts keyed on the payout id: a
// payout that fails after paying (bank bounce sends paid → failed)
// overwrites its own row rather than duplicating. Stripe stays the source
// of truth; this table only lets the owner dashboard answer "when do I get
// paid?" without a Stripe login.

import type Stripe from 'stripe';
import type { Handler, HandlerContext, HandlerResult } from './types.ts';

async function recordPayout(
  { supa, event }: HandlerContext,
  status: 'paid' | 'failed',
): Promise<HandlerResult> {
  // A payout on the PLATFORM account (Ludi's own bank) has no
  // event.account. Not ours to mirror — acknowledge and move on.
  const accountId = event.account;
  if (!accountId) return { status: 200, notes: 'platform-payout' };

  const payout = event.data.object as Stripe.Payout;

  const { data: venue, error: venueErr } = await supa
    .from('venues')
    .select('id')
    .eq('stripe_account_id', accountId)
    .maybeSingle();
  if (venueErr) throw new Error(`venue lookup failed: ${venueErr.message}`);
  if (!venue) {
    // Same posture as account.updated: a connected account we have no
    // venue for (pre-prod, deleted venue). Log and stop retries.
    console.warn(`payout.${status} for unknown stripe_account_id`, accountId);
    return { status: 200, notes: 'unknown-account' };
  }

  const { error: upsertErr } = await supa.from('venue_payouts').upsert(
    {
      stripe_payout_id: payout.id,
      venue_id: venue.id,
      amount_cents: payout.amount,
      currency: payout.currency,
      status,
      arrival_date: new Date(payout.arrival_date * 1000)
        .toISOString()
        .slice(0, 10),
      failure_code: payout.failure_code ?? null,
      failure_message: payout.failure_message ?? null,
    },
    { onConflict: 'stripe_payout_id' },
  );
  if (upsertErr) throw new Error(`venue_payouts upsert failed: ${upsertErr.message}`);

  if (status === 'failed') {
    // A failed payout means the venue's bank rejected their money — loud
    // by design, so it reaches Sentry breadcrumbs and the function logs
    // even before anyone opens the dashboard.
    console.error('venue payout FAILED', {
      venue_id: venue.id,
      payout_id: payout.id,
      amount_cents: payout.amount,
      failure_code: payout.failure_code,
    });
  }

  return { status: 200, notes: `payout:${status}` };
}

export const payoutPaid: Handler = (ctx) => recordPayout(ctx, 'paid');
export const payoutFailed: Handler = (ctx) => recordPayout(ctx, 'failed');
