// _tests/admin-toggle-pitch-schema.test.ts
// Zod validation tests for AdminTogglePitchInput.

import { assert, assertFalse } from 'std/assert/mod.ts';
import { AdminTogglePitchInput } from '../_shared/schemas/admin-toggle-pitch.ts';

const VALID_UUID = '00000000-0000-7000-8000-000000000001';
const VALID_REASON = 'venue confirmed insurance + facility inspection passed';

Deno.test('accepts verify with valid uuid + reason', () => {
  const out = AdminTogglePitchInput.safeParse({
    pitch_id: VALID_UUID,
    action: 'verify',
    reason: VALID_REASON,
  });
  assert(out.success);
});

Deno.test('accepts activate', () => {
  const out = AdminTogglePitchInput.safeParse({
    pitch_id: VALID_UUID,
    action: 'activate',
    reason: VALID_REASON,
  });
  assert(out.success);
});

Deno.test('accepts deactivate', () => {
  const out = AdminTogglePitchInput.safeParse({
    pitch_id: VALID_UUID,
    action: 'deactivate',
    reason: VALID_REASON,
  });
  assert(out.success);
});

Deno.test("rejects 'unverify' (out of v1 scope; admin_actions.action_type CHECK doesn't allow it)", () => {
  const out = AdminTogglePitchInput.safeParse({
    pitch_id: VALID_UUID,
    action: 'unverify',
    reason: VALID_REASON,
  });
  assertFalse(out.success);
});

Deno.test('rejects unknown action', () => {
  const out = AdminTogglePitchInput.safeParse({
    pitch_id: VALID_UUID,
    action: 'archive',
    reason: VALID_REASON,
  });
  assertFalse(out.success);
});

Deno.test('rejects missing action', () => {
  const out = AdminTogglePitchInput.safeParse({
    pitch_id: VALID_UUID,
    reason: VALID_REASON,
  });
  assertFalse(out.success);
});

Deno.test('rejects reason shorter than 10 chars', () => {
  const out = AdminTogglePitchInput.safeParse({
    pitch_id: VALID_UUID,
    action: 'verify',
    reason: 'too short',
  });
  assertFalse(out.success);
});

Deno.test('rejects reason longer than 500 chars', () => {
  const out = AdminTogglePitchInput.safeParse({
    pitch_id: VALID_UUID,
    action: 'verify',
    reason: 'x'.repeat(501),
  });
  assertFalse(out.success);
});

Deno.test('accepts reason exactly at 10-char floor', () => {
  const out = AdminTogglePitchInput.safeParse({
    pitch_id: VALID_UUID,
    action: 'verify',
    reason: '1234567890',
  });
  assert(out.success);
});

Deno.test('accepts reason exactly at 500-char ceiling', () => {
  const out = AdminTogglePitchInput.safeParse({
    pitch_id: VALID_UUID,
    action: 'verify',
    reason: 'x'.repeat(500),
  });
  assert(out.success);
});

Deno.test('rejects missing pitch_id', () => {
  const out = AdminTogglePitchInput.safeParse({
    action: 'verify',
    reason: VALID_REASON,
  });
  assertFalse(out.success);
});

Deno.test('rejects non-uuid pitch_id', () => {
  const out = AdminTogglePitchInput.safeParse({
    pitch_id: 'not-a-uuid',
    action: 'verify',
    reason: VALID_REASON,
  });
  assertFalse(out.success);
});
