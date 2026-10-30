// The Nest — Ludi's one loading gesture.
//
// The mark assembles outside-in, gold landing last. Same seven planes, same
// 90ms stagger, everywhere: pull-to-refresh, slot fetch, checkout polling,
// Wallet pass write. Only the size changes. It is the launch screen made into
// the app's heartbeat rather than a one-off.
//
// Two states, ONE component. `progress` undefined means the loop is cycling;
// `progress` set means the planes are a gauge. The nest must never unmount
// between the two — the thing that was waiting is the thing that says yes, and
// remounting it throws that continuity away.
//
// Three sizes only. They are not arbitrary: 20 is an inline button spinner,
// 40 is pull-to-refresh, 96 is full-screen. A fourth size means the layout is
// wrong, not that the Nest needs a new option.
//
// Do NOT show this under ~1s of latency — rows should just rise. A spinner for
// a request that was never slow makes the app feel slower than it is.

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Path, Svg } from 'react-native-svg';

import { MARK_GOLD, MARK_PLANES, MARK_RAMP, planePath } from './brand';
import { EASE, Reveal, useReduceMotion } from './motion';

// 20 inline / 40 pull-to-refresh / 96 full-screen are the loader sizes, and
// the union exists so a fourth cannot be added casually. 180 is the splash —
// a different surface, not a loader, and the only exception.
export type NestSize = 20 | 40 | 96 | 180;

const STAGGER = 90;
const PLANE_IN = 280;
const CYCLE_HOLD = 620;
const PLANE_OUT = 200;

/**
 * Plane count for a side. 5-a-side uses the five-plane cut, 7-a-side the full
 * seven. 11-a-side is deliberately absent — it falls back to a numeral at the
 * call site, because inventing planes the logo does not have breaks the mark.
 */
export function planesForSide(side: 5 | 7): number {
  return side === 5 ? 5 : 7;
}

type PlaneMode = 'loop' | 'gauge' | 'still';

// One plane, on the UI thread. Each plane runs its own slice of the shared
// timeline, so the whole mark keeps the 09-01 choreography: planes land 90 ms
// apart (280 ms each), hold 620 ms once the gold is in, then clear together
// in 200 ms and go again.
function NestPlane({
  index,
  count,
  mode,
  filled,
  size,
  d,
  fill,
}: {
  index: number;
  count: number;
  mode: PlaneMode;
  /** For 'gauge' and 'still': is this plane in? */
  filled: boolean;
  size: number;
  d: string;
  fill: string;
}) {
  const v = useSharedValue(mode === 'still' && filled ? 1 : 0);
  useEffect(() => {
    cancelAnimation(v);
    if (mode === 'still') {
      v.value = filled ? 1 : 0;
      return;
    }
    if (mode === 'gauge') {
      // A join arriving should read as one plane landing, not a redraw.
      v.value = withDelay(
        index * STAGGER,
        withTiming(filled ? 1 : 0, { duration: PLANE_IN, easing: EASE }),
      );
      return;
    }
    // Loop: outside-in, gold last, then clear and go again.
    v.value = 0;
    v.value = withRepeat(
      withSequence(
        withDelay(index * STAGGER, withTiming(1, { duration: PLANE_IN, easing: EASE })),
        withDelay(
          (count - 1 - index) * STAGGER + CYCLE_HOLD,
          withTiming(0, { duration: PLANE_OUT, easing: EASE }),
        ),
      ),
      -1,
    );
    return () => cancelAnimation(v);
  }, [mode, filled, index, count, v]);

  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * 7 }, { scale: 0.93 + 0.07 * v.value }],
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width={size} height={size} viewBox="0 0 180 180">
        <Path d={d} fill={fill} />
      </Svg>
    </Animated.View>
  );
}

export function Nest({
  size = 40,
  progress,
  planeCount = MARK_PLANES.length,
  hueShift = 0,
  label = 'Loading',
}: {
  size?: NestSize;
  /** 0–1 turns the loop into a gauge. Omit for indeterminate. */
  progress?: number;
  /** Gauge denominator — the side's size, not always seven. */
  planeCount?: number;
  hueShift?: number;
  label?: string;
}) {
  const planes = MARK_PLANES.slice(0, Math.max(1, Math.min(planeCount, MARK_PLANES.length)));
  const determinate = typeof progress === 'number';
  const reduceMotion = useReduceMotion();

  // Reduce-motion: no landing, no loop. The gauge jumps to its value; the
  // indeterminate loader holds the finished mark — the same "collapse to the
  // built nest" convention the launch screen uses.
  const mode: PlaneMode = reduceMotion ? 'still' : determinate ? 'gauge' : 'loop';
  const filledCount = determinate ? Math.round((progress as number) * planes.length) : planes.length;

  return (
    <View
      style={[styles.root, { width: size, height: size }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={
        determinate ? { now: Math.round((progress as number) * 100), min: 0, max: 100 } : undefined
      }
    >
      {/* The ground plane alone, always. An empty gauge still has to read as a
       * Λ waiting to be filled rather than a broken graphic. */}
      <Svg width={size} height={size} viewBox="0 0 180 180" style={StyleSheet.absoluteFill}>
        <Path d={planePath(28, 88)} fill={MARK_RAMP[0]} opacity={0.12} />
      </Svg>

      {planes.map(([apex, half], i) => (
        <NestPlane
          key={apex}
          index={i}
          count={planes.length}
          mode={mode}
          filled={i < filledCount}
          size={size}
          d={planePath(apex, half)}
          // The innermost plane is always the gold, whatever the count —
          // never drop it, and never let a second hue into the stack.
          fill={
            hueShift
              ? (MARK_RAMP[(i + hueShift) % MARK_RAMP.length] ?? MARK_GOLD)
              : i === planes.length - 1
                ? MARK_GOLD
                : (MARK_RAMP[i] ?? MARK_GOLD)
          }
        />
      ))}
    </View>
  );
}

/**
 * A wait with no layout to promise — a link resolving, a sign-in finishing,
 * the consent check at launch. It honours the rule above: nothing for the
 * first `delay` ms (most of these waits end there), then the Nest fades in.
 * The space is held from the start, so its arrival moves nothing. Replaces
 * the full-screen ActivityIndicator (motion-v3 slice 6). A wait that DOES
 * have a layout to promise gets that screen's Skeleton instead.
 */
export function NestWait({
  size = 40,
  delay = 600,
  label,
}: {
  size?: 40 | 96;
  delay?: number;
  label?: string;
}) {
  const [shown, setShown] = useState(delay <= 0);
  useEffect(() => {
    if (delay <= 0) return;
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  if (!shown) return <View style={{ width: size, height: size }} />;
  return (
    <Reveal distance={0}>
      <Nest size={size} label={label} />
    </Reveal>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
