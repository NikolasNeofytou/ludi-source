// _shared/notices.ts
// What a player's notice says, in their language (ADR-0048, plans/reach.md
// R3). Pure: a claimed ledger row in, a title, a body and the route the
// tap opens out. The sender (notify-players) turns these into Expo push
// messages and Resend emails; this file never touches the network, so
// every line of copy is unit-tested in _tests/notices.test.ts.
//
// Rules the copy keeps:
//   - the game is named by its kickoff in Cyprus time, its venue and its
//     code — never by who else is in it (ADR-0012's minimisation);
//   - an ask says what is being asked and that the keeper plays free
//     (ADR-0047); it never names the organiser;
//   - a tap lands on the fixture for the player's own game and on the
//     board for an ask — the two routes the app accepts (push.ts);
//   - a followed team's match (plans/cfa-in-the-app.md, ADR-0051) is named
//     by its age group and its two teams — never a child — and a tap lands
//     on Bookings, where the parent's teams' matches are; the parents'
//     game is an ask, on the board;
//   - the morning after (plans/strava-build.md B1) tells the organiser
//     how many played and how many came back from last week — counts,
//     never names — and a tap lands on the game, where "Book again" is;
//   - a person's name (the keeper in keeper_found, the greeting in an
//     email) goes through displayFirstName first: players type their own,
//     and it lands in someone else's push title (audit 2026-10-19, L12).

import { displayFirstName } from './display-name.ts';

export type NoticeKind =
  | 'booking_confirmed'
  | 'reminder'
  | 'fixture_cancelled'
  | 'keeper_wanted'
  | 'keeper_found'
  | 'seat_offered'
  | 'seat_taken'
  | 'game_full'
  | 'team_programme'
  | 'team_changed'
  | 'team_reminder'
  | 'parents_game'
  | 'series_turnout';

/** A followed team's match, as the claim brings it (context.match). */
export interface NoticeMatch {
  venue_id?: string;
  date?: string;
  category?: string;
  home?: string;
  away?: string;
  status?: string;
  what?: 'kickoff' | 'court' | 'venue' | 'status';
  old?: string;
  new?: string;
}

/**
 * The morning after's numbers (fixture_turnout): seats in the game, of them
 * how many were in last week's game of the same series (absent when there
 * was none), and the run's week.
 */
export interface NoticeTurnout {
  played?: number;
  returning?: number;
  weeks?: number;
}

export type Locale = 'en' | 'gr';

/** One claimed row, as claim_player_notifications returns it. */
export interface ClaimedNotice {
  id: string;
  kind: NoticeKind;
  channel: 'push' | 'email';
  user_id: string;
  attempts: number;
  locale: string | null;
  first_name: string | null;
  email: string | null;
  tokens: string[] | null;
  /** NULL for a followed team's match: it has no booking of the parent's. */
  booking_id: string | null;
  code: string | null;
  starts_at: string;
  invite_token: string | null;
  pitch_name: string | null;
  venue_name: string;
  context: {
    shape?: 'full' | 'rotation';
    keeper_name?: string;
    slot_kind?: string;
    match?: NoticeMatch;
    /** The morning after: counts from fixture_turnout(). */
    turnout?: NoticeTurnout;
  } | null;
}

export interface RenderedNotice {
  title: string;
  body: string;
  /** The route the app opens on tap: /booking/<id> or /community. */
  url: string;
}

export const VENUE_TZ = 'Asia/Nicosia';

const ASK_KINDS: ReadonlySet<NoticeKind> = new Set(['keeper_wanted', 'seat_offered', 'parents_game']);

/** A followed team's match: no booking, the match in context.match. */
export const TEAM_KINDS: ReadonlySet<NoticeKind> = new Set(['team_programme', 'team_changed', 'team_reminder']);

export function localeOf(value: string | null | undefined): Locale {
  return value === 'gr' ? 'gr' : 'en';
}

