// _tests/cancellation-policy.test.ts
// Pure-math tests for the cancellation refund table. No DB, no Stripe.

import { assertEquals, assertThrows } from 'std/assert/mod.ts';
import {
  cancelBlockedByKickoff,
  computeRefund,
  hoursBetween,
  refundBpsForPolicy,
} from '../_shared/cancellation-policy.ts';

// ── refundBpsForPolicy: the contract table verbatim ────────────────────

Deno.test('>24h: every policy refunds 100%', () => {
  for (const policy of ['standard', 'strict', 'flex'] as const) {
    assertEquals(refundBpsForPolicy(policy, 24), 10_000);
    assertEquals(refundBpsForPolicy(policy, 48), 10_000);
    assertEquals(refundBpsForPolicy(policy, 100_000), 10_000);
  }
});

Deno.test('6-24h: standard 50%, strict 0%, flex 100%', () => {
  for (const h of [6, 12, 23.99]) {
    assertEquals(refundBpsForPolicy('standard', h), 5_000);
    assertEquals(refundBpsForPolicy('strict', h), 0);
    assertEquals(refundBpsForPolicy('flex', h), 10_000);
  }
});

Deno.test('<6h: standard 0%, strict 0%, flex 50%', () => {
  for (const h of [5.99, 1, 0.0001]) {
    assertEquals(refundBpsForPolicy('standard', h), 0);
    assertEquals(refundBpsForPolicy('strict', h), 0);
    assertEquals(refundBpsForPolicy('flex', h), 5_000);
  }
});

Deno.test('kicked off (zero or negative hours): nothing back on any policy', () => {
  // The Edge Function refuses with ALREADY_STARTED before reaching the
  // math; this is the second line. flex used to fall into its <6h tier
  // here and pay 50% of a game already played.
  for (const policy of ['standard', 'strict', 'flex'] as const) {
    assertEquals(refundBpsForPolicy(policy, 0), 0);
    assertEquals(refundBpsForPolicy(policy, -1), 0);
    assertEquals(refundBpsForPolicy(policy, -100), 0);
  }
});

// ── cancelBlockedByKickoff: the ALREADY_STARTED gate ───────────────────

const KICKOFF = new Date('2026-10-24T18:00:00Z');
const at = (iso: string) => new Date(iso);

Deno.test('kickoff gate: money-holding states close at starts_at', () => {
  for (const state of ['paid', 'confirmed', 'collecting']) {
    assertEquals(cancelBlockedByKickoff(state, KICKOFF, at('2026-10-24T17:59:59Z')), false);
    assertEquals(cancelBlockedByKickoff(state, KICKOFF, at('2026-10-24T18:00:00Z')), true);
    assertEquals(cancelBlockedByKickoff(state, KICKOFF, at('2026-10-24T19:30:00Z')), true);
  }
});

Deno.test('kickoff gate: an unpaid pending booking can still be released', () => {
  // Cancelling a pending booking only kills the open PaymentIntent.
  assertEquals(cancelBlockedByKickoff('pending', KICKOFF, at('2026-10-24T19:30:00Z')), false);
});

// ── computeRefund: integer cents + terminalState mapping ───────────────

Deno.test('computeRefund: 100% of 4000c is 4000c, refunded', () => {
  const out = computeRefund({ totalCents: 4000, policy: 'standard', hoursToSlot: 48 });
  assertEquals(out.refundCents, 4000);
  assertEquals(out.terminalState, 'refunded');
});

Deno.test('computeRefund: 50% of 4001c floors to 2000c (user-favours-venue)', () => {
  // 4001 * 5000 / 10000 = 2000.5 → floor 2000.
  // Floor in the venue's favour: refund the user 2000, venue keeps 2001.
  const out = computeRefund({ totalCents: 4001, policy: 'standard', hoursToSlot: 12 });
  assertEquals(out.refundCents, 2000);
  assertEquals(out.terminalState, 'refunded');
});

Deno.test('computeRefund: 0% refund routes to cancelled_no_refund', () => {
  const out = computeRefund({ totalCents: 4000, policy: 'strict', hoursToSlot: 12 });
  assertEquals(out.refundCents, 0);
  assertEquals(out.terminalState, 'cancelled_no_refund');
});

Deno.test('computeRefund: <6h flex still gives 50%', () => {
  const out = computeRefund({ totalCents: 6000, policy: 'flex', hoursToSlot: 2 });
  assertEquals(out.refundCents, 3000);
  assertEquals(out.terminalState, 'refunded');
});

Deno.test('computeRefund: rejects zero/negative totalCents', () => {
  assertThrows(() =>
    computeRefund({ totalCents: 0, policy: 'standard', hoursToSlot: 48 }),
  );
  assertThrows(() =>
    computeRefund({ totalCents: -100, policy: 'standard', hoursToSlot: 48 }),
  );
});

Deno.test('computeRefund: rejects non-finite hoursToSlot', () => {
  assertThrows(() =>
    computeRefund({ totalCents: 4000, policy: 'standard', hoursToSlot: NaN }),
  );
  assertThrows(() =>
    computeRefund({ totalCents: 4000, policy: 'standard', hoursToSlot: Infinity }),
  );
});

// ── hoursBetween: timezone-agnostic, uses millisecond delta ─────────────

Deno.test('hoursBetween: exact hour delta', () => {
  const a = new Date('2026-05-01T12:00:00Z');
  const b = new Date('2026-05-01T10:30:00Z');
  assertEquals(hoursBetween(a, b), 1.5);
});

Deno.test('hoursBetween: negative when later < earlier', () => {
  const a = new Date('2026-05-01T10:00:00Z');
  const b = new Date('2026-05-01T12:00:00Z');
  assertEquals(hoursBetween(a, b), -2);
});
