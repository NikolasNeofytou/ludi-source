// Motion — the engine and the pieces every interaction is built from
// (ADR-0035; plans/motion-v3.md, "The interaction contract" and slice 1).
//
// Reanimated 4 runs all of it on the UI thread. Two vocabularies, never mixed:
//   SPATIAL — position, size, scale, anything under a finger → a SPRING
//   EFFECT  — colour, opacity, a text rising in            → a MOTION duration
// Reduce Motion (§3.5): spatial motion drops — it jumps, or a press becomes an
// opacity dip — and effects keep their fade at half length. `useReduceMotion`
// is the live switch every piece reads; animations that don't pass it inherit
// Reanimated's own ReduceMotion.System, which finishes them instantly. So a
// fade written as a raw `withTiming` (an entering or exiting worklet) must say
// `reduceMotion: ReduceMotion.Never` and halve its own duration, or under
// Reduce Motion it snaps instead of fading (found on the simulator in sweep 4).
//
// The pieces, by the contract's kinds:
//   Press   — Go: something that opens something (cards, rows, links)
//   Pick    — Pick: a choice made in place (chips, pills, days, slots)
//   Tally   — Count: a number or short label that changes
//   Reveal  — List / Fail: content that arrives or leaves (errors, late sections)
//   ROW_LAYOUT — List: the glide every row in a changing list shares
//   RiseIn  — Load: the first screenful arriving

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Easing as RNEasing,
  Pressable,
  StyleSheet,
  View,
  type Insets,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  LinearTransition,
  ReduceMotion,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { haptic } from './haptics';
import { MOTION, SPRING, STANDARD_CURVE } from './tokens';

/** The standard curve for Reanimated (`withTiming`, layout builders). */
export const EASE = Easing.bezier(...STANDARD_CURVE);

/** The same curve for RN core `Animated`, for the app code that still uses it
 *  (the launch screen, the slot pop). New motion uses `EASE`. */
export const STANDARD_EASING = RNEasing.bezier(...STANDARD_CURVE);

// Last known OS value, shared across mounts. A screen that mounts after launch
// (the confirmation, a sheet) reads the right answer synchronously instead of
// running its one-shot animation with `false` while the async query resolves.
let lastKnown: boolean | null = null;

/** Tracks the OS reduce-motion setting, live (not just at mount). */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(lastKnown ?? false);
  useEffect(() => {
    let alive = true;
    const set = (v: boolean) => {
      lastKnown = v;
      if (alive) setReduceMotion(v);
    };
    AccessibilityInfo.isReduceMotionEnabled()
      .then(set)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', set);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduceMotion;
}

/** A caller's own opacity, so a press dip multiplies it instead of replacing it. */
function baseOpacity(style: StyleProp<ViewStyle>): number {
  const o = StyleSheet.flatten(style)?.opacity;
  return typeof o === 'number' ? o : 1;
}

// Keys that place a control in its parent. `Press` and `Pick` put these on
// their Pressable — the flex item, and the hit area — and the rest on the
// animated view that gives under the finger. With everything on the inner
// view, a `width: '33%'` resolved against a Pressable shrunk to its text
// (Profile's spec grid collapsed), and an `alignSelf` left the hit area as
// wide as the row (a tap beside "Cancel booking" opened it) — sweeps 4–5.
const PLACEMENT = new Set<string>([
  'alignSelf',
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'width',
  'minWidth',
  'maxWidth',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginHorizontal',
  'marginVertical',
  'position',
  'top',
  'bottom',
  'left',
  'right',
  'zIndex',
]);
function splitPlacement(style: StyleProp<ViewStyle>): { outer: ViewStyle; inner: ViewStyle } {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) (PLACEMENT.has(k) ? outer : inner)[k] = v;
  return { outer: outer as ViewStyle, inner: inner as ViewStyle };
}

/* ───── the two vocabularies ───── */

/** An effect — colour, opacity, a text rise: a MOTION duration on the
 *  standard curve. Under Reduce Motion it halves; it is never skipped. */
export function effect(to: number, reduceMotion: boolean, duration: number = MOTION.quick) {
  'worklet';
  return withTiming(to, {
    duration: reduceMotion ? duration / 2 : duration,
    easing: EASE,
    reduceMotion: ReduceMotion.Never,
  });
}

