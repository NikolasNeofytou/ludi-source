import Link from 'next/link';

import { CalendarBooking, type CalendarBookingInfo } from '@/components/calendar-booking';
import { PrintButton } from '@/components/print-button';
import { AppShell, Badge, Card, EmptyState, PageHead } from '@/components/ui';
import { WalkInButton, WalkInCell, type WalkInPitch } from '@/components/walk-in-modal';
import { requireVenueAccess } from '@/lib/auth';
import { SLOT_HOLDING_STATES } from '@/lib/booking-states';
import { getCopy, intlTag, type Locale } from '@/lib/copy';
import {
  addDaysToKey,
  formatTime,
  venueDayBoundsUtc,
  venueToday,
  venueWallClockToIso,
} from '@/lib/format';
import { rosterByBookingId, rosterName } from '@/lib/roster';
import { dayOfWeekOfKey, defaultSlotMinutes } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

// The book on the wall (plans/owner-calendar.md). Two views of the same
// bookings:
//
//   week — seven days across, the venue's courts down: the planning view.
//   day  — the venue's courts across, that day's hours down: the sheet the
//          owner already keeps on paper (Campeone's, photographed
//          2026-09-15: ΚΡΑΤΗΣΕΙΣ, ΗΜΕΡΑ, ΗΜΕΡΟΜΗΝΙΑ, ΩΡΑ rows, court
//          columns, and most cells blank on purpose — a form to write
//          phone bookings into). The print of the day view IS that sheet,
//          with the app's bookings already filled in.
//
// One venue at a time; the view, the venue and the date live in the URL so
// any of them is a link. Prints on A4, portrait or landscape as the dialog says — see @media print in
// globals.css. Names on paper, never phones: a sheet on a wall is not the
// operational window ADR-0023 opens.

type SearchParams = { venue?: string; week?: string; day?: string; view?: string; part?: string };

type CalendarBooking = {
  id: string;
  code: string;
  state: string;
  starts_at: string;
  ends_at: string;
  origin: string | null;
  series_id: string | null;
  pitch: { id: string; venue_id: string } | null;
};

type Court = { id: string; name: string; type: string; price_per_hour_cents: number };

