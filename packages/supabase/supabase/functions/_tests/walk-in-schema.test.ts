// _tests/walk-in-schema.test.ts
// Zod validation tests for WalkInInput (M6 #41j).

import { assert, assertEquals, assertFalse } from 'std/assert/mod.ts';
import { WalkInInput } from '../_shared/schemas/walk-in.ts';

const validCreate = {
  action: 'create',
  pitch_id: '00000000-0000-7000-8000-000000000001',
  starts_at: '2026-08-29T17:00:00Z',
  ends_at: '2026-08-29T18:00:00Z',
  customer_name: 'Andreas',
};

Deno.test('create: accepts minimal valid input', () => {
  const res = WalkInInput.safeParse(validCreate);
  assert(res.success);
  if (res.success && res.data.action === 'create') {
    assertEquals(res.data.addons, []); // default
    assertEquals(res.data.price_override_cents, undefined);
  }
});

Deno.test('create: accepts addons, phone, and a price override', () => {
  const res = WalkInInput.safeParse({
    ...validCreate,
    customer_phone: '+357 99 123456',
    addons: [{ code: 'bibs', quantity: 1 }],
    price_override_cents: 3500,
  });
  assert(res.success);
});

Deno.test('create: rejects empty customer_name', () => {
  const res = WalkInInput.safeParse({ ...validCreate, customer_name: '   ' });
  assertFalse(res.success);
});

Deno.test('create: rejects a sub-30-minute slot', () => {
  const res = WalkInInput.safeParse({
    ...validCreate,
    ends_at: '2026-08-29T17:15:00Z',
  });
  assertFalse(res.success);
});

Deno.test('create: rejects ends_at before starts_at', () => {
  const res = WalkInInput.safeParse({
    ...validCreate,
    ends_at: '2026-08-29T16:00:00Z',
  });
  assertFalse(res.success);
});

Deno.test('create: rejects duplicate addon lines', () => {
  const res = WalkInInput.safeParse({
    ...validCreate,
    addons: [
      { code: 'bibs', quantity: 1 },
      { code: 'bibs', quantity: 2 },
    ],
  });
  assertFalse(res.success);
});

Deno.test('create: rejects an override below €1 or above €5000', () => {
  assertFalse(
    WalkInInput.safeParse({ ...validCreate, price_override_cents: 50 }).success,
  );
  assertFalse(
    WalkInInput.safeParse({ ...validCreate, price_override_cents: 600_000 }).success,
  );
});

Deno.test('cancel: accepts booking_id with optional reason', () => {
  const res = WalkInInput.safeParse({
    action: 'cancel',
    booking_id: '00000000-0000-7000-8000-000000000002',
    reason: 'entered the wrong hour',
  });
  assert(res.success);
});

Deno.test('cancel: rejects a missing booking_id', () => {
  const res = WalkInInput.safeParse({ action: 'cancel' });
  assertFalse(res.success);
});

Deno.test('rejects an unknown action', () => {
  const res = WalkInInput.safeParse({ ...validCreate, action: 'block' });
  assertFalse(res.success);
});

// Slice C of plans/owner-contacts.md — the contact picked from the
// typeahead rides along as an id. Optional, because typing a new name is
// still the common case; a uuid when present, because it is looked up.
Deno.test('create: contact_id is optional', () => {
  const res = WalkInInput.safeParse(validCreate);
  assert(res.success);
  if (res.success && res.data.action === 'create') {
    assertEquals(res.data.contact_id, undefined);
  }
});

Deno.test('create: accepts a picked contact_id', () => {
  const res = WalkInInput.safeParse({
    ...validCreate,
    contact_id: '00000000-0000-7000-8000-0000000000c1',
  });
  assert(res.success);
  if (res.success && res.data.action === 'create') {
    assertEquals(res.data.contact_id, '00000000-0000-7000-8000-0000000000c1');
  }
});

Deno.test('create: rejects a contact_id that is not a uuid', () => {
  assertFalse(
    WalkInInput.safeParse({ ...validCreate, contact_id: 'andreas' }).success,
  );
});
