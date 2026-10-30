// _tests/account-updated.test.ts
// Pure-function tests for the Stripe Account → venue.stripe_account_status
// mapping. Covers each branch of the state machine.

import { assertEquals } from 'std/assert/mod.ts';
import type Stripe from 'stripe';
import { mapAccountToStatus } from '../_shared/webhook-handlers/account-updated.ts';

// Helper: build a minimal Account with sensible defaults, override per test.
// details_submitted defaults false — the fresh-account state; tests for
// post-onboarding problems (restricted, non-rejection disabled) must say
// details_submitted: true explicitly, because that submission is exactly
// what makes those statuses honest (41o).
function mkAccount(overrides: Partial<Stripe.Account> = {}): Stripe.Account {
  return {
    id: 'acct_test',
    object: 'account',
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    requirements: {
      currently_due: [],
      eventually_due: [],
      past_due: [],
      pending_verification: [],
      disabled_reason: null,
      errors: [],
    } as unknown as Stripe.Account.Requirements,
    ...overrides,
  } as unknown as Stripe.Account;
}

Deno.test('active when charges AND payouts both enabled', () => {
  const status = mapAccountToStatus(
    mkAccount({ charges_enabled: true, payouts_enabled: true }),
  );
  assertEquals(status, 'active');
});

Deno.test('disabled when disabled_reason is set', () => {
  const status = mapAccountToStatus(
    mkAccount({
      charges_enabled: false,
      payouts_enabled: false,
      requirements: {
        currently_due: [],
        eventually_due: [],
        past_due: [],
        pending_verification: [],
        disabled_reason: 'rejected.fraud',
        errors: [],
      } as unknown as Stripe.Account.Requirements,
    }),
  );
  assertEquals(status, 'disabled');
});

Deno.test('restricted when currently_due has items after submission', () => {
  const status = mapAccountToStatus(
    mkAccount({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: {
        currently_due: ['individual.verification.document'],
        eventually_due: [],
        past_due: [],
        pending_verification: [],
        disabled_reason: null,
        errors: [],
      } as unknown as Stripe.Account.Requirements,
    }),
  );
  assertEquals(status, 'restricted');
});

Deno.test('fresh account with currently_due is pending, not restricted (41o)', () => {
  // A just-created Express account has currently_due non-empty BY
  // DEFINITION — before the owner has even opened hosted onboarding.
  // Painting that red flagged every new venue for doing nothing wrong.
  const status = mapAccountToStatus(
    mkAccount({
      requirements: {
        currently_due: ['individual.verification.document', 'external_account'],
        eventually_due: [],
        past_due: [],
        pending_verification: [],
        disabled_reason: null,
        errors: [],
      } as unknown as Stripe.Account.Requirements,
    }),
  );
  assertEquals(status, 'pending');
});

Deno.test('fresh account with requirements.past_due is pending, not disabled (41o)', () => {
  // Stripe sets disabled_reason: 'requirements.past_due' on brand-new
  // accounts too — it just restates "KYC not done yet".
  const status = mapAccountToStatus(
    mkAccount({
      requirements: {
        currently_due: ['individual.id_number'],
        eventually_due: [],
        past_due: ['individual.id_number'],
        pending_verification: [],
        disabled_reason: 'requirements.past_due',
        errors: [],
      } as unknown as Stripe.Account.Requirements,
    }),
  );
  assertEquals(status, 'pending');
});

Deno.test('rejection is disabled even before submission', () => {
  // The one pre-submission state that really is terminal.
  const status = mapAccountToStatus(
    mkAccount({
      requirements: {
        currently_due: [],
        eventually_due: [],
        past_due: [],
        pending_verification: [],
        disabled_reason: 'rejected.terms_of_service',
        errors: [],
      } as unknown as Stripe.Account.Requirements,
    }),
  );
  assertEquals(status, 'disabled');
});

Deno.test('pending otherwise (fresh onboarding, no blockers yet)', () => {
  const status = mapAccountToStatus(mkAccount());
  assertEquals(status, 'pending');
});

Deno.test('charges enabled but payouts not → pending (not active)', () => {
  // Stripe often enables charges before payouts during onboarding.
  const status = mapAccountToStatus(
    mkAccount({ charges_enabled: true, payouts_enabled: false }),
  );
  assertEquals(status, 'pending');
});

Deno.test('payouts enabled but charges not → pending', () => {
  const status = mapAccountToStatus(
    mkAccount({ charges_enabled: false, payouts_enabled: true }),
  );
  assertEquals(status, 'pending');
});

Deno.test('disabled_reason trumps currently_due after submission', () => {
  // An account with both requirements AND disabled_reason should be
  // classified disabled — it's a harder state than restricted.
  const status = mapAccountToStatus(
    mkAccount({
      details_submitted: true,
      requirements: {
        currently_due: ['individual.id_number'],
        eventually_due: [],
        past_due: [],
        pending_verification: [],
        disabled_reason: 'requirements.past_due',
        errors: [],
      } as unknown as Stripe.Account.Requirements,
    }),
  );
  assertEquals(status, 'disabled');
});
