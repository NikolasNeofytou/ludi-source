// _tests/share-math.test.ts
// The split-fixture arithmetic (C2 W3). The one property everything else
// leans on: shares plus the organiser's remainder reconstruct the total
// exactly — settle_split_booking() confirms on equality, so a single cent
// of drift would strand every fixture at 'collecting' forever.

import { assert, assertEquals, assertThrows } from 'std/assert/mod.ts';
import {
  collectDeadline,
  organiserShareCents,
  proRataCents,
  shareAmountCents,
  splitCreatable,
} from '../_shared/share-math.ts';

Deno.test('sum invariant holds across awkward totals and every squad size', () => {
  // 10 (5-a-side), 14 (7-a-side), 22 (11-a-side) — plus 2, the degenerate
  // minimum the guard allows.
  const slotGrid = [2, 10, 14, 22];
  // Primes, round numbers, off-by-one-cent totals.
  const totals = [4500, 4499, 4501, 3001, 9973, 100, 12345, 87, 999999];
  for (const slots of slotGrid) {
    for (const total of totals) {
      if (total < slots) continue; // sub-cent shares are not real fixtures
      const share = shareAmountCents(total, slots);
      const organiser = organiserShareCents(total, slots);
      assertEquals(
        share * (slots - 1) + organiser,
        total,
        `sum invariant broke at total=${total} slots=${slots}`,
      );
      assert(organiser >= share, 'organiser absorbs the remainder UPWARD');
      assert(organiser < share + slots, 'remainder bounded by slots-1 cents');
    }
  }
});

Deno.test('the 5-a-side €45 fixture everyone will actually book', () => {
  assertEquals(shareAmountCents(4500, 10), 450);
  assertEquals(organiserShareCents(4500, 10), 450);
});

Deno.test('rounding lands on the organiser, never the mates', () => {
  // €44.99 across 10: mates pay a clean 449; the organiser eats the 9
  // leftover cents (they chose the split).
  assertEquals(shareAmountCents(4499, 10), 449);
  assertEquals(organiserShareCents(4499, 10), 458);
});

Deno.test('rejects garbage before it becomes money', () => {
  assertThrows(() => shareAmountCents(0, 10));
  assertThrows(() => shareAmountCents(45.5, 10));
  assertThrows(() => shareAmountCents(4500, 1));
  assertThrows(() => shareAmountCents(4500, 9.5));
});

Deno.test('collectDeadline is T-24h', () => {
  const kickoff = new Date('2026-09-05T18:00:00Z');
  assertEquals(collectDeadline(kickoff).toISOString(), '2026-09-04T18:00:00.000Z');
});

Deno.test('proRataCents: the fan-out never refunds more than the policy owes', () => {
  // W5's confirmed-split cancellation: each payer's slice floors, so the
  // fanned-out total is <= proRataCents(total) and the shortfall is < one
  // cent per payer.
  const totals = [4500, 4499, 9973, 12345];
  const bpsGrid = [0, 2500, 5000, 7500, 10000];
  for (const total of totals) {
    for (const bps of bpsGrid) {
      for (const slots of [10, 14, 22]) {
        const share = shareAmountCents(total, slots);
        const organiser = organiserShareCents(total, slots);
        const fanned = share !== null
          ? proRataCents(share, bps) * (slots - 1) + proRataCents(organiser, bps)
          : 0;
        const policyRefund = proRataCents(total, bps);
        assert(fanned <= policyRefund, `fanned ${fanned} > policy ${policyRefund}`);
        assert(policyRefund - fanned < slots, 'shortfall bounded by one cent per payer');
      }
    }
  }
  assertEquals(proRataCents(450, 5000), 225);
  assertEquals(proRataCents(450, 0), 0);
  assertEquals(proRataCents(450, 10000), 450);
  assertEquals(proRataCents(451, 5000), 225); // floors
});

Deno.test('proRataCents rejects garbage', () => {
  assertThrows(() => proRataCents(-1, 5000));
  assertThrows(() => proRataCents(450, 10001));
  assertThrows(() => proRataCents(450, -1));
  assertThrows(() => proRataCents(450.5, 5000));
});

Deno.test('splitCreatable: the 26h boundary, both sides', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const at = (h: number) => new Date(now.getTime() + h * 3600_000);
  assert(splitCreatable(at(26), now), 'exactly 26h out is creatable');
  assert(splitCreatable(at(48), now));
  assert(!splitCreatable(at(25.99), now), 'inside 26h is refused (cut list #4)');
  assert(!splitCreatable(at(2), now));
});
