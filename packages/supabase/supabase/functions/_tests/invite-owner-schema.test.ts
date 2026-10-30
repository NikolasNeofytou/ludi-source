// _tests/invite-owner-schema.test.ts
// Zod validation tests for InviteOwnerInput (ADR-0024, hardened in 41n).

import { assert, assertEquals, assertFalse } from 'std/assert/mod.ts';
import { InviteOwnerInput } from '../_shared/schemas/invite-owner.ts';

const VENUE = '00000000-0000-7000-8000-000000000001';

Deno.test('accepts a minimal valid body and defaults', () => {
  const res = InviteOwnerInput.safeParse({
    venue_id: VENUE,
    email: 'owner@theirvenue.cy',
  });
  assert(res.success);
  assertEquals(res.data.owner_role, 'owner');
  assertEquals(res.data.confirm_new_person, false);
});

Deno.test('lowercases and trims the email', () => {
  // The address is both the lookup key and the invite destination —
  // "Owner@" matching nothing while "owner@" matches would be a
  // confusing way to discover case sensitivity.
  const res = InviteOwnerInput.safeParse({
    venue_id: VENUE,
    email: '  Owner@Venue.Example ',
  });
  assert(res.success);
  assertEquals(res.data.email, 'owner@venue.example');
});

Deno.test('accepts confirm_new_person: true', () => {
  const res = InviteOwnerInput.safeParse({
    venue_id: VENUE,
    email: 'second.manager@venue.example',
    confirm_new_person: true,
  });
  assert(res.success);
  assertEquals(res.data.confirm_new_person, true);
});

Deno.test('rejects a non-boolean confirm_new_person', () => {
  // "true" the string must not slip through — the whole point of the flag
  // is a deliberate assertion, not whatever a form serializer produced.
  const res = InviteOwnerInput.safeParse({
    venue_id: VENUE,
    email: 'owner@theirvenue.cy',
    confirm_new_person: 'true',
  });
  assertFalse(res.success);
});

Deno.test('rejects a non-uuid venue_id', () => {
  const res = InviteOwnerInput.safeParse({
    venue_id: 'piacere',
    email: 'owner@theirvenue.cy',
  });
  assertFalse(res.success);
});

Deno.test('rejects an invalid email', () => {
  const res = InviteOwnerInput.safeParse({
    venue_id: VENUE,
    email: 'not-an-address',
  });
  assertFalse(res.success);
});

Deno.test('rejects an unknown owner_role', () => {
  const res = InviteOwnerInput.safeParse({
    venue_id: VENUE,
    email: 'owner@theirvenue.cy',
    owner_role: 'superadmin',
  });
  assertFalse(res.success);
});
