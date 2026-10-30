// _tests/booking-request.test.ts
// The booking desk's reader (ADR-0046). It lives in the admin
// (apps/admin/lib/booking-request.ts), which has no test runner; it is pure
// and import-free precisely so this suite can test it by path.
//
// "Today" is Tuesday 13 October 2026 throughout; courts are Campeone-like.

import { assertEquals } from 'std/assert/mod.ts';
import { parseBookingRequest } from '../../../../../apps/admin/lib/booking-request.ts';

const courts = [
  { id: 'c1', name: 'Court 1', type: '5-a-side' },
  { id: 'c2', name: 'Court 2', type: '5-a-side' },
  { id: 'c3', name: 'Γήπεδο 3', type: '5-a-side' },
  { id: 'c7', name: 'Court 7 (7v7)', type: '7-a-side' },
];
const at = (h: number, m = 0) => ({ today: '2026-10-13', nowMinutes: h * 60 + m, courts });
const morning = at(11);

const read = (text: string, ctx = morning) => {
  const p = parseBookingRequest(text, ctx);
  return { date: p.date, time: p.time, court: p.courtId, format: p.format, min: p.durationMin, players: p.players, conf: p.confidence };
};

Deno.test('Greek: tomorrow at 8, five-a-side', () => {
  const r = read('Γεια σου Γιώργο, μπορώ να κλείσω αύριο στις 8 για 5x5;');
  assertEquals([r.date, r.time, r.format, r.conf], ['2026-10-14', '20:00', '5-a-side', 'high']);
});

Deno.test('Greek: a court by number, a weekday, the evening said out loud', () => {
  const r = read('Θέλω γήπεδο 3 την Πέμπτη 9 το βράδυ');
  assertEquals([r.date, r.time, r.court], ['2026-10-15', '21:00', 'c3']);
});

Deno.test('Greeklish: avrio stis 7 kai misi', () => {
  const r = read('Kalispera, exete gipedo avrio stis 7 kai misi?');
  assertEquals([r.date, r.time], ['2026-10-14', '19:30']);
});

Deno.test('English: court, weekday, pm, minutes', () => {
  const r = read('Can I book court 2 on Friday at 8pm for 90 minutes');
  assertEquals([r.date, r.time, r.court, r.min], ['2026-10-16', '20:00', 'c2', 90]);
});

Deno.test('a date, a clock time, a seven-a-side word', () => {
  const r = read('15/10 στις 21:00 εφτάρι');
  assertEquals([r.date, r.time, r.format], ['2026-10-15', '21:00', '7-a-side']);
});

Deno.test('morning is morning', () => {
  const r = read('Σάββατο πρωί 10');
  assertEquals([r.date, r.time], ['2026-10-17', '10:00']);
});

Deno.test('tonight at 10 is 22:00', () => {
  assertEquals(read('απόψε 10').time, '22:00');
  assertEquals(read('απόψε 10').date, '2026-10-13');
});

Deno.test('today\'s weekday: today while the hour is ahead, next week once it has passed', () => {
  assertEquals(read('Τρίτη 8', at(11)).date, '2026-10-13');
  assertEquals(read('Τρίτη 8', at(21)).date, '2026-10-20');
});

Deno.test('a question with no day and no hour proposes nothing', () => {
  assertEquals(read('Γεια, τι ώρες έχετε;').conf, 'none');
});

Deno.test('a day alone is partial; an hour alone is partial', () => {
  const day = read('αύριο έχετε;');
  assertEquals([day.date, day.time, day.conf], ['2026-10-14', null, 'partial']);
  const hour = read('στις 20.30 υπάρχει;');
  assertEquals([hour.date, hour.time, hour.conf], [null, '20:30', 'partial']);
});

Deno.test('lengths: μιάμιση ώρα, 2 ώρες', () => {
  assertEquals(read('μιάμιση ώρα αύριο στις 7').min, 90);
  assertEquals(read('αύριο 8 για 2 ώρες').min, 120);
  assertEquals(read('αύριο 8 για 2 ώρες').time, '20:00');
});

Deno.test('a date already past this year is next year', () => {
  assertEquals(read('02/01 στις 8').date, '2027-01-02');
});

Deno.test('21h and 8μμ', () => {
  assertEquals(read('αύριο 21h').time, '21:00');
  assertEquals(read('αύριο 8μμ').time, '20:00');
  assertEquals(read('αύριο 9 π.μ.').time, '09:00');
});

Deno.test('a headcount is not an hour', () => {
  const r = read('αύριο για 10 άτομα στις 9');
  assertEquals([r.time, r.players], ['21:00', 10]);
});

Deno.test('capitals and no accents', () => {
  const r = read('ΑΥΡΙΟ ΣΤΙΣ 8 ΓΗΠΕΔΟ 1');
  assertEquals([r.date, r.time, r.court], ['2026-10-14', '20:00', 'c1']);
});

Deno.test('a court the venue does not have stays unmatched; its number is not an hour', () => {
  const r = read('γήπεδο 9 αύριο στις 8');
  assertEquals([r.court, r.time], [null, '20:00']);
});

Deno.test('a court implies its format', () => {
  assertEquals(read('court 7 αύριο 8').format, '7-a-side');
});

Deno.test('Greeklish weekday and pentari', () => {
  const r = read('kalispera, tin pempti stis 9 gia pentari');
  assertEquals([r.date, r.time, r.format], ['2026-10-15', '21:00', '5-a-side']);
});

Deno.test('a phone number in the message is not an hour', () => {
  const r = read('Ανδρέας 99123456, αύριο στις 8');
  assertEquals(r.time, '20:00');
});
