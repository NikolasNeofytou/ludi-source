// Fixture data layer (booking-as-shared-fixture, W4).
//
// Reads `v_fixture` and `v_fixture_roster`, never the base tables. Both are
// definer views carrying their own caller predicate (migration
// 20260824000001, ADR-0013 shape), so a participant who is not the organiser
// gets the fixture and the roster and nothing else — `bookings` itself is
// self-or-owner-or-admin and would return them zero rows.
//
// The organiser's own read could go through `bookings` directly. It should
// not: two read paths for one screen is how the two drift apart.

import { supabase } from './supabase';

const VENUE_TZ = 'Europe/Nicosia';

import type { BookingState } from './bookings-list';
import { GR_MONTHS_ACC } from './player-profile';

export type SlotKind = 'gk' | 'outfield';

export interface FixtureAddon {
  addon_code: 'bibs' | 'ball_rental';
  quantity: number;
  unit_price_cents: number;
}

export interface Fixture {
  booking_id: string;
  code: string;
  starts_at: string;
  ends_at: string;
  state: BookingState;
  cancelled_at: string | null;
  cancellation_policy: 'standard' | 'strict' | 'flex';
  cancellation_refund_cents: number | null;
  total_cents: number;
  gk_slots: number;
  outfield_slots: number;
  invite_token: string;
  pitch_id: string;
  pitch_name: string;
  pitch_type: string;
  venue_name: string;
  city_name_en: string;
  city_name_gr: string;
  viewer_is_organiser: boolean;
  addons: FixtureAddon[];
  // C2 W6 — the split money layer. All three null/false off split fixtures.
  is_split: boolean;
  share_amount_cents: number | null;
  collect_deadline: string | null;
  /** Listed on the community board (ADR-0028). */
  is_open: boolean;
  /** The listing's level tag; null = unsaid. */
  open_level: OpenLevel | null;
  /** Where the game is (plans/maps.md): for directions. */
  venue_id: string;
  venue_address: string | null;
  lat: number | null;
  lng: number | null;
}

export type OpenLevel = 'casual' | 'competitive';

export interface RosterEntry {
  participant_id: string;
  user_id: string;
  slot_kind: SlotKind;
  status: 'in' | 'out';
  first_name: string | null;
  handle: string | null;
  is_organiser: boolean;
  is_you: boolean;
  /** Their share settled (split fixtures only; always false on free ones). */
  share_paid: boolean;
  /** When they took the seat - the roster reads as it filled. */
  joined_at: string;
  /** When they gave it up. Null while they are in. */
  left_at: string | null;
  /* The self-declared football facts from their player card. Every one is
   * optional on the card, so every one is optional here: the teammate sheet
   * renders complete without them. */
  skill_level: number | null;
  positions: string[] | null;
  preferred_foot: 'left' | 'right' | 'both' | null;
  /** Completed fixtures the viewer has shared with them. Null on your own row. */
  played_with_you: number | null;
  /** They can't make it and hold the seat until someone takes it (ADR-0044). */
  replacing_since: string | null;
  /** They handed the seat over: it went to someone, it did not open. */
  was_replaced: boolean;
  /** A keeper from the pool (ADR-0047): plays free, owes no share. */
  keeper_free: boolean;
}

export interface FixtureWithRoster {
  fixture: Fixture;
  roster: RosterEntry[];
}

const FIXTURE_COLUMNS =
  `booking_id, code, starts_at, ends_at, state, cancelled_at, cancellation_policy,
   cancellation_refund_cents, total_cents, gk_slots, outfield_slots, invite_token,
   pitch_id, pitch_name, pitch_type, venue_name, city_name_en, city_name_gr,
   viewer_is_organiser, addons, is_split, share_amount_cents, collect_deadline, is_open,
   open_level, venue_id, venue_address, lat, lng`;

