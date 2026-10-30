// Bookings list data layer (M2 #10, widened in W7 to "my fixtures").
//
// Reads `v_fixture` with no `booking_id` filter rather than the base
// `bookings` table. The view's own WHERE clause is already
// organiser-or-participant-or-admin (migration 20260824000001), which is
// exactly "every fixture I am in" — before this, a booking joined as a
// teammate never appeared in the joiner's own Bookings tab at all, because
// `bookings` RLS is self-or-owner-or-admin and a teammate is neither.
//
// `fetchBookingById` is gone: the fixture screen reads `fetchFixture` from
// `@/lib/fixture` since W4, and this file's sole remaining job is the list.

import { supabase } from './supabase';

// Mirrors the CHECK constraint in 20260421000003_initial_schema.sql.
export type BookingState =
  | 'pending'
  | 'collecting'
  | 'paid'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'refunded_by_admin'
  | 'cancelled_no_refund';

export interface BookingListItem {
  id: string;
  code: string;
  state: BookingState;
  starts_at: string;
  ends_at: string;
  total_cents: number;
  pitch: {
    name: string;
    venue: {
      name: string;
      city_name_en: string;
      city_name_gr: string;
    };
  };
  /** Whether the caller organised this fixture, or joined someone else's. */
  is_organiser: boolean;
  /**
   * The invite capability (ADR-0021). `v_fixture` already exposes it to
   * every reader of the row — organiser, participant, admin — so a joiner
   * can share a fixture they stand on from the Community tab's *Yours*
   * section (community-v4.md unit 1) without a second read.
   */
  invite_token: string;
  /** Roster progress — "say so from the list", not only once it's open. */
  squad: { filled: number; total: number; gkFilled: number; gkTotal: number };
}

interface FixtureRow {
  booking_id: string;
  code: string;
  state: BookingState;
  starts_at: string;
  ends_at: string;
  total_cents: number;
  gk_slots: number;
  outfield_slots: number;
  gk_filled: number;
  outfield_filled: number;
  pitch_name: string;
  venue_name: string;
  city_name_en: string;
  city_name_gr: string;
  viewer_is_organiser: boolean;
  invite_token: string;
}

const FIXTURE_LIST_COLUMNS =
  `booking_id, code, state, starts_at, ends_at, total_cents,
   gk_slots, outfield_slots, gk_filled, outfield_filled,
   pitch_name, venue_name, city_name_en, city_name_gr, viewer_is_organiser,
   invite_token`;

function toListItem(row: FixtureRow): BookingListItem {
  return {
    id: row.booking_id,
    code: row.code,
    state: row.state,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    total_cents: row.total_cents,
    pitch: {
      name: row.pitch_name,
      venue: {
        name: row.venue_name,
        city_name_en: row.city_name_en,
        city_name_gr: row.city_name_gr,
      },
    },
    is_organiser: row.viewer_is_organiser,
    invite_token: row.invite_token,
    squad: {
      filled: row.gk_filled + row.outfield_filled,
      total: row.gk_slots + row.outfield_slots,
      gkFilled: row.gk_filled,
      gkTotal: row.gk_slots,
    },
  };
}

export async function fetchMyBookings(): Promise<BookingListItem[]> {
  const { data, error } = await supabase
    .from('v_fixture')
    .select(FIXTURE_LIST_COLUMNS)
    .order('starts_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as FixtureRow[]).map(toListItem);
}

// ── Segmentation ────────────────────────────────────────────────────────
// Upcoming = active states AND end-time still in the future. Everything else
// is History — either terminal-state bookings or active bookings whose slot
// has passed (waiting for the cleanup cron to flip them to `completed`).

const ACTIVE_STATES: ReadonlySet<BookingState> = new Set([
  'pending',
  'collecting',
  'paid',
  'confirmed',
]);

export function isUpcoming(b: BookingListItem, now: Date = new Date()): boolean {
  return ACTIVE_STATES.has(b.state) && new Date(b.ends_at).getTime() > now.getTime();
}

export interface SegmentedBookings {
  upcoming: BookingListItem[];
  history: BookingListItem[];
}

export function segmentBookings(
  bookings: BookingListItem[],
  now: Date = new Date(),
): SegmentedBookings {
  const upcoming: BookingListItem[] = [];
  const history: BookingListItem[] = [];
  for (const b of bookings) {
    (isUpcoming(b, now) ? upcoming : history).push(b);
  }
  // Source query orders by starts_at desc — that's right for History (most
  // recent first) but Upcoming reads better as soonest-first.
  upcoming.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { upcoming, history };
}

// ── When-formatting ─────────────────────────────────────────────────────
// Shared by the Bookings tab rows and the home screen's next-match strip so
// the two surfaces can never disagree about the same fixture's time.

const VENUE_TZ = 'Europe/Nicosia';

// "Tonight · 20:00" under 24h, "Tomorrow · 20:00" for the day after,
// otherwise null (an absolute string covers it).
export function relativeHeadline(
  startsAtIso: string,
  locale: 'en' | 'gr',
  tonight: string,
  tomorrow: string,
): string | null {
  const start = new Date(startsAtIso);
  const now = new Date();
  const diffH = (start.getTime() - now.getTime()) / 3_600_000;
  if (diffH < 0 || diffH > 48) return null;
  const intlLocale = locale === 'gr' ? 'el-GR' : 'en-GB';
  const time = new Intl.DateTimeFormat(intlLocale, {
    timeZone: VENUE_TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(start);
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: VENUE_TZ, dateStyle: 'short' });
  const sameDay = dayFmt.format(start) === dayFmt.format(now);
  if (diffH <= 24 && sameDay) return `${tonight} · ${time}`;
  const tomorrowDate = new Date(now.getTime() + 24 * 3_600_000);
  if (dayFmt.format(start) === dayFmt.format(tomorrowDate)) return `${tomorrow} · ${time}`;
  return null;
}

// Format the booking window in the venue's wall time so it lines up with how
// the user picked the slot, regardless of the device timezone.
export function formatWhen(startsAtIso: string, endsAtIso: string, locale: 'en' | 'gr'): string {
  const intlLocale = locale === 'gr' ? 'el-GR' : 'en-GB';
  const start = new Date(startsAtIso);
  const end = new Date(endsAtIso);
  const date = new Intl.DateTimeFormat(intlLocale, {
    timeZone: VENUE_TZ,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(start);
  const t = (d: Date) =>
    new Intl.DateTimeFormat(intlLocale, {
      timeZone: VENUE_TZ,
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  return `${date} · ${t(start)}–${t(end)}`;
}

// Start-only variant — "Fri 05 Sep · 20:00" — for headline-sized text where
// the full range would wrap.
export function formatStart(startsAtIso: string, locale: 'en' | 'gr'): string {
  const intlLocale = locale === 'gr' ? 'el-GR' : 'en-GB';
  const start = new Date(startsAtIso);
  const date = new Intl.DateTimeFormat(intlLocale, {
    timeZone: VENUE_TZ,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(start);
  const time = new Intl.DateTimeFormat(intlLocale, {
    timeZone: VENUE_TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(start);
  return `${date} · ${time}`;
}