/** Spatial motion — a spring. Under Reduce Motion the value jumps. */
export function spatial(
  to: number,
  reduceMotion: boolean,
  config: { duration: number; dampingRatio: number } = SPRING.spatial,
) {
  'worklet';
  return reduceMotion ? to : withSpring(to, { ...config, reduceMotion: ReduceMotion.Never });
}

/** The glide every row in a changing list shares: a seat filling, a filter
 *  narrowing, a section arriving late. Put it on each sibling's `layout`. */
export const ROW_LAYOUT = LinearTransition.springify(SPRING.spatial.duration).dampingRatio(
  SPRING.spatial.dampingRatio,
);

/* ───── Press — Go ───── */
// Press feedback for anything that opens something: cards, rows, links. The
// thing gives under the finger on the press spring and comes back on it; no
// haptic (Go is silent — the push or the sheet is the answer). Replaces the
// inline `opacity: pressed ? x : 1` snaps screens hand-roll.
// Reduce Motion: no transform; the press reads through an opacity dip.
export interface PressProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** 'card' (default) gives to 0.985 — cards and rows; 'control' to 0.97 —
   *  small tiles and text links. */
  feel?: 'card' | 'control';
  /** Explicit pressed scale; overrides `feel`. */
  scale?: number;
  /** Styles for the animated container — put the card's visuals here. */
  style?: StyleProp<ViewStyle>;
  hitSlop?: number | Insets;
  accessibilityRole?: 'button' | 'link';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** false lets a screen reader read what is inside instead of one button
   *  (the player card, which a separate button turns). */
  accessible?: boolean;
  testID?: string;
  /** Measured on the animated container. */
  onLayout?: (e: LayoutChangeEvent) => void;
}
export function Press({
  children,
  onPress,
  onLongPress,
  disabled,
  feel = 'card',
  scale,
  style,
  hitSlop,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityHint,
  accessible,
  testID,
  onLayout,
}: PressProps) {
  const reduceMotion = useReduceMotion();
  const to = scale ?? (feel === 'control' ? 0.97 : 0.985);
  const down = useSharedValue(0);
  // The animated style owns `opacity`, so a caller's own (a dimmed past row)
  // is multiplied in rather than overridden.
  const base = baseOpacity(style);
  const { outer, inner } = splitPlacement(style);
  // Same keys either way, so a Reduce Motion toggle never strands a transform.
  const animated = useAnimatedStyle(() => ({
    opacity: base * (reduceMotion ? 1 - 0.1 * down.value : 1),
    transform: [{ scale: reduceMotion ? 1 : 1 - (1 - to) * down.value }],
  }));
  const set = (v: 0 | 1) => {
    down.value = reduceMotion ? effect(v, true, MOTION.instant) : withSpring(v, SPRING.press);
  };
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      disabled={disabled}
      onPressIn={disabled ? undefined : () => set(1)}
      onPressOut={disabled ? undefined : () => set(0)}
      hitSlop={hitSlop}
      accessible={accessible}
      accessibilityRole={accessible === false ? undefined : accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={disabled ? { disabled: true } : undefined}
      testID={testID}
      style={outer}
    >
      <Animated.View onLayout={onLayout} style={[inner, animated]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/** The 09-01 name for `Press`. Kept so existing call sites read the same;
 *  new code says `Press`. */
export const PressScale = Press;
export type PressScaleProps = PressProps;

/* ───── Pick — a choice made in place ───── */
// Chips, filter pills, day tiles, slot tiles, steppers. Gives under the finger
// (0.96 on the press spring), plays `selection` when the choice changes, and
// cross-fades its fill and border on the UI thread (an effect, MOTION.instant
// — halved, not dropped, under Reduce Motion). A `PickLabel` inside it fades
// its text colour on the same clock, so label and fill never disagree.
const PickProgress = createContext<SharedValue<number> | null>(null);

export interface PickProps {
  children: React.ReactNode;
  selected: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** Background, unselected → selected. */
  fill?: { off: string; on: string };
  /** Border colour, unselected → selected. */
  border?: { off: string; on: string };
  /** No `selection` haptic — for a parent that plays its own. */
  silent?: boolean;
  style?: StyleProp<ViewStyle>;
  hitSlop?: number | Insets;
  accessibilityRole?: 'button' | 'tab' | 'radio' | 'checkbox';
  accessibilityLabel?: string;
  testID?: string;
}
export function Pick({
  children,
  selected,
  onPress,
  disabled,
  fill,
  border,
  silent,
  style,
  hitSlop,
  accessibilityRole = 'button',
  accessibilityLabel,
  testID,
}: PickProps) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(selected ? 1 : 0);
  const down = useSharedValue(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    progress.value = effect(selected ? 1 : 0, reduceMotion, MOTION.instant);
  }, [selected, reduceMotion, progress]);

  const base = baseOpacity(style);
  const { outer, inner } = splitPlacement(style);
  const animated = useAnimatedStyle(() => {
    const s: ViewStyle = {};
    if (fill) s.backgroundColor = interpolateColor(progress.value, [0, 1], [fill.off, fill.on]);
    if (border) s.borderColor = interpolateColor(progress.value, [0, 1], [border.off, border.on]);
    s.opacity = base * (reduceMotion ? 1 - 0.1 * down.value : 1);
    s.transform = [{ scale: reduceMotion ? 1 : 1 - 0.04 * down.value }];
    return s;
  });
  const set = (v: 0 | 1) => {
    down.value = reduceMotion ? effect(v, true, MOTION.instant) : withSpring(v, SPRING.press);
  };
  return (
    <Pressable
      onPress={
        disabled
          ? undefined
          : () => {
              if (!silent) haptic('selection');
              onPress?.();
            }
      }
      disabled={disabled}
      onPressIn={disabled ? undefined : () => set(1)}
      onPressOut={disabled ? undefined : () => set(0)}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled: !!disabled }}
      testID={testID}
      style={outer}
    >
      <Animated.View style={[inner, animated]}>
        <PickProgress.Provider value={progress}>{children}</PickProgress.Provider>
      </Animated.View>
    </Pressable>
  );
}