/** "Thu 15 Oct, 20:00" / "Πέμ 15 Οκτ, 20:00" — the kickoff in Cyprus time. */
export function formatKickoff(iso: string, locale: Locale): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat(locale === 'gr' ? 'el-GR' : 'en-GB', {
    timeZone: VENUE_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: VENUE_TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return `${day}, ${time}`;
}

/** "20:00" — the time alone, for the reminder's headline. */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: VENUE_TZ, hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso));
}

export function routeFor(kind: NoticeKind, bookingId: string | null): string {
  if (TEAM_KINDS.has(kind)) return '/bookings';
  return ASK_KINDS.has(kind) ? '/community' : `/booking/${bookingId}`;
}

// A followed team's match, in both languages. "U9 Lions · ΟΜΟΝΟΙΑ – ΠΑΕΕΚ",
// the place as "Court 3 · Campeone" (or the CFA's venue name for an away
// match), the kickoff in Cyprus time.
function renderTeam(n: ClaimedNotice, locale: Locale): RenderedNotice {
  const m = n.context?.match ?? {};
  const url = routeFor(n.kind, n.booking_id);
  const cat = m.category ?? '';
  const teams = m.home && m.away ? `${m.home} – ${m.away}` : '';
  const when = formatKickoff(n.starts_at, locale);
  const time = formatTime(n.starts_at);
  const place = n.pitch_name ? `${n.pitch_name} · ${n.venue_name}` : n.venue_name;
  const join = (...parts: string[]) => parts.filter(Boolean).join(' · ');
  const gr = locale === 'gr';

  if (n.kind === 'team_programme') {
    return { title: join(gr ? 'Βγήκε το πρόγραμμα' : 'The programme is out', cat), body: join(when, place, teams), url };
  }
  if (n.kind === 'team_reminder') {
    return { title: join(gr ? `Σέντρα στις ${time}` : `Kick-off at ${time}`, cat), body: join(teams, place), url };
  }
  // team_changed: what moved, from and to
  const line = join(cat, teams);
  switch (m.what) {
    case 'kickoff':
      return { title: gr ? `Άλλαξε η ώρα: ${m.old} → ${m.new}` : `New time: ${m.old} → ${m.new}`, body: join(line, place), url };
    case 'court':
      return { title: gr ? `Άλλαξε γήπεδο: ${m.new}` : `New court: ${m.new}`, body: join(line, when, n.venue_name), url };
    case 'venue':
      return { title: gr ? `Αλλάζει χώρος: ${m.new}` : `New venue: ${m.new}`, body: join(line, when), url };
    case 'status': {
      const word = m.new === 'cancelled'
        ? (gr ? 'Ακυρώθηκε' : 'Cancelled')
        : m.new === 'postponed'
        ? (gr ? 'Αναβλήθηκε' : 'Postponed')
        : (gr ? 'Ξανά στο πρόγραμμα' : 'Back on');
      return { title: join(word, cat), body: join(teams, when, place), url };
    }
    default:
      return { title: join(gr ? 'Αλλαγή στο πρόγραμμα' : 'Programme change', cat), body: join(teams, when, place), url };
  }
}

// The weekday of the game, in Cyprus: the English name, and the Greek
// nominative for the title and the phrase for "book next <day>" (Σάββατο
// is neuter: "το επόμενο Σάββατο").
const GREEK_DAY: Record<string, { name: string; next: string }> = {
  Monday: { name: 'Δευτέρα', next: 'την επόμενη Δευτέρα' },
  Tuesday: { name: 'Τρίτη', next: 'την επόμενη Τρίτη' },
  Wednesday: { name: 'Τετάρτη', next: 'την επόμενη Τετάρτη' },
  Thursday: { name: 'Πέμπτη', next: 'την επόμενη Πέμπτη' },
  Friday: { name: 'Παρασκευή', next: 'την επόμενη Παρασκευή' },
  Saturday: { name: 'Σάββατο', next: 'το επόμενο Σάββατο' },
  Sunday: { name: 'Κυριακή', next: 'την επόμενη Κυριακή' },
};

