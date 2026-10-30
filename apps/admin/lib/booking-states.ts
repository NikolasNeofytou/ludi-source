// Booking-state vocabulary shared by /bookings and the Today view.
// Extracted from app/bookings/page.tsx when the Today page became the
// second reader — one source for the state list and its palette mapping.

import { getCopy, type Locale } from '@/lib/copy';

// Mirrors bookings_state_check (migration 20260830000001, which added
// 'collecting' for split-payment fixtures), in the constraint's order.
export const BOOKING_STATES = [
  'pending',
  'collecting',
  'paid',
  'confirmed',
  'completed',
  'cancelled',
  'refunded',
  'refunded_by_admin',
  'cancelled_no_refund',
] as const;

export type BookingState = (typeof BOOKING_STATES)[number];

export function isBookingState(value: string): value is BookingState {
  return (BOOKING_STATES as readonly string[]).includes(value);
}

// States that hold their slot — the ones an operations view means by "a
// booking". Same set as the bookings_pitch_id_time_range_excl predicate
// (migration 20260830000001): 'collecting' holds the pitch while a split
// fixture gathers its shares; cancelled/refunded states released it.
export const SLOT_HOLDING_STATES = [
  'pending',
  'collecting',
  'paid',
  'confirmed',
  'completed',
] as const satisfies readonly BookingState[];

// What an owner reads on a badge or in the state filter, in the account's
// language (the words live in lib/copy). The raw values are schema
// vocabulary ('refunded_by_admin' names who pressed the button, not what
// happened to the money). Falls back to the raw value, so a state the
// database grows before the dictionary does still shows something.
export function stateLabel(state: BookingState, locale: Locale = 'en'): string {
  return getCopy(locale).states[state] ?? state;
}

// Booking state mapped onto the palette's semantic roles, not onto
// decorative colours: `pitch` = the money is good, `sun` = waiting on
// something, `alert` = cancelled or reversed, `primary` = refunded (a
// completed administrative act, not a failure).
export function stateTone(
  state: BookingState,
): 'good' | 'warn' | 'alert' | 'info' | 'neutral' {
  switch (state) {
    case 'pending':
    case 'collecting':
      return 'warn';
    case 'paid':
    case 'confirmed':
      return 'good';
    case 'completed':
      return 'neutral';
    case 'cancelled':
    case 'cancelled_no_refund':
      return 'alert';
    case 'refunded':
    case 'refunded_by_admin':
      return 'info';
  }
}
