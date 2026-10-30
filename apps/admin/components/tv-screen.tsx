'use client';

// The lobby screen (plans/cfa-grassroots-saturday.md). Designed for a 32"+ TV
// read from a few metres, light background, Greek. It refreshes itself every
// minute and keeps a clock.
//
//   CFA day  — the programme grouped by kick-off, cards two across, the match
//              on now outlined; beside it every court now and the next
//              kick-off with a countdown. More groups than fit → it turns the
//              page by whole groups.
//   any day  — the board: a row per booking still to come, soonest first —
//              whose it is, which courts, when (ADR-0054). A group walks in
//              asking "we're in Σώζος's name, which court?"; the board says
//              it in one look. The first name only, and only today. Beside
//              it every court now.
//
//   the wall — an opened fixture still short of players (plans/venue-wall.md,
//              ADR-0043) is marked on its row, and the rail carries the next
//              one with what it is missing and a QR to join. Counts only.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { venueMark } from '@/lib/venue-marks';

export type TvItem = {
  pitch_id: string;
  starts_at: string;
  ends_at: string;
  kind: 'cfa' | 'booked';
  category: string | null;
  home: string | null;
  away: string | null;
  round: string | null;
  // a CFA match's status (plans/cfa-in-the-app.md K5): scheduled or postponed
  status?: string | null;
  // the first word of the name on the booking, today only (20261016000006)
  who?: string | null;
  // present only while the community board would list the fixture
  open_gk?: number | null;
  open_outfield?: number | null;
  share_cents?: number | null;
  join?: string | null;
};

export type TvData = {
  venue: string;
  // the venue's link, for the follow QR on a CFA day (20261016000005)
  slug?: string | null;
  date: string;
  courts: { id: string; name: string; type: string; parts: string[] }[];
  items: TvItem[];
};

const TZ = 'Europe/Nicosia';
const PAGE_SECONDS = 15;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true });
const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
// "Court 4" and "Γήπεδο 4" read as 4 on a chip; a court with no number keeps its name
const chipOf = (name: string) => name.match(/(\d+)\s*$/)?.[1] ?? name;

const wantedOf = (items: TvItem[], now: number) =>
  items.filter((i) => i.join && Date.parse(i.starts_at) > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));

const missingText = (i: TvItem) => {
  const gk = i.open_gk ?? 0;
  const out = i.open_outfield ?? 0;
  const parts: string[] = [];
  if (gk > 0) parts.push(gk === 1 ? '1 τερματοφύλακας' : `${gk} τερματοφύλακες`);
  if (out > 0) parts.push(out === 1 ? '1 παίκτης' : `${out} παίκτες`);
  return parts.join(' · ');
};

const euros = (cents: number) => `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export function TvScreen({
  data,
  qr,
  joinQr = {},
  followQr,
}: {
  data: TvData;
  qr?: string;
  joinQr?: Record<string, string>;
  followQr?: string;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [full, setFull] = useState(false);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(() => router.refresh(), 60_000);
    // Full screen is the Fullscreen API, or a window that already covers the
    // screen: Chrome --kiosk fills it without the API, and so does a TV's own
    // browser. Either way there is nothing left to press.
    const onFs = () =>
      setFull(
        Boolean(document.fullscreenElement) ||
          (window.innerWidth >= window.screen.width && window.innerHeight >= window.screen.height),
      );
    onFs();
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('resize', onFs);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('resize', onFs);
    };
  }, [router]);

  const courtName = new Map(data.courts.map((c) => [c.id, c.name]));
  const partsOf = new Map(data.courts.map((c) => [c.id, c.parts]));
  const leaves = data.courts.filter((c) => c.parts.length === 0).sort(byName);
  const holds = (i: TvItem, courtId: string) =>
    i.pitch_id === courtId || (partsOf.get(i.pitch_id) ?? []).includes(courtId);

  const cfa = data.items
    .filter((i) => i.kind === 'cfa')
    .sort(
      (a, b) =>
        a.starts_at.localeCompare(b.starts_at) ||
        (courtName.get(a.pitch_id) ?? '').localeCompare(courtName.get(b.pitch_id) ?? '', undefined, { numeric: true }),
    );

  const dayLabel = new Intl.DateTimeFormat('el-GR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${data.date}T12:00:00Z`));
  const clock = hhmm(new Date(now).toISOString());
  const mark = venueMark(data.slug);

  return (
    <main className="tv" lang="el">
      <header className="tv-head">
        <div>
          {mark ? (
            <img
              className="tv-mark"
              src={mark.src}
              alt={data.venue}
              style={{ '--tv-mark-clear': mark.clear } as CSSProperties}
            />
          ) : (
            <div className="tv-venue">{data.venue}</div>
          )}
          <div className="tv-date">
            {dayLabel}
            {cfa[0]?.round ? (
              <>
                {' · '}
                <span className="tv-round">ΚΟΠ Grassroots · {cfa[0].round}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="tv-head-right">
          {/* A CFA day's second QR (plans/release-1-0.md E2): the venue's
              page, where a parent follows their child's team in the app. In
              the header, not the rail, so a ten-court rail never pushes it
              off the screen. */}
          {followQr ? (
            <span className="tv-qr tv-qr-follow">
              <span className="tv-qr-img" dangerouslySetInnerHTML={{ __html: followQr }} />
              <span className="tv-qr-text">
                Ακολουθήστε
                <br />
                την ομάδα σας
                <span className="tv-brand">στο Ludi</span>
              </span>
            </span>
          ) : null}
          {qr ? (
            <span className="tv-qr">
              <span className="tv-qr-img" dangerouslySetInnerHTML={{ __html: qr }} />
              <span className="tv-qr-text">
                Σκανάρετε
                <br />
                για το κινητό
                <span className="tv-brand">ludi.football</span>
              </span>
            </span>
          ) : null}
          <div className="tv-clock" suppressHydrationWarning>
            {clock}
          </div>
        </div>
      </header>

      {cfa.length ? (
        <CfaDay
          cfa={cfa}
          now={now}
          courtName={courtName}
          leaves={leaves}
          holds={holds}
          items={data.items}
          joinQr={joinQr}
        />
      ) : (
        <Board data={data} now={now} leaves={leaves} holds={holds} courtName={courtName} joinQr={joinQr} />
      )}

      {!full ? (
        <button
          type="button"
          className="tv-fs"
          onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)}
        >
          Πλήρης οθόνη
        </button>
      ) : null}
    </main>
  );
}

