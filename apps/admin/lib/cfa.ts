// CFA grassroots rounds (plans/cfa-grassroots-saturday.md). Pure helpers
// shared by the loader and its tests-by-eye: read the CFA's published round
// file, turn a team string into a category and a format, and propose courts.
//
// The format table is the CFA's 2025–26 προκήρυξη for what can be played on
// futsal courts: 5 v 5 on one court, 7 v 7 on two joined (a composite,
// ADR-0032). 9 v 9 and 11 v 11 are not a futsal venue's, so they come back
// null and the owner decides. Re-read the table when the season's rules are
// published.
//
// 2026–27 broke the table: the CFA writes the format into each competition,
// "2016 (U11) LIONS (5v5)", and one age plays in more than one (U11 Lions in
// 5 v 5 and 7 v 7, U12 Lions in 7 v 7 and 9 v 9). A file that states the
// format, in a Format column or in the competition's name, wins over it.
// And 9 v 9 is a futsal venue's after all: Campeone joins three courts into
// one (Giorgos, 29 Oct 2026: 1–3 for 9 v 9, 6–7 for 7 v 7, 4 and 5 alone).

export type CfaFormat = 5 | 7 | 9 | null;

// "5v5", "7 v 7", "2015 (U12) LIONS (9v9), ΛΕΥΚΩΣΙΑ" → 5, 7, 9; "11v11" →
// null; nothing stated → undefined, and the age table decides.
export function statedFormat(s: string): CfaFormat | undefined {
  const m = /(\d{1,2})\s*v\s*\d{1,2}/i.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n === 5 || n === 7 || n === 9 ? n : null;
}

export type CfaRow = {
  round: string;
  kickoff: string; // HH:MM
  date: string | null; // YYYY-MM-DD when the file carries one
  venue: string;
  homeRaw: string;
  awayRaw: string;
  home: string;
  away: string;
  category: string;
  // Each side's own age group and CFA group: with the club, the team's key
  // for the season (plans/cfa-in-the-app.md K1). The group is what the CFA
  // writes after Eagles/Lions ("Nicosia A").
  homeCategory: string;
  awayCategory: string;
  homeGroup: string;
  awayGroup: string;
  format: CfaFormat;
};

// Whatever the sheet reader hands back per cell.
type Cell = unknown;

// "ΑΠΟΕΛ ΛΕΥΚΩΣΙΑΣ U13 Eagles Nicosia A": club, age, category, group. The
// girls' groups (K-11 Pearls, K-13 Diamonds) carry a K.
const TEAM = /^(.*?)\s+[UK]\s*-?\s*(\d{1,2})\s+(Eagles|Lions|Bambini|Pearls|Diamonds)\b\s*(.*)$/i;

export function parseTeam(raw: string): { club: string; age: number | null; cat: string | null; group: string } {
  const s = raw.replace(/\s+/g, ' ').trim();
  const m = TEAM.exec(s);
  if (!m) return { club: s, age: null, cat: null, group: '' };
  const cat = m[3]!.charAt(0).toUpperCase() + m[3]!.slice(1).toLowerCase();
  return { club: m[1]!.trim(), age: Number(m[2]), cat, group: (m[4] ?? '').trim().slice(0, 40) };
}

const categoryOf = (t: { age: number | null; cat: string | null }) => (t.age !== null ? `U${t.age} ${t.cat}` : '');

export function formatFor(age: number | null, cat: string | null): CfaFormat {
  if (age === null || cat === 'Pearls' || cat === 'Diamonds') return null;
  if (age <= 9) return 5;
  if (age === 10) return cat === 'Lions' ? 5 : 7;
  if (age === 11) return 7;
  if (age === 12) return cat === 'Lions' ? 7 : null;
  return null;
}

