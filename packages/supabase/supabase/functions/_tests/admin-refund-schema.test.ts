// _tests/admin-refund-schema.test.ts
// Zod validation tests for AdminRefundInput.

import { assert, assertFalse } from 'std/assert/mod.ts';
import { AdminRefundInput } from '../_shared/schemas/admin-refund.ts';

const VALID_UUID = '00000000-0000-7000-8000-000000000001';
const VALID_REASON = 'pitch was unplayable due to flooding';

Deno.test('accepts full-refund (amount_cents=null) with valid uuid + reason', () => {
  const out = AdminRefundInput.safeParse({
    booking_id: VALID_UUID,
    amount_cents: null,
    reason: VALID_REASON,
  });
  assert(out.success);
});

Deno.test('accepts partial refund with positive amount_cents', () => {
  const out = AdminRefundInput.safeParse({
    booking_id: VALID_UUID,
    amount_cents: 500,
    reason: VALID_REASON,
  });
  assert(out.success);
});

Deno.test('rejects amount_cents = 0 (Stripe would no-op, but contract says positive)', () => {
  const out = AdminRefundInput.safeParse({
    booking_id: VALID_UUID,
    amount_cents: 0,
    reason: VALID_REASON,
  });
  assertFalse(out.success);
});

Deno.test('rejects negative amount_cents', () => {
  const out = AdminRefundInput.safeParse({
    booking_id: VALID_UUID,
    amount_cents: -100,
    reason: VALID_REASON,
  });
  assertFalse(out.success);
});

Deno.test('rejects fractional amount_cents', () => {
  const out = AdminRefundInput.safeParse({
    booking_id: VALID_UUID,
    amount_cents: 12.5,
    reason: VALID_REASON,
  });
  assertFalse(out.success);
});

Deno.test('rejects missing amount_cents (must be number or null, not omitted)', () => {
  const out = AdminRefundInput.safeParse({
    booking_id: VALID_UUID,
    reason: VALID_REASON,
  });
  assertFalse(out.success);
});

Deno.test('rejects reason shorter than 10 chars', () => {
  const out = AdminRefundInput.safeParse({
    booking_id: VALID_UUID,
    amount_cents: null,
    reason: 'too short',
  });
  assertFalse(out.success);
});

Deno.test('rejects reason longer than 500 chars', () => {
  const out = AdminRefundInput.safeParse({
    booking_id: VALID_UUID,
    amount_cents: null,
    reason: 'x'.repeat(501),
  });
  assertFalse(out.success);
});

Deno.test('accepts reason exactly at 10-char floor', () => {
  const out = AdminRefundInput.safeParse({
    booking_id: VALID_UUID,
    amount_cents: null,
    reason: '1234567890',
  });
  assert(out.success);
});

Deno.test('accepts reason exactly at 500-char ceiling', () => {
  const out = AdminRefundInput.safeParse({
    booking_id: VALID_UUID,
    amount_cents: null,
    reason: 'x'.repeat(500),
  });
  assert(out.success);
});

Deno.test('rejects missing booking_id', () => {
  const out = AdminRefundInput.safeParse({
    amount_cents: null,
    reason: VALID_REASON,
  });
  assertFalse(out.success);
});

Deno.test('rejects non-uuid booking_id', () => {
  const out = AdminRefundInput.safeParse({
    booking_id: 'not-a-uuid',
    amount_cents: null,
    reason: VALID_REASON,
  });
  assertFalse(out.success);
});
