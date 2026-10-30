// _tests/booking-window.test.ts
// The create-booking rules that sit in front of the insert: the horizon,
// the venue-local date a slot is looked up on, and matching the request
// against the pitch's own grid.

import { assertEquals } from 'std/assert/mod.ts';
import {
  BOOKING_HORIZON_DAYS,
  beyondHorizon,
  matchOfferedSlot,
  MAX_PENDING_PER_USER,
  venueDateOf,
} from '../_shared/booking-window.ts';

const NOW = new Date('2026-10-20T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

Deno.test('horizon: 31 days ahead, matching get_available_slots', () => {
  assertEquals(BOOKING_HORIZON_DAYS, 31);
  assertEquals(beyondHorizon(new Date(NOW.getTime() + 31 * DAY), NOW), false);
  assertEquals(beyondHorizon(new Date(NOW.getTime() + 31 * DAY + 60_000), NOW), true);
  assertEquals(beyondHorizon(new Date(NOW.getTime() + DAY), NOW), false);
});

Deno.test('pending cap: one checkout and one retry', () => {
  assertEquals(MAX_PENDING_PER_USER, 2);
});

Deno.test('venueDateOf: the Nicosia calendar day, not the UTC one', () => {
  // 23:30 UTC on the 24th is 02:30 on the 25th in Nicosia (EEST, +3).
  assertEquals(venueDateOf(new Date('2026-10-24T23:30:00Z')), '2026-10-25');
  // 21:30 UTC is still the 24th there.
  assertEquals(venueDateOf(new Date('2026-10-24T20:30:00Z')), '2026-10-24');
  // Winter time (EET, +2): 22:30 UTC on 1 Dec is 00:30 on 2 Dec.
  assertEquals(venueDateOf(new Date('2026-12-01T22:30:00Z')), '2026-12-02');
});

const GRID = [
  { starts_at: '2026-10-24T18:00:00+03:00', ends_at: '2026-10-24T19:00:00+03:00', is_available: true },
  { starts_at: '2026-10-24T19:00:00+03:00', ends_at: '2026-10-24T20:00:00+03:00', is_available: false },
];

Deno.test('matchOfferedSlot: an offered, free slot is available', () => {
  // Same instants as the grid, written in UTC the way a client might.
  assertEquals(
    matchOfferedSlot(GRID, new Date('2026-10-24T15:00:00Z'), new Date('2026-10-24T16:00:00Z')),
    'available',
  );
});

Deno.test('matchOfferedSlot: an offered slot someone holds is taken', () => {
  assertEquals(
    matchOfferedSlot(GRID, new Date('2026-10-24T16:00:00Z'), new Date('2026-10-24T17:00:00Z')),
    'taken',
  );
});

Deno.test('matchOfferedSlot: a range off the grid is not offered', () => {
  // Wrong start (03:00), a window off the slot boundaries, a double slot.
  assertEquals(
    matchOfferedSlot(GRID, new Date('2026-10-24T00:00:00Z'), new Date('2026-10-24T01:00:00Z')),
    'not_offered',
  );
  assertEquals(
    matchOfferedSlot(GRID, new Date('2026-10-24T15:15:00Z'), new Date('2026-10-24T15:45:00Z')),
    'not_offered',
  );
  assertEquals(
    matchOfferedSlot(GRID, new Date('2026-10-24T15:00:00Z'), new Date('2026-10-24T17:00:00Z')),
    'not_offered',
  );
});

Deno.test('matchOfferedSlot: a closed day has no grid at all', () => {
  assertEquals(
    matchOfferedSlot([], new Date('2026-10-24T15:00:00Z'), new Date('2026-10-24T16:00:00Z')),
    'not_offered',
  );
});