export async function fetchFixture(bookingId: string): Promise<FixtureWithRoster | null> {
  const [fixtureRes, rosterRes] = await Promise.all([
    supabase.from('v_fixture').select(FIXTURE_COLUMNS).eq('booking_id', bookingId).maybeSingle(),
    supabase
      .from('v_fixture_roster')
      .select(
        `participant_id, user_id, slot_kind, status, first_name, handle, is_organiser,
         is_you, share_paid, joined_at, left_at, skill_level, positions, preferred_foot,
         played_with_you, replacing_since, was_replaced, keeper_free`,
      )
      .eq('booking_id', bookingId)
      // Organiser first, then join order — the roster reads as it filled.
      .order('is_organiser', { ascending: false })
      .order('joined_at', { ascending: true }),
  ]);

  if (fixtureRes.error) throw fixtureRes.error;
  if (rosterRes.error) throw rosterRes.error;
  if (!fixtureRes.data) return null;

  const fixture = fixtureRes.data as unknown as Fixture;
  // `addons` is a jsonb column, not an embed — the view carries it so a
  // participant needs one read, not two (booking_addons has the same
  // owner-only policy `bookings` does).
  // Full roster — in AND out. The view's own read predicate no longer
  // requires status='in' (a departed participant still needs to see their
  // own fixture to rejoin), so filtering here would throw that row away
  // client-side and lose it for the "you're out" state entirely. Screens
  // that render the squad grid filter to 'in' themselves (`slotsFor`).
  return {
    fixture: { ...fixture, addons: fixture.addons ?? [] },
    roster: (rosterRes.data ?? []) as unknown as RosterEntry[],
  };
}

/**
 * Positional slots for rendering: filled ones first, then the gaps. Only
 * `status === 'in'` occupies a slot — someone who left frees theirs
 * immediately, which is the whole point of the roster staying in the array
 * rather than the person just vanishing from it.
 */
export function slotsFor(
  roster: RosterEntry[],
  kind: SlotKind,
  total: number,
): Array<RosterEntry | null> {
  const filled = roster.filter((r) => r.slot_kind === kind && r.status === 'in');
  const out: Array<RosterEntry | null> = filled.slice(0, total);
  while (out.length < total) out.push(null);
  return out;
}

/**
 * `https://ludi.football/f/<token>` — the token, never the code (ADR-0021).
 *
 * An https link, not the `ludi://` scheme, since C1 (ADR-0025): a scheme URL
 * is a dead, unlinkified string to any WhatsApp recipient without the app.
 * The web side previews the fixture and funnels to the install; with the
 * associated-domains entitlement in place, iOS opens the app directly
 * instead. The scheme still works inbound — the web page's "Open in Ludi"
 * button uses it — but nothing shares it anymore.
 */
export function inviteLink(fixture: Fixture): string {
  return `https://ludi.football/f/${fixture.invite_token}`;
}

/* ─────────────────────── invite preview + joining (W5) ─────────────────────── */

export interface FixturePreview {
  booking_id: string;
  starts_at: string;
  ends_at: string;
  pitch_type: string;
  pitch_name: string;
  venue_name: string;
  city_name_en: string;
  city_name_gr: string;
  gk_open: number;
  outfield_open: number;
  joinable: boolean;
  /** C2 W3: what a slot costs, shown before the claim. Null off split. */
  is_split: boolean;
  share_amount_cents: number | null;
  /** Seats a player is waiting to hand over (ADR-0044) — taken, not joined. */
  gk_replacing: number;
  outfield_replacing: number;
  /** The venue's pin (plans/maps.md); older previews omit it. */
  lat?: number | null;
  lng?: number | null;
}

/**
 * What a link buys you before you are on the roster. Callable signed-out
 * (`fixture_preview` is GRANTed to anon) — a stranger deciding whether to
 * install an app deserves to see what they are being invited to first.
 */
export async function fetchFixturePreview(token: string): Promise<FixturePreview | null> {
  const { data, error } = await supabase.rpc('fixture_preview', { p_invite_token: token });
  if (error) throw error;
  const row = (data ?? [])[0] as FixturePreview | undefined;
  return row ?? null;
}

export type JoinFixtureErrorCode =
  | 'INVALID_INVITE'
  | 'FIXTURE_CANCELLED'
  | 'FIXTURE_STARTED'
  | 'FIXTURE_FULL'
  | 'INVALID_SLOT_KIND'
  | 'NOT_SIGNED_IN'
  | 'UNKNOWN';

const KNOWN_JOIN_CODES: readonly string[] = [
  'INVALID_INVITE',
  'FIXTURE_CANCELLED',
  'FIXTURE_STARTED',
  'FIXTURE_FULL',
  'INVALID_SLOT_KIND',
  'NOT_SIGNED_IN',
];

