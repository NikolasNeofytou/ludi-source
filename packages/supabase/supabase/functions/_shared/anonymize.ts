// _shared/anonymize.ts
// GDPR erasure (ADR-0018, anonymise-and-keep): what anonymize-me changes,
// what it deletes and what it deliberately keeps. Pure — no DB — so the
// "what counts as the person's data" decision lives in one place and the
// drift guards in _tests/anonymize.test.ts can hold it. The Edge Function
// applies it with the service role (the normal RLS update path forbids
// writing anonymized_at — api-contract.md §2.2).
//
// ── CHANGED: the public.users row (kept for FK integrity + 7-year retention)
//   NULLED       handle, positions ([]), preferred_foot, height_cm, age_band,
//                play_frequency — self-declared or quasi-identifying profile
//                content the card surfaces (height_cm + age_band are flagged
//                "nulled on erasure" in 20260530000001)
//   PLACEHOLDER  first_name / last_name are NOT NULL → "Deleted" / "User"
//   SWITCHED OFF (audit 2026-10-19, C17/L11) — an erased account must stop
//                being an addressable person, not only a renamed one:
//                public_profile → false (public_profile_at → NULL, as the
//                consent CHECK requires), so /p/<handle> is gone;
//                goes_in_goal → 'no', so the keeper pool never offers them;
//                notify_games / notify_asks → false, so nothing is minted
//   STAMPED      anonymized_at — the claim, and the flag every read checks
//
// ── DELETED: rows that are only the person's own (ERASED_ROWS)
//   push_tokens           the phone stops being reachable
//   team_follows          which children's teams they follow (match_followers()
//                         reads it, so the follow notices stop with it)
//   player_notifications  their notice ledger: their games, and the names of
//                         the keepers who covered them
//   gk_feedback (about)   what organisers said about them as a keeper
//   wallet_pass_tickets   60-second wallet-pass tickets
//   idempotency_keys      cached responses to their own requests
//
// ── KEPT: deliberately untouched (KEPT_TABLES, KEPT_USER_COLUMNS)
//   bookings, payments, booking_addons, booking_participants
//                financial records, kept for the 7-year audit retention.
//                Future bookings are NOT cancelled here: a cancel refunds,
//                and a refund is the player's decision under its own policy,
//                not a side effect of erasure. anonymize-me reports them
//                (upcoming_bookings) so the app can say what stays booked.
//                A participant row stays on its fixture's roster, where the
//                name now reads "Deleted User".
//   admin_actions  the audit log, this erasure's own row included
//   venue_owners   the venue's record of who had access; the auth soft-delete
//                already ends the sign-in
//   venue_contacts, the walk-in name and phone on a booking, booking_series,
//   booking_notes, venue_inbox, fill_offers, recordings
//                the venue's own records, for which the venue is the
//                controller — not the player's account. A venue erases its
//                contacts itself (venue_contacts_delete_all).
//   gk_requests    an ask belongs to its fixture, which other players are in
//   gk_feedback (from)  the other keeper's record; it now reads as from
//                "Deleted User"
//   users.city_id, skill_level, preferred_locale, role, member_no
//                coarse or opaque, NOT NULL, useful for aggregates
//   users.stripe_customer_id
//                opaque pointer for reconciling the kept payments; deleting
//                the Stripe customer is a parked follow-up (ADR-0018)

export const ANONYMIZED_FIRST_NAME = 'Deleted';
export const ANONYMIZED_LAST_NAME = 'User';

export interface AnonymizedProfilePatch {
  first_name: string;
  last_name: string;
  handle: null;
  positions: string[];
  preferred_foot: null;
  height_cm: null;
  age_band: null;
  play_frequency: null;
  public_profile: false;
  public_profile_at: null;
  goes_in_goal: 'no';
  notify_games: false;
  notify_asks: false;
  anonymized_at: string;
}

/** The public.users column patch for GDPR erasure. `nowIso` stamps anonymized_at. */
export function anonymizedProfilePatch(nowIso: string): AnonymizedProfilePatch {
  return {
    first_name: ANONYMIZED_FIRST_NAME,
    last_name: ANONYMIZED_LAST_NAME,
    handle: null,
    positions: [],
    preferred_foot: null,
    height_cm: null,
    age_band: null,
    play_frequency: null,
    public_profile: false,
    public_profile_at: null,
    goes_in_goal: 'no',
    notify_games: false,
    notify_asks: false,
    anonymized_at: nowIso,
  };
}

/** Columns the patch must never write — asserted by the test as a drift guard. */
export const KEPT_USER_COLUMNS = [
  'city_id',
  'skill_level',
  'preferred_locale',
  'role',
  'member_no',
  'stripe_customer_id',
] as const;

/** One delete anonymize-me runs: every row of `table` whose `column` is the user. */
export interface ErasedRows {
  table: string;
  column: string;
}

/** The person's own rows, deleted on every call (idempotent, so a retry heals). */
export const ERASED_ROWS: readonly ErasedRows[] = [
  { table: 'push_tokens', column: 'user_id' },
  { table: 'team_follows', column: 'user_id' },
  { table: 'player_notifications', column: 'user_id' },
  { table: 'gk_feedback', column: 'about_user' },
  { table: 'wallet_pass_tickets', column: 'user_id' },
  { table: 'idempotency_keys', column: 'user_id' },
];

/** Tables erasure must never delete from — the drift guard's other half. */
export const KEPT_TABLES = [
  'users',
  'bookings',
  'payments',
  'booking_addons',
  'booking_participants',
  'admin_actions',
  'venue_owners',
  'venue_contacts',
  'booking_series',
  'booking_notes',
  'gk_requests',
] as const;

/** Booking states that are still going to happen — what erasure leaves booked. */
export const UPCOMING_BOOKING_STATES = ['pending', 'collecting', 'paid', 'confirmed'] as const;

/** A booking the erased player organised that is still to come. */
export interface UpcomingBooking {
  id: string;
  code: string;
  starts_at: string;
  state: string;
  venue_name: string | null;
}

type One<T> = T | T[] | null | undefined;
const one = <T>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** The bookings select (`… pitch:pitches(venue:venues(name))`), flattened for the app. */
export function upcomingBookingsFrom(
  rows: Array<{
    id: string;
    code: string;
    starts_at: string;
    state: string;
    pitch?: One<{ venue?: One<{ name?: string | null }> }>;
  }> | null,
): UpcomingBooking[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    starts_at: r.starts_at,
    state: r.state,
    venue_name: one(one(r.pitch)?.venue)?.name ?? null,
  }));
}
