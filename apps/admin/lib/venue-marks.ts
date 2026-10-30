// A venue's own mark, where Ludi shows the venue to the whole room: the lobby
// TV and the printed CFA programme. Keyed by slug; a venue without one keeps
// its name in type. The brand is the venue's and stays in the content, never
// in Ludi's chrome.
//
// Each file is a horizontal lockup whose box already holds the mark's clear
// space x on every side (Campeone: x = 48.17 of 267.85 units high), so the
// page can pull the box into its margin and the drawing still lines up with
// the text under it.
//
// campeone.svg is `lockup-h-name-colour.svg` from
// plans/campeone/identity/crest/masters/ ("Αγκαλιάζει", Ludi teal with a
// light-blue point), shown to Giorgos on 29 Oct 2026. Rebuild it there with
// masters.py and copy it here; never edit this copy.

export type VenueMark = { src: string; clear: number };

const MARKS: Record<string, VenueMark> = {
  campeone: { src: '/marks/campeone.svg', clear: 48.17 / 267.85 },
};

export function venueMark(slug: string | null | undefined): VenueMark | null {
  return (slug && MARKS[slug]) || null;
}
