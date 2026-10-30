// Ludi Factions — position-line → faction mapping (ADR-0017, colour language
// accepted 2026-06-08). Hexes follow the founder-approved mock
// (docs/ui/ludi-factions-cards.html on plan/match-fit-card): the GK gold is
// the darker "Aurata" #9A6E12 for contrast on the rays, not the accent gold
// #C2901C (that one is reserved for honour chips — NEW, member number).
// Local to the card surfaces for now; promote into @ludi/ui tokens when a
// second consumer lands (the wallet pass generator server-side is the first
// candidate). Latin tags use Roman orthography (V for U): RVSSATA, AVRATA.

export interface Faction {
  key: 'russata' | 'veneta' | 'prasina' | 'aurata' | 'albata';
  latin: string; // FACTIO tag, Roman orthography
  line: 'GOALKEEPER' | 'DEFENDER' | 'MIDFIELDER' | 'ATTACKER' | 'PLAYER';
  hue: string; // ray colour A / fills
  deep: string; // ray colour B / deep fills
  onHero: string; // text colour on the rays
  onHeroDim: string;
  // The same hue lifted to read on navy — the card back's echo rings around
  // the primary position sit on HERO_PANEL, where `hue` goes muddy.
  onDark: string;
}

const WHITE_ON = '#FBF8F0';
const WHITE_ON_DIM = 'rgba(251,248,240,0.85)';

export const FACTIONS: Record<Faction['key'], Faction> = {
  aurata: {
    key: 'aurata',
    latin: 'AVRATA',
    line: 'GOALKEEPER',
    hue: '#9A6E12',
    deep: '#7C560D',
    onHero: WHITE_ON,
    onHeroDim: WHITE_ON_DIM,
    onDark: '#D99520',
  },
  veneta: {
    key: 'veneta',
    latin: 'VENETA',
    line: 'DEFENDER',
    hue: '#1F6F8B',
    deep: '#17536A',
    onHero: WHITE_ON,
    onHeroDim: WHITE_ON_DIM,
    onDark: '#5BA9C6',
  },
  prasina: {
    key: 'prasina',
    latin: 'PRASINA',
    line: 'MIDFIELDER',
    hue: '#2E7D4F',
    deep: '#20603C',
    onHero: WHITE_ON,
    onHeroDim: WHITE_ON_DIM,
    onDark: '#5DB585',
  },
  russata: {
    key: 'russata',
    latin: 'RVSSATA',
    line: 'ATTACKER',
    hue: '#BF4429',
    deep: '#9C3420',
    onHero: WHITE_ON,
    onHeroDim: WHITE_ON_DIM,
    onDark: '#E8735A',
  },
  // No position declared yet — the white faction. Ink text on marble rays;
  // doubles as the "pick your position" nudge state.
  albata: {
    key: 'albata',
    latin: 'ALBATA',
    line: 'PLAYER',
    hue: '#E8DCC4',
    deep: '#D9CFBA',
    onHero: '#241F19',
    onHeroDim: 'rgba(36,31,25,0.65)',
    onDark: '#DCE9EC',
  },
};

// Crisp white body (founder correction 2026-08-30: "white crisp", not the
// yellowish marble) — the app's own Chalk & Aegean neutrals, so the card
// sits in the UI it lives in. Honour gold stays for member number + NEW.
export const CRISP = {
  bg: '#F2F4F3',
  surface: '#FFFFFF',
  surface2: '#F2F4F3',
  ink: '#10181C',
  ink2: '#3F4C51',
  ink3: '#5F6E73',
  line: 'rgba(16,24,28,0.07)',
  lineBold: 'rgba(16,24,28,0.12)',
  gold: '#C2901C',
  goldInk: '#2A1F08',
} as const;

// One hero ground for every card: the brand's dark Aegean (the splash
// ground, brand.tsx MARK_GROUND). The position speaks ONLY through the
// echo rings — same founder correction.
export const HERO_GROUND = '#0A2E3D';

// Text on the hero ground — always chalk, whatever the faction.
export const ON_HERO = '#FBF8F0';
export const ON_HERO_DIM = 'rgba(251,248,240,0.85)';

// The card back's panels — one step up from the ground, so the position,
// record and QR read as three objects on one surface (player-card-v2.md).
export const HERO_PANEL = '#113B4D';

// Charcoal ground (dark skin) — the art-brief ground, same layout.
export const CHARCOAL = {
  bg: '#0E0E10',
  surface: '#15161A',
  surface2: '#1D1F24',
  ink: '#F5F3EE',
  ink2: 'rgba(245,243,238,0.72)',
  ink3: 'rgba(245,243,238,0.48)',
  line: 'rgba(245,243,238,0.10)',
  lineBold: 'rgba(245,243,238,0.18)',
  gold: '#C2901C',
  goldInk: '#2A1F08',
} as const;

// Echo rings — the mark's own Λ geometry (base half-width / height =
// 88/152) repeated outward as strokes, the splash-screen gesture. Rings are
// centred on the mark's visual centroid and the outer ones get cut by the
// hero's edge, which is the mark's "never float the base" rule at hero scale.
const LAMBDA = 88 / 152;
export function echoRingPaths(cx: number, cy: number, heights: number[]): string[] {
  return heights.map((h) => {
    const apexY = cy - (2 * h) / 3;
    const baseY = cy + h / 3;
    const half = LAMBDA * h;
    return `M ${cx} ${apexY} L ${cx + half} ${baseY} L ${cx - half} ${baseY} Z`;
  });
}

// The echo-ring colour is the ONLY place the faction hue appears on the
// card (founder rule). Albata's parchment hue reads muddy on the navy
// hero, so it echoes in chalk instead.
export function factionRingColor(faction: Faction): string {
  return faction.key === 'albata' ? '#DCE9EC' : faction.hue;
}

const DEF = ['CB', 'LB', 'RB'];
const MID = ['CDM', 'CM', 'CAM'];

export function factionFor(positions: string[]): Faction {
  const p = positions[0];
  if (p === 'GK') return FACTIONS.aurata;
  if (p && DEF.includes(p)) return FACTIONS.veneta;
  if (p && MID.includes(p)) return FACTIONS.prasina;
  if (p) return FACTIONS.russata;
  return FACTIONS.albata;
}
