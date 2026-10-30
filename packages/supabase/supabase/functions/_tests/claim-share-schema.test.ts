// _tests/claim-share-schema.test.ts
// Zod validation for the claim-share contract (C2 W3).

import { assert, assertFalse } from 'std/assert/mod.ts';
import { ClaimShareInput } from '../_shared/schemas/claim-share.ts';

// Deliberately low-entropy: a realistic token shape here trips secret
// scanners (GitGuardian flagged the first draft). The schema only checks
// charset + length, so an obviously-fake value tests the same thing.
const valid = { invite_token: 'testtoken_0000-_00', slot_kind: 'outfield' };

Deno.test('accepts a base64url token and a real slot kind', () => {
  assert(ClaimShareInput.safeParse(valid).success);
  assert(ClaimShareInput.safeParse({ ...valid, slot_kind: 'gk' }).success);
});

Deno.test('rejects tokens that are not tokens', () => {
  assertFalse(ClaimShareInput.safeParse({ ...valid, invite_token: 'short' }).success);
  assertFalse(
    ClaimShareInput.safeParse({ ...valid, invite_token: 'has spaces in it!' }).success,
  );
});

Deno.test('a pasted booking code passes the shape — the DB lookup is the defence', () => {
  // 'LAR-2026-0009' fits the charset (hyphens are base64url), so the schema
  // cannot and does not pretend to reject it. ADR-0021's guarantee lives in
  // the lookup: bookings are found by invite_token, never by code, so an
  // enumerable code resolves to INVALID_INVITE. Pinned here so nobody
  // "tightens" the regex and believes that closed the hole.
  assert(ClaimShareInput.safeParse({ ...valid, invite_token: 'LAR-2026-0009' }).success);
});

Deno.test('rejects unknown slot kinds', () => {
  assertFalse(ClaimShareInput.safeParse({ ...valid, slot_kind: 'bench' }).success);
  assertFalse(ClaimShareInput.safeParse({ invite_token: valid.invite_token }).success);
});
