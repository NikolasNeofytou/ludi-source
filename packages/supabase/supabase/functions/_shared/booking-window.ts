// _shared/booking-window.ts
// What a player may hold through create-booking, in pure functions so the
// rules are unit-tested rather than inferred from the handler.
//
//   * The slot must be one the pitch actually offers: a row of
//     get_available_slots for that day, with the same start and end, still
//     available. That one call carries the weekly schedule, the date
//     overrides, closed days, composite blockers and "already started" —
//     the same grid the app draws, so the server and the screen can't
//     disagree about what is bookable.
//   * No further ahead than get_available_slots will answer for (31 days).
//   * At most MAX_PENDING_PER_USER unpaid holds at once. A pending booking
//     holds its court until it is paid or the 15-minute sweep clears it;
//     one checkout plus one retry is all a person needs.

export const BOOKING_HORIZON_DAYS = 31;
export const MAX_PENDING_PER_USER = 2;

const VENUE_TZ = 'Europe/Nicosia';
const DAY_MS = 24 * 60 * 60 * 1000;

/** True when `startsAt` is further ahead than bookings open. */
export function beyondHorizon(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() - now.getTime() > BOOKING_HORIZON_DAYS * DAY_MS;
}

/** The venue-local calendar date (YYYY-MM-DD) an instant falls on —
 *  the `p_start_date` get_available_slots expects for a slot starting then. */
export function venueDateOf(instant: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VENUE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export interface OfferedSlot {
  starts_at: string;
  ends_at: string;
  is_available: boolean;
}

export type SlotMatch = 'available' | 'taken' | 'not_offered';

/** Whether [startsAt, endsAt) is exactly one slot the grid offers. Instants
 *  are compared, not strings: PostgREST renders timestamptz with its own
 *  offset, the app sends whatever it received. */
export function matchOfferedSlot(
  slots: OfferedSlot[],
  startsAt: Date,
  endsAt: Date,
): SlotMatch {
  const start = startsAt.getTime();
  const end = endsAt.getTime();
  const slot = slots.find(
    (s) => Date.parse(s.starts_at) === start && Date.parse(s.ends_at) === end,
  );
  if (!slot) return 'not_offered';
  return slot.is_available ? 'available' : 'taken';
}
