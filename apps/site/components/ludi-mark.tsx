/**
 * The Ludi mark — "Lambda, radiating".
 *
 * A nest of Λ planes cut off the bottom edge: one hue stepped seven times from
 * the ink ground up to chalk, with a single gold plane innermost. Each plane is
 * a player; the gold one is the player who made the side up.
 *
 * Plane count drops with size rather than the geometry scaling down — at
 * favicon size only the outer plane, one mid plane and the gold survive, which
 * is all a favicon or a map pin needs to be.
 *
 * The four rules this component exists to enforce (from the locked spec):
 *   1. Never a second hue in the stack — the ramp is one colour stepped, and a
 *      second hue turns depth into stripes.
 *   2. Never float the base — the outermost plane is cut by the frame edge.
 *      Lift it and the mark becomes a bunting triangle.
 *   3. Never outline the mark — strokes belong to the radiating rings only.
 *   4. Never drop the gold — it is the only warm pixel in the system.
 *
 * The ramp deliberately introduces mid-steps (#2B7E96, #63A6B7, #A3C9D3) that
 * are not in lib/tokens.ts. They are interpolation between primaryDeep and
 * primarySoft for this mark only, not new brand colours — do not reach for them
 * elsewhere in the UI.
 */

const GROUND = '#0A2E3D';
const GOLD = '#D99520';

/**
 * [apex y, base half-width, fill] per plane, outermost first; gold last.
 *
 * Taken literally from the locked drawing rather than derived. The planes are
 * not on one constant diagonal — apexes step evenly (22px apart at full
 * density) while half-widths step faster (88 → 72 → 56 → 40 → 24 → 10), so the
 * nest tightens as it recedes. Computing them from a single angle visibly
 * widens the inner planes and flattens that recession.
 */
const RAMPS = {
  /** App icon and anything ≥96px: the full seven-plane side. */
  full: [
    [28, 88, '#0F3F52'],
    [50, 72, '#175E77'],
    [72, 56, '#2B7E96'],
    [94, 40, '#63A6B7'],
    [116, 24, '#A3C9D3'],
    [138, 10, '#DCE9EC'],
    [156, 6, GOLD],
  ],
  /** Lockup scale — four planes plus gold, never seven. */
  lockup: [
    [28, 88, '#0F3F52'],
    [60, 64, '#2B7E96'],
    [92, 40, '#63A6B7'],
    [124, 16, '#DCE9EC'],
    [150, 8, GOLD],
  ],
  /** ~48px: nav, list rows, the wallet pass. */
  compact: [
    [28, 88, '#175E77'],
    [74, 56, '#63A6B7'],
    [120, 20, '#DCE9EC'],
    [150, 9, GOLD],
  ],
  /** ≤18px: favicon, map pin. A shape with a warm centre. */
  micro: [
    [28, 88, '#175E77'],
    [104, 36, '#DCE9EC'],
    [148, 11, GOLD],
  ],
} as const;

export type MarkDensity = keyof typeof RAMPS;

function plane(apex: number, half: number): string {
  return `M90 ${apex} L${90 + half} 180 L${90 - half} 180 Z`;
}

export function LudiMark({
  size = 48,
  density = 'compact',
  rounded = false,
  title,
}: {
  size?: number;
  density?: MarkDensity;
  /** Squircle corners. Off by default: the app icon is masked by the OS. */
  rounded?: boolean;
  /** Omit for decorative use so the mark is skipped by screen readers. */
  title?: string;
}) {
  const planes = RAMPS[density];
  const clipId = `ludi-mark-${density}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 180 180"
      style={{ display: 'block', borderRadius: rounded ? size * 0.22 : undefined }}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <clipPath id={clipId}>
        <rect width="180" height="180" />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect width="180" height="180" fill={GROUND} />
        {planes.map(([apex, half, fill]) => (
          <path key={apex} d={plane(apex, half)} fill={fill} />
        ))}
      </g>
    </svg>
  );
}
