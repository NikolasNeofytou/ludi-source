// Shared formatters for admin UI. Everything is rendered in Europe/Nicosia
// to match the venue local time the DB and mobile app use.
//
// The formatters that print words or separators take the account's locale
// (ADR-0037) and default to English, so a caller that has no viewer (a
// client helper) reads exactly as before. Times are 24-hour in both
// languages and take none.

import { intlTag, type Locale } from '@/lib/copy';

export const VENUE_TZ = 'Europe/Nicosia';

// '€1,234.50', '€45' — '€1.234,50' in Greek. Whole euros drop the cents.
export function formatEur(cents: number, locale: Locale = 'en'): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  const euros = (cents / 100).toLocaleString(intlTag(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `€${euros}`;
}

// An owner-typed euro amount → cents, or null if it isn't one. Accepts a
// comma as the decimal mark ('45,50'): a Greek-locale phone keypad types
// one, and refusing it reads as "your price is wrong".
export function parseEurosToCents(input: string): number | null {
  const trimmed = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const euros = Number.parseFloat(trimmed);
  if (!Number.isFinite(euros) || euros <= 0) return null;
  return Math.round(euros * 100);
}

export function formatDateTime(iso: string, locale: Locale = 'en'): string {
  return new Date(iso).toLocaleString(intlTag(locale), {
    timeZone: VENUE_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string, locale: Locale = 'en'): string {
  return new Date(iso).toLocaleDateString(intlTag(locale), {
    timeZone: VENUE_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: VENUE_TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 'Thu 28 Aug' ('Πέμ 28 Αυγ') — the week-strip label on the Today view.
export function formatDayLabel(iso: string, locale: Locale = 'en'): string {
  return new Date(iso).toLocaleDateString(intlTag(locale), {
    timeZone: VENUE_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

// The venue-local calendar date ('2026-08-27') an instant falls on.
// Grouping by this string is how the Today view avoids UTC-vs-Nicosia
// boundary bugs entirely — no offset arithmetic, DST handled by Intl.
export function venueDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VENUE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// Today's venue-local date ('2026-09-13').
export function venueToday(): string {
  return venueDateKey(new Date());
}

// Calendar arithmetic on a venue date key. Works on the date itself, not on
// 24-hour blocks of time, so a DST change can neither skip nor repeat a day.
export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

// The instant venue wall-clock `date time` names. Cyprus is +02:00 or
// +03:00 depending on the date, so try both and keep the one that
// round-trips through Intl. `time` may be '24:00' (the end of the day).
export function venueWallClockToIso(date: string, time: string): string {
  if (time === '24:00') return venueWallClockToIso(addDaysToKey(date, 1), '00:00');
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: VENUE_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  for (const off of ['+03:00', '+02:00']) {
    const candidate = new Date(`${date}T${time}:00${off}`);
    const parts = fmt.formatToParts(candidate);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const roundTrip = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
    if (roundTrip === `${date} ${time}`) return candidate.toISOString();
  }
  // Only the hour skipped by the spring-forward change lands here.
  return new Date(`${date}T${time}:00+02:00`).toISOString();
}

// [start, end) of a venue-local day as UTC instants — for filtering
// timestamptz columns by the owner's calendar day, not UTC's.
export function venueDayBoundsUtc(dateKey: string): { start: string; end: string } {
  return {
    start: venueWallClockToIso(dateKey, '00:00'),
    end: venueWallClockToIso(addDaysToKey(dateKey, 1), '00:00'),
  };
}