export class JoinFixtureError extends Error {
  readonly code: JoinFixtureErrorCode;
  constructor(code: JoinFixtureErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'JoinFixtureError';
  }
}

/**
 * Takes a slot via `join_fixture()`. PostgREST surfaces a RAISE EXCEPTION as
 * `error.message` = the exception's message text — our functions raise the
 * SCREAMING_SNAKE code itself as the message (see ADR-0022), so switching on
 * `error.message` rather than `error.code` (which is just the SQLSTATE
 * 'P0001' for all of them) is deliberate, not a workaround.
 */
export async function joinFixture(token: string, slotKind: SlotKind): Promise<void> {
  const { error } = await supabase.rpc('join_fixture', {
    p_invite_token: token,
    p_slot_kind: slotKind,
  });
  if (!error) return;
  const code = KNOWN_JOIN_CODES.includes(error.message)
    ? (error.message as JoinFixtureErrorCode)
    : 'UNKNOWN';
  throw new JoinFixtureError(code, error.message);
}

/* ────────────────── paid joining + covering (C2 W6) ────────────────── */
// Split fixtures take money to join, so join_fixture() refuses them and
// these two Edge Functions are the doors: claim-share for a teammate's
// slot, cover-shortfall for the organiser closing the gap. Both return a
// PaymentIntent client_secret for the same Payment Sheet the checkout uses.

export type ClaimShareErrorCode =
  | 'INVALID_INVITE'
  | 'NOT_SPLIT'
  | 'CLAIM_NOT_OPEN'
  | 'FIXTURE_STARTED'
  | 'COLLECTION_CLOSED'
  | 'ALREADY_PAID'
  | 'FIXTURE_FULL'
  | 'COVER_IN_FLIGHT'
  | 'NOTHING_TO_COVER'
  | 'NOT_AUTHORIZED'
  | 'STRIPE_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

const KNOWN_CLAIM_CODES: readonly string[] = [
  'INVALID_INVITE',
  'NOT_SPLIT',
  'CLAIM_NOT_OPEN',
  'FIXTURE_STARTED',
  'COLLECTION_CLOSED',
  'ALREADY_PAID',
  'FIXTURE_FULL',
  'COVER_IN_FLIGHT',
  'NOTHING_TO_COVER',
  'NOT_AUTHORIZED',
  'STRIPE_ERROR',
];

export class ClaimShareError extends Error {
  readonly code: ClaimShareErrorCode;
  constructor(code: ClaimShareErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ClaimShareError';
  }
}

export interface SharePaymentIntent {
  booking_id: string;
  amount_cents: number;
  payment_intent_id: string;
  client_secret: string;
  publishable_key: string;
}

