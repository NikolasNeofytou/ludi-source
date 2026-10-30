// Share-card plane geometry — the one field every card variant sits on.
//
// Pure data and string maths on purpose: no React, no react-native-svg, no
// imports at all. The site has to draw these too (the 1200×630 link preview is
// rendered server-side from profile data), and apps/site cannot import the rest
// of @ludi/ui because that package re-exports React Native primitives which do
// not compile under webpack. Keeping this file dependency-free is what lets
// both surfaces share one source of truth instead of mirroring it by hand.
//
// The design's claim is that "the seven planes sit at the same proportional
// apexes on every canvas — 1350, 1080, 630 and 1920 tall — so the composition
// is recognisable across all of them without a single element being resized to
// fit". That was verified against all four drawings before this was written:
// the ratios below reproduce the 1350, 1080 and 630 artwork exactly.
//
// The story canvas is the one deliberate exception — see STORY_APEX.
//
// One ratio is tuned rather than naive: plane 3 is 0.4818, not the 0.4815 the
// 1350 and 1080 drawings imply on their own. At 630 tall the naive value lands
// on 303.3 and rounds to 303, where the artwork draws 304. 0.4818 is inside the
// window that rounds correctly on all three canvases at once, so every plane
// reproduces its drawing exactly instead of 23 of 24.

/** apex y / canvas height, outermost first. */
const APEX = [0.0889, 0.2963, 0.4818, 0.6074, 0.7407, 0.8519] as const;

/**
 * The story's pale steps start lower on purpose: "below 65% height so every
 * line of type sits on deep Aegean". Planes 1–2 keep the standard ratios;
 * 3–6 compress into the bottom third so the type above them never crosses a
 * tonal boundary. Do not "fix" this to match the others — it is the reason the
 * story is legible at all.
 */
const STORY_APEX = [0.0885, 0.2964, 0.651, 0.7448, 0.8125, 0.8646] as const;

/**
 * base half-width / canvas width. The outermost is 1.0 — a full canvas width
 * either side of centre — so every plane's base runs past the frame and gets
 * clipped. That is the mark's "never float the base" rule at poster scale.
 */
const HALF = [1.0, 0.7593, 0.5741, 0.5185, 0.4444, 0.3704] as const;

export type ShareGround = 'whisper' | 'colour' | 'story';

/**
 * Ground rule, from the design: **if the surface is read, it's whisper; if
 * it's looked at, it's colour.** The story is the only export that gets the
 * ramp. Whisper steps roughly 2% between tones — felt more than seen, like a
 * watermark in stone — so at thumbnail size the card reads as flat ink and
 * nothing competes with the name.
 */
const GROUNDS: Record<ShareGround, { base: string; planes: readonly string[] }> = {
  whisper: {
    base: '#08283A',
    planes: ['#0A2D40', '#0C3245', '#0E374B', '#103C51', '#124156', '#14465C'],
  },
  colour: {
    base: '#0F3F52',
    planes: ['#175E77', '#2C7A93', '#63A6B7', '#9DC6D1', '#DCE9EC', '#F2F4F3'],
  },
  story: {
    base: '#0F3F52',
    planes: ['#175E77', '#1E6480', '#63A6B7', '#9DC6D1', '#DCE9EC', '#F2F4F3'],
  },
};

/** The canvases the system ships. A fifth means a new export, not a new size. */
export const SHARE_CANVASES = {
  card: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  link: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
} as const;

export type ShareCanvas = keyof typeof SHARE_CANVASES;

export interface SharePlane {
  /** SVG path data, absolute to the canvas. */
  d: string;
  fill: string;
}

export function shareGroundColor(ground: ShareGround): string {
  return GROUNDS[ground].base;
}

/**
 * The plane field for a canvas. Renderer-agnostic — hand `d` and `fill` to an
 * SVG <path> in either React DOM or react-native-svg.
 *
 * `cut` truncates the field to N planes and is how the invite's roster gauge
 * works: six planes drawn and the seventh left as bare ground, so the dark
 * notch at the base of the mark *is* "one spot left" without a label.
 */
export function sharePlanes(
  canvas: ShareCanvas,
  ground: ShareGround = 'whisper',
  cut?: number,
): SharePlane[] {
  const { width, height } = SHARE_CANVASES[canvas];
  const apexes = ground === 'story' ? STORY_APEX : APEX;
  const { planes } = GROUNDS[ground];
  const count = Math.max(0, Math.min(cut ?? planes.length, planes.length));
  const cx = width / 2;

  const out: SharePlane[] = [];
  for (let i = 0; i < count; i += 1) {
    const apexY = Math.round((apexes[i] as number) * height);
    const half = Math.round((HALF[i] as number) * width);
    out.push({
      d: `M${cx} ${apexY} L${cx + half} ${height} L${cx - half} ${height} Z`,
      fill: planes[i] as string,
    });
  }
  return out;
}