function weekdayOf(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: VENUE_TZ, weekday: 'long' }).format(new Date(iso));
}

// "Thursday at Kamares Futsal" / "10 played · 8 of them last week too ·
// Book next Thursday". With fewer than two seats on the roster Ludi does
// not know who played, so the counts drop and only the booking line stays.
function renderTurnout(n: ClaimedNotice, locale: Locale, url: string): RenderedNotice {
  const day = weekdayOf(n.starts_at);
  const t = n.context?.turnout ?? {};
  const played = t.played ?? 0;
  const known = played >= 2;
  const back = known && t.returning != null && t.returning > 0 ? t.returning : null;
  if (locale === 'gr') {
    const gr = GREEK_DAY[day] ?? GREEK_DAY.Monday;
    const parts = [
      known ? `Έπαιξαν ${played}` : null,
      back == null
        ? null
        : back === played
          ? 'όλοι και την προηγούμενη εβδομάδα'
          : back === 1
            ? 'ένας από αυτούς και την προηγούμενη εβδομάδα'
            : `οι ${back} και την προηγούμενη εβδομάδα`,
      `Κλείσε ${gr.next}`,
    ];
    return { title: `${gr.name} στο ${n.venue_name}`, body: parts.filter(Boolean).join(' · '), url };
  }
  const parts = [
    known ? `${played} played` : null,
    back == null ? null : back === played ? 'all of them last week too' : `${back} of them last week too`,
    `Book next ${day}`,
  ];
  return { title: `${day} at ${n.venue_name}`, body: parts.filter(Boolean).join(' · '), url };
}

export function renderNotice(n: ClaimedNotice): RenderedNotice {
  const locale = localeOf(n.locale);
  if (TEAM_KINDS.has(n.kind)) return renderTeam(n, locale);
  if (n.kind === 'series_turnout') return renderTurnout(n, locale, routeFor(n.kind, n.booking_id));
  const when = formatKickoff(n.starts_at, locale);
  const time = formatTime(n.starts_at);
  const where = `${n.pitch_name} · ${n.venue_name}`;
  const url = routeFor(n.kind, n.booking_id);
  const shape = n.context?.shape;
  const keeper = displayFirstName(n.context?.keeper_name);

  if (locale === 'gr') {
    switch (n.kind) {
      case 'booking_confirmed':
        return { title: 'Το γήπεδο κλείστηκε', body: `${when} · ${where} · ${n.code}`, url };
      case 'reminder':
        return { title: `Το παιχνίδι σου είναι στις ${time}`, body: `${where} · ${n.code}`, url };
      case 'fixture_cancelled':
        return { title: 'Ακυρώθηκε το παιχνίδι', body: `${when} · ${where} · ${n.code}`, url };
      case 'keeper_wanted':
        return {
          title: `Ζητείται τερματοφύλακας ${when}`,
          body: `${n.venue_name} · ${shape === 'rotation' ? 'είκοσι λεπτά ο καθένας' : 'όλο το παιχνίδι'} · παίζεις δωρεάν`,
          url,
        };
      case 'keeper_found':
        return {
          title: keeper ? `Ο ${keeper} μπαίνει στο τέρμα` : 'Βρέθηκε τερματοφύλακας',
          body: `${when} · ${where}`,
          url,
        };
      case 'seat_offered':
        return { title: `Άνοιξε μια θέση ${when}`, body: `${n.venue_name} · πάτησε για να την πάρεις`, url };
      case 'seat_taken':
        return { title: 'Η θέση σου πάρθηκε', body: `${when} · ${where} · είσαι εντάξει`, url };
      case 'game_full':
        return { title: 'Το παιχνίδι σου γέμισε', body: `${when} · ${where} · ${n.code}`, url };
      case 'parents_game':
        return { title: `Οι γονείς παίζουν ${when}`, body: `${n.venue_name} · πάτησε για να μπεις`, url };
      default:
        break;
    }
  }
  switch (n.kind) {
    case 'booking_confirmed':
      return { title: 'Your game is booked', body: `${when} · ${where} · ${n.code}`, url };
    case 'reminder':
      return { title: `Your game is at ${time}`, body: `${where} · ${n.code}`, url };
    case 'fixture_cancelled':
      return { title: 'Game cancelled', body: `${when} · ${where} · ${n.code}`, url };
    case 'keeper_wanted':
      return {
        title: `Keeper wanted ${when}`,
        body: `${n.venue_name} · ${shape === 'rotation' ? 'twenty minutes each' : 'the whole game'} · you play free`,
        url,
      };
    case 'keeper_found':
      return {
        title: keeper ? `${keeper} is in goal` : 'A keeper is in',
        body: `${when} · ${where}`,
        url,
      };
    case 'seat_offered':
      return { title: `A seat opened ${when}`, body: `${n.venue_name} · tap to take it`, url };
    case 'seat_taken':
      return { title: 'Your seat was taken', body: `${when} · ${where} · you're off the hook`, url };
    case 'game_full':
      return { title: 'Your game is full', body: `${when} · ${where} · ${n.code}`, url };
    case 'parents_game':
      return { title: `Parents' game ${when}`, body: `${n.venue_name} · tap to join`, url };
    default:
      return { title: 'Ludi', body: `${when} · ${n.venue_name}`, url };
  }
}