async function invokeMoneyDoor(
  fn: 'claim-share' | 'cover-shortfall',
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<SharePaymentIntent> {
  // Lazy import avoids a require cycle (booking.ts is heavier than us).
  const { extractEdgeFunctionError } = await import('./booking');
  let response;
  try {
    response = await supabase.functions.invoke(fn, {
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  } catch (err) {
    throw new ClaimShareError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Network request failed',
    );
  }
  if (response.error) {
    const raw = await extractEdgeFunctionError(response.error, 'Payment setup failed');
    const code = raw.code && KNOWN_CLAIM_CODES.includes(raw.code)
      ? (raw.code as ClaimShareErrorCode)
      : 'UNKNOWN';
    throw new ClaimShareError(code, raw.message);
  }
  const data = response.data as {
    booking_id: string;
    share_amount_cents?: number;
    cover_amount_cents?: number;
    payment: { payment_intent_id: string; client_secret: string; publishable_key: string };
  } | null;
  if (!data?.payment?.client_secret) {
    throw new ClaimShareError('UNKNOWN', `Empty response from ${fn}`);
  }
  return {
    booking_id: data.booking_id,
    amount_cents: data.share_amount_cents ?? data.cover_amount_cents ?? 0,
    payment_intent_id: data.payment.payment_intent_id,
    client_secret: data.payment.client_secret,
    publishable_key: data.payment.publishable_key,
  };
}

/** Take (or resume paying for) a slot on a split fixture. */
export function claimShare(
  inviteToken: string,
  slotKind: SlotKind,
  idempotencyKey: string,
): Promise<SharePaymentIntent> {
  return invokeMoneyDoor('claim-share', { invite_token: inviteToken, slot_kind: slotKind }, idempotencyKey);
}

/** Organiser only: pay whatever the invite didn't collect, in one go. */
export function coverShortfall(
  bookingId: string,
  idempotencyKey: string,
): Promise<SharePaymentIntent> {
  return invokeMoneyDoor('cover-shortfall', { booking_id: bookingId }, idempotencyKey);
}

/* ─────────────────── find my replacement (ADR-0044) ─────────────────── */
// The leaver keeps the seat until someone takes it. On a free fixture the
// seat changes hands through the take_seat RPC; on a split fixture the
// taker pays the frozen share through take-seat and the leaver's share is
// given back when it settles. While a split fixture is still collecting
// there is no replacement — leaving costs nothing and refunds the share
// (leave-share), and the seat reopens to the ordinary claim.

export type ReplacementErrorCode =
  | 'ORGANISER_CANNOT_BE_REPLACED'
  | 'LEAVE_INSTEAD'
  | 'FIXTURE_NOT_LIVE'
  | 'FIXTURE_STARTED'
  | 'NOT_ON_ROSTER'
  | 'NO_SEAT_TO_TAKE'
  | 'SEAT_REQUIRES_PAYMENT'
  | 'SEAT_NOT_TAKEABLE'
  | 'ALREADY_IN'
  | 'ALREADY_PAID_HERE'
  | 'INVALID_INVITE'
  | 'FIXTURE_FULL'
  | 'PAYMENT_IN_FLIGHT'
  | 'ORGANISER_CANNOT_LEAVE'
  | 'STRIPE_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

const KNOWN_REPLACEMENT_CODES: readonly string[] = [
  'ORGANISER_CANNOT_BE_REPLACED',
  'LEAVE_INSTEAD',
  'FIXTURE_NOT_LIVE',
  'FIXTURE_STARTED',
  'NOT_ON_ROSTER',
  'NO_SEAT_TO_TAKE',
  'SEAT_REQUIRES_PAYMENT',
  'SEAT_NOT_TAKEABLE',
  'ALREADY_IN',
  'ALREADY_PAID_HERE',
  'INVALID_INVITE',
  'FIXTURE_FULL',
  'PAYMENT_IN_FLIGHT',
  'ORGANISER_CANNOT_LEAVE',
  'STRIPE_ERROR',
];

export class ReplacementError extends Error {
  readonly code: ReplacementErrorCode;
  constructor(code: ReplacementErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ReplacementError';
  }
}

const replacementCode = (message: string | null | undefined): ReplacementErrorCode =>
  message && KNOWN_REPLACEMENT_CODES.includes(message) ? (message as ReplacementErrorCode) : 'UNKNOWN';

/** I can't make it: keep my seat until someone takes it. */
export async function askReplacement(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('ask_replacement', { p_booking_id: bookingId });
  if (error) throw new ReplacementError(replacementCode(error.message), error.message);
}

/** I can play after all. A seat already taken is gone. */
export async function keepMySeat(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('keep_my_seat', { p_booking_id: bookingId });
  if (error) throw new ReplacementError(replacementCode(error.message), error.message);
}

/** The result of taking a seat: free, or a share to pay for it. */
export type TakeSeatResult =
  | { taken: true; booking_id: string }
  | { taken: false; booking_id: string; payment: SharePaymentIntent };

/**
 * Take a seat someone is waiting to hand over. A free fixture goes through
 * the take_seat RPC; a split one through take-seat, which answers free
 * seats too and hands back a PaymentIntent for a paid one. A re-tap after
 * dismissing the card sheet returns the same PaymentIntent.
 */
export async function takeSeat(
  inviteToken: string,
  slotKind: SlotKind | null,
  isSplit: boolean,
  idempotencyKey: string,
): Promise<TakeSeatResult> {
  if (!isSplit) {
    const { data, error } = await supabase.rpc('take_seat', {
      p_invite_token: inviteToken,
      p_slot_kind: slotKind,
    });
    if (error) throw new ReplacementError(replacementCode(error.message), error.message);
    return { taken: true, booking_id: data as string };
  }
  const { extractEdgeFunctionError } = await import('./booking');
  let response;
  try {
    response = await supabase.functions.invoke('take-seat', {
      body: slotKind ? { invite_token: inviteToken, slot_kind: slotKind } : { invite_token: inviteToken },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  } catch (err) {
    throw new ReplacementError('NETWORK_ERROR', err instanceof Error ? err.message : 'Network request failed');
  }
  if (response.error) {
    const raw = await extractEdgeFunctionError(response.error, 'Taking the seat failed');
    throw new ReplacementError(replacementCode(raw.code), raw.message);
  }
  const data = response.data as {
    booking_id: string;
    taken: boolean;
    share_amount_cents: number | null;
    payment: { payment_intent_id: string; client_secret: string; publishable_key: string } | null;
  } | null;
  if (!data) throw new ReplacementError('UNKNOWN', 'Empty response from take-seat');
  if (data.taken || !data.payment) return { taken: true, booking_id: data.booking_id };
  return {
    taken: false,
    booking_id: data.booking_id,
    payment: {
      booking_id: data.booking_id,
      amount_cents: data.share_amount_cents ?? 0,
      payment_intent_id: data.payment.payment_intent_id,
      client_secret: data.payment.client_secret,
      publishable_key: data.payment.publishable_key,
    },
  };
}

/**
 * Leave a split fixture that is still collecting, with the share back. The
 * database refuses a bare status flip on a paid seat there (the money would
 * stay behind and the fixture could never confirm).
 */
export async function leaveShare(bookingId: string): Promise<{ refunded_cents: number }> {
  const { extractEdgeFunctionError } = await import('./booking');
  let response;
  try {
    response = await supabase.functions.invoke('leave-share', { body: { booking_id: bookingId } });
  } catch (err) {
    throw new ReplacementError('NETWORK_ERROR', err instanceof Error ? err.message : 'Network request failed');
  }
  if (response.error) {
    const raw = await extractEdgeFunctionError(response.error, 'Leaving failed');
    throw new ReplacementError(replacementCode(raw.code), raw.message);
  }
  const data = response.data as { refunded_cents?: number } | null;
  return { refunded_cents: data?.refunded_cents ?? 0 };
}

/** A seat up for grabs from your crew (v_crew_seats) — counts, never names. */
export interface CrewSeat {
  booking_id: string;
  starts_at: string;
  ends_at: string;
  pitch_type: string;
  pitch_name: string;
  venue_name: string;
  city_name_en: string;
  city_name_gr: string;
  gk_replacing: number;
  outfield_replacing: number;
  is_split: boolean;
  share_amount_cents: number | null;
  invite_token: string;
}

export async function fetchCrewSeats(): Promise<CrewSeat[]> {
  const { data, error } = await supabase
    .from('v_crew_seats')
    .select(
      `booking_id, starts_at, ends_at, pitch_type, pitch_name, venue_name, city_name_en,
       city_name_gr, gk_replacing, outfield_replacing, is_split, share_amount_cents, invite_token`,
    )
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CrewSeat[];
}

/* ─────────────────────── shared date formatting ─────────────────────── */
// Lives here rather than duplicated in every screen that renders a fixture
// or a preview of one — `/f/[token]` needs the identical "Friday 28 August"
// / "19:00–20:00" strings before the viewer has joined anything.

export function formatFixtureDate(iso: string, locale: 'en' | 'gr'): string {
  return new Intl.DateTimeFormat(locale === 'gr' ? 'el-GR' : 'en-GB', {
    timeZone: VENUE_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(iso));
}

// "Every Thursday since September" (plans/strava-build.md B2). The day is
// the game's, the month the run's first game's, both on the venue's clock;
// the year only when the run began in another one. Tables, not Intl, for
// the Greek: after «Κάθε» the day stays as it is and after «από τον» the
// month takes the accusative, which no engine's Intl offers reliably.
const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
const GR_DAYS: Record<string, string> = {
  Monday: 'Δευτέρα',
  Tuesday: 'Τρίτη',
  Wednesday: 'Τετάρτη',
  Thursday: 'Πέμπτη',
  Friday: 'Παρασκευή',
  Saturday: 'Σάββατο',
  Sunday: 'Κυριακή',
};

export function seriesLineParts(
  startsAt: string,
  since: string,
  locale: 'en' | 'gr',
  now: Date = new Date(),
): { day: string; month: string; year: string | null } {
  const inCyprus = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: VENUE_TZ, ...opts }).format(d);
  const day = inCyprus(new Date(startsAt), { weekday: 'long' });
  const sinceDate = new Date(since);
  const monthIndex = Number(inCyprus(sinceDate, { month: 'numeric' })) - 1;
  const year = inCyprus(sinceDate, { year: 'numeric' });
  return {
    day: locale === 'gr' ? (GR_DAYS[day] ?? day) : day,
    month: (locale === 'gr' ? GR_MONTHS_ACC[monthIndex] : EN_MONTHS[monthIndex]) ?? '',
    year: year === inCyprus(now, { year: 'numeric' }) ? null : year,
  };
}

export function formatFixtureTimeRange(startsAt: string, endsAt: string, locale: 'en' | 'gr'): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(locale === 'gr' ? 'el-GR' : 'en-GB', {
      timeZone: VENUE_TZ,
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  return `${fmt(new Date(startsAt))}–${fmt(new Date(endsAt))}`;
}

/* ─────────────────────────── leave + rejoin (W6) ─────────────────────────── */

/**
 * Leaving is a plain RLS-gated UPDATE on the caller's own row, never an RPC
 * (ADR-0022's "when it stops moving money" boundary doesn't apply — this
 * moves nothing, and the identity-column trigger already stops it becoming
 * anything more than a status flip). `booking_participants_update_self`
 * requires `user_id = auth.uid()`, which the caller's own participant row
 * always satisfies, so filtering by `participant_id` alone is sufficient —
 * there is nothing else that row could belong to.
 */
export async function leaveFixture(participantId: string): Promise<void> {
  const { error } = await supabase
    .from('booking_participants')
    .update({ status: 'out' })
    .eq('id', participantId);
  if (error) throw error;
}

/**
 * Rejoining reuses `join_fixture()` rather than a second UPDATE path — the
 * RPC's own UPDATE-then-INSERT logic already treats "existing row, flip back
 * to in" as the ordinary case (a mis-tapped leave is just a rejoin), so a
 * bespoke rejoin function would duplicate exactly that. Needs the fixture's
 * own `invite_token` because the RPC's only entry point is the capability,
 * not the booking id (ADR-0021) — `v_fixture` carries it for this reason.
 */
export async function rejoinFixture(inviteToken: string, slotKind: SlotKind): Promise<void> {
  await joinFixture(inviteToken, slotKind);
}

/* ──────────────────── the community board (ADR-0028) ──────────────────── */
// An open match is a booking whose organiser listed it. The board reads
// `v_open_fixtures` — preview-shaped (counts, never names) and carrying the
// invite token, because joining an open match IS following its invite: the
// Community tab routes a tapped row to /f/<token> and inherits the whole
// join/claim/sign-in machinery instead of growing a second join path.

export interface OpenMatch {
  booking_id: string;
  starts_at: string;
  ends_at: string;
  pitch_type: string;
  pitch_name: string;
  venue_name: string;
  city_name_en: string;
  city_name_gr: string;
  gk_open: number;
  outfield_open: number;
  is_split: boolean;
  share_amount_cents: number | null;
  invite_token: string;
  /** Booking total + slot shape — the "~€X a head if it fills" estimate. */
  total_cents: number;
  gk_slots: number;
  outfield_slots: number;
  open_level: OpenLevel | null;
  /**
   * How many of the seated squad the viewer has already completed a match
   * with (community-v3.md). Counts, never names — and symmetric, so it can
   * only ever reflect fixtures the viewer themselves stood on. 0 for a
   * newcomer, and the row hides the line at 0.
   */
  played_with_squad: number;
  /** Where the game is (plans/maps.md): the venue's pin. */
  venue_id: string;
  lat: number | null;
  lng: number | null;
  /**
   * The group's weekly run (plans/strava-build.md B2): the organiser's
   * same venue, weekday and hour, week after week. NULL below week 4 —
   * the floor is in the view, so a non-null value is always worth saying.
   */
  series_weeks: number | null;
  /** The run's first kickoff — "since September". NULL with series_weeks. */
  series_since: string | null;
}

const OPEN_MATCH_COLUMNS =
  `booking_id, starts_at, ends_at, pitch_type, pitch_name, venue_name,
   city_name_en, city_name_gr, gk_open, outfield_open, is_split,
   share_amount_cents, invite_token, total_cents, gk_slots, outfield_slots,
   open_level, played_with_squad, venue_id, lat, lng, series_weeks, series_since`;

/**
 * Every listed fixture, soonest first. The view's own predicate does the
 * curation (open, live, not started, short a player), so an empty array
 * really means "nothing to join right now", not "filtered wrong here".
 */
export async function fetchOpenMatches(): Promise<OpenMatch[]> {
  const { data, error } = await supabase
    .from('v_open_fixtures')
    .select(OPEN_MATCH_COLUMNS)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as OpenMatch[];
}

/**
 * The organiser's listing switch — a plain RLS-gated UPDATE, the
 * `leaveFixture` boundary again: a flag flip moves no money, so no RPC.
 * `bookings_update_open_self` only reaches the caller's own booking, and
 * the column guard on bookings freezes everything except `is_open`.
 */
export async function setFixtureOpen(bookingId: string, open: boolean): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ is_open: open })
    .eq('id', bookingId);
  if (error) throw error;
}

/** The listing's level tag — the guard's second (and only other) column. */
export async function setFixtureLevel(bookingId: string, level: OpenLevel | null): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ open_level: level })
    .eq('id', bookingId);
  if (error) throw error;
}

