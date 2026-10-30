// _tests/cover-shortfall-schema.test.ts
// Zod validation for the cover-shortfall contract (C2 W4).

import { assert, assertFalse } from 'std/assert/mod.ts';
import { CoverShortfallInput } from '../_shared/schemas/cover-shortfall.ts';

Deno.test('accepts a booking id and nothing else', () => {
  assert(
    CoverShortfallInput.safeParse({ booking_id: '00000000-0000-4000-8000-000000000001' })
      .success,
  );
});

Deno.test('rejects non-uuids and missing ids', () => {
  assertFalse(CoverShortfallInput.safeParse({ booking_id: 'LAR-2026-0009' }).success);
  assertFalse(CoverShortfallInput.safeParse({}).success);
});
