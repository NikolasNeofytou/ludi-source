// _tests/seat-swap.test.ts
// find-my-replacement (ADR-0044): the request shapes and the refusal table.

import { assert, assertEquals, assertFalse } from 'std/assert/mod.ts';
import { LeaveShareInput, TakeSeatInput } from '../_shared/schemas/seat-swap.ts';
import { swapRefusalFromPg } from '../_shared/seat-swap.ts';

const token = 'testtoken_0000-_00';

Deno.test('take-seat: a token, and a slot kind or none', () => {
  assert(TakeSeatInput.safeParse({ invite_token: token }).success);
  assert(TakeSeatInput.safeParse({ invite_token: token, slot_kind: 'gk' }).success);
  assertFalse(TakeSeatInput.safeParse({ invite_token: token, slot_kind: 'bench' }).success);
  assertFalse(TakeSeatInput.safeParse({ invite_token: 'short' }).success);
});

Deno.test('leave-share: a booking id and nothing else', () => {
  assert(LeaveShareInput.safeParse({ booking_id: '00000000-0000-4000-8000-000000000001' }).success);
  assertFalse(LeaveShareInput.safeParse({ booking_id: 'LAR-2026-0001' }).success);
  assertFalse(LeaveShareInput.safeParse({}).success);
});

Deno.test('the swap refusals map to typed codes', () => {
  assertEquals(swapRefusalFromPg({ code: 'P0001', message: 'NO_SEAT_TO_TAKE' })?.code, 'NO_SEAT_TO_TAKE');
  assertEquals(swapRefusalFromPg({ code: 'P0001', message: 'INVALID_INVITE' })?.status, 404);
  assertEquals(swapRefusalFromPg({ code: 'P0001', message: 'ALREADY_IN' })?.status, 409);
  // the capacity trigger's message carries a detail suffix in some drivers
  assertEquals(swapRefusalFromPg({ code: 'P0001', message: 'FIXTURE_FULL' })?.code, 'FIXTURE_FULL');
});

Deno.test('anything else is not a refusal', () => {
  assertEquals(swapRefusalFromPg({ code: '23505', message: 'duplicate key' }), null);
  assertEquals(swapRefusalFromPg({ code: 'P0001', message: 'SOMETHING_NEW' }), null);
  assertEquals(swapRefusalFromPg(null), null);
});
