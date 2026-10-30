// The app's two celebrations share one beat (ADR-0035, amended 2026-10-20):
// a booking confirmed, and "You're in". The ring pops, the check draws, and
// the headline rises under it. Kept in one place so the two can't drift.
//
// The ring is spatial (scale 0.6 → 1.08 → 1) and the check an SVG stroke,
// drawn through animated props on the UI thread. Reduce Motion: durations and
// delays halve, the scale drops, the check still draws — the celebration
// manages its own reduced form, so the engine must not skip it.

import { EASE, ELEV, MOTION, TOKENS, useReduceMotion } from '@ludi/ui';
import { useEffect } from 'react';
import Animated, {
  ReduceMotion,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Path, Svg } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** One beat of the celebration's clock; never skipped by the engine. */
export const celebrate = (to: number, duration: number, delay = 0) =>
  withDelay(delay, withTiming(to, { duration, easing: EASE, reduceMotion: ReduceMotion.Never }));

/** A text rise under the ring: fade + 12 px, the rise dropped under Reduce Motion. */
export function useCelebrationRise(v: SharedValue<number>, reduceMotion: boolean) {
  return useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: reduceMotion ? 0 : (1 - v.value) * 12 }],
  }));
}

/** The time scale the celebration runs at: 1, or 0.5 under Reduce Motion. */
export function useCelebrationScale(): number {
  return useReduceMotion() ? 0.5 : 1;
}

/**
 * The ring and its check. Plays once on mount. `onChecked` fires on the JS
 * thread when the check has finished drawing — the moment a haptic that
 * belongs to the check should land.
 */
export function CelebrationRing({ onChecked }: { onChecked?: () => void }) {
  const reduceMotion = useReduceMotion();
  const scale = reduceMotion ? 0.5 : 1;
  const ring = useSharedValue(0);
  const draw = useSharedValue(40);

  useEffect(() => {
    // ringPop — scale 0.6 → 1.08 → 1 over 450ms.
    ring.value = celebrate(1, MOTION.slow * scale);
    // drawCheck — dashoffset 40 → 0, 180ms delay.
    draw.value = withDelay(
      180 * scale,
      withTiming(
        0,
        { duration: MOTION.slow * scale, easing: EASE, reduceMotion: ReduceMotion.Never },
        (finished) => {
          if (finished && onChecked) runOnJS(onChecked)();
        },
      ),
    );
    // Mount-only on purpose: the celebration plays once, at the Reduce
    // Motion setting it was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ring.value,
    transform: [
      { scale: reduceMotion ? 1 : interpolate(ring.value, [0, 0.7, 1], [0.6, 1.08, 1]) },
    ],
  }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: draw.value }));

  return (
    <Animated.View
      style={[
        {
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: TOKENS.pitch,
          alignItems: 'center',
          justifyContent: 'center',
        },
        ELEV.e3,
        ringStyle,
      ]}
    >
      <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
        <AnimatedPath
          d="M5 12l5 5L20 6"
          stroke="#fff"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={40}
          animatedProps={checkProps}
        />
      </Svg>
    </Animated.View>
  );
}
