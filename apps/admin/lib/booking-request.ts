// The booking desk's reader (plans/whatsapp-desk.md, ADR-0046): turns the
// message a customer sends a venue — "αύριο στις 8 για 5άρι;", "kalispera,
// exete gipedo tin pempti 9?", "court 2 Friday 8pm for 90 min" — into a
// PROPOSAL: a day, an hour, a length, a court or a format. It never books.
// The owner sees the proposal beside the message and confirms or corrects
// it; a wrong read costs him a tap, never a double booking.
//
// Pure and dependency-free on purpose: the admin renders with it, and the
// Edge Function test suite imports it by path (Deno has a runner; the admin
// does not), so it must not import anything.
//
// Rules, in the order they consume the text (each match is blanked out so
// a later rule cannot read the same digits twice):
//   1. court ("γήπεδο 3", "court 3", "#3") and format ("5x5", "5άρι",
//      "εφτάρι") — before times, so "γήπεδο 3 στις 8" is court 3 at 20:00
//   2. headcount ("για 10 άτομα") — so it is not read as 10 o'clock
//   3. length ("μιάμιση ώρα", "90 λεπτά", "2 hours")
//   4. a date ("15/10", "15.10.26")
//   5. a day word ("αύριο", "Πέμπτη", "friday")
//   6. an hour ("20:30", "8μμ", "στις 8", "9 το πρωί", "21h", "8 και μισή")
// A bare hour from 1 to 11 is the evening — this is five-a-side — unless
// the message says morning.

export type DeskCourt = { id: string; name: string; type: string };

export type PitchFormat = '5-a-side' | '7-a-side' | '11-a-side';

export type RequestParse = {
  date: string | null;
  time: string | null;
  durationMin: number | null;
  courtId: string | null;
  format: PitchFormat | null;
  players: number | null;
  confidence: 'high' | 'partial' | 'none';
};

export type ParseContext = {
  /** The venue's today, YYYY-MM-DD. */
  today: string;
  /** Minutes since the venue's midnight, now. */
  nowMinutes: number;
  courts: DeskCourt[];
};

const L = '(?<![\\p{L}\\p{N}])';
const R = '(?![\\p{L}\\p{N}])';
const re = (body: string) => new RegExp(body, 'gu');

export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ');
}

const WEEKDAYS: [number, string[]][] = [
  [0, ['κυριακη', 'kyriaki', 'kiriaki', 'sunday']],
  [1, ['δευτερα', 'deftera', 'deutera', 'monday', 'mon']],
  [2, ['τριτη', 'triti', 'tuesday', 'tue', 'tues']],
  [3, ['τεταρτη', 'tetarti', 'wednesday']],
  [4, ['πεμπτη', 'pempti', 'thursday', 'thu', 'thurs']],
  [5, ['παρασκευη', 'paraskevi', 'paraskeui', 'friday', 'fri']],
  [6, ['σαββατο', 'σαββατου', 'savvato', 'sabbato', 'savato', 'saturday']],
];
const TODAY = ['σημερα', 'αποψε', 'simera', 'apopse', 'today', 'tonight'];
const TOMORROW = ['αυριο', 'avrio', 'aurio', 'tomorrow', 'tmrw'];
const AFTER_TOMORROW = ['μεθαυριο', 'methavrio', 'methaurio'];
const MORNING = ['πρωι', 'proi', 'morning'];
const NUMBER_WORDS: Record<string, number> = {
  μια: 1, μιαν: 1, ενα: 1, mia: 1, ena: 1, one: 1,
  δυο: 2, dyo: 2, duo: 2, two: 2,
  τρεισ: 3, τρια: 3, treis: 3, tria: 3, three: 3,
};