/* ───────────────────── the shelf (community-v2.md) ───────────────────── */
// Standing content under the board: the official per-city WhatsApp groups
// (rendered only where a link exists) and the trailing week's proof of
// life. Never simulated activity — the strip hides itself at zero.

export interface CityGroup {
  name_en: string;
  name_gr: string;
  whatsapp_group_url: string;
}

export async function fetchCityGroups(): Promise<CityGroup[]> {
  const { data, error } = await supabase
    .from('cities')
    .select('name_en, name_gr, whatsapp_group_url')
    .not('whatsapp_group_url', 'is', null)
    .order('name_en');
  if (error) throw error;
  return (data ?? []) as unknown as CityGroup[];
}

export interface WeekStats {
  matches_7d: number;
  players_7d: number;
}

export async function fetchWeekStats(): Promise<WeekStats> {
  const { data, error } = await supabase.rpc('community_week_stats');
  if (error) throw error;
  const row = (data ?? [])[0] as WeekStats | undefined;
  return row ?? { matches_7d: 0, players_7d: 0 };
}

/* ────────── the organiser & the thread (community-v3.md) ────────── */
// Two caller-scoped reads that make v2's substrate visible. Both answer
// only about the signed-in caller's own fixtures, both are counts, and
// both are allowed to come back empty — the screen renders nothing at
// all rather than an empty room.