type Window = { pitch_id: string; opens_at: string; closes_at: string; slot_duration_minutes: number };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Where the afternoon ends and the evening begins (plans/campeone-day-
// shape.md): academies and personal training before, football after.
// One constant until a second venue splits its day somewhere else — then
// it becomes a column on venues. A day only splits when it has rows on
// both sides.
const SPLIT_TIME = '18:00';

type Part = 'afternoon' | 'evening' | 'all';

// The printed heads, Greek whatever the account says (see GREEK_DAYS).
const SHEET_TITLE: Record<Part, string> = {
  all: 'ΚΡΑΤΗΣΕΙΣ',
  afternoon: `ΚΡΑΤΗΣΕΙΣ · ΜΕΧΡΙ ${SPLIT_TIME}`,
  evening: `ΚΡΑΤΗΣΕΙΣ · ΑΠΟ ${SPLIT_TIME}`,
};

// The printed sheet's head is Greek whatever the account says: it is the
// paper on Campeone's wall, not the dashboard's chrome.
const GREEK_DAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

// The Monday of the week a date falls in. day_of_week is Sunday = 0.
function mondayOf(dateKey: string): string {
  const dow = dayOfWeekOfKey(dateKey);
  return addDaysToKey(dateKey, -((dow + 6) % 7));
}

function dayHeading(dateKey: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

function longDay(dateKey: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

function weekTitle(monday: string, locale: Locale): string {
  const sunday = addDaysToKey(monday, 6);
  const fmt = (key: string, withYear: boolean) =>
    new Intl.DateTimeFormat(intlTag(locale), {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    }).format(new Date(`${key}T12:00:00Z`));
  return `${fmt(monday, false)} – ${fmt(sunday, true)}`;
}

// '2026-09-16' → '16/09/2026', the way a Cypriot writes it on the sheet.
function dmy(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

const hhmm = (t: string) => t.slice(0, 5);
const minutesOf = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const timeOfMinutes = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

// The venue-local date a booking starts on.
function dayKeyOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Nicosia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requireVenueAccess();
  const params = await searchParams;
  const t = getCopy(viewer.locale);
  const { locale } = viewer;

  // Same posture as Bookings: the venue list is viewer.venues, never a
  // `venues` query — the table is public-readable when active, and an
  // owner's dropdown must not list other people's venues.
  const venues = viewer.venues;
  const venue = venues.find((v) => v.id === params.venue) ?? venues[0] ?? null;

  const today = venueToday();
  const view: 'week' | 'day' = params.view === 'day' ? 'day' : 'week';
  const part: Part = params.part === 'afternoon' || params.part === 'evening' ? params.part : 'all';
  const day = params.day && DATE_KEY.test(params.day) ? params.day : today;
  const monday =
    params.week && DATE_KEY.test(params.week) ? mondayOf(params.week) : mondayOf(view === 'day' ? day : today);
  const days = view === 'day' ? [day] : Array.from({ length: 7 }, (_, i) => addDaysToKey(monday, i));
  const rangeStart = venueDayBoundsUtc(days[0]!).start;
  const rangeEnd = venueDayBoundsUtc(days[days.length - 1]!).end;

  const supabase = await createClient();

  let courts: Court[] = [];
  let bookings: CalendarBooking[] = [];
  let windows: Window[] = [];
  if (venue) {
    const [{ data: courtRows, error: courtError }, { data: bookingRows, error: bookingError }] =
      await Promise.all([
        supabase
          .from('pitches')
          .select('id, name, type, price_per_hour_cents')
          .eq('venue_id', venue.id)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('bookings')
          .select('id, code, state, starts_at, ends_at, origin, series_id, pitch:pitches!inner ( id, venue_id )')
          .eq('pitch.venue_id', venue.id)
          .in('state', [...SLOT_HOLDING_STATES])
          .gte('starts_at', rangeStart)
          .lt('starts_at', rangeEnd)
          .order('starts_at', { ascending: true }),
      ]);
    if (courtError) throw new Error(`calendar: courts failed: ${courtError.message}`);
    if (bookingError) throw new Error(`calendar: bookings failed: ${bookingError.message}`);
    courts = (courtRows ?? []) as Court[];
    bookings = (bookingRows ?? []) as unknown as CalendarBooking[];

    // The day sheet's rows come from the venue's hours for that date: an
    // exception replaces the weekly window for its date (the same rule
    // get_available_slots applies).
    if (view === 'day' && courts.length) {
      const ids = courts.map((c) => c.id);
      const [{ data: weekly }, { data: overrides }] = await Promise.all([
        supabase
          .from('pitch_schedules')
          .select('pitch_id, opens_at, closes_at, slot_duration_minutes')
          .in('pitch_id', ids)
          .eq('day_of_week', dayOfWeekOfKey(day)),
        supabase
          .from('pitch_schedule_overrides')
          .select('pitch_id, is_closed, opens_at, closes_at, slot_duration_minutes')
          .in('pitch_id', ids)
          .eq('override_date', day),
      ]);
      const overridden = new Set((overrides ?? []).map((o) => o.pitch_id as string));
      windows = [
        ...((weekly ?? []) as Window[]).filter((w) => !overridden.has(w.pitch_id)),
        ...((overrides ?? []) as Array<Window & { is_closed: boolean }>)
          .filter((o) => !o.is_closed && o.opens_at && o.closes_at)
          .map(({ pitch_id, opens_at, closes_at, slot_duration_minutes }) => ({
            pitch_id,
            opens_at,
            closes_at,
            slot_duration_minutes: slot_duration_minutes ?? 60,
          })),
      ];
    }
  }

  const roster = await rosterByBookingId(
    supabase,
    bookings.map((b) => b.id),
  );

  // A day the CFA plays here gets a link to its programme.
  let cfaCount = 0;
  if (venue && view === 'day') {
    const { count } = await supabase
      .from('cfa_matches')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venue.id)
      .eq('match_date', day);
    cfaCount = count ?? 0;
  }

  // A booking that holds a CFA match gets the match's own actions in its
  // panel (plans/cfa-in-the-app.md K5): move, postpone, cancel, put back.
  const cfaByBooking = new Map<string, { matchId: string; status: string }>();
  if (bookings.length) {
    const { data: cfaRows } = await supabase
      .from('competition_matches')
      .select('id, booking_id, status')
      .in(
        'booking_id',
        bookings.map((b) => b.id),
      );
    for (const r of cfaRows ?? []) {
      cfaByBooking.set(r.booking_id as string, { matchId: r.id as string, status: r.status as string });
    }
  }

  // The venue's own comments (booking_notes — owners, managers, admins only).
  const notes = new Map<string, string>();
  if (bookings.length) {
    const { data: noteRows, error: noteError } = await supabase
      .from('booking_notes')
      .select('booking_id, note')
      .in(
        'booking_id',
        bookings.map((b) => b.id),
      );
    if (noteError) throw new Error(`calendar: notes failed: ${noteError.message}`);
    for (const n of noteRows ?? []) notes.set(n.booking_id as string, n.note as string);
  }

  const label = (b: CalendarBooking) => {
    const r = roster.get(b.id);
    return {
      name: rosterName(r) ?? t.common.booked,
      walkIn: (r?.origin ?? b.origin) === 'walk_in',
      hold: b.state === 'pending' || b.state === 'collecting',
    };
  };

  const qs = (extra: Record<string, string>) =>
    `/calendar?${new URLSearchParams({ ...(venue ? { venue: venue.id } : {}), ...extra })}`;
  const weekHref = (m: string) => qs({ view: 'week', week: m });
  const dayHref = (d: string) => qs({ view: 'day', day: d, ...(part !== 'all' ? { part } : {}) });
  const partHref = (p: Part) => qs({ view: 'day', day, ...(p !== 'all' ? { part: p } : {}) });
  const split = minutesOf(SPLIT_TIME);
  const startsBeforeSplit = (b: CalendarBooking) => minutesOf(formatTime(b.starts_at)) < split;

  // ── Week grid cells: `${pitchId}|${dateKey}` → bookings in starts_at order.
  const weekCells = new Map<string, CalendarBooking[]>();
  if (view === 'week') {
    for (const b of bookings) {
      if (!b.pitch) continue;
      const key = `${b.pitch.id}|${dayKeyOf(b.starts_at)}`;
      weekCells.set(key, [...(weekCells.get(key) ?? []), b]);
    }
  }

  // ── Day sheet rows: the venue's earliest opening to latest closing that
  // day, stepped by the slot length the courts mostly use, and stretched to
  // take in any booking outside those hours — walk-ins and standing
  // bookings ignore opening hours, so an academy at 16:00 on courts that
  // open at 18:00 is in the book and must be on the sheet. A court with no
  // window over a row is shut for that hour and shaded.
  const rows: { start: string; end: string; startIso: string; endIso: string }[] = [];
  if (view === 'day' && (windows.length || bookings.length)) {
    const step = windows.length
      ? defaultSlotMinutes(
          windows.map((w) => ({ day_of_week: dayOfWeekOfKey(day), slot_duration_minutes: w.slot_duration_minutes })),
          dayOfWeekOfKey(day),
        )
      : 60;
    const spans = bookings.map((b) => ({
      start: minutesOf(formatTime(b.starts_at)),
      // A booking ending at midnight (or on the next day) runs to the end.
      end: dayKeyOf(b.ends_at) !== day ? 24 * 60 : minutesOf(formatTime(b.ends_at)),
    }));
    let first: number;
    let last: number;
    if (windows.length) {
      first = Math.min(...windows.map((w) => minutesOf(hhmm(w.opens_at))));
      last = Math.max(...windows.map((w) => minutesOf(hhmm(w.closes_at))));
      // Stretch by whole steps so the extra rows line up with the hours.
      const earliest = Math.min(first, ...spans.map((x) => x.start));
      const latest = Math.max(last, ...spans.map((x) => x.end));
      first -= Math.ceil((first - earliest) / step) * step;
      last += Math.ceil((latest - last) / step) * step;
    } else {
      // No hours set: the hours the bookings themselves span.
      first = Math.floor(Math.min(...spans.map((x) => x.start)) / 60) * 60;
      last = Math.max(...spans.map((x) => x.end));
    }
    first = Math.max(0, first);
    last = Math.min(24 * 60, last);
    for (let t = first; t + step <= last; t += step) {
      const start = timeOfMinutes(t);
      const end = timeOfMinutes(t + step);
      rows.push({ start, end, startIso: venueWallClockToIso(day, start), endIso: venueWallClockToIso(day, end) });
    }
  }
  const openAt = (courtId: string, row: { start: string; end: string }) =>
    windows.some(
      (w) =>
        w.pitch_id === courtId &&
        minutesOf(hhmm(w.opens_at)) <= minutesOf(row.start) &&
        minutesOf(hhmm(w.closes_at) === '24:00' ? '24:00' : hhmm(w.closes_at)) >= minutesOf(row.end),
    );
  // Compare instants, not strings: PostgREST returns '…T15:00:00+00:00' and
  // the rows are '…T15:00:00.000Z', and '+' sorts before '.', so a string
  // test put every booking in the hour above it as well.
  const bookingsIn = (courtId: string, row: { startIso: string; endIso: string }) =>
    bookings.filter(
      (b) =>
        b.pitch?.id === courtId &&
        Date.parse(b.starts_at) < Date.parse(row.endIso) &&
        Date.parse(b.ends_at) > Date.parse(row.startIso),
    );

  // The walk-in modal writes straight into this grid: the header button opens
  // on the date on screen, an empty cell on its court and hour.
  // Fill the hour (ADR-0045): an empty cell can also offer the hour to the
  // regulars, where the viewer owns the venue and Ludi switched it on. The
  // read is RLS-scoped to the owner, so a manager's set is always empty.
  const fillVenues = new Set<string>();
  if (venue && viewer.venues.some((v) => v.id === venue.id && v.role === 'owner')) {
    const { data: fillOn } = await supabase
      .from('venue_fill_enabled')
      .select('venue_id')
      .eq('venue_id', venue.id)
      .maybeSingle();
    if (fillOn) fillVenues.add(venue.id);
  }

  const walkInPitches: WalkInPitch[] = courts.map((c) => ({
    id: c.id,
    venueId: venue?.id,
    name: c.name,
    venueName: venue?.name ?? '—',
    pricePerHourCents: c.price_per_hour_cents,
  }));
  // ── The day's parts: afternoon and evening, each its own sheet on paper.
  // A cell a single booking fills row after row is drawn once, spanning
  // those rows, instead of the name repeated down the column.
  type Row = (typeof rows)[number];
  type SheetCell = { span: number; items: CalendarBooking[]; open: boolean } | null;
  const layout = (sheetRows: Row[]): SheetCell[][] => {
    const grid: (SheetCell | undefined)[][] = sheetRows.map(() => courts.map(() => undefined));
    sheetRows.forEach((row, i) => {
      courts.forEach((c, ci) => {
        if (grid[i]![ci] === null) return;
        const items = bookingsIn(c.id, row);
        let span = 1;
        if (items.length === 1) {
          while (i + span < sheetRows.length) {
            const next = bookingsIn(c.id, sheetRows[i + span]!);
            if (next.length !== 1 || next[0]!.id !== items[0]!.id) break;
            grid[i + span]![ci] = null;
            span += 1;
          }
        }
        grid[i]![ci] = { span, items, open: windows.length === 0 || openAt(c.id, row) };
      });
    });
    return grid as SheetCell[][];
  };
  const hasSplit =
    rows.some((r) => minutesOf(r.start) < split) && rows.some((r) => minutesOf(r.start) >= split);
  const partRows: Record<Part, Row[]> = {
    all: rows,
    afternoon: rows.filter((r) => minutesOf(r.start) < split),
    evening: rows.filter((r) => minutesOf(r.start) >= split),
  };
  const sheets = (
    !hasSplit ? (['all'] as const) : part === 'all' ? (['afternoon', 'evening'] as const) : [part]
  ).map((key) => ({ key, rows: partRows[key], cells: layout(partRows[key]) }));
  const partLabel: Record<Part, string> = {
    all: t.calendar.allDay,
    afternoon: t.calendar.afternoonUntil(SPLIT_TIME),
    evening: t.calendar.eveningFrom(SPLIT_TIME),
  };

  // ── Week: when the week has both halves, each cell reads as two — the
  // afternoon's regulars as a quiet line on top, the evening's bookings
  // under it.
  const weekSplit =
    view === 'week' && bookings.some(startsBeforeSplit) && bookings.some((b) => !startsBeforeSplit(b));

  const rowMinutes = rows.length ? minutesOf(rows[0]!.end === '24:00' ? '24:00' : rows[0]!.end) - minutesOf(rows[0]!.start) : 60;

  const courtName = new Map(courts.map((c) => [c.id, c.name]));
  const info = (b: CalendarBooking): CalendarBookingInfo => {
    const l = label(b);
    return {
      id: b.id,
      code: b.code,
      name: l.name,
      court: b.pitch ? (courtName.get(b.pitch.id) ?? '') : '',
      when: `${dayHeading(dayKeyOf(b.starts_at), locale)} · ${formatTime(b.starts_at)}–${formatTime(b.ends_at)}`,
      dayKey: dayKeyOf(b.starts_at),
      walkIn: l.walkIn,
      seriesId: b.series_id,
      stateLabel: l.hold ? b.state : null,
      note: notes.get(b.id) ?? null,
      cfa: cfaByBooking.has(b.id)
        ? {
            ...cfaByBooking.get(b.id)!,
            kickoff: formatTime(b.starts_at),
            pitchId: b.pitch?.id ?? '',
            courts: courts.map((c) => ({ id: c.id, name: c.name })),
          }
        : null,
    };
  };

  const meta =
    view === 'day'
      ? `${venue?.name ?? ''} · ${longDay(day, locale)}`
      : `${venue?.name ?? ''} · ${weekTitle(monday, locale)}`;

  return (
    <AppShell viewer={viewer}>
      <PageHead title={t.calendar.title} meta={meta.replace(/^ · /, '')} 
        actions={
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <PrintButton />
            <WalkInButton
              pitches={walkInPitches}
              prefill={{ date: view === 'day' ? day : days.includes(today) ? today : monday }}
            />
          </span>
        }
      />

      <div className="calendar-controls no-print">
        <div className="filters-actions">
          <Link href="/standing" className="btn btn-secondary">
            {t.calendar.standing}
          </Link>
          {venue ? (
            <Link
              href={`/calendar/cfa?venue=${venue.id}${view === 'day' ? `&day=${day}` : ''}`}
              className="btn btn-secondary"
            >
              {t.calendar.cfa}
            </Link>
          ) : null}
          {venue ? (
            <Link href={`/calendar/screen?venue=${venue.id}`} className="btn btn-secondary">
              {t.calendar.screen}
            </Link>
          ) : null}
          <span className="pills" role="tablist" aria-label={t.calendar.view}>
            <Link
              href={weekHref(view === 'day' ? mondayOf(day) : monday)}
              className={view === 'week' ? 'pill pill-active' : 'pill'}
              aria-current={view === 'week' ? 'page' : undefined}
            >
              {t.calendar.week}
            </Link>
            <Link
              href={dayHref(view === 'week' ? (days.includes(today) ? today : monday) : day)}
              className={view === 'day' ? 'pill pill-active' : 'pill'}
              aria-current={view === 'day' ? 'page' : undefined}
            >
              {t.calendar.day}
            </Link>
          </span>
          {view === 'day' ? (
            <>
              <Link href={dayHref(addDaysToKey(day, -1))} className="btn btn-secondary">
                {t.calendar.previous}
              </Link>
              <Link href={dayHref(today)} className={day === today ? 'btn btn-secondary' : 'btn btn-primary'}>
                {t.calendar.today}
              </Link>
              <Link href={dayHref(addDaysToKey(day, 1))} className="btn btn-secondary">
                {t.calendar.next}
              </Link>
            </>
          ) : (
            <>
              <Link href={weekHref(addDaysToKey(monday, -7))} className="btn btn-secondary">
                {t.calendar.previous}
              </Link>
              <Link
                href={weekHref(mondayOf(today))}
                className={monday === mondayOf(today) ? 'btn btn-secondary' : 'btn btn-primary'}
              >
                {t.calendar.thisWeek}
              </Link>
              <Link href={weekHref(addDaysToKey(monday, 7))} className="btn btn-secondary">
                {t.calendar.next}
              </Link>
            </>
          )}
        </div>
        {venues.length > 1 ? (
          <form method="GET" className="calendar-venue">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name={view === 'day' ? 'day' : 'week'} value={view === 'day' ? day : monday} />
            <label className="field">
              <span className="field-label">{t.calendar.venue}</span>
              <select name="venue" className="input" defaultValue={venue?.id ?? ''}>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-secondary">
              {t.calendar.show}
            </button>
          </form>
        ) : null}
      </div>

      {!venue ? (
        <EmptyState>{t.calendar.noVenue}</EmptyState>
      ) : courts.length === 0 ? (
        <EmptyState>
          {t.calendar.noCourtsAt(venue.name)}
          <Link href="/pitches">{t.calendar.addThem}</Link>.
        </EmptyState>
      ) : view === 'day' ? (
        <>
          {cfaCount > 0 ? (
            <div className="calendar-parts no-print">
              <Link href={`/calendar/cfa/programme?venue=${venue.id}&day=${day}`} className="btn btn-primary">
                {t.cfa.programme}
              </Link>
            </div>
          ) : null}
          {hasSplit ? (
            <div className="calendar-parts no-print">
              <span className="pills" role="tablist" aria-label={t.calendar.part}>
                {(['afternoon', 'evening', 'all'] as const).map((p) => (
                  <Link
                    key={p}
                    href={partHref(p)}
                    className={part === p ? 'pill pill-active' : 'pill'}
                    aria-current={part === p ? 'page' : undefined}
                  >
                    {partLabel[p]}
                  </Link>
                ))}
              </span>
            </div>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState>
              {t.calendar.closedOn(longDay(day, locale))}
              <Link href="/pitches">{t.calendar.setHours}</Link>.
            </EmptyState>
          ) : (
            sheets.map((sheet, si) => {
              const lastRow = sheet.rows[sheet.rows.length - 1];
              return (
                <section key={sheet.key} className={si > 0 ? 'daysheet-part daysheet-break' : 'daysheet-part'}>
                  {/* The sheet's own head — printed; on screen the PageHead says it. */}
                  <div className="daysheet-head print-only">
                    <div className="daysheet-title">
                      {venue.name.toUpperCase()} <span>{SHEET_TITLE[sheet.key]}</span>
                    </div>
                    <div className="daysheet-fields">
                      <span>
                        <b>ΗΜΕΡΑ</b> {GREEK_DAYS[dayOfWeekOfKey(day)]}
                      </span>
                      <span>
                        <b>ΗΜΕΡΟΜΗΝΙΑ</b> {dmy(day)}
                      </span>
                      {sheet.key !== 'all' && sheet.rows[0] && lastRow ? (
                        <span>
                          <b>ΩΡΕΣ</b> {sheet.rows[0].start}–{lastRow.end === '24:00' ? '00:00' : lastRow.end}
                        </span>
                      ) : null}
                      <span className="daysheet-stamp">Ludi · {today}</span>
                    </div>
                  </div>
                  {sheets.length > 1 ? <h2 className="daysheet-part-title no-print">{partLabel[sheet.key]}</h2> : null}

                  <Card pad={false} className="calendar-card">
                    <div className="calendar-scroll">
                      <table className={sheet.key === 'afternoon' ? 'daysheet daysheet-compact' : 'daysheet'}>
                        <thead>
                          <tr>
                            <th className="daysheet-hour-head">ΩΡΑ</th>
                            {courts.map((c) => (
                              <th key={c.id} className="daysheet-court-head">
                                {c.name}
                                <span className="calendar-court-type">{courtType(c.type, locale)}</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sheet.rows.map((row, i) => (
                            <tr key={row.start}>
                              <th scope="row" className="daysheet-hour">
                                {row.start}–{row.end === '24:00' ? '00:00' : row.end}
                              </th>
                              {courts.map((c, ci) => {
                                const cell = sheet.cells[i]![ci];
                                if (!cell) return null;
                                const { items, open, span } = cell;
                                const spanEnd = sheet.rows[i + span - 1]!.endIso;
                                return (
                                  <td
                                    key={c.id}
                                    rowSpan={span > 1 ? span : undefined}
                                    className={
                                      items.length
                                        ? 'daysheet-cell daysheet-booked'
                                        : open
                                          ? 'daysheet-cell'
                                          : 'daysheet-cell daysheet-shut'
                                    }
                                  >
                                    {items.length === 0 && open ? (
                                      <WalkInCell
                                        pitches={walkInPitches}
                                        fillVenues={fillVenues}
                                        prefill={{ pitchId: c.id, date: day, time: row.start, duration: rowMinutes }}
                                        label={`${t.walkIn.button} · ${c.name} · ${row.start}`}
                                      />
                                    ) : null}
                                    {items.map((b) => {
                                      const l = label(b);
                                      const continued = Date.parse(b.starts_at) < Date.parse(row.startIso);
                                      const exact =
                                        Date.parse(b.starts_at) === Date.parse(row.startIso) &&
                                        Date.parse(b.ends_at) === Date.parse(spanEnd);
                                      return (
                                        <CalendarBooking
                                          key={b.id}
                                          booking={info(b)}
                                          className={l.walkIn ? 'daysheet-item daysheet-walkin' : 'daysheet-item'}
                                        >
                                          <span className="calendar-name">{l.name}</span>
                                          {span > 1 || !exact ? (
                                            <span className="calendar-time">
                                              {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                                            </span>
                                          ) : null}
                                          {continued ? (
                                            <>
                                              <span className="daysheet-continued no-print">{t.calendar.continued}</span>
                                              <span className="daysheet-continued print-only">συνέχεια</span>
                                            </>
                                          ) : null}
                                          <span className="calendar-code print-only">{b.code}</span>
                                          {b.series_id ? (
                                            <Badge tone="info">{t.calendar.weekly}</Badge>
                                          ) : l.walkIn ? (
                                            <Badge tone="info">{t.common.walkIn}</Badge>
                                          ) : l.hold ? (
                                            <Badge tone="warn">{b.state}</Badge>
                                          ) : null}
                                          {notes.get(b.id) ? (
                                            <span className="calendar-note">{notes.get(b.id)}</span>
                                          ) : null}
                                        </CalendarBooking>
                                      );
                                    })}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </section>
              );
            })
          )}
        </>
      ) : (
        <>
          <div className="calendar-print-title print-only">
            <strong>{venue.name}</strong> · {weekTitle(monday, locale)}
            <span className="calendar-print-note">{t.calendar.printedOn(today)}</span>
          </div>
          <Card pad={false} className="calendar-card">
            <div className="calendar-scroll">
              <table className="calendar">
                <thead>
                  <tr>
                    <th className="calendar-court-head">{t.calendar.court}</th>
                    {days.map((d) => (
                      <th key={d} className={d === today ? 'calendar-day-head calendar-today' : 'calendar-day-head'}>
                        <Link href={dayHref(d)} className="calendar-day-link">
                          {dayHeading(d, locale)}
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {courts.map((c) => (
                    <tr key={c.id}>
                      <th scope="row" className="calendar-court">
                        {c.name}
                        <span className="calendar-court-type">{courtType(c.type, locale)}</span>
                      </th>
                      {days.map((d) => {
                        const items = weekCells.get(`${c.id}|${d}`) ?? [];
                        const early = weekSplit ? items.filter(startsBeforeSplit) : [];
                        const late = weekSplit ? items.filter((b) => !startsBeforeSplit(b)) : items;
                        return (
                          <td key={d} className={d === today ? 'calendar-cell calendar-today' : 'calendar-cell'}>
                            {items.length === 0 ? (
                              <span className="calendar-empty print-only" aria-hidden>
                                ·
                              </span>
                            ) : null}
                            {early.length ? (
                              <ul className="calendar-items calendar-afternoon">
                                {early.map((b) => (
                                  <li key={b.id} className="calendar-item">
                                    <CalendarBooking booking={info(b)} className="calendar-item-link">
                                      <span className="calendar-time">
                                        {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                                      </span>
                                      <span className="calendar-name">{label(b).name}</span>
                                      {notes.get(b.id) ? (
                                        <span className="calendar-note">{notes.get(b.id)}</span>
                                      ) : null}
                                    </CalendarBooking>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {late.length ? (
                              <ul className="calendar-items">
                                {late.map((b) => {
                                  const l = label(b);
                                  return (
                                    <li key={b.id} className={l.walkIn ? 'calendar-item calendar-walkin' : 'calendar-item'}>
                                      <CalendarBooking booking={info(b)} className="calendar-item-link">
                                        <span className="calendar-time">
                                          {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                                        </span>
                                        <span className="calendar-name">{l.name}</span>
                                        <span className="calendar-code print-only">{b.code}</span>
                                        {notes.get(b.id) ? (
                                          <span className="calendar-note">{notes.get(b.id)}</span>
                                        ) : null}
                                      </CalendarBooking>
                                      {b.series_id ? (
                                        <Badge tone="info">{t.calendar.weekly}</Badge>
                                      ) : l.walkIn ? (
                                        <Badge tone="info">{t.common.walkIn}</Badge>
                                      ) : l.hold ? (
                                        <Badge tone="warn">{b.state}</Badge>
                                      ) : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : null}
                            <WalkInCell
                              pitches={walkInPitches}
                              prefill={{ pitchId: c.id, date: d }}
                              label={`${t.walkIn.button} · ${c.name} · ${dayHeading(d, locale)}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <p className="field-hint no-print" style={{ marginTop: 12 }}>
        {view === 'day' ? t.calendar.hintDay : t.calendar.hintWeek}
      </p>
    </AppShell>
  );
}

// '5-a-side' → '5x5' in Greek, itself in English. A type the dictionary
// does not know (none today) shows as stored.
function courtType(type: string, locale: Locale): string {
  const types = getCopy(locale).pitch.types as Record<string, string | undefined>;
  return types[type] ?? type;
}