/** Text inside a `Pick` whose colour follows the pick's fill. Outside a Pick
 *  it simply shows `off`. */
export function PickLabel({
  children,
  on,
  off,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  on: string;
  off: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const fallback = useSharedValue(0);
  const progress = useContext(PickProgress) ?? fallback;
  const animated = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [off, on]),
  }));
  return (
    <Animated.Text numberOfLines={numberOfLines} style={[style, animated]}>
      {children}
    </Animated.Text>
  );
}

/* ───── RiseIn — the first screenful arriving ───── */
// Fade + rise on mount, staggered, first `animateFirst` items only so a long
// list doesn't ripple forever. A text-and-card rise is an effect: timing, not
// a spring. Settled values (motion-v2 slice 4, carried into v3 slice 1): 14 px,
// MOTION.quick, 40 ms stagger — six cards land by 400 ms. Mount-only: a
// Reduce Motion toggle mid-screen doesn't replay it.
export interface RiseInProps {
  children: React.ReactNode;
  /** Position in a staggered group; 0 for a lone element. */
  index?: number;
  /** Items at index >= this render already settled. */
  animateFirst?: number;
  /** Per-index stagger in ms. */
  stagger?: number;
  /** Rise distance in px. */
  distance?: number;
}
export function RiseIn({
  children,
  index = 0,
  animateFirst = 6,
  stagger = 40,
  distance = 14,
}: RiseInProps) {
  const animate = index < animateFirst;
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) return;
    progress.value = withDelay(index * stagger, effect(1, reduceMotion, MOTION.quick));
    // Mount-only on purpose (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduceMotion ? 0 : (1 - progress.value) * distance }],
  }));
  return <Animated.View style={animated}>{children}</Animated.View>;
}

