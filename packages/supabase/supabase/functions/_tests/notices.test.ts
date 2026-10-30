// _tests/notices.test.ts
// The player's notices render in both languages, name the game by its
// kickoff in Cyprus time, route where the app accepts, and Expo's answers
// pair back to the devices they were for (ADR-0048).

import { assertEquals, assertMatch } from 'std/assert/mod.ts';
import {
  chunk,
  formatKickoff,
  isDeadDevice,
  pairTickets,
  pushMessagesFor,
  renderEmail,
  renderNotice,
  routeFor,
  type ClaimedNotice,
  type NoticeKind,
} from '../_shared/notices.ts';

const KINDS: NoticeKind[] = [
  'booking_confirmed',
  'reminder',
  'fixture_cancelled',
  'keeper_wanted',
  'keeper_found',
  'seat_offered',
  'seat_taken',
  'game_full',
  'team_programme',
  'team_changed',
  'team_reminder',
  'parents_game',
  'series_turnout',
];

function row(overrides: Partial<ClaimedNotice> = {}): ClaimedNotice {
  return {
    id: 'n-1',
    kind: 'reminder',
    channel: 'push',
    user_id: 'u-1',
    attempts: 1,
    locale: 'en',
    first_name: 'Marios',
    email: 'marios@example.test',
    tokens: ['ExponentPushToken[aaaaaaaaaaaa]', 'ExponentPushToken[bbbbbbbbbbbb]'],
    booking_id: '7b2c6b8e-3b2a-4b9f-9d6a-1c2d3e4f5a6b',
    code: 'LAR-2026-0412',
    starts_at: '2026-10-15T17:00:00Z', // 20:00 in Cyprus (EEST)
    invite_token: 'test-invite-token',
    pitch_name: 'Court 2',
    venue_name: 'Kamares Futsal',
    context: null,
    ...overrides,
  };
}

Deno.test('kickoff is the venue clock, in both languages', () => {
  assertEquals(formatKickoff('2026-10-15T17:00:00Z', 'en'), 'Thu 15 Oct, 20:00');
  assertMatch(formatKickoff('2026-10-15T17:00:00Z', 'gr'), /Πέμ.* 15 Οκτ.*, 20:00/);
  // winter: EET, +2
  assertEquals(formatKickoff('2026-12-10T18:00:00Z', 'en'), 'Thu 10 Dec, 20:00');
});

Deno.test('every kind renders in EN and EL with a title, a body and a route', () => {
  for (const kind of KINDS) {
    for (const locale of ['en', 'gr'] as const) {
      const r = renderNotice(row({ kind, locale }));
      assertEquals(r.title.length > 0, true, `${kind}/${locale} title`);
      assertEquals(r.body.length > 0, true, `${kind}/${locale} body`);
      assertEquals(r.url, routeFor(kind, '7b2c6b8e-3b2a-4b9f-9d6a-1c2d3e4f5a6b'));
    }
  }
});

Deno.test('asks route to the board, a player\'s own game to the fixture', () => {
  assertEquals(routeFor('keeper_wanted', 'b'), '/community');
  assertEquals(routeFor('seat_offered', 'b'), '/community');
  assertEquals(routeFor('reminder', 'b'), '/booking/b');
  assertEquals(routeFor('keeper_found', 'b'), '/booking/b');
});

Deno.test('the reminder leads with the time; confirmed carries the code', () => {
  assertEquals(renderNotice(row({ kind: 'reminder' })).title, 'Your game is at 20:00');
  assertEquals(renderNotice(row({ kind: 'reminder' })).body, 'Court 2 · Kamares Futsal · LAR-2026-0412');
  assertEquals(renderNotice(row({ kind: 'booking_confirmed' })).body, 'Thu 15 Oct, 20:00 · Court 2 · Kamares Futsal · LAR-2026-0412');
  assertEquals(renderNotice(row({ kind: 'reminder', locale: 'gr' })).title, 'Το παιχνίδι σου είναι στις 20:00');
});