/** A fixture of mine that still has seats. The organiser lane's row. */
export interface FixtureToFill {
  booking_id: string;
  starts_at: string;
  ends_at: string;
  pitch_type: string;
  pitch_name: string;
  venue_name: string;
  city_name_en: string;
  city_name_gr: string;
  gk_open: number;
  outfield_open: number;
  is_open: boolean;
  invite_token: string;
}

export async function fetchFixturesToFill(): Promise<FixtureToFill[]> {
  const { data, error } = await supabase.rpc('my_fixtures_to_fill');
  if (error) throw error;
  return (data ?? []) as unknown as FixtureToFill[];
}

/**
 * A repeated slot — "Tuesdays at Camares". Grouped server-side on the
 * local clock, floored at two played matches, so a single game never
 * dresses itself up as a habit.
 */
export interface Series {
  venue_name: string;
  city_name_en: string;
  city_name_gr: string;
  pitch_type: string;
  /** ISO weekday, 1 = Monday. */
  weekday: number;
  kickoff_hour: number;
  played: number;
  last_played_at: string | null;
  next_booking_id: string | null;
  next_starts_at: string | null;
}

export async function fetchMySeries(): Promise<Series[]> {
  const { data, error } = await supabase.rpc('my_series');
  if (error) throw error;
  return (data ?? []) as unknown as Series[];
}