function text(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toISOString();
  return String(c).trim();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Excel hands a time back as a Date on 1899-12-30, a day fraction, or text.
export function cellTime(c: Cell): string | null {
  if (c instanceof Date) return `${pad(c.getUTCHours())}:${pad(c.getUTCMinutes())}`;
  if (typeof c === 'number' && c >= 0 && c < 2) {
    const mins = Math.round((c % 1) * 1440);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  const m = /(\d{1,2})[:.](\d{2})/.exec(text(c));
  return m ? `${pad(Number(m[1]))}:${m[2]}` : null;
}

export function cellDate(c: Cell): string | null {
  if (c instanceof Date && c.getUTCFullYear() > 1900) {
    return `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}`;
  }
  const m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(text(c));
  return m ? `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}` : null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

// One sheet's rows → matches. The header row is the one naming HomeTeam; the
// venue is the column the CFA leaves unlabelled after the time (or one called
// venue / γήπεδο).
export function rowsFromSheet(rows: Cell[][]): CfaRow[] {
  const h = rows.findIndex((r) => r.some((c) => norm(text(c)) === 'hometeam'));
  if (h < 0) return [];
  const head = rows[h]!.map((c) => norm(text(c)));
  const col = (name: string) => head.indexOf(name);
  const iRound = col('round');
  const iHome = col('hometeam');
  const iAway = col('awayteam');
  const iTime = head.findIndex((c) => c === 'datetime' || c === 'time' || c === 'ώρα');
  let iVenue = head.findIndex((c) => /venue|γήπεδο|γηπεδο|stadium/.test(c));
  const iFormat = col('format') >= 0 ? col('format') : col('competition');

  const out: CfaRow[] = [];
  for (const r of rows.slice(h + 1)) {
    const homeRaw = text(r[iHome]);
    const awayRaw = text(r[iAway]);
    if (!homeRaw || !awayRaw) continue;
    if (iVenue < 0) {
      iVenue = r.findIndex((c, i) => i > Math.max(iHome, iAway, iTime) && text(c) !== '');
    }
    const kickoff = cellTime(r[iTime]);
    if (!kickoff) continue;
    const home = parseTeam(homeRaw);
    const away = parseTeam(awayRaw);
    const stated = iFormat >= 0 ? statedFormat(text(r[iFormat])) : undefined;
    out.push({
      round: iRound >= 0 ? text(r[iRound]) : '',
      kickoff,
      date: cellDate(r[iTime]),
      venue: iVenue >= 0 ? text(r[iVenue]) : '',
      homeRaw,
      awayRaw,
      home: home.club,
      away: away.club,
      category: categoryOf(home),
      homeCategory: categoryOf(home),
      awayCategory: categoryOf(away) || categoryOf(home),
      homeGroup: home.group,
      awayGroup: away.group,
      format: stated !== undefined ? stated : formatFor(home.age, home.cat),
    });
  }
  return out;
}

// ── Proposing courts ─────────────────────────────────────────────────

export type LoaderCourt = { id: string; name: string; units: string[] };
export type Busy = { units: string[]; start: number; end: number };

const minutesOf = (hhmm: string) => {
  const [hh, mm] = hhmm.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
};

// Each match on the first free court of its size, in kick-off order and the
// biggest format first, so a joined pitch is still whole when its match
// comes: 9 v 9 on a court joined from three or more, 7 v 7 on the smallest
// joined court, 5 v 5 on a single court, first one that is no part of a
// joined pitch. A unit is free when nothing overlapping holds it.
export function proposeCourts(
  matches: { kickoff: string; format: CfaFormat }[],
  courts: LoaderCourt[],
  busy: Busy[],
  minutes: number,
): (string | '')[] {
  const taken: Busy[] = [...busy];
  const joined = courts.filter((c) => c.units.length > 1);
  const inJoined = new Set(joined.flatMap((c) => c.units));
  const singles = courts.filter((c) => c.units.length === 1);
  const pools: Record<5 | 7 | 9, LoaderCourt[]> = {
    5: [...singles.filter((c) => !inJoined.has(c.id)), ...singles.filter((c) => inJoined.has(c.id))],
    7: [...joined].sort((a, b) => a.units.length - b.units.length),
    9: joined.filter((c) => c.units.length >= 3),
  };
  const free = (units: string[], s: number, e: number) =>
    !taken.some((b) => b.start < e && b.end > s && b.units.some((u) => units.includes(u)));

  const order = matches
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.kickoff.localeCompare(b.m.kickoff) || (b.m.format ?? 0) - (a.m.format ?? 0));
  const result: (string | '')[] = matches.map(() => '');
  for (const { m, i } of order) {
    if (m.format === null) continue;
    const s = minutesOf(m.kickoff);
    const e = s + minutes;
    const pick = pools[m.format].find((c) => free(c.units, s, e));
    if (pick) {
      result[i] = pick.id;
      taken.push({ units: pick.units, start: s, end: e });
    }
  }
  return result;
}

// A re-load keeps what is already on a court (plans/cfa-in-the-app.md K1):
// those count as busy, and only the rest are proposed.
export function proposeKeeping(
  matches: { kickoff: string; format: CfaFormat; pitchId: string }[],
  courts: LoaderCourt[],
  busy: Busy[],
  minutes: number,
): (string | '')[] {
  const unitsOf = new Map(courts.map((c) => [c.id, c.units]));
  const keeps = (m: { pitchId: string }) => m.pitchId !== '' && unitsOf.has(m.pitchId);
  const kept: Busy[] = matches.filter(keeps).map((m) => ({
    units: unitsOf.get(m.pitchId)!,
    start: minutesOf(m.kickoff),
    end: minutesOf(m.kickoff) + minutes,
  }));
  const open = matches.map((m) => (keeps(m) ? { kickoff: m.kickoff, format: null } : m));
  const proposed = proposeCourts(open, courts, [...busy, ...kept], minutes);
  return matches.map((m, i) => (keeps(m) ? m.pitchId : (proposed[i] ?? '')));
}

// A team's key for the season, as the database compares it: club, age
// group, CFA group, case- and space-insensitive.
export function teamKey(club: string, category: string, group: string): string {
  return [club, category, group].map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
}

// The season a date is in: August to July, as competition_season() says.
export function cfaSeason(dateKey: string): string {
  const y = Number(dateKey.slice(0, 4));
  const start = Number(dateKey.slice(5, 7)) >= 8 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// The next Saturday on or after a date key.
export function saturdayOnOrAfter(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