Deno.test('a keeper wanted says the shape and that the keeper plays free, never the organiser', () => {
  const full = renderNotice(row({ kind: 'keeper_wanted', context: { shape: 'full' } }));
  assertEquals(full.title, 'Keeper wanted Thu 15 Oct, 20:00');
  assertEquals(full.body, 'Kamares Futsal · the whole game · you play free');
  const rota = renderNotice(row({ kind: 'keeper_wanted', context: { shape: 'rotation' }, locale: 'gr' }));
  assertEquals(rota.body, 'Kamares Futsal · είκοσι λεπτά ο καθένας · παίζεις δωρεάν');
  assertEquals(full.body.includes('Marios'), false);
});

Deno.test('a keeper found names the keeper when there is one', () => {
  assertEquals(renderNotice(row({ kind: 'keeper_found', context: { keeper_name: 'Kleanthis' } })).title, 'Kleanthis is in goal');
  assertEquals(renderNotice(row({ kind: 'keeper_found', context: { keeper_name: '  ' } })).title, 'A keeper is in');
  assertEquals(renderNotice(row({ kind: 'keeper_found', context: { keeper_name: 'Κλεάνθης' }, locale: 'gr' })).title, 'Ο Κλεάνθης μπαίνει στο τέρμα');
});

// The keeper chose their own first name, and it lands in the organiser's
// push title (audit 2026-10-19, L12): a first name and nothing else.
Deno.test('a keeper found names the keeper by a first name only', () => {
  const title = (keeper_name: string, locale = 'en') =>
    renderNotice(row({ kind: 'keeper_found', context: { keeper_name }, locale })).title;
  assertEquals(title('scam-site.cy/win'), 'Scam-Site is in goal');
  assertEquals(title('Kleanthis Georgiou'), 'Kleanthis is in goal');
  assertEquals(title('\u202Eniw.yc\u202C Kleanthis'), 'Niw is in goal');
  assertEquals(title('🔥🔥🔥'), 'A keeper is in');
  assertEquals(title('ΚΛΕΑΝΘΗΣ', 'gr'), 'Ο Κλεανθης μπαίνει στο τέρμα');
  assertEquals(title('\u2066Κλεάνθης\u2069 www.scam.cy', 'gr'), 'Ο Κλεάνθης μπαίνει στο τέρμα');
  const email = renderEmail(row({ kind: 'keeper_found', context: { keeper_name: 'evil.cy/x' } }));
  assertEquals(email.subject, 'Evil is in goal');
});

Deno.test('the email greets the player by a first name only', () => {
  assertMatch(renderEmail(row({ first_name: '  marios.cy  ' })).text, /^Hi Marios,\n/);
  assertMatch(renderEmail(row({ first_name: '\u202E😀' })).text, /^Hi,\n/);
  assertMatch(renderEmail(row({ first_name: 'Μάριος', locale: 'gr' })).text, /^Γεια σου Μάριος,\n/);
});

Deno.test('one push message per live device, carrying the route', () => {
  const msgs = pushMessagesFor(row());
  assertEquals(msgs.length, 2);
  assertEquals(msgs[0].to, 'ExponentPushToken[aaaaaaaaaaaa]');
  assertEquals(msgs[0].data.url, '/booking/7b2c6b8e-3b2a-4b9f-9d6a-1c2d3e4f5a6b');
  assertEquals(msgs[0].sound, 'default');
  assertEquals(pushMessagesFor(row({ tokens: null })).length, 0);
});

Deno.test('chunks of a hundred', () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  const parts = chunk(items, 100);
  assertEquals(parts.map((p) => p.length), [100, 100, 50]);
  assertEquals(chunk([], 100), []);
});

