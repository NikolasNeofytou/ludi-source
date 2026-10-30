// _tests/pricing.test.ts
// Pure-function tests for the booking price math. These run without a DB,
// without Stripe, without network — just Deno.

import { assertAlmostEquals, assertEquals, assertThrows } from 'std/assert/mod.ts';
import {
  ADDON_PRICES,
  computeBookingPrice,
  type PriceInputs,
} from '../_shared/pricing.ts';

const baseInput = (): PriceInputs => ({
  startsAt: new Date('2026-05-01T17:00:00Z'),
  endsAt: new Date('2026-05-01T18:00:00Z'),
  pricePerHourCents: 4000, // €40 / hour
  addons: [],
  takeRateBps: 1000, // 10%
});

Deno.test('1-hour slot at €40/h, no addons, 10% fee', () => {
  const p = computeBookingPrice(baseInput());
  assertEquals(p.durationMinutes, 60);
  assertEquals(p.baseCents, 4000);
  assertEquals(p.addonsCents, 0);
  assertEquals(p.totalCents, 4000);
  assertEquals(p.platformFeeCents, 400);
});

Deno.test('90-minute slot pro-rates the hourly price', () => {
  const p = computeBookingPrice({
    ...baseInput(),
    endsAt: new Date('2026-05-01T18:30:00Z'),
  });
  assertEquals(p.durationMinutes, 90);
  assertEquals(p.baseCents, 6000); // 4000 * 90 / 60
  assertEquals(p.totalCents, 6000);
  assertEquals(p.platformFeeCents, 600);
});

Deno.test('addons sum into totalCents and affect the fee', () => {
  const p = computeBookingPrice({
    ...baseInput(),
    addons: [
      { code: 'bibs', quantity: 2 },
      { code: 'ball_rental', quantity: 1 },
    ],
  });
  assertEquals(p.addonsCents, ADDON_PRICES.bibs * 2 + ADDON_PRICES.ball_rental); // 1000 + 300
  assertEquals(p.totalCents, 4000 + 1300);
  assertEquals(p.platformFeeCents, Math.floor((4000 + 1300) * 1000 / 10_000)); // 530
});

Deno.test('platform fee floors so venue gets any sub-cent rounding', () => {
  // total 4003 * 1000 / 10000 = 400.3 → floor = 400
  const p = computeBookingPrice({
    ...baseInput(),
    pricePerHourCents: 4003,
  });
  assertEquals(p.totalCents, 4003);
  assertEquals(p.platformFeeCents, 400);
});

Deno.test('45-minute slot rounds to nearest cent', () => {
  // 4000 * 45 / 60 = 3000 exactly
  const p = computeBookingPrice({
    ...baseInput(),
    endsAt: new Date('2026-05-01T17:45:00Z'),
  });
  assertEquals(p.durationMinutes, 45);
  assertEquals(p.baseCents, 3000);
});

Deno.test('odd duration rounding: 50 minutes @ €40/h', () => {
  // 4000 * 50 / 60 = 3333.33... → rounds to 3333
  const p = computeBookingPrice({
    ...baseInput(),
    endsAt: new Date('2026-05-01T17:50:00Z'),
  });
  assertAlmostEquals(p.baseCents, 3333, 0);
});

Deno.test('rejects ends_at <= starts_at', () => {
  assertThrows(
    () =>
      computeBookingPrice({
        ...baseInput(),
        endsAt: new Date('2026-05-01T17:00:00Z'),
      }),
    Error,
    'ends_at must be after',
  );
});

Deno.test('rejects invalid dates', () => {
  assertThrows(
    () =>
      computeBookingPrice({
        ...baseInput(),
        startsAt: new Date('not-a-date'),
      }),
    Error,
    'valid dates',
  );
});

Deno.test('rejects non-positive pricePerHourCents', () => {
  assertThrows(
    () =>
      computeBookingPrice({
        ...baseInput(),
        pricePerHourCents: 0,
      }),
    Error,
    'pricePerHourCents',
  );
});

Deno.test('rejects takeRateBps out of range', () => {
  assertThrows(
    () =>
      computeBookingPrice({
        ...baseInput(),
        takeRateBps: -1,
      }),
    Error,
    'takeRateBps',
  );
  assertThrows(
    () =>
      computeBookingPrice({
        ...baseInput(),
        takeRateBps: 10_001,
      }),
    Error,
    'takeRateBps',
  );
});

Deno.test('rejects unknown addon code', () => {
  assertThrows(
    () =>
      computeBookingPrice({
        ...baseInput(),
        // @ts-expect-error intentionally invalid at runtime
        addons: [{ code: 'dragon_fire', quantity: 1 }],
      }),
    Error,
    'unknown addon',
  );
});

Deno.test('rejects non-positive addon quantity', () => {
  assertThrows(
    () =>
      computeBookingPrice({
        ...baseInput(),
        addons: [{ code: 'bibs', quantity: 0 }],
      }),
    Error,
    'quantity',
  );
});

Deno.test('ADDON_PRICES contains both Cyprus-mandated addons', () => {
  // Guardrail: if someone deletes one of these, tests fail and they read the
  // memo in the failure about Cyprus law requiring they be offered.
  assertEquals(typeof ADDON_PRICES.bibs, 'number');
  assertEquals(typeof ADDON_PRICES.ball_rental, 'number');
});
