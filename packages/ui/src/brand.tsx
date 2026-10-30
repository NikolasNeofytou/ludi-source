// The Ludi mark and lockup — "Lambda, radiating".
//
// A nest of Λ planes cut off the bottom edge: one hue stepped seven times from
// ink up to chalk, with a single gold plane innermost. Each plane is a player;
// the gold one is the player who made the side up.
//
// The four rules this file exists to enforce:
//   1. Never a second hue in the stack — the ramp is one colour stepped, and a
//      second hue turns depth into stripes.
//   2. Never float the base — the outermost plane is cut by the frame edge.
//   3. Never outline the mark — strokes belong to the radiating rings only.
//   4. Never drop the gold — it is the only warm pixel in the system.
//
// Plane count drops with size rather than the geometry scaling down. The ramp's
// mid-steps are interpolation for this mark only and are deliberately NOT in
// TOKENS — do not reach for them elsewhere in the UI.

import React from 'react';
import { G, Path, Rect, Svg, Text as SvgText } from 'react-native-svg';

import { TOKENS } from './tokens';

export const MARK_GROUND = '#0A2E3D';
export const MARK_GOLD = '#D99520';

/** The seven-step ramp, outermost first. Index 6 is the gold. */
export const MARK_RAMP = [
  '#0F3F52',
  '#175E77',
  '#2B7E96',
  '#63A6B7',
  '#A3C9D3',
  '#DCE9EC',
  MARK_GOLD,
] as const;

/**
 * [apex y, base half-width] per plane, outermost first.
 *
 * Taken literally from the locked drawing rather than derived: apexes step
 * evenly (22 at full density) while half-widths step faster (88 → 72 → 56 → 40
 * → 24 → 10), so the nest tightens as it recedes. Deriving them from one
 * diagonal widens the inner planes and flattens that recession.
 */
const PLANES = {
  full: [
    [28, 88],
    [50, 72],
    [72, 56],
    [94, 40],
    [116, 24],
    [138, 10],
    [156, 6],
  ],
  lockup: [
    [28, 88],
    [60, 64],
    [92, 40],
    [124, 16],
    [150, 8],
  ],
  compact: [
    [28, 88],
    [74, 56],
    [120, 20],
    [150, 9],
  ],
  micro: [
    [28, 88],
    [104, 36],
    [148, 11],
  ],
} as const;

export type MarkDensity = keyof typeof PLANES;

/** The seven-plane geometry, exported so the Nest can animate plane-by-plane. */
export const MARK_PLANES: readonly (readonly [number, number])[] = PLANES.full;

/** Fills for a density: the ramp sampled evenly, always ending on the gold. */
function fillsFor(density: MarkDensity): string[] {
  const planes = PLANES[density];
  const n = planes.length;
  if (density === 'full') return [...MARK_RAMP];
  // Sample the ink→chalk part evenly, then append gold as the innermost.
  const body = MARK_RAMP.slice(0, 6);
  const out: string[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const step = Math.round((i / Math.max(1, n - 2)) * (body.length - 1));
    out.push(body[step] as string);
  }
  out.push(MARK_GOLD);
  return out;
}

export function planePath(apex: number, half: number): string {
  return `M90 ${apex} L${90 + half} 180 L${90 - half} 180 Z`;
}

export function LudiMark({
  size = 48,
  density = 'compact',
  ground = MARK_GROUND,
  /** Fill override per plane — used by the launch animation's hue rotation. */
  fills,
}: {
  size?: number;
  density?: MarkDensity;
  ground?: string | null;
  fills?: string[];
}) {
  const planes = PLANES[density];
  const colors = fills ?? fillsFor(density);

  return (
    <Svg width={size} height={size} viewBox="0 0 180 180">
      {ground ? <Rect width={180} height={180} fill={ground} /> : null}
      {planes.map(([apex, half], i) => (
        <Path key={apex} d={planePath(apex, half)} fill={colors[i] ?? MARK_GOLD} />
      ))}
    </Svg>
  );
}

/**
 * Horizontal lockup: the mark at lockup density beside the logotype.
 *
 * The L is drawn, not set — stem cut flat, foot terminal sheared on the mark's
 * own diagonal so the letter and the icon share one angle. UDI stays Fraunces
 * 600. Four planes here; seven is app-icon only.
 */
export function LudiWordmark({
  height = 32,
  onDark = false,
}: {
  height?: number;
  onDark?: boolean;
}) {
  const ink = onDark ? TOKENS.bg : TOKENS.ink;
  // 172:40 is the drawn aspect ratio of the logotype.
  const width = height * (172 / 40);

  return (
    <Svg width={width} height={height} viewBox="0 0 172 40">
      <G fill={ink}>
        <Path d="M0 0 H8 V26 H30 L34.6 34 H0 Z" translateX={2} translateY={1} fill={ink} />
        <SvgText
          x={37}
          y={35}
          fontFamily={TOKENS.displaySemi}
          fontSize={47}
          letterSpacing={2}
          fill={ink}
        >
          UDI
        </SvgText>
      </G>
    </Svg>
  );
}
