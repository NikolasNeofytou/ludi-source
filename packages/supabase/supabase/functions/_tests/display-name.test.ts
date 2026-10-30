// _tests/display-name.test.ts
// A name other people read is a first name and nothing else (audit
// 2026-10-19, C5 + L12): letters in any script, one hyphen or apostrophe at
// most, no links, emoji, controls or bidi tricks, 24 characters, sensibly
// capitalised. tests/rls/55_tv_first_name.sql pins the same cases on
// public.display_first_name(), the lobby screen's copy of the rule.

import { assertEquals } from 'std/assert/mod.ts';
import { DISPLAY_NAME_MAX, displayFirstName } from '../_shared/display-name.ts';

const CASES: Array<[string | null | undefined, string | null, string]> = [
  // Greek and Latin survive, accents included
  ['Σώζος', 'Σώζος', 'a Greek name is kept as typed'],
  ['  Σώζος   Παπαδόπουλος ', 'Σώζος', 'the first word only, trimmed'],
  ['ΣΩΖΟΣ', 'Σωζος', 'Greek capitals are capitalised, with a final sigma'],
  ['σώζος', 'Σώζος', 'Greek small letters get a capital'],
  ['Kleanthis', 'Kleanthis', 'a Latin name is kept'],
  ['MARIA', 'Maria', 'all capitals are capitalised'],
  ['jean-luc', 'Jean-Luc', 'one internal hyphen is kept, each part capitalised'],
  ["o'brien", "O'Brien", 'one internal apostrophe is kept'],
  ['O\u2019Brien', "O'Brien", 'a typographic apostrophe becomes a plain one'],
  ['McKenzie', 'McKenzie', 'a mixed-case name keeps its letters'],
  ['Анна', 'Анна', 'Cyrillic is letters too'],
  // links, symbols and emoji
  ['scam-site.cy/win', 'Scam-Site', 'a domain is cut at its first dot'],
  ['https://scam.cy', 'Https', 'a URL is cut at its colon'],
  ['www.ludi-prize.com', 'Www', 'www. is cut at its dot'],
  ['🔥🔥 Maria 🔥', 'Maria', 'emoji around a name go'],
  ['Maria😀', 'Maria', 'an emoji after a name goes'],
  ['😀😀😀', null, 'only emoji leaves nothing'],
  ['Anne--Marie', 'Anne', 'two hyphens in a row end the name'],
  ['Jean-Luc-Marie', 'Jean-Luc', 'a second hyphen ends the name'],
  ['-Maria-', 'Maria', 'leading and trailing hyphens go'],
  ['Andreas99', 'Andreas', 'digits end the name'],
  ['12345', null, 'digits only leaves nothing'],
  // controls and bidi
  ['\u202Eniw/yc.mac', 'Niw', 'a right-to-left override goes'],
  ['\u2066Anna\u2069', 'Anna', 'bidi isolates go'],
  ['\u200FMaria\u200E', 'Maria', 'directional marks go'],
  ['Ma\u200Bria', 'Maria', 'a zero-width space does not split the name'],
  ['Ma\u00ADria', 'Maria', 'a soft hyphen does not split the name'],
  ['An\u0000na\u0007', 'Anna', 'control characters go'],
  // styled and full-width letters fold to plain ones
  ['𝐒𝐜𝐚𝐦', 'Scam', 'mathematical bold letters fold'],
  ['Ｍａｒｉａ', 'Maria', 'full-width letters fold'],
  // nothing to show
  [null, null, 'NULL stays NULL'],
  [undefined, null, 'undefined is NULL'],
  ['', null, 'empty is NULL'],
  ['   ', null, 'blank is NULL'],
  ['.-/', null, 'punctuation only is NULL'],
];

for (const [input, want, why] of CASES) {
  Deno.test(`displayFirstName: ${why}`, () => {
    assertEquals(displayFirstName(input), want);
  });
}

Deno.test('displayFirstName: at most 24 characters', () => {
  const long = 'Abcdefghijklmnopqrstuvwxyzabcdef';
  assertEquals(displayFirstName(long), long.slice(0, DISPLAY_NAME_MAX));
  assertEquals(DISPLAY_NAME_MAX, 24);
  // counted in characters, not UTF-16 units, and Greek counts the same
  assertEquals(Array.from(displayFirstName('Ω'.repeat(40)) ?? '').length, 24);
});

Deno.test('displayFirstName: a cut never ends on a hyphen', () => {
  // 23 letters, a hyphen at 24, more after it
  assertEquals(displayFirstName(`${'a'.repeat(23)}-bbbb`), `A${'a'.repeat(22)}`);
});

Deno.test('displayFirstName: what comes out is letters, one joiner at most', () => {
  const nasty = [
    '\u202Ehttps://evil.example/\u202C',
    'Free€€€ €100 at evil.cy',
    '<script>alert(1)</script>',
    '@everyone',
    '#1 Fan',
    'M̴a̷r̸i̵a̶',
  ];
  for (const raw of nasty) {
    const out = displayFirstName(raw);
    if (out === null) continue;
    assertEquals(
      /^\p{Alphabetic}+(?:['-]\p{Alphabetic}+)?$/u.test(out),
      true,
      `${JSON.stringify(raw)} → ${out}`,
    );
  }
});