// ── CFA day ──────────────────────────────────────────────────────────

function CfaDay({
  cfa,
  now,
  courtName,
  leaves,
  holds,
  items,
  joinQr,
}: {
  cfa: TvItem[];
  now: number;
  courtName: Map<string, string>;
  leaves: { id: string; name: string }[];
  holds: (i: TvItem, courtId: string) => boolean;
  items: TvItem[];
  joinQr: Record<string, string>;
}) {
  const state = (i: TvItem) =>
    Date.parse(i.ends_at) <= now ? 'done' : Date.parse(i.starts_at) <= now ? 'now' : 'later';

  // Groups by kick-off; finished groups leave (all of them only once the
  // morning is over, so the last round stays up).
  const groups = useMemo(() => {
    const m = new Map<string, TvItem[]>();
    for (const i of cfa) m.set(i.starts_at, [...(m.get(i.starts_at) ?? []), i]);
    return [...m.entries()].map(([startsAt, list]) => ({ startsAt, list }));
  }, [cfa]);
  const live = groups.filter((g) => g.list.some((i) => Date.parse(i.ends_at) > now));
  const shown = live.length ? live : groups;

  // Pages of whole groups, measured in a hidden copy at the same width.
  const boxRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [starts, setStarts] = useState<number[]>([0]);
  const [page, setPage] = useState(0);
  const key = shown.map((g) => g.startsAt).join('|');

  useLayoutEffect(() => {
    const box = boxRef.current;
    const measure = measureRef.current;
    if (!box || !measure) return;
    const run = () => {
      if (window.innerWidth < 900) {
        setStarts([0]);
        return;
      }
      const H = box.clientHeight;
      const els = [...measure.children] as HTMLElement[];
      const gap = parseFloat(getComputedStyle(measure).rowGap) || 0;
      const next: number[] = [0];
      let used = 0;
      els.forEach((el, i) => {
        const h = el.offsetHeight;
        if (i > 0 && used + gap + h > H) {
          next.push(i);
          used = h;
        } else {
          used += (i > 0 ? gap : 0) + h;
        }
      });
      setStarts(next);
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(box);
    return () => ro.disconnect();
  }, [key]);

  useEffect(() => {
    const turn = setInterval(() => setPage((n) => n + 1), PAGE_SECONDS * 1000);
    return () => clearInterval(turn);
  }, []);

  const pages = starts.length;
  const at = page % pages;
  const from = starts[at] ?? 0;
  const to = starts[at + 1] ?? shown.length;

  const group = (g: { startsAt: string; list: TvItem[] }) => (
    <section key={g.startsAt} className="tv-group">
      <div className="tv-group-time">{hhmm(g.startsAt)}</div>
      <div className="tv-cards">
        {g.list.map((i, n) => {
          const st = state(i);
          return (
            <article key={`${i.pitch_id}-${n}`} className={`tv-match tv-${st}`}>
              <div className="tv-match-top">
                <span className="tv-court">{courtName.get(i.pitch_id)}</span>
                <span className="tv-cat">{i.category}</span>
                {i.status === 'postponed' ? (
                  <span className="tv-live tv-postponed">Αναβολή</span>
                ) : st === 'now' ? (
                  <span className="tv-live">Τώρα</span>
                ) : null}
              </div>
              <div className="tv-team">{i.home}</div>
              <div className="tv-team tv-team-away">{i.away}</div>
            </article>
          );
        })}
      </div>
    </section>
  );

  const want = wantedOf(items, now)[0];
  const nextKick = cfa.find((i) => Date.parse(i.starts_at) > now);
  const mins = nextKick ? Math.ceil((Date.parse(nextKick.starts_at) - now) / 60000) : null;

  return (
    <div className="tv-body">
      <div className="tv-main" ref={boxRef}>
        <div className="tv-groups">{shown.slice(from, to).map(group)}</div>
        <div className="tv-groups tv-measure" ref={measureRef} aria-hidden>
          {shown.map(group)}
        </div>
        {pages > 1 ? (
          <div className="tv-pages">
            {Array.from({ length: pages }, (_, n) => (
              <span key={n} className={n === at ? 'tv-dot tv-dot-on' : 'tv-dot'} />
            ))}
          </div>
        ) : null}
      </div>

      <aside className="tv-side">
        <div className="tv-side-title">Τώρα στα γήπεδα</div>
        <ul className="tv-now-list">
          {leaves.map((c) => {
            const cur = items.find(
              (i) => holds(i, c.id) && Date.parse(i.starts_at) <= now && Date.parse(i.ends_at) > now,
            );
            return (
              <li key={c.id} className={cur ? 'tv-now-row tv-now-busy' : 'tv-now-row'}>
                <span className="tv-now-court">{c.name}</span>
                <span className="tv-now-what">
                  {cur ? (cur.kind === 'cfa' ? cur.category : 'Κρατημένο') : 'Ελεύθερο'}
                </span>
              </li>
            );
          })}
        </ul>
        {want ? <WantCard item={want} courtName={courtName} qr={joinQr[want.join ?? '']} compact /> : null}
        {nextKick && mins !== null ? (
          <div className="tv-next">
            <div className="tv-next-label">Επόμενη σέντρα</div>
            <div className="tv-next-time">{hhmm(nextKick.starts_at)}</div>
            <div className="tv-next-in">σε {mins} {mins === 1 ? 'λεπτό' : 'λεπτά'}</div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

// ── Any other day: the board ─────────────────────────────────────────

type Row = { key: string; who: string | null; startsAt: string; endsAt: string; courts: string[]; want: TvItem | null };

function Board({
  data,
  now,
  leaves,
  holds,
  courtName,
  joinQr,
}: {
  data: TvData;
  now: number;
  leaves: { id: string; name: string }[];
  holds: (i: TvItem, courtId: string) => boolean;
  courtName: Map<string, string>;
  joinQr: Record<string, string>;
}) {
  const isToday = new Date(now).toLocaleDateString('en-CA', { timeZone: TZ }) === data.date;
  const partsOf = new Map(data.courts.map((c) => [c.id, c.parts]));

  // A row per booking not yet over, soonest first. A 7v7 shows the two
  // courts it fills. Courts booked in one name for the same hours are one
  // group, so one row; bookings with no name never merge.
  const rows: Row[] = [];
  for (const i of [...data.items]
    .filter((i) => !isToday || Date.parse(i.ends_at) > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const ids = partsOf.get(i.pitch_id)?.length ? (partsOf.get(i.pitch_id) ?? []) : [i.pitch_id];
    const courts = ids.map((id) => courtName.get(id) ?? '').filter(Boolean);
    const want = i.join && Date.parse(i.starts_at) > now ? i : null;
    const same = i.who
      ? rows.find((r) => r.who === i.who && r.startsAt === i.starts_at && r.endsAt === i.ends_at)
      : undefined;
    if (same) {
      same.courts = [...new Set([...same.courts, ...courts])].sort(byNumber);
      same.want ??= want;
    } else {
      rows.push({
        key: `${i.starts_at}-${i.pitch_id}`,
        who: i.who ?? null,
        startsAt: i.starts_at,
        endsAt: i.ends_at,
        courts: courts.sort(byNumber),
        want,
      });
    }
  }

  // As many rows as fit, measured in a hidden copy at the same width; the
  // rest are later in the evening and come up as the first ones end.
  const boxRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(rows.length);
  const key = rows.map((r) => `${r.key}:${r.courts.length}`).join('|');

  useLayoutEffect(() => {
    const box = boxRef.current;
    const measure = measureRef.current;
    if (!box || !measure) return;
    const run = () => {
      const [label, ...rest] = [...measure.children] as HTMLElement[];
      const more = rest.pop();
      if (window.innerWidth < 900) {
        setFit(rest.length);
        return;
      }
      const H = box.clientHeight;
      const gap = parseFloat(getComputedStyle(measure).rowGap) || 0;
      let used = label?.offsetHeight ?? 0;
      let n = 0;
      for (const el of rest) {
        const tail = n + 1 < rest.length ? gap + (more?.offsetHeight ?? 0) : 0;
        if (used + gap + el.offsetHeight + tail > H) break;
        used += gap + el.offsetHeight;
        n += 1;
      }
      setFit(Math.max(1, n));
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(box);
    return () => ro.disconnect();
  }, [key]);

  const row = (r: Row) => {
    const on = isToday && Date.parse(r.startsAt) <= now;
    const mins = Math.ceil((Date.parse(r.startsAt) - now) / 60000);
    return (
      <div
        key={r.key}
        className={['tv-row', on ? 'tv-row-now' : '', r.want ? 'tv-row-want' : ''].filter(Boolean).join(' ')}
      >
        <div className={r.who ? 'tv-row-who' : 'tv-row-who tv-row-anon'}>{r.who ?? 'Κρατημένο'}</div>
        <div className="tv-row-courts">
          {r.courts.map((c) => (
            <span key={c} className="tv-chip">
              {chipOf(c)}
            </span>
          ))}
        </div>
        <div className="tv-row-time">
          {hhmm(r.startsAt)}–{hhmm(r.endsAt)}
        </div>
        <div className="tv-row-state">
          {on ? (
            <span className="tv-live">Τώρα</span>
          ) : isToday && mins <= 60 ? (
            <span className="tv-soon">σε {mins}′</span>
          ) : null}
        </div>
      </div>
    );
  };

  const label = (
    <div className="tv-row tv-row-label">
      <span>Κράτηση</span>
      <span>Γήπεδο</span>
      <span>Ώρα</span>
      <span />
    </div>
  );
  const wanted = wantedOf(data.items, now);
  const shown = rows.slice(0, fit);

  return (
    <div className={isToday ? 'tv-body tv-body-board' : 'tv-body tv-body-wide'}>
      <div className="tv-main" ref={boxRef}>
        {rows.length ? (
          <div className="tv-board">
            {label}
            {shown.map(row)}
            {rows.length > shown.length ? (
              <div className="tv-board-more">+{rows.length - shown.length} αργότερα</div>
            ) : null}
          </div>
        ) : (
          <div className="tv-board-empty">{isToday ? 'Καμία άλλη κράτηση σήμερα' : 'Καμία κράτηση'}</div>
        )}
        <div className="tv-board tv-measure" ref={measureRef} aria-hidden>
          {label}
          {rows.map(row)}
          <div className="tv-board-more">+0 αργότερα</div>
        </div>
      </div>

      {isToday ? (
        <aside className="tv-side">
          <div className="tv-side-title">Τώρα στα γήπεδα</div>
          <ul className="tv-now-list">
            {leaves.map((c) => {
              const cur = data.items.find(
                (i) => holds(i, c.id) && Date.parse(i.starts_at) <= now && Date.parse(i.ends_at) > now,
              );
              return (
                <li key={c.id} className={cur ? 'tv-now-row tv-now-busy' : 'tv-now-row'}>
                  <span className="tv-now-court">{c.name}</span>
                  <span className="tv-now-what">{cur ? `ως ${hhmm(cur.ends_at)}` : 'Ελεύθερο'}</span>
                </li>
              );
            })}
          </ul>
          {wanted[0] ? (
            <WantCard item={wanted[0]} courtName={courtName} qr={joinQr[wanted[0].join ?? '']} compact />
          ) : null}
          {wanted.length > 1 ? (
            <div className="tv-want-more">+{wanted.length - 1} ακόμη στην εφαρμογή Ludi</div>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

// ── The wall: one fixture short of players ───────────────────────────

function WantCard({
  item,
  courtName,
  qr,
  compact = false,
}: {
  item: TvItem;
  courtName: Map<string, string>;
  qr?: string;
  compact?: boolean;
}) {
  return (
    <article className={compact ? 'tv-want tv-want-compact' : 'tv-want'}>
      <div className="tv-want-text">
        <div className="tv-want-when">
          <span className="tv-want-time">{hhmm(item.starts_at)}</span>
          <span className="tv-want-court">{courtName.get(item.pitch_id)}</span>
        </div>
        <div className="tv-want-missing">Λείπει: {missingText(item)}</div>
        {item.share_cents ? <div className="tv-want-price">{euros(item.share_cents)} η θέση</div> : null}
        <div className="tv-want-scan">Σκανάρετε για να μπείτε</div>
      </div>
      {qr ? <span className="tv-want-qr" dangerouslySetInnerHTML={{ __html: qr }} /> : null}
    </article>
  );
}