/* ───── Tally — a number that changes ───── */
// Prices, totals, "7 / 10", seats left. The new value arrives the way the
// number moved — up rises in from 6 px below, down drops in from above — while
// the old one fades where it stood: MOTION.quick, an effect. (The old one
// can't travel: a leaving element keeps the props of its last render, so it
// cannot know which way the next value went.)
// Direction is read from the digits when both values have them; pass
// `direction` when it isn't (a label, a date). The first render never animates.
// Reduce Motion: a cross-fade at half length, no travel.
export interface TallyProps {
  value: string | number;
  style?: StyleProp<TextStyle>;
  /** 1 = the value went up, -1 = down. Inferred from the digits if omitted. */
  direction?: 1 | -1;
  /** Which edge old and new values share while they cross. */
  align?: 'left' | 'center' | 'right';
  numberOfLines?: number;
}
function tallyNumber(text: string): number | null {
  const digits = text.replace(/[^0-9.-]/g, '');
  if (!digits) return null;
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) ? n : null;
}
function tallyIn(dy: number, duration: number) {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: dy }] },
      animations: {
        opacity: withTiming(1, { duration, easing: EASE, reduceMotion: ReduceMotion.Never }),
        transform: [{ translateY: withTiming(0, { duration, easing: EASE, reduceMotion: ReduceMotion.Never }) }],
      },
    };
  };
}
function tallyOut(duration: number) {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 1 },
      animations: { opacity: withTiming(0, { duration, easing: EASE, reduceMotion: ReduceMotion.Never }) },
    };
  };
}
export function Tally({ value, style, direction, align = 'left', numberOfLines }: TallyProps) {
  const text = String(value);
  const reduceMotion = useReduceMotion();
  const previous = useRef<string | null>(null);
  const before = previous.current;
  useEffect(() => {
    previous.current = text;
  }, [text]);

  let dir: 1 | -1 = direction ?? 1;
  if (direction == null && before != null) {
    const a = tallyNumber(before);
    const b = tallyNumber(text);
    if (a != null && b != null) dir = b < a ? -1 : 1;
  }
  const changed = before != null && before !== text;
  const dy = reduceMotion ? 0 : 6 * dir;
  const duration = reduceMotion ? MOTION.quick / 2 : MOTION.quick;
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
      }}
    >
      <Animated.Text
        key={text}
        numberOfLines={numberOfLines}
        entering={changed ? tallyIn(dy, duration) : undefined}
        exiting={tallyOut(duration)}
        style={style}
      >
        {text}
      </Animated.Text>
    </View>
  );
}

/* ───── Reveal — content that arrives or leaves ───── */
// Mount it when the content appears and unmount it when it goes: an error
// under a field, "Saved", a section that arrives after the screen, a late
// record. Arrives with a fade and an 8 px rise (MOTION.quick), leaves with a
// fade (MOTION.instant), and glides with ROW_LAYOUT when its neighbours move.
// Neighbours glide too only if they carry `layout={ROW_LAYOUT}` themselves.
// Reduce Motion: fades only, half length, no glide.
function revealIn(distance: number, reduceMotion: boolean) {
  const dy = reduceMotion ? 0 : distance;
  const duration = reduceMotion ? MOTION.quick / 2 : MOTION.quick;
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: dy }] },
      animations: {
        opacity: withTiming(1, { duration, easing: EASE, reduceMotion: ReduceMotion.Never }),
        transform: [{ translateY: withTiming(0, { duration, easing: EASE, reduceMotion: ReduceMotion.Never }) }],
      },
    };
  };
}
function revealOut(reduceMotion: boolean) {
  const duration = reduceMotion ? MOTION.instant / 2 : MOTION.instant;
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 1 },
      animations: { opacity: withTiming(0, { duration, easing: EASE, reduceMotion: ReduceMotion.Never }) },
    };
  };
}
export function Reveal({
  children,
  style,
  distance = 8,
  enter = true,
  onLayout,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Rise distance in px. */
  distance?: number;
  /** false mounts it already in place — a row in a list's first render,
   *  which arrives with the list (`useSettled`). It still leaves and glides. */
  enter?: boolean;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View
      entering={enter ? revealIn(distance, reduceMotion) : undefined}
      exiting={revealOut(reduceMotion)}
      layout={reduceMotion ? undefined : ROW_LAYOUT}
      onLayout={onLayout}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

/* ───── useSettled — a list's first render, then its changes ───── */
// A list arrives whole (a skeleton cross-fade, or RiseIn's first screenful);
// after that, a row that appears is news and should arrive as one. This is
// the switch between the two: false on the render where `ready` first turns
// true, true from the next render on, and false again whenever `ready` goes
// false (a city change sends the list back to its skeleton). Pass it as a
// row's `Reveal enter`.
export function useSettled(ready = true): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (ready !== settled) setSettled(ready);
  }, [ready, settled]);
  return ready && settled;
}