// ── Expo push ─────────────────────────────────────────────────────────

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: { url: string };
  sound: 'default';
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** One message per live device of the player. */
export function pushMessagesFor(n: ClaimedNotice): ExpoMessage[] {
  const r = renderNotice(n);
  return (n.tokens ?? []).map((to) => ({ to, title: r.title, body: r.body, data: { url: r.url }, sound: 'default' }));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface TokenOutcome {
  token: string;
  ticketId: string | null;
  /** Expo's error code, e.g. DeviceNotRegistered, or null when accepted. */
  error: string | null;
}

/** Pairs Expo's tickets back with the messages they answer, in order. */
export function pairTickets(messages: ExpoMessage[], tickets: ExpoTicket[]): TokenOutcome[] {
  return messages.map((m, i) => {
    const t = tickets[i];
    if (!t) return { token: m.to, ticketId: null, error: 'NoTicket' };
    if (t.status === 'ok' && t.id) return { token: m.to, ticketId: t.id, error: null };
    return { token: m.to, ticketId: null, error: t.details?.error ?? t.message ?? 'Unknown' };
  });
}

/** Expo errors that mean the device is gone, not that the message was bad. */
export function isDeadDevice(error: string | null): boolean {
  return error === 'DeviceNotRegistered';
}

// ── Email ─────────────────────────────────────────────────────────────

export interface RenderedEmail {
  subject: string;
  text: string;
}

/** The email is the push and a link; no HTML until there is a reason. */
export function renderEmail(n: ClaimedNotice, siteOrigin = 'https://ludi.football'): RenderedEmail {
  const r = renderNotice(n);
  const locale = localeOf(n.locale);
  const link = n.invite_token ? `${siteOrigin}/f/${n.invite_token}` : siteOrigin;
  const name = displayFirstName(n.first_name);
  const hello = name ? (locale === 'gr' ? `Γεια σου ${name},` : `Hi ${name},`) : (locale === 'gr' ? 'Γεια σου,' : 'Hi,');
  const open = locale === 'gr' ? 'Άνοιξέ το στο Ludi:' : 'Open it in Ludi:';
  const sign = locale === 'gr' ? '— Ludi' : '— Ludi';
  return {
    subject: r.title,
    text: `${hello}\n\n${r.title}\n${r.body}\n\n${open} ${link}\n\n${sign}`,
  };
}
