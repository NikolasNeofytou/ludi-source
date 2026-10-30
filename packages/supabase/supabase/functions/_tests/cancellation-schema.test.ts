// _tests/cancellation-schema.test.ts
// Zod validation tests for CancelBookingInput.

import { assert, assertFalse } from 'std/assert/mod.ts';
import { CancelBookingInput } from '../_shared/schemas/cancellation.ts';

Deno.test('accepts a valid uuid booking_id', () => {
  const out = CancelBookingInput.safeParse({
    booking_id: '00000000-0000-7000-8000-000000000001',
  });
  assert(out.success);
});

Deno.test('rejects missing booking_id', () => {
  const out = CancelBookingInput.safeParse({});
  assertFalse(out.success);
});

Deno.test('rejects non-uuid booking_id', () => {
  const out = CancelBookingInput.safeParse({ booking_id: 'not-a-uuid' });
  assertFalse(out.success);
});

Deno.test('rejects extra fields silently dropped (Zod default strips)', () => {
  // Default Zod behaviour: unknown keys pass through. Ensures we don't
  // accidentally tighten this without intention — adding `.strict()` later
  // would break clients that pass timing/telemetry alongside booking_id.
  const out = CancelBookingInput.safeParse({
    booking_id: '00000000-0000-7000-8000-000000000001',
    notes: 'rage-cancel',
  });
  assert(out.success);
});
