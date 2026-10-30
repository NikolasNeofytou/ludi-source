// Launch screen — "the nest is the loader".
//
// One gesture: the tunnel assembles from the outside and the daylight arrives
// last. Reads as walking in.
//
// Three things happen, in order:
//   1. Planes land outside-in, one every LAND_STAGGER ms.
//   2. The ramp rotates — each plane takes the next hue every HUE_STEP ms, so
//      the gradient (and the gold with it) travels up through the nest.
//   3. Four Λ rings cross the display, expanding out of the mark.
//
// The gold is the only plane that never leaves the stack: on static surfaces it
// sits innermost as the last player in, and the launch is the one place it
// travels.
//
// Under reduce-motion the whole thing collapses to the finished mark, held for
// a beat — not a slowed-down version. Matches the convention in
// booking/[id]/confirmed.tsx.

import {
  LudiWordmark,
  MARK_GOLD,
  MARK_GROUND,
  MARK_PLANES,
  MARK_RAMP,
  Nest,
  STANDARD_EASING,
  planePath,
} from '@ludi/ui';
import type { NestSize } from '@ludi/ui';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { Path, Svg } from 'react-native-svg';

const LAND_STAGGER = 90;
const LAND_DURATION = 280; // MOTION.standard
const HUE_STEP = 360;
const RING_COUNT = 4;
const RING_DURATION = 1600;

/** The app's standard curve — declared once, in @ludi/ui's tokens. */
const STANDARD = STANDARD_EASING;

export function LudiLaunch({ size = 180, onFinish }: { size?: NestSize; onFinish?: () => void }) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [hueOffset, setHueOffset] = useState(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => setReduceMotion(false));
  }, []);

  // The Nest owns the planes and their landing; only the rings drive from here.
  const rings = useRef(Array.from({ length: RING_COUNT }, () => new Animated.Value(0))).current;
  const word = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion === null) return;

    if (reduceMotion) {
      word.setValue(1);
      const timer = setTimeout(() => onFinish?.(), 600);
      return () => clearTimeout(timer);
    }

    const ringLoops = rings.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * (RING_DURATION / RING_COUNT)),
          Animated.timing(value, {
            toValue: 1,
            duration: RING_DURATION,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    ringLoops.forEach((loop) => loop.start());

    // The logotype arrives on the beat the gold lands — the side is full.
    Animated.timing(word, {
      toValue: 1,
      delay: MARK_PLANES.length * LAND_STAGGER,
      duration: LAND_DURATION,
      easing: STANDARD,
      useNativeDriver: true,
    }).start();

    const landedAt = MARK_PLANES.length * LAND_STAGGER + LAND_DURATION;
    const hueTimer = setInterval(() => setHueOffset((n) => n + 1), HUE_STEP);
    const done = setTimeout(() => onFinish?.(), landedAt + HUE_STEP * MARK_RAMP.length);

    return () => {
      ringLoops.forEach((loop) => loop.stop());
      clearInterval(hueTimer);
      clearTimeout(done);
    };
  }, [reduceMotion, rings, word, onFinish]);

  if (reduceMotion === null) {
    return <View style={[styles.root, { width: size, height: size }]} />;
  }

  return (
    <View style={styles.stack}>
      <View style={[styles.root, { width: size, height: size }]}>
        <Svg width={size} height={size} viewBox="0 0 180 180" style={StyleSheet.absoluteFill}>
          <Path d="M0 0 H180 V180 H0 Z" fill={MARK_GROUND} />
        </Svg>

        <Nest size={size} progress={1} hueShift={reduceMotion ? 0 : hueOffset} label="Ludi" />

        {!reduceMotion &&
          rings.map((value, i) => (
            <Animated.View
              key={`ring-${i}`}
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  opacity: value.interpolate({
                    inputRange: [0, 0.7, 1],
                    outputRange: [0.5, 0.14, 0],
                  }),
                  transform: [
                    { scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 4.6] }) },
                  ],
                },
              ]}
            >
              {/* Strokes belong to the radiating rings only — that is what makes
                them read as leaving the icon rather than outlining it. */}
              <Svg width={size} height={size} viewBox="0 0 180 180">
                <Path
                  d={planePath(28, 88)}
                  fill="none"
                  stroke={MARK_GOLD}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
              </Svg>
            </Animated.View>
          ))}
      </View>

      <Animated.View style={{ opacity: word, marginTop: 24 }}>
        <LudiWordmark height={30} onDark />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    // Deliberately NOT `overflow: 'hidden'` — the radiating rings scale past
    // this box on their way across the display. Clipping here cropped them to
    // the nest and they read as a flicker inside the mark instead.
  },
});
