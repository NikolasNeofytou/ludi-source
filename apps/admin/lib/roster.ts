import type { SupabaseClient } from '@supabase/supabase-js';

import { getCopy, type Locale } from '@/lib/copy';

// Reads v_venue_booking_roster (M6 #41g/#41h, ADR-0023) and hands pages a
// booking_id → roster row map to merge into their own booking lists.
//
// The view carries its own caller predicate — an owner gets rows only for
// their pitches, an admin for all — so callers never filter for access,
// only by booking id. organiser_phone is windowed IN THE VIEW (non-null
// only for paid/confirmed within 24h-before-kickoff → slot end); the UI
// renders what it gets and never tries to widen it.

export type RosterAddon = { addon_code: string; quantity: number };

export type RosterRow = {
  booking_id: string;
  first_name: string | null;
  last_name: string | null;
  party_size: number | null;
  confirmed_count: number;
  organiser_phone: string | null;
  addons: RosterAddon[];
  origin: 'app' | 'walk_in';
  // Slice E (20260918000001) — who put a walk-in on the book and who took
  // it off. All NULL for app bookings. The *_email columns are filled by
  // the VIEW only when the caller owns the venue (or is an admin); a
  // manager gets NULL there and must never be shown one, so nothing below
  // tries to fetch it another way.
  taken_by_user_id: string | null;
  taken_by_name: string | null;
  taken_by_email: string | null;
  taken_by_ludi: boolean | null;
  cancelled_by_user_id: string | null;
  cancelled_by_name: string | null;
  cancelled_by_email: string | null;
  cancelled_by_ludi: boolean | null;
  cancelled_at: string | null;
};

export async function rosterByBookingId(
  supabase: SupabaseClient,
  bookingIds: string[],
): Promise<Map<string, RosterRow>> {
  if (bookingIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('v_venue_booking_roster')
    // One literal, not a concatenation: supabase-js types the result by
    // parsing this string, and `a + b` is just `string` to it.
    .select(
      `booking_id, first_name, last_name, party_size, confirmed_count,
       organiser_phone, addons, origin,
       taken_by_user_id, taken_by_name, taken_by_email, taken_by_ludi,
       cancelled_by_user_id, cancelled_by_name, cancelled_by_email,
       cancelled_by_ludi, cancelled_at`,
    )
    .in('booking_id', bookingIds);
  // The code, not the message: this view is names and phones, and a thrown
  // message travels to logs and error reporting.
  if (error) throw new Error(`roster: load failed (${error.code || 'unknown'})`);

  const map = new Map<string, RosterRow>();
  for (const row of (data ?? []) as RosterRow[]) {
    map.set(row.booking_id, row);
  }
  return map;
}

export function rosterName(row: RosterRow | undefined): string | null {
  if (!row) return null;
  const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim();
  return name || null;
}

// 'bibs ×1 · ball ×2' — the extras the venue must have ready at the door.
export function rosterAddonsLabel(row: RosterRow | undefined, locale: Locale = 'en'): string | null {
  if (!row || row.addons.length === 0) return null;
  const t = getCopy(locale).addons;
  return row.addons
    .map((a) => {
      const label =
        a.addon_code === 'ball_rental' ? t.ball : a.addon_code === 'bibs' ? t.bibs : a.addon_code;
      return a.quantity > 1 ? `${label} ×${a.quantity}` : label;
    })
    .join(' · ');
}

// Slice E — "by Maria". One ladder for both halves, in the order that is
// most useful to the person reading it:
//
//   1. it was you               → "by you"
//   2. it was Ludi              → "by Ludi" — the founder at the counter
//                                 during a handover, or a series set up
//                                 at enrolment; the owner knows them as
//                                 Ludi, not as a first name
//   3. they have a name         → the name
//   4. they have no name, and   → their email — the view only fills it
//      the viewer owns the venue  for an owner, and slice C invites staff
//                                 with the name optional, so this is the
//                                 common case rather than the edge
//   5. otherwise                → "a colleague" — a manager looking at a
//                                 nameless colleague's booking
//
// Returns null when there is no actor to name at all: an app booking, or
// a cancel that no path recorded. Blank beats a guess.
type Actor = {
  userId: string | null;
  name: string | null;
  email: string | null;
  ludi: boolean | null;
};

function actorLabel(actor: Actor, viewerId: string, locale: Locale): string | null {
  if (!actor.userId) return null;
  const t = getCopy(locale).common;
  if (actor.userId === viewerId) return t.byYou;
  if (actor.ludi) return t.byLudi;
  return actor.name ?? actor.email ?? t.byColleague;
}

export function takenByLabel(
  row: RosterRow | undefined,
  viewerId: string,
  locale: Locale = 'en',
): string | null {
  if (!row || row.origin !== 'walk_in') return null;
  const who = actorLabel(
    {
      userId: row.taken_by_user_id,
      name: row.taken_by_name,
      email: row.taken_by_email,
      ludi: row.taken_by_ludi,
    },
    viewerId,
    locale,
  );
  return who ? getCopy(locale).common.takenBy(who) : null;
}

export function cancelledByLabel(
  row: RosterRow | undefined,
  viewerId: string,
  locale: Locale = 'en',
): string | null {
  if (!row) return null;
  const who = actorLabel(
    {
      userId: row.cancelled_by_user_id,
      name: row.cancelled_by_name,
      email: row.cancelled_by_email,
      ludi: row.cancelled_by_ludi,
    },
    viewerId,
    locale,
  );
  return who ? getCopy(locale).common.cancelledBy(who) : null;
}
