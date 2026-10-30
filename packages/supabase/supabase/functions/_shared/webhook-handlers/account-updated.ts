// _shared/webhook-handlers/account-updated.ts
//
// `account.updated` — fires whenever a venue's Stripe Connect account state
// changes (onboarding complete, new ID doc required, disabled, etc).
// Reflect the new status on the venue row; the venue-side trigger in
// migration 008 cascades pitch.is_verified=false if the venue leaves
// active.

import type Stripe from 'stripe';
import type { Handler } from './types.ts';

export type VenueStripeStatus = 'pending' | 'active' | 'restricted' | 'disabled';

/**
 * Map a Stripe Account to the venue.stripe_account_status enum.
 * Pure function — unit-tested without stripe or DB.
 *
 * `details_submitted` is the hinge (41o): a just-created Express account
 * has `currently_due` non-empty and often `disabled_reason:
 * 'requirements.past_due'` BY DEFINITION — Stripe restating "KYC not done
 * yet", not an incident. Reading those literally painted every fresh venue
 * red for doing nothing wrong. Until the owner has been through hosted
 * onboarding once, the honest status is `pending`; `restricted` and
 * non-rejection `disabled` are reserved for accounts that submitted and
 * then developed a problem. A rejection is the one pre-submission state
 * that really is terminal, so it stays `disabled` regardless.
 */
export function mapAccountToStatus(account: Stripe.Account): VenueStripeStatus {
  if (account.charges_enabled && account.payouts_enabled) return 'active';

  const requirements = account.requirements;
  // Rejected (fraud, terms of service, platform) — terminal whether or not
  // onboarding ever happened.
  if (requirements?.disabled_reason?.startsWith('rejected')) return 'disabled';
  // Never finished onboarding: the normal fresh state.
  if (!account.details_submitted) return 'pending';
  // From here on the owner HAS submitted — Stripe's complaints are real.
  // `disabled_reason` set => Stripe has hard-disabled the account.
  if (requirements?.disabled_reason) return 'disabled';
  // Items `currently_due` mean the account is up and running for now but
  // will be restricted unless the owner submits the listed documents.
  if (requirements?.currently_due && requirements.currently_due.length > 0) {
    return 'restricted';
  }
  return 'pending';
}

export const accountUpdated: Handler = async ({ supa, event }) => {
  const account = event.data.object as Stripe.Account;
  const status = mapAccountToStatus(account);

  const { error, data } = await supa
    .from('venues')
    .update({ stripe_account_status: status })
    .eq('stripe_account_id', account.id)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`venue update failed: ${error.message}`);
  if (!data) {
    // A Stripe account we don't have a venue for — could be a pre-prod
    // account or a deleted venue. Log and move on.
    console.warn('account.updated for unknown stripe_account_id', account.id);
    return { status: 200, notes: 'unknown-account' };
  }

  return { status: 200, notes: `status:${status}` };
};
