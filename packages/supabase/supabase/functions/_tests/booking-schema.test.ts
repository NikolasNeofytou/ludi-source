// _tests/booking-schema.test.ts
// Zod validation tests for CreateBookingInput.

import { assert, assertEquals, assertFalse } from 'std/assert/mod.ts';
import { CreateBookingInput } from '../_shared/schemas/booking.ts';

const validBase = {
  pitch_id: '00000000-0000-7000-8000-000000000001',
  starts_at: '2026-05-01T17:00:00Z',
  ends_at: '2026-05-01T18:00:00Z',
};

Deno.test('accepts minimal valid input', () => {
  const res = CreateBookingInput.safeParse(validBase);
  assert(res.success);
  if (res.success) {
    assertEquals(res.data.addons, []); // default
  }
});

Deno.test('accepts full input with addons and notes', () => {
  const res = CreateBookingInput.safeParse({
    ...validBase,
    addons: [
      { code: 'bibs', quantity: 2 },
      { code: 'ball_rental', quantity: 1 },
    ],
    notes: 'goalkeeper running late',
  });
  assert(res.success);
});

Deno.test('rejects non-uuid pitch_id', () => {
  const res = CreateBookingInput.safeParse({ ...validBase, pitch_id: 'nope' });
  assertFalse(res.success);
});

Deno.test('rejects non-ISO datetime', () => {
  const res = CreateBookingInput.safeParse({
    ...validBase,
    starts_at: '2026-05-01 17:00',
  });
  assertFalse(res.success);
});

Deno.test('rejects ends_at <= starts_at', () => {
  const res = CreateBookingInput.safeParse({
    ...validBase,
    ends_at: '2026-05-01T17:00:00Z',
  });
  assertFalse(res.success);
});

Deno.test('rejects duration under 30 minutes', () => {
  const res = CreateBookingInput.safeParse({
    ...validBase,
    ends_at: '2026-05-01T17:15:00Z',
  });
  assertFalse(res.success);
});

Deno.test('rejects duration over 8 hours', () => {
  const res = CreateBookingInput.safeParse({
    ...validBase,
    ends_at: '2026-05-02T02:00:00Z',
  });
  assertFalse(res.success);
});

Deno.test('rejects unknown addon code', () => {
  const res = CreateBookingInput.safeParse({
    ...validBase,
    addons: [{ code: 'dragon_fire', quantity: 1 }],
  });
  assertFalse(res.success);
});

Deno.test('rejects non-integer addon quantity', () => {
  const res = CreateBookingInput.safeParse({
    ...validBase,
    addons: [{ code: 'bibs', quantity: 1.5 }],
  });
  assertFalse(res.success);
});

Deno.test('rejects duplicate addon codes', () => {
  const res = CreateBookingInput.safeParse({
    ...validBase,
    addons: [
      { code: 'bibs', quantity: 1 },
      { code: 'bibs', quantity: 2 },
    ],
  });
  assertFalse(res.success);
});

Deno.test('rejects notes longer than 500 chars', () => {
  const res = CreateBookingInput.safeParse({
    ...validBase,
    notes: 'x'.repeat(501),
  });
  assertFalse(res.success);
});

Deno.test('accepts a rebooked_from uuid (community v2 chain)', () => {
  const res = CreateBookingInput.safeParse({
    ...validBase,
    rebooked_from: '00000000-0000-7000-8000-000000000099',
  });
  assert(res.success);
  if (res.success) {
    assertEquals(res.data.rebooked_from, '00000000-0000-7000-8000-000000000099');
  }
});

Deno.test('rejects a non-uuid rebooked_from', () => {
  const res = CreateBookingInput.safeParse({
    ...validBase,
    rebooked_from: 'DEV-OPEN-0001',
  });
  assertFalse(res.success);
});
