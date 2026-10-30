// Design tokens — "Chalk & Aegean" (design-handoff bundle, 2026-08-10).
// Cool chalk ground, Aegean blue primary. Terracotta is retained but demoted
// to a SEMANTIC colour (errors, cancellations, refunds) — it is no longer the
// accent. Values are final per the handoff README; if you change one here,
// mirror it into apps/admin/lib/tokens.ts (see the comment there).

// There is one accent now, not a choice: the `PALETTES` map, `PaletteKey` and
// `ACCENT_MAP` were removed with the app's move onto the site's Aegean palette
// (docs/ui/palette-migration-app.md). `olive` went with them — it had no site
// equivalent and no call sites. Aegean is the accent; everything else is a role.

export const TOKENS = {
  // base
  bg: '#F2F4F3',
  surface: '#FFFFFF',
  ink: '#10181C',
  ink2: '#3F4C51',
  ink3: '#5F6E73',
  line: 'rgba(16,24,28,0.07)',
  lineBold: 'rgba(16,24,28,0.12)',
  // primary — Aegean. CTA fills, active tab, selected slot/day, focus ring.
  primary: '#175E77',
  primaryDeep: '#0F3F52', // accent TEXT on the bg ground (primary at text size is for surface only)
  primarySoft: '#DCE9EC',
  // role
  pitch: '#1F6640', // success, confirmed, availability
  pitchDeep: '#174028',
  pitchSoft: '#DFECE3',
  sun: '#D99520', // pending, warnings
  sunDeep: '#8A5A0E',
  sunSoft: '#F8E8C9',
  // semantic only — errors, cancellation, refunds, LOSS. FILLS ONLY on bg;
  // error *text* uses `alertDeep` (the base at 4.3:1 on bg fails AA).
  //
  // `alert*` is the role name and what new code should use. The `terra*` names
  // are the same values under their old decorative name, kept as aliases so the
  // existing call sites keep working — a colour named after a material invites
  // being used as an accent, which is precisely what this token must never be.
  alert: '#C1502E',
  alertSoft: '#F4E1D4',
  alertDeep: '#8B3415',
  terracotta: '#C1502E',
  terraSoft: '#F4E1D4',
  terraDeep: '#8B3415',
  // legacy aliases — pre-handoff screens referenced `sea`; keep them pointing
  // at the primary so un-rewritten files stay consistent. New code uses
  // `primary` / `primarySoft` directly.
  sea: '#175E77',
  seaSoft: '#DCE9EC',
  // fonts — static instances registered in apps/mobile/app/_layout.tsx.
  // One family name per weight: RN font matching cannot select weights
  // within a custom family, so `fontWeight` alongside these is a no-op by
  // design — pick the family that carries the weight you want.
  display: 'Fraunces', // 500
  displaySemi: 'Fraunces-SemiBold', // 600
  displayItalic: 'Fraunces-Italic',
  /**
   * Poster serif — the share/export surface ONLY (ShareCard). The share card
   * is drawn in Literata and is a distinct artefact from the app UI, which
   * stays on Fraunces. Do not reach for this inside app screens: two display
   * serifs in one interface is the thing this separation exists to prevent.
   * The one exception is Greek text, which Fraunces cannot set at all — that
   * goes through `displayFamily()` (display-family.ts), never directly.
   */
  poster: 'Literata',
  posterSemi: 'Literata-SemiBold',
  ui: 'System',
  mono: 'JetBrainsMono', // 400
  monoMedium: 'JetBrainsMono-Medium', // 500
  monoBold: 'JetBrainsMono-Bold', // 700
} as const;

// Elevation — depth comes from shadow only, never a second background fill.
// Shadow colour is ink-derived, never black (black on chalk reads grey).
// Spread as `{...ELEV.e2}` on a style object. elev2+ should pair with a
// hairline `TOKENS.line` border so the shape survives on Android (<API 28
// ignores shadow colour).
export const ELEV = {
  e0: {},
  e1: {
    shadowColor: '#10181C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  e2: {
    shadowColor: '#10181C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  e3: {
    shadowColor: '#10181C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 6,
  },
  e4: {
    shadowColor: '#10181C',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 32,
    elevation: 12,
  },
} as const;

// Spacing — 4px base scale. Screen horizontal padding is SPACE.s5 (20)
// everywhere except full-attention screens (consent, sign-in, OTP, checkout
// failure), which use 24.
export const SPACE = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 20,
  s6: 28,
  s8: 40,
} as const;

// Radii. Every rounded rectangle also sets `borderCurve: 'continuous'` —
// iOS's own corner, the one the system draws on sheets, icons and the
// device itself (ignored on Android). Circles and pills don't need it.
export const RADII = {
  sm: 10, // chips, filter pills, icon tiles
  md: 14, // inputs, slot tiles, day tiles, OTP boxes
  lg: 20, // cards
  xl: 28, // sheets, hero cards, modals
  full: 999, // buttons, pills, avatars
} as const;

// Motion — durations in ms, for EFFECTS: colour, opacity, a text rising in.
// The standard easing is cubic-bezier(0.2,0,0,1) — `STANDARD_CURVE` below,
// which @ludi/ui turns into the engine's easing (`EASE`, motion.tsx). Respect
// the OS Reduce Motion setting: transforms drop, effect durations halve.
export const MOTION = {
  instant: 120,
  quick: 200,
  standard: 280,
  slow: 450,
} as const;

/** cubic-bezier(0.2, 0, 0, 1) — the one curve, declared once. */
export const STANDARD_CURVE = [0.2, 0, 0, 1] as const;

// Springs — for SPATIAL motion only: position, size, scale, anything under a
// finger (ADR-0035). Never colour or opacity; those stay on MOTION. Reanimated
// 4's duration-based spring: `duration` is how long it takes to settle,
// `dampingRatio` 1 settles without overshoot, below 1 overshoots a little.
// Starting values from plans/motion-v3.md (slice 1), tuned on device.
export const SPRING = {
  /** Under the finger: fast, no visible overshoot at a 0.97 press
   *  (the shape of SwiftUI's interactive spring). */
  press: { duration: 150, dampingRatio: 0.86 },
  /** Things that move in space: a row gliding, a seat arriving, a thumb. */
  spatial: { duration: 350, dampingRatio: 0.8 },
  /** Settles with no overshoot: the player card's flip. */
  gentle: { duration: 550, dampingRatio: 1 },
} as const;

// Format dot colours — pitch size scannable without reading (Discover, map
// pins, match cards).
export const FORMAT_DOT: Record<string, string> = {
  '5-a-side': TOKENS.primary,
  '7-a-side': TOKENS.pitch,
  '11-a-side': TOKENS.sun,
};
