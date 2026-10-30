// _tests/webhook-handlers-registry.test.ts
// Smoke test that the HANDLERS registry exposes exactly the event types
// our documented contract (api-contract.md §5.3) says we handle. If
// someone adds or removes a handler without updating the contract, this
// fails and forces the docs change too.

import { assert, assertEquals } from 'std/assert/mod.ts';
import { HANDLERS } from '../_shared/webhook-handlers/index.ts';

const DOCUMENTED_EVENT_TYPES = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'account.updated',
  'payout.paid',
  'payout.failed',
] as const;

Deno.test('HANDLERS registry exposes every documented event type', () => {
  for (const type of DOCUMENTED_EVENT_TYPES) {
    assert(
      HANDLERS[type] !== undefined,
      `Missing handler for ${type}. Add it or update docs/api-contract.md §5.3.`,
    );
  }
});

Deno.test('HANDLERS registry has no undocumented extras', () => {
  const actual = Object.keys(HANDLERS).sort();
  const expected = [...DOCUMENTED_EVENT_TYPES].sort();
  assertEquals(actual, expected);
});

Deno.test('every handler is a function', () => {
  for (const [type, fn] of Object.entries(HANDLERS)) {
    assertEquals(typeof fn, 'function', `Handler for ${type} must be a function`);
  }
});
