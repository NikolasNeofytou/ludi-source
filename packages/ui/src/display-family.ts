// The display serif for a string — Fraunces, unless the string is Greek.
//
// Fraunces has no Greek glyphs (Google Fonts serves it latin, latin-ext and
// vietnamese only), so every Greek name, foot or tier set in it fell back to
// the system font, mid-card, beside Latin set in the serif. Literata has
// Greek and is already in the binary for the share card, so a Greek string
// borrows its face (plans/player-card-v2.md, "Greek text").
//
// This is the one sanctioned use of the poster serif inside app screens.
// Keep every call behind this helper: reverting the decision is making
// `displayFamily` return the Fraunces face unconditionally.

import { TOKENS } from './tokens';

/** Literata faces registered for Greek display text (apps/mobile/app/_layout.tsx). */
export const GREEK_DISPLAY = {
  medium: 'Literata-Medium',
  semi: TOKENS.posterSemi,
  italic: 'Literata-MediumItalic',
} as const;

const LATIN_DISPLAY = {
  medium: TOKENS.display,
  semi: TOKENS.displaySemi,
  italic: TOKENS.displayItalic,
} as const;

export type DisplayWeight = keyof typeof LATIN_DISPLAY;

// Greek and Coptic + Greek Extended.
const GREEK = /[Ͱ-Ͽἀ-῿]/;

export function hasGreek(text: string | null | undefined): boolean {
  return text ? GREEK.test(text) : false;
}

export function displayFamily(text: string | null | undefined, weight: DisplayWeight = 'semi'): string {
  return hasGreek(text) ? GREEK_DISPLAY[weight] : LATIN_DISPLAY[weight];
}

// Literata hangs a capital's tonos left of the letter's origin — up to
// 0.23 em on Ύ — and iOS clips whatever a Text draws outside its box, so
// «Έμπειρο» rendered as «Εμπειρο». Pad the box by the overhang and pull it
// back by the same: the letter stays on its column and the accent hangs in
// the margin, the way a typesetter would hang it.
const CAP_TONOS = /[\u0386\u0388-\u038A\u038C\u038E\u038F]/;

/** Spread into a display Text's style; undefined when nothing can overhang. */
export function displayHang(
  text: string | null | undefined,
  fontSize: number,
): { paddingLeft: number; marginLeft: number } | undefined {
  if (!text || !CAP_TONOS.test(text)) return undefined;
  const hang = Math.ceil(0.25 * fontSize);
  return { paddingLeft: hang, marginLeft: -hang };
}
