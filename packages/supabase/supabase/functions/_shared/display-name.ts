// _shared/display-name.ts
// A name that someone else will read (pre-public security audit
// 2026-10-19, C5 + L12). Players choose their own first name, and a notice
// puts it in another player's push title and email ("Kleanthis is in
// goal"). Left as typed, a "first name" can be "scam-site.cy/win", a row of
// emoji, or a bidi override that flips the rest of the line. So a name that
// leaves its owner's own screen is cut to what a first name is:
//
//   1. NFKC first: styled and full-width letters (𝐒𝐜𝐚𝐦, Ｍａｒｉａ) fold
//      to plain ones, so they meet the same rule;
//   2. control and format characters go — bidi embeddings, overrides and
//      isolates (U+202A–202E, U+2066–2069), the LRM/RLM marks (U+200E/F),
//      zero-widths, the soft hyphen — removed rather than treated as a
//      break, so "Ma<U+200B>ria" is Maria;
//   3. the first run of letters, in any script (the Unicode Alphabetic
//      property, so Greek, Latin and Cyrillic alike), with at most one
//      hyphen or apostrophe inside it: Jean-Luc, O'Brien. Anything else
//      (a space, dot, slash, digit, emoji) ends the name, so
//      "scam-site.cy/win" is "Scam-Site" and never a link;
//   4. at most 24 characters;
//   5. a name typed all in capitals or all in small letters is
//      capitalised (ΣΩΖΟΣ → Σωζος, jean-luc → Jean-Luc); a mixed one
//      (McKenzie) keeps its letters, with a capital first.
//
// Nothing left → null, and the caller words its sentence without a name.
//
// public.display_first_name() (20261021000101) is the same rule in SQL, for
// the lobby screen. _tests/display-name.test.ts and tests/rls/55_* pin the
// same cases on both sides; change one, change both.

export const DISPLAY_NAME_MAX = 24;

// Cc + Cf: every control and format character, bidi controls included.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
// A run of letters with at most one internal hyphen or apostrophe.
const NAME = /\p{Alphabetic}+(?:['\u2019-]\p{Alphabetic}+)?/u;
const WORD_START = /(^|['-])(\p{Alphabetic})/gu;
// σ at the end of a word is ς (simple case mapping cannot know that).
const FINAL_SIGMA = /σ(?=$|['-])/g;

/** The name to show other people, or null when nothing name-like is left. */
export function displayFirstName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const found = raw.normalize('NFKC').replace(INVISIBLE, '').match(NAME);
  if (!found) return null;
  const name = Array.from(found[0].replace(/\u2019/g, "'"))
    .slice(0, DISPLAY_NAME_MAX)
    .join('')
    .replace(/['-]+$/, '');
  const lower = name.toLowerCase();
  let shown: string;
  if (name === lower || name === name.toUpperCase()) {
    shown = lower.replace(WORD_START, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
  } else {
    const [first, ...rest] = Array.from(name);
    shown = first.toUpperCase() + rest.join('');
  }
  return shown.replace(FINAL_SIGMA, 'ς');
}