function addDays(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(key: string): number {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}
const pad = (n: number) => String(n).padStart(2, '0');

type Cursor = { s: string };
// Find the first match, blank it out, return its groups.
function take(cur: Cursor, pattern: RegExp): RegExpExecArray | null {
  pattern.lastIndex = 0;
  const m = pattern.exec(cur.s);
  if (!m) return null;
  cur.s = cur.s.slice(0, m.index) + ' '.repeat(m[0].length) + cur.s.slice(m.index + m[0].length);
  return m;
}

function courtByNumber(courts: DeskCourt[], n: number): DeskCourt | null {
  const word = new RegExp(`${L}0*${n}${R}`, 'u');
  return courts.find((c) => word.test(normalise(c.name))) ?? null;
}

export function parseBookingRequest(text: string, ctx: ParseContext): RequestParse {
  const cur: Cursor = { s: normalise(text) };
  const out: RequestParse = {
    date: null,
    time: null,
    durationMin: null,
    courtId: null,
    format: null,
    players: null,
    confidence: 'none',
  };

  // 1. Court, then format.
  const court = take(
    cur,
    re(`${L}(?:γηπεδο|γηπεδου|γηπ\\.?|gipedo|ghpedo|γηπεδακι|court|pitch)\\s*(?:no\\.?|νο\\.?|#|n\\.)?\\s*(\\d{1,2})${R}`),
  ) ?? take(cur, re(`(?:^|\\s)#\\s*(\\d{1,2})${R}`));
  if (court) out.courtId = courtByNumber(ctx.courts, Number(court[1]))?.id ?? null;

  const vs = take(cur, re(`${L}(5|7|11)\\s*(?:x|χ|v|vs|on|ν|επι|με)\\s*(5|7|11)${R}`));
  if (vs) out.format = `${vs[1]}-a-side` as PitchFormat;
  if (!out.format) {
    const word = take(
      cur,
      re(`${L}(?:(5|7|11)\\s*(?:-?\\s*αρι|-?\\s*ari|αρακι)|(πενταρι|pentari|πενταρακι)|(εφταρι|επταρι|eftari|eptari)|(εντεκαρι|endekari|entekari))${R}`),
    );
    if (word) {
      out.format = word[1]
        ? (`${word[1]}-a-side` as PitchFormat)
        : word[2]
          ? '5-a-side'
          : word[3]
            ? '7-a-side'
            : '11-a-side';
    }
  }
  if (out.courtId && !out.format) {
    const t = ctx.courts.find((c) => c.id === out.courtId)?.type;
    if (t === '5-a-side' || t === '7-a-side' || t === '11-a-side') out.format = t;
  }

  // 2. Headcount.
  const players = take(cur, re(`${L}(\\d{1,2})\\s*(?:ατομα|ατομων|atoma|people|players|παικτεσ|paiktes|pax)${R}`));
  if (players) out.players = Number(players[1]);

  // 3. Length.
  const half = take(cur, re(`${L}(?:μιαμιση|μια\\s*μιση|ενα\\s*μιση|ενα\\s*και\\s*μιση|miamisi|mia\\s*misi|1[.,]5|one\\s*and\\s*a\\s*half)\\s*(?:ωρα|ωρεσ|ωρ|ora|ores|h|hr|hrs|hour|hours)?${R}`));
  if (half) out.durationMin = 90;
  if (!out.durationMin) {
    const mins = take(cur, re(`${L}(\\d{2,3})\\s*(?:λεπτα|λεπτων|λ\\.|lepta|min|mins|minutes)${R}`));
    if (mins) out.durationMin = Number(mins[1]);
  }
  if (!out.durationMin) {
    const hours = take(
      cur,
      re(`${L}(\\d|μια|μιαν|ενα|δυο|τρεισ|τρια|mia|ena|dyo|duo|treis|tria|one|two|three)\\s*(?:ωρα|ωρεσ|ωρουλα|ora|ores|hour|hours|hr|hrs)${R}`),
    );
    if (hours) {
      const n = /^\d$/.test(hours[1]!) ? Number(hours[1]) : NUMBER_WORDS[hours[1]!];
      if (n && n <= 4) out.durationMin = n * 60;
    }
  }

  // Time words that point at the hour before the day rules run, so "πρωί"
  // inside "Σάββατο πρωί 10" is read once.
  const morning = MORNING.some((w) => new RegExp(`${L}${w}${R}`, 'u').test(cur.s)) || /(?<![\p{L}])am(?![\p{L}])|π\.?μ\.?(?![\p{L}])/u.test(cur.s);

  // 4. A date. "20.30" is not a date (no month 30), so it is left for the
  // hour rule: only a valid day and month is consumed.
  const dateRe = re(`${L}(\\d{1,2})[/.\\-](\\d{1,2})(?:[/.\\-](\\d{2,4}))?${R}`);
  for (const date of cur.s.matchAll(dateRe)) {
    const day = Number(date[1]);
    const month = Number(date[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let year = date[3] ? Number(date[3].length === 2 ? `20${date[3]}` : date[3]) : Number(ctx.today.slice(0, 4));
    let key = `${year}-${pad(month)}-${pad(day)}`;
    if (!date[3] && key < ctx.today) {
      year += 1;
      key = `${year}-${pad(month)}-${pad(day)}`;
    }
    out.date = key;
    cur.s = cur.s.slice(0, date.index) + ' '.repeat(date[0].length) + cur.s.slice(date.index! + date[0].length);
    break;
  }

  // 5. A day word.
  let weekday: number | null = null;
  if (!out.date) {
    const word = (list: string[]) => take(cur, re(`${L}(?:${list.join('|')})${R}`));
    if (word(AFTER_TOMORROW)) out.date = addDays(ctx.today, 2);
    else if (word(TOMORROW)) out.date = addDays(ctx.today, 1);
    else if (word(TODAY)) out.date = ctx.today;
    else {
      for (const [wd, names] of WEEKDAYS) {
        if (word(names)) {
          weekday = wd;
          break;
        }
      }
    }
  }

  // 6. The hour.
  let minutes: number | null = null;
  const clock = take(cur, re(`${L}([01]?\\d|2[0-3])[:.]([0-5]\\d)${R}`));
  if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2]);
  if (minutes === null) {
    const ampm = take(cur, re(`${L}(\\d{1,2})(?:[:.]([0-5]\\d))?\\s*(pm|am|μμ|μ\\.μ\\.|πμ|π\\.μ\\.)`));
    if (ampm) {
      let h = Number(ampm[1]) % 12;
      if (ampm[3] === 'pm' || ampm[3]!.startsWith('μ')) h += 12;
      minutes = h * 60 + Number(ampm[2] ?? 0);
    }
  }
  if (minutes === null) {
    const hourly = take(cur, re(`${L}(\\d{1,2})\\s*h${R}`));
    if (hourly && Number(hourly[1]) <= 23) minutes = Number(hourly[1]) * 60;
  }
  if (minutes === null) {
    const at = take(
      cur,
      re(`${L}(?:στισ|στη|στο|απο|stis|sti|at|@|για|gia|for)?\\s*(\\d{1,2})(\\s*(?:και\\s*μιση|και\\s*τεταρτο|kai\\s*misi|μιση|misi|thirty))?(?=\\s|$|[?.,!;])`),
    );
    if (at && Number(at[1]) <= 23) {
      let h = Number(at[1]);
      if (h >= 1 && h <= 11 && !morning) h += 12;
      const extra = at[2] ? (/τεταρτο/.test(at[2]) ? 15 : 30) : 0;
      minutes = h * 60 + extra;
    }
  }
  if (minutes !== null) out.time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

  // A weekday is the next one; today only if the hour is still ahead.
  if (weekday !== null) {
    const ahead = (weekday - weekdayOf(ctx.today) + 7) % 7;
    const laterToday = minutes === null || minutes > ctx.nowMinutes;
    out.date = addDays(ctx.today, ahead === 0 && !laterToday ? 7 : ahead);
  }

  out.confidence = out.date && out.time ? 'high' : out.date || out.time ? 'partial' : 'none';
  return out;
}
