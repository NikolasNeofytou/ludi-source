// Icons — ported from the prototype to react-native-svg.
// Each icon returns a <Svg>; signature (color, size) is stable across all icons.

import React from 'react';
import { Svg, Path, Circle, Rect, Line } from 'react-native-svg';

export type IconFn = (color?: string, size?: number, filled?: boolean) => React.ReactElement;

// Use `satisfies` (not an annotation) so each key's type stays specific.
// Under `noUncheckedIndexedAccess` a `Record<string, IconFn>` annotation
// would make every `Icon.foo` access return `IconFn | undefined`.
export const Icon = {
  search: (c = 'currentColor', s = 18) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Circle cx="11" cy="11" r="7" stroke={c} strokeWidth={2} />
      <Path d="M21 21l-4.3-4.3" stroke={c} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  ),
  pin: (c = 'currentColor', s = 18) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 22s7-7.5 7-13a7 7 0 10-14 0c0 5.5 7 13 7 13z"
        stroke={c}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="9" r="2.5" stroke={c} strokeWidth={2} />
    </Svg>
  ),
  star: (c = 'currentColor', s = 14, filled = true) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill={filled ? c : 'none'} stroke={c} strokeWidth={1.5}>
      <Path
        d="M12 2l3 6.5 7 .8-5.2 4.9 1.5 7-6.3-3.6L5.7 21l1.5-7L2 9.3l7-.8L12 2z"
        strokeLinejoin="round"
      />
    </Svg>
  ),
  clock: (c = 'currentColor', s = 16) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={c} strokeWidth={2} />
      <Path d="M12 7v5l3 2" stroke={c} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  ),
  users: (c = 'currentColor', s = 16) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Circle cx="9" cy="8" r="3.5" stroke={c} strokeWidth={2} />
      <Path d="M2 21c0-4 3-6 7-6s7 2 7 6" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Circle cx="17" cy="7" r="3" stroke={c} strokeWidth={2} />
      <Path d="M18 15c2.5.3 4 2 4 5" stroke={c} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  ),
  ball: (c = 'currentColor', s = 16) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={c} strokeWidth={1.8} />
      <Path
        d="M12 3l3 4.5-1.5 5h-3L9 7.5 12 3zM3.5 10l5 1M15.5 11l5-1M9 16.5L7 21M15 16.5l2 4.5"
        stroke={c}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  ),
  chevR: (c = 'currentColor', s = 14) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Path d="M9 5l7 7-7 7" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  chevL: (c = 'currentColor', s = 14) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Path d="M15 5l-7 7 7 7" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  plus: (c = 'currentColor', s = 18) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" stroke={c} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  ),
  heart: (c = 'currentColor', s = 18, filled = false) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill={filled ? c : 'none'} stroke={c} strokeWidth={2}>
      <Path
        d="M12 20s-7-4.5-7-10.5A4.5 4.5 0 0112 7a4.5 4.5 0 017 2.5C19 15.5 12 20 12 20z"
        strokeLinejoin="round"
      />
    </Svg>
  ),
  share: (c = 'currentColor', s = 18) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3v13M12 3l-4 4M12 3l4 4M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5"
        stroke={c}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  ),
  // Settings gear — the profile tab demotes every account action behind it
  // (profile Direction C, 2026-09-02). Six teeth keeps the ring readable at
  // 20px; a finer gear turns to mush against the dark Aegean hero.
  gear: (c = 'currentColor', s = 20) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3.2" stroke={c} strokeWidth={1.8} />
      <Path
        d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4"
        stroke={c}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  ),
  filter: (c = 'currentColor', s = 16) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6h18M6 12h12M10 18h4" stroke={c} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  ),
  home: (c = 'currentColor', s = 22) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 11l8-7 8 7v9a2 2 0 01-2 2h-3v-6h-6v6H6a2 2 0 01-2-2v-9z"
        stroke={c}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  ),
  cal: (c = 'currentColor', s = 22) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={5} width={18} height={16} rx={2} stroke={c} strokeWidth={1.8} />
      <Path d="M3 10h18M8 3v4M16 3v4" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  ),
  user: (c = 'currentColor', s = 22) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="4" stroke={c} strokeWidth={1.8} />
      <Path d="M4 21c0-4.5 3.5-7 8-7s8 2.5 8 7" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  ),
  check: (c = 'currentColor', s = 14) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12l5 5L20 6" stroke={c} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  x: (c = 'currentColor', s = 16) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6l12 12M18 6L6 18" stroke={c} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  ),
  // Simple line-style amenity icons (subset of prototype; extend as needed).
  shower: (c = 'currentColor', s = 20) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4V2M12 4a6 6 0 016 6H6a6 6 0 016-6z" stroke={c} strokeWidth={1.7} strokeLinecap="round" />
      <Path
        d="M8 14v1M12 14v1M16 14v1M9 18v1M13 18v1"
        stroke={c}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  ),
  parking: (c = 'currentColor', s = 20) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={4} width={16} height={16} rx={3} stroke={c} strokeWidth={1.7} />
      <Path
        d="M10 16V8h3a2.5 2.5 0 010 5h-3"
        stroke={c}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  ),
  lights: (c = 'currentColor', s = 20) => (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3v1M12 20v1M21 12h-1M4 12H3M18.4 5.6l-.7.7M6.3 17.7l-.7.7M18.4 18.4l-.7-.7M6.3 6.3l-.7-.7"
        stroke={c}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Circle cx="12" cy="12" r="4" stroke={c} strokeWidth={1.7} />
    </Svg>
  ),
} satisfies Record<string, IconFn>;

export const AMENITY_ICON = {
  Showers: Icon.shower,
  Parking: Icon.parking,
  Lights: Icon.lights,
  Ball: Icon.ball,
  'Ball rental': Icon.ball,
} satisfies Record<string, IconFn>;
