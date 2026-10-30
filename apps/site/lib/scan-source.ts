// Where a visit came from. Every QR in a print pack encodes
// `ludi.football/get?s=<venue>-<piece>`, and every link Ludi posts on its
// own channels carries `?s=ludi-<channel>`, so each piece and each channel
// can be judged on its own before the next one is made
// (docs/plans/launch-assets/, docs/plans/instagram.md IG-1).
//
// A closed list on purpose, not the raw query value: analytics properties
// are enums only (lib/analytics.ts), so an unknown or hand-typed `s` is
// counted as 'other' rather than passed through. Typing the printed
// `ludi.football/get` by hand, or the wallet pass, arrives as 'direct'.
// New print run or new channel → add its tag here before it goes out.

export const VENUES = ['campeone', 'kamares'] as const;
// 'page' is the venue's own page's "Get the app" button (plans/reach.md R1).
// 'cfa-tv' and 'cfa-print' are the "follow your child's team" QRs on the
// lobby screen and the printed CFA programme (plans/release-1-0.md E2); they
// land on the venue's page, which hands its tag on to "Get the app".
// 'ig', 'fb', 'google' and 'link' are the venue's own profiles and the
// owner's *Your link* card (plans/marketing.md MK-E3).
const PIECES = [
  'banner',
  'a3',
  'a4',
  'a5',
  'a6',
  'sticker',
  'page',
  'cfa-tv',
  'cfa-print',
  'ig',
  'fb',
  'google',
  'link',
] as const;

// Ludi's own channels (plans/marketing/launch-campaigns.md § Links).
// `ludi-ig` is the Instagram bio, the `ludi-ig-*` four are the keyword DMs
// and `ludi-story` is the app's Story cards (plans/instagram.md IG-5, IG-8).
const LUDI_CHANNELS = [
  'ludi-ig',
  'ludi-ig-play',
  'ludi-ig-keeper',
  'ludi-ig-cup',
  'ludi-ig-goal',
  'ludi-story',
  'ludi-tiktok',
  'ludi-fb',
  'ludi-li',
  'ludi-wa',
  'ludi-press',
  'ludi-league',
] as const;

export type ScanVenue = (typeof VENUES)[number] | 'other';

/** A venue slug as an analytics value: the closed list, or 'other'. */
export function scanVenue(slug: string): ScanVenue {
  return (VENUES as readonly string[]).includes(slug) ? (slug as ScanVenue) : 'other';
}

type LudiChannel = (typeof LUDI_CHANNELS)[number];

export type ScanSource =
  | `${(typeof VENUES)[number]}-${(typeof PIECES)[number]}`
  | LudiChannel
  | 'direct'
  | 'other';

const KNOWN = new Set<string>([
  ...VENUES.flatMap((v) => PIECES.map((p) => `${v}-${p}`)),
  ...LUDI_CHANNELS,
]);

export function parseScanSource(value: string | string[] | undefined): ScanSource {
  if (value === undefined) return 'direct';
  const s = Array.isArray(value) ? value[0] : value;
  return s !== undefined && KNOWN.has(s) ? (s as ScanSource) : 'other';
}

/**
 * The tag a page hands on to its next link: the one that brought the
 * visitor, when it is known and belongs here (one of Ludi's own channels,
 * or this venue's piece), else the page's own fallback. Another venue's
 * piece is never passed on, so a Campeone poster can't take credit for a
 * Kamares install.
 */
export function carrySource(source: ScanSource, fallback: string, venueSlug?: string): string {
  if (source === 'direct' || source === 'other') return fallback;
  if ((LUDI_CHANNELS as readonly string[]).includes(source)) return source;
  return venueSlug !== undefined && source.startsWith(`${venueSlug}-`) ? source : fallback;
}
