// _tests/venue-express-login-schema.test.ts
// Zod validation tests for VenueExpressLoginInput (41l).

import { assert, assertFalse } from 'std/assert/mod.ts';
import { VenueExpressLoginInput } from '../_shared/schemas/venue-express-login.ts';

Deno.test('accepts a valid venue_id', () => {
  const res = VenueExpressLoginInput.safeParse({
    venue_id: '00000000-0000-7000-8000-000000000001',
  });
  assert(res.success);
});

Deno.test('rejects a non-uuid venue_id', () => {
  const res = VenueExpressLoginInput.safeParse({ venue_id: 'piacere' });
  assertFalse(res.success);
});

Deno.test('rejects a missing venue_id', () => {
  const res = VenueExpressLoginInput.safeParse({});
  assertFalse(res.success);
});

Deno.test('ignores unknown keys rather than failing', () => {
  // Zod objects strip by default; a stale client sending extras must not
  // break the call.
  const res = VenueExpressLoginInput.safeParse({
    venue_id: '00000000-0000-7000-8000-000000000001',
    return_url: 'https://example.com',
  });
  assert(res.success);
});