Deno.test('tickets pair back to devices; a dead device is told apart from a bad message', () => {
  const msgs = pushMessagesFor(row());
  const out = pairTickets(msgs, [
    { status: 'ok', id: 'ticket-1' },
    { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
  ]);
  assertEquals(out[0], { token: 'ExponentPushToken[aaaaaaaaaaaa]', ticketId: 'ticket-1', error: null });
  assertEquals(out[1].error, 'DeviceNotRegistered');
  assertEquals(isDeadDevice(out[1].error), true);
  assertEquals(isDeadDevice('MessageTooBig'), false);
  // fewer tickets than messages: the missing one is an error, not a crash
  assertEquals(pairTickets(msgs, [{ status: 'ok', id: 't' }])[1].error, 'NoTicket');
});

Deno.test('the email is the notice and a link to the fixture', () => {
  const e = renderEmail(row({ kind: 'booking_confirmed' }));
  assertEquals(e.subject, 'Your game is booked');
  assertMatch(e.text, /^Hi Marios,\n\nYour game is booked\n/);
  assertMatch(e.text, /https:\/\/ludi\.football\/f\/test-invite-token/);
  const el = renderEmail(row({ kind: 'fixture_cancelled', locale: 'gr', first_name: null, invite_token: null }));
  assertMatch(el.text, /^Γεια σου,\n\nΑκυρώθηκε το παιχνίδι\n/);
  assertMatch(el.text, /Άνοιξέ το στο Ludi: https:\/\/ludi\.football\n/);
});

// ── a followed CFA team (plans/cfa-in-the-app.md, ADR-0051) ────────────

const MATCH = { venue_id: 'v-1', date: '2026-10-31', category: 'U9 Lions', home: 'ΟΜΟΝΟΙΑ', away: 'ΠΑΕΕΚ', status: 'scheduled' };

function teamRow(overrides: Partial<ClaimedNotice> = {}, match: Record<string, string> = {}): ClaimedNotice {
  return row({
    kind: 'team_programme',
    booking_id: null,
    code: null,
    starts_at: '2026-10-31T07:15:00Z', // 09:15 in Cyprus (EET from 25 Oct)
    invite_token: null,
    pitch_name: 'Court 3',
    venue_name: 'Campeone',
    context: { match: { ...MATCH, ...match } },
    ...overrides,
  });
}

Deno.test('a followed team\'s notice lands on Bookings; the parents\' game on the board', () => {
  assertEquals(routeFor('team_programme', null), '/bookings');
  assertEquals(routeFor('team_changed', null), '/bookings');
  assertEquals(routeFor('team_reminder', null), '/bookings');
  assertEquals(routeFor('parents_game', 'b'), '/community');
  assertEquals(renderNotice(teamRow()).url, '/bookings');
});

Deno.test('the programme names the age group, the teams, the court and the kickoff', () => {
  const en = renderNotice(teamRow());
  assertEquals(en.title, 'The programme is out · U9 Lions');
  assertEquals(en.body, 'Sat 31 Oct, 09:15 · Court 3 · Campeone · ΟΜΟΝΟΙΑ – ΠΑΕΕΚ');
  const gr = renderNotice(teamRow({ locale: 'gr' }));
  assertEquals(gr.title, 'Βγήκε το πρόγραμμα · U9 Lions');
  // an away match: the CFA's venue name, no court
  const away = renderNotice(teamRow({ pitch_name: null, venue_name: 'CENTRAL PARK' }, { venue_id: '' }));
  assertEquals(away.body, 'Sat 31 Oct, 09:15 · CENTRAL PARK · ΟΜΟΝΟΙΑ – ΠΑΕΕΚ');
});

Deno.test('a change says what moved, from and to', () => {
  assertEquals(
    renderNotice(teamRow({ kind: 'team_changed' }, { what: 'kickoff', old: '09:15', new: '10:15' })).title,
    'New time: 09:15 → 10:15',
  );
  assertEquals(
    renderNotice(teamRow({ kind: 'team_changed', locale: 'gr' }, { what: 'kickoff', old: '09:15', new: '10:15' })).title,
    'Άλλαξε η ώρα: 09:15 → 10:15',
  );
  const court = renderNotice(teamRow({ kind: 'team_changed', pitch_name: 'Court 5' }, { what: 'court', old: 'Court 3', new: 'Court 5' }));
  assertEquals(court.title, 'New court: Court 5');
  assertEquals(court.body, 'U9 Lions · ΟΜΟΝΟΙΑ – ΠΑΕΕΚ · Sat 31 Oct, 09:15 · Campeone');
  assertEquals(
    renderNotice(teamRow({ kind: 'team_changed', locale: 'gr' }, { what: 'status', old: 'scheduled', new: 'cancelled' })).title,
    'Ακυρώθηκε · U9 Lions',
  );
  assertEquals(
    renderNotice(teamRow({ kind: 'team_changed' }, { what: 'status', old: 'scheduled', new: 'postponed' })).title,
    'Postponed · U9 Lions',
  );
  assertEquals(
    renderNotice(teamRow({ kind: 'team_changed' }, { what: 'venue', old: 'Campeone', new: 'CENTRAL PARK' })).title,
    'New venue: CENTRAL PARK',
  );
});

Deno.test('the hour before leads with the kickoff', () => {
  const r = renderNotice(teamRow({ kind: 'team_reminder' }));
  assertEquals(r.title, 'Kick-off at 09:15 · U9 Lions');
  assertEquals(r.body, 'ΟΜΟΝΟΙΑ – ΠΑΕΕΚ · Court 3 · Campeone');
  assertEquals(renderNotice(teamRow({ kind: 'team_reminder', locale: 'gr' })).title, 'Σέντρα στις 09:15 · U9 Lions');
});

Deno.test('the parents\' game is an ask: the venue and the time, never the organiser', () => {
  const r = renderNotice(row({ kind: 'parents_game' }));
  assertEquals(r.title, "Parents' game Thu 15 Oct, 20:00");
  assertEquals(r.body, 'Kamares Futsal · tap to join');
  assertMatch(renderNotice(row({ kind: 'parents_game', locale: 'gr' })).title, /^Οι γονείς παίζουν Πέμ.* 15 Οκτ.*, 20:00$/);
  assertEquals(r.body.includes('Marios'), false);
});

// ── the morning after (plans/strava-build.md B1) ─────────────────────
const AFTER = { kind: 'series_turnout' as const, starts_at: '2026-10-15T17:00:00Z' }; // Thursday 20:00 in Cyprus

Deno.test('the morning after: how many played and came back, in English', () => {
  const r = renderNotice(row({ ...AFTER, context: { turnout: { played: 10, returning: 8, weeks: 5 } } }));
  assertEquals(r.title, 'Thursday at Kamares Futsal');
  assertEquals(r.body, '10 played · 8 of them last week too · Book next Thursday');
  assertEquals(r.url, '/booking/7b2c6b8e-3b2a-4b9f-9d6a-1c2d3e4f5a6b');
});

Deno.test('the morning after, in Greek', () => {
  const r = renderNotice(row({ ...AFTER, locale: 'gr', context: { turnout: { played: 10, returning: 8, weeks: 5 } } }));
  assertEquals(r.title, 'Πέμπτη στο Kamares Futsal');
  assertEquals(r.body, 'Έπαιξαν 10 · οι 8 και την προηγούμενη εβδομάδα · Κλείσε την επόμενη Πέμπτη');
});

Deno.test('the morning after: no game last week drops the clause; all back says so', () => {
  assertEquals(
    renderNotice(row({ ...AFTER, context: { turnout: { played: 6, weeks: 1 } } })).body,
    '6 played · Book next Thursday',
  );
  assertEquals(
    renderNotice(row({ ...AFTER, context: { turnout: { played: 5, returning: 5, weeks: 2 } } })).body,
    '5 played · all of them last week too · Book next Thursday',
  );
  assertEquals(
    renderNotice(row({ ...AFTER, locale: 'gr', context: { turnout: { played: 5, returning: 1, weeks: 2 } } })).body,
    'Έπαιξαν 5 · ένας από αυτούς και την προηγούμενη εβδομάδα · Κλείσε την επόμενη Πέμπτη',
  );
});

Deno.test('the morning after: without a roster, only the booking line', () => {
  assertEquals(renderNotice(row({ ...AFTER, context: { turnout: { played: 1, weeks: 1 } } })).body, 'Book next Thursday');
  assertEquals(renderNotice(row({ ...AFTER, locale: 'gr', context: null })).body, 'Κλείσε την επόμενη Πέμπτη');
});

Deno.test('the morning after: Saturday is neuter in Greek, and no name is ever said', () => {
  const sat = renderNotice(row({ ...AFTER, locale: 'gr', starts_at: '2026-10-17T17:00:00Z', context: { turnout: { played: 8, returning: 6 } } }));
  assertEquals(sat.title, 'Σάββατο στο Kamares Futsal');
  assertEquals(sat.body.endsWith('Κλείσε το επόμενο Σάββατο'), true);
  assertEquals(sat.body.includes('Marios'), false);
});
