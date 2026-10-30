// Shared primitives — "Chalk & Aegean" pass (design handoff, 2026-08-10).
// Keep these small and composable; screens in apps/mobile compose them.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  View,
  Text,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  type DimensionValue,
  type ViewStyle,
  type TextInputProps,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  ReduceMotion,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Icon } from './icons';
import { haptic } from './haptics';
import {
  EASE,
  Pick,
  PickLabel,
  Press,
  ROW_LAYOUT,
  Reveal,
  RiseIn,
  STANDARD_EASING,
  Tally,
  effect,
  spatial,
  useReduceMotion,
} from './motion';
import { ELEV, MOTION, RADII, SPRING, TOKENS } from './tokens';

export { STANDARD_EASING };

/* ───── Chip ───── */
export interface ChipProps {
  children: React.ReactNode;
  active?: boolean;
  onPress?: () => void;
  color?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}
export function Chip({ children, active, onPress, color, size = 'md', disabled }: ChipProps) {
  // A Pick (motion.tsx): gives under the finger, plays `selection`, and
  // cross-fades fill, border and label together on the UI thread
  // (MOTION.instant — a colour fade, so Reduce Motion halves it, §3.5).
  const fill = color ?? TOKENS.ink;
  const padV = size === 'sm' ? 5 : 8;
  const padH = size === 'sm' ? 10 : 14;
  const fontSize = size === 'sm' ? 12 : 13;
  return (
    <Pick
      selected={!!active}
      onPress={onPress}
      disabled={disabled}
      fill={{ off: 'rgba(255,255,255,0)', on: fill }}
      border={{ off: TOKENS.lineBold, on: fill }}
      // sm chips are ~26pt tall — below the 44pt target; grow the hit area,
      // not the visual size.
      hitSlop={size === 'sm' ? { top: 9, bottom: 9, left: 4, right: 4 } : undefined}
      style={[
        styles.chip,
        active ? ELEV.e1 : null,
        { paddingVertical: padV, paddingHorizontal: padH, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <PickLabel
        on="#fff"
        off={TOKENS.ink}
        style={{ fontFamily: TOKENS.ui, fontSize, fontWeight: '500', letterSpacing: -0.2 }}
      >
        {children}
      </PickLabel>
    </Pick>
  );
}

/* ───── Tag ───── */
// Static state marker — soft fill, deep text, mono overline type, and a dot
// in the role's base colour. Born from a design correction (2026-08-31):
// state is never an edge stripe — the 4px rail read as decoration, not
// information. The dot is the third channel (colour, shape, type — Carbon's
// accessibility bar) and reuses the venue cards' format-dot idiom.
export interface TagProps {
  label: string;
  /** Soft variant of a role colour (e.g. TOKENS.sunSoft). */
  fill: string;
  /** Deep variant of the same role — the AA-safe text pair for the fill. */
  color: string;
  /** Base variant of the role — rendered as a 6px dot before the label. */
  dot?: string;
}
export function Tag({ label, fill, color, dot }: TagProps) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: RADII.sm,
        borderCurve: 'continuous',
        backgroundColor: fill,
      }}
    >
      {dot != null && (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
      )}
      <Text
        style={{
          fontFamily: TOKENS.monoMedium,
          fontSize: 10.5,
          color,
          textTransform: 'uppercase',
          letterSpacing: 0.84,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/* ───── Button ───── */
export interface ButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'destructive';
  full?: boolean;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  /** The label is a value that changes ("Book €45"): it rolls like a Tally
   *  instead of swapping in one frame. String labels only. */
  tally?: boolean;
}
export function Button({
  children,
  onPress,
  variant = 'primary',
  full,
  color,
  size = 'md',
  icon,
  disabled,
  loading,
  tally,
}: ButtonProps) {
  const bg =
    variant === 'primary'
      ? color ?? TOKENS.primary
      : variant === 'destructive'
        ? TOKENS.terracotta
        : TOKENS.surface;
  const fg = variant === 'secondary' ? color ?? TOKENS.ink : '#fff';
  const h = size === 'lg' ? 56 : size === 'sm' ? 36 : 48;
  const fontSize = size === 'lg' ? 17 : size === 'sm' ? 14 : 16;
  const inert = disabled || loading;

  // Press feedback — scale 0.97 on the press spring (SPRING.press, the UI
  // thread), plus the handoff's impactLight haptic. The transform lives on an
  // inner Animated.View: the Pressable's own style array stays stable, which
  // matters under the New Architecture (see the Input shadow comment below).
  // Reduce-motion: no transform; the press reads through a brief opacity dip.
  const press = useSharedValue(0);
  const reduceMotion = useReduceMotion();
  const setPressed = (down: boolean) => {
    press.value = reduceMotion
      ? effect(down ? 1 : 0, true, MOTION.instant)
      : withSpring(down ? 1 : 0, SPRING.press);
  };
  const pressStyle = useAnimatedStyle(() => ({
    opacity: disabled && !loading ? 0.4 : reduceMotion ? 1 - 0.15 * press.value : 1,
    transform: [{ scale: reduceMotion ? 1 : 1 - 0.03 * press.value }],
  }));
  return (
    <Pressable
      onPress={inert ? undefined : onPress}
      onPressIn={
        inert
          ? undefined
          : () => {
              haptic('press');
              setPressed(true);
            }
      }
      onPressOut={inert ? undefined : () => setPressed(false)}
      disabled={inert}
      style={{ width: full ? '100%' : undefined }}
    >
      <Animated.View
        style={[
          styles.button,
          variant === 'secondary' ? ELEV.e1 : ELEV.e2,
          {
            height: h,
            width: full ? '100%' : undefined,
            borderRadius: RADII.full,
            backgroundColor: bg,
            borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth : 0,
            borderColor: TOKENS.line,
          },
          pressStyle,
        ]}
      >
        {/* Loading replaces the label but keeps the button's footprint — the
            children stay mounted at opacity 0 so the width never jumps. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', opacity: loading ? 0 : 1 }}>
          {icon}
          {tally && typeof children === 'string' ? (
            <View style={{ marginLeft: icon ? 8 : 0 }}>
              <Tally
                value={children}
                style={{ color: fg, fontFamily: TOKENS.ui, fontSize, fontWeight: '600', letterSpacing: -0.3 }}
              />
            </View>
          ) : (
            <Text
              style={{
                color: fg,
                fontFamily: TOKENS.ui,
                fontSize,
                fontWeight: '600',
                letterSpacing: -0.3,
                marginLeft: icon ? 8 : 0,
              }}
            >
              {children}
            </Text>
          )}
        </View>
        {loading && (
          <View style={StyleSheet.absoluteFill}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={fg} />
            </View>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

/* ───── Card ───── */
// The missing elevation primitive: surface + radius + shadow + hairline.
// Depth comes from shadow only — never a second background fill.
export interface CardProps {
  children: React.ReactNode;
  elevation?: keyof typeof ELEV;
  radius?: keyof typeof RADII;
  padded?: boolean | number;
  color?: string;
  style?: ViewStyle;
}
export function Card({
  children,
  elevation = 'e1',
  radius = 'lg',
  padded = false,
  color,
  style,
}: CardProps) {
  const padding = padded === true ? 16 : padded === false ? 0 : padded;
  return (
    <View
      style={[
        {
          backgroundColor: color ?? TOKENS.surface,
          borderRadius: RADII[radius],
          borderCurve: 'continuous',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: TOKENS.line,
          padding,
          overflow: 'visible',
        },
        ELEV[elevation],
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* ───── SegmentedControl ───── */
export interface Segment<V extends string> {
  value: V;
  label: string;
  count?: number;
}
export interface SegmentedControlProps<V extends string> {
  segments: Array<Segment<V>>;
  value: V;
  onChange: (v: V) => void;
}
export function SegmentedControl<V extends string>({
  segments,
  value,
  onChange,
}: SegmentedControlProps<V>) {
  // Sliding thumb — the surface pill glides to the selected segment on the
  // spatial spring (it moves in space; ADR-0035) instead of teleporting.
  // Segments are equal-width (flex: 1), so the thumb's offset is index ×
  // measured width. Reduce-motion: the thumb jumps — position is the signal,
  // so there is no opacity-only equivalent worth faking.
  const index = Math.max(
    0,
    segments.findIndex((s) => s.value === value),
  );
  const [segmentWidth, setSegmentWidth] = useState(0);
  const thumbX = useSharedValue(0);
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (segmentWidth === 0) return;
    thumbX.value = spatial(index * segmentWidth, reduceMotion);
  }, [index, segmentWidth, thumbX, reduceMotion]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: thumbX.value }] }));

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: 'rgba(16,24,28,0.06)',
        borderRadius: RADII.full,
        padding: 4,
      }}
      onLayout={(e) => {
        const inner = e.nativeEvent.layout.width - 8; // minus the 4px padding
        const w = segments.length > 0 ? inner / segments.length : 0;
        setSegmentWidth(w);
        cancelAnimation(thumbX);
        thumbX.value = index * w; // settle without animating on first layout
      }}
    >
      {segmentWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 4,
              bottom: 4,
              left: 4,
              width: segmentWidth,
              borderRadius: RADII.full,
              backgroundColor: TOKENS.surface,
            },
            ELEV.e1,
            thumbStyle,
          ]}
        />
      )}
      {segments.map((s) => {
        const selected = s.value === value;
        return (
          <Pressable
            key={s.value}
            onPress={() => {
              if (!selected) haptic('selection');
              onChange(s.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={{
              flex: 1,
              paddingVertical: 9,
              borderRadius: RADII.full,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Text
              style={{
                fontFamily: TOKENS.ui,
                fontSize: 14,
                fontWeight: '600',
                color: selected ? TOKENS.ink : TOKENS.ink3,
              }}
            >
              {s.label}
            </Text>
            {s.count !== undefined && s.count > 0 && (
              <Text style={{ fontFamily: TOKENS.mono, fontSize: 12, color: TOKENS.ink3 }}>
                {s.count}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/* ───── EmptyState ───── */
// One component for every empty screen — replaces the bare grey sentences.
export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}
export function EmptyState({ icon, title, body, action, secondary }: EmptyStateProps) {
  // Gentle fade + 8px rise on mount — the empty state is usually the whole
  // screen, and arriving softly reads as intentional rather than as a failed
  // load. Reduce-motion aware via RiseIn.
  return (
    <RiseIn distance={8}>
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 8 }}>
      {icon && (
        <View
          style={[
            {
              width: 96,
              height: 96,
              borderRadius: RADII.xl,
              borderCurve: 'continuous',
              backgroundColor: TOKENS.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: TOKENS.line,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 8,
            },
            ELEV.e2,
          ]}
        >
          {icon}
        </View>
      )}
      <Text
        style={{
          fontFamily: TOKENS.displaySemi,
          fontSize: 22,
          color: TOKENS.ink,
          textAlign: 'center',
          letterSpacing: -0.3,
        }}
      >
        {title}
      </Text>
      {body && (
        <Text
          style={{
            fontFamily: TOKENS.ui,
            fontSize: 14,
            color: TOKENS.ink2,
            textAlign: 'center',
            lineHeight: 21,
          }}
        >
          {body}
        </Text>
      )}
      {action && (
        <View style={{ marginTop: 12, alignSelf: 'stretch' }}>
          <Button full onPress={action.onPress}>
            {action.label}
          </Button>
        </View>
      )}
      {secondary && (
        <Press feel="control" onPress={secondary.onPress} style={{ marginTop: 4, padding: 8 }}>
          <Text
            style={{ fontFamily: TOKENS.ui, fontSize: 14, fontWeight: '600', color: TOKENS.primaryDeep }}
          >
            {secondary.label}
          </Text>
        </Press>
      )}
    </View>
    </RiseIn>
  );
}

/* ───── Skeleton ───── */
// Loading placeholder: the shape of what is coming, with a slow light passing
// over it left to right (motion-v3 slice 6 — NN/g on skeletons; Chung: a wave
// reads as progress where a pulse reads as a blink, and slow beats fast).
// 1.1 s across, 0.3 s rest, on the UI thread; the light is a react-native-svg
// gradient band. Every block moves its band the same distance — the window's
// width — so the light crosses a card's image and its bars at one speed, in
// step. Reduce Motion: no light; the blocks hold their tone, still (loops stop
// dead, the site's rule).
const SWEEP_MS = 1100;
const SWEEP_REST_MS = 300;
const BAND_W = 160;
const BONE = 'rgba(16,24,28,0.09)';
const BONE_SOFT = 'rgba(16,24,28,0.06)';

// The one clock a Skeleton's blocks share; null when the light is off.
const SkeletonClock = React.createContext<SharedValue<number> | null>(null);

export interface SkeletonProps {
  variant?: 'card' | 'row' | 'tile' | 'block';
  /** 'block' only — the shape it stands in for (a field, the player card). */
  width?: DimensionValue;
  height?: number;
  radius?: number;
}
export function Skeleton({ variant = 'row', width, height, radius }: SkeletonProps) {
  const sweep = useSharedValue(0);
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(sweep);
      sweep.value = 0;
      return;
    }
    sweep.value = 0;
    sweep.value = withRepeat(
      withSequence(
        withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.quad) }),
        withDelay(SWEEP_REST_MS, withTiming(0, { duration: 0 })),
      ),
      -1,
    );
    return () => cancelAnimation(sweep);
  }, [sweep, reduceMotion]);

  let body: React.ReactNode;
  if (variant === 'card') {
    body = (
      <View
        style={[
          {
            backgroundColor: TOKENS.surface,
            borderRadius: RADII.lg,
            borderCurve: 'continuous',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: TOKENS.line,
            overflow: 'hidden',
          },
          ELEV.e1,
        ]}
      >
        <Bone style={{ height: 170, backgroundColor: BONE_SOFT }} />
        <View style={{ padding: 16, gap: 10 }}>
          <Bone style={bar(18, '55%')} />
          <Bone style={bar(11, '40%')} />
        </View>
      </View>
    );
  } else if (variant === 'tile') {
    body = (
      <Bone
        style={{
          height: 44,
          width: 79,
          borderRadius: RADII.md,
          borderCurve: 'continuous',
          backgroundColor: BONE_SOFT,
        }}
      />
    );
  } else if (variant === 'block') {
    body = (
      <Bone
        style={{
          height: height ?? 56,
          width: width ?? '100%',
          borderRadius: radius ?? RADII.md,
          borderCurve: 'continuous',
          backgroundColor: BONE_SOFT,
        }}
      />
    );
  } else {
    body = (
      <View style={{ gap: 10, paddingVertical: 6 }}>
        <Bone style={bar(18, '70%')} />
        <Bone style={bar(11, '45%')} />
      </View>
    );
  }
  return <SkeletonClock.Provider value={reduceMotion ? null : sweep}>{body}</SkeletonClock.Provider>;
}

function bar(h: number, w: DimensionValue): ViewStyle {
  return {
    height: h,
    width: w,
    borderRadius: RADII.sm,
    borderCurve: 'continuous',
    backgroundColor: BONE,
  };
}

/** One placeholder block, clipping the light that crosses it. */
function Bone({ style }: { style: ViewStyle }) {
  return (
    <View style={[style, { overflow: 'hidden' }]}>
      <SkeletonLight />
    </View>
  );
}

let lightIds = 0;
function SkeletonLight() {
  const sweep = React.useContext(SkeletonClock);
  const { width } = useWindowDimensions();
  const id = React.useRef(`skeleton-light-${++lightIds}`).current;
  const travel = width + BAND_W;
  const moving = useAnimatedStyle(() => ({
    transform: [{ translateX: sweep ? -BAND_W + sweep.value * travel : -BAND_W }],
  }));
  if (!sweep) return null;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: BAND_W }, moving]}>
      <Svg width={BAND_W} height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={BAND_W} height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/* ───── PriceSummary ───── */
// The €35→€43 mitigation: base + chosen addons → total, always expanded,
// never behind a disclosure. Shown before payment, not after.
export interface PriceLine {
  /** Stable identity, so a line that comes and goes (an add-on) arrives and
   *  leaves instead of every line below it re-keying. Falls back to index. */
  id?: string;
  label: string;
  qualifier?: string; // e.g. "required" — Mono 10 uppercase ink3
  amountCents: number;
}
export interface PriceSummaryProps {
  lines: PriceLine[];
  totalLabel: string;
  totalCents: number;
}
function eur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}
// Lines arrive and leave as the add-ons change (fade + rise in, fade out, the
// rest glide on ROW_LAYOUT), and every amount and the total roll as Tallies
// (plans/motion-v3.md, Count). The first render never animates.
const lineIn = (reduceMotion: boolean) => () => {
  'worklet';
  const duration = reduceMotion ? MOTION.quick / 2 : MOTION.quick;
  return {
    initialValues: { opacity: 0, transform: [{ translateY: reduceMotion ? 0 : 6 }] },
    animations: {
      opacity: withTiming(1, { duration, easing: EASE, reduceMotion: ReduceMotion.Never }),
      transform: [{ translateY: withTiming(0, { duration, easing: EASE, reduceMotion: ReduceMotion.Never }) }],
    },
  };
};
const lineOut = (reduceMotion: boolean) => () => {
  'worklet';
  return {
    initialValues: { opacity: 1 },
    animations: {
      opacity: withTiming(0, {
        duration: reduceMotion ? MOTION.instant / 2 : MOTION.instant,
        easing: EASE,
        reduceMotion: ReduceMotion.Never,
      }),
    },
  };
};

export function PriceSummary({ lines, totalLabel, totalCents }: PriceSummaryProps) {
  const reduceMotion = useReduceMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <View style={{ gap: 8 }}>
      {lines.map((l, i) => (
        <Animated.View
          key={l.id ?? i}
          entering={mounted ? lineIn(reduceMotion) : undefined}
          exiting={lineOut(reduceMotion)}
          layout={reduceMotion ? undefined : ROW_LAYOUT}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, color: TOKENS.ink2 }} numberOfLines={1}>
              {l.label}
            </Text>
            {l.qualifier && (
              <Text
                style={{
                  fontFamily: TOKENS.mono,
                  fontSize: 10,
                  color: TOKENS.ink3,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {l.qualifier}
              </Text>
            )}
          </View>
          <Tally
            value={eur(l.amountCents)}
            align="right"
            style={{ fontFamily: TOKENS.mono, fontSize: 13, color: TOKENS.ink }}
          />
        </Animated.View>
      ))}
      <Animated.View
        layout={reduceMotion ? undefined : ROW_LAYOUT}
        style={{ height: 1, backgroundColor: TOKENS.line, marginVertical: 2 }}
      />
      <Animated.View
        layout={reduceMotion ? undefined : ROW_LAYOUT}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, fontWeight: '600', color: TOKENS.ink }}>
          {totalLabel}
        </Text>
        <Tally
          value={eur(totalCents)}
          align="right"
          style={{ fontFamily: TOKENS.displaySemi, fontSize: 22, color: TOKENS.ink }}
        />
      </Animated.View>
    </View>
  );
}

/* ───── Avatar ───── */
export interface AvatarProps {
  color: string;
  initial?: string;
  size?: number;
  ring?: string;
  borderColor?: string;
  borderWidth?: number;
  image?: string; // uri — photos land with the Player Card work
}
export function Avatar({
  color,
  initial = '',
  size = 28,
  ring,
  borderColor,
  borderWidth,
  image,
}: AvatarProps) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
          borderColor,
          borderWidth,
        },
        ring ? { borderColor: ring, borderWidth: 2 } : null,
      ]}
    >
      {image ? (
        <Image source={{ uri: image }} style={{ width: size, height: size }} />
      ) : (
        <Text
          style={{
            color: '#fff',
            fontFamily: TOKENS.ui,
            fontWeight: '700',
            fontSize: size * 0.4,
            letterSpacing: -0.5,
          }}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}

/* ───── LevelBars ───── */
export interface LevelBarsProps {
  level: number;
  max?: number;
  size?: 'sm' | 'md';
}
export function LevelBars({ level, max = 5, size = 'md' }: LevelBarsProps) {
  const w = size === 'sm' ? 3 : 4;
  const baseH = size === 'sm' ? 10 : 14;
  return (
    <View style={{ flexDirection: 'row', gap: 2, alignItems: 'flex-end' }}>
      {Array.from({ length: max }).map((_, i) => (
        <LevelBar key={i} on={i < level} width={w} height={baseH * (0.5 + i * 0.15)} />
      ))}
    </View>
  );
}

// One bar. A level picked is seen to rise: the fill grows up from the base on
// the spatial spring (plans/motion-v3.md, Count); a bar switched off sinks.
// The first render is still. Reduce Motion: the fill fades at half length.
function LevelBar({ on, width, height }: { on: boolean; width: number; height: number }) {
  const reduceMotion = useReduceMotion();
  const fill = useSharedValue(on ? 1 : 0);
  const first = React.useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    fill.value = reduceMotion
      ? effect(on ? 1 : 0, true, MOTION.instant)
      : withSpring(on ? 1 : 0, { ...SPRING.spatial, reduceMotion: ReduceMotion.Never });
  }, [on, reduceMotion, fill]);
  // Same keys in both branches, so a Reduce Motion flip never strands a scale.
  const fillStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? fill.value : 1,
    transform: [{ scaleY: reduceMotion ? 1 : Math.max(0, fill.value) }],
  }));
  return (
    <View style={{ width, height, borderRadius: 1, backgroundColor: TOKENS.lineBold, overflow: 'hidden' }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: TOKENS.pitch, transformOrigin: 'bottom' },
          fillStyle,
        ]}
      />
    </View>
  );
}

/* ───── Rating ───── */
export interface RatingProps {
  value: number;
  reviews?: number;
  size?: 'sm' | 'md';
}
export function Rating({ value, reviews, size = 'md' }: RatingProps) {
  const fontSize = size === 'sm' ? 12 : 13;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {Icon.star(TOKENS.sun, size === 'sm' ? 12 : 14)}
      <Text style={{ fontFamily: TOKENS.ui, fontSize, fontWeight: '600', color: TOKENS.ink }}>{value}</Text>
      {reviews !== undefined && (
        <Text style={{ fontFamily: TOKENS.ui, fontSize, color: TOKENS.ink3 }}>({reviews})</Text>
      )}
    </View>
  );
}

/* ───── Input ───── */
export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  prefix?: string;
}
export function Input({ label, error, prefix, ...textInputProps }: InputProps) {
  // Focus state (previously absent — a focused field was identical to idle).
  // Border: lineBold idle → primary when focused or filled → terraDeep error.
  // Error uses the deep variant so an error on a *focused* field stays
  // distinguishable, and because terracotta at text size fails AA.
  const [focused, setFocused] = useState(false);
  const filled = !!textInputProps.value && String(textInputProps.value).length > 0;
  const borderColor = error
    ? TOKENS.terraDeep
    : focused || filled
      ? TOKENS.primary
      : TOKENS.lineBold;
  return (
    <View style={{ width: '100%' }}>
      {label ? (
        <Text
          style={{
            fontFamily: TOKENS.monoMedium,
            fontSize: 10.5,
            color: TOKENS.ink2,
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: 0.84,
          }}
        >
          {label}
        </Text>
      ) : null}
      {/*
        The shadow is ALWAYS in the style array and only its opacity changes.
        Do not "simplify" this back to `focused ? ELEV.e1 : null` — that
        toggles a style object in and out of the array, which under the New
        Architecture (newArchEnabled in app.json) recreates the native view on
        focus and drops first-responder from the TextInput inside it. The
        symptom is the keyboard appearing and instantly dismissing, on every
        screen that uses this component, which made sign-in impossible.
        Diagnosed on the simulator 2026-08-21 after two wrong guesses.
      */}
      <View style={[styles.inputRow, ELEV.e1, { borderColor, shadowOpacity: focused ? 0.06 : 0 }]}>
        {prefix ? (
          <>
            <Text
              style={{
                fontFamily: TOKENS.mono,
                fontSize: 16,
                color: TOKENS.ink3,
                marginRight: 8,
              }}
            >
              {prefix}
            </Text>
            <View style={{ width: 1, height: 22, backgroundColor: TOKENS.line, marginRight: 8 }} />
          </>
        ) : null}
        <TextInput
          {...textInputProps}
          onFocus={(e) => {
            setFocused(true);
            textInputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            textInputProps.onBlur?.(e);
          }}
          placeholderTextColor={TOKENS.ink3}
          style={{
            flex: 1,
            fontFamily: prefix ? TOKENS.mono : TOKENS.ui,
            fontSize: prefix ? 18 : 17,
            color: TOKENS.ink,
            letterSpacing: prefix ? 1 : -0.3,
            padding: 0,
          }}
        />
      </View>
      {/* A Fail (plans/motion-v3.md): the error arrives and leaves as a
          Reveal instead of mounting in one frame; keyed, so a new message
          arrives as news. Callers glide what sits under the field. */}
      {error ? (
        <Reveal key={error}>
          <Text
            style={{
              fontFamily: TOKENS.ui,
              fontSize: 13,
              color: TOKENS.terraDeep,
              marginTop: 6,
              letterSpacing: -0.2,
            }}
          >
            {error}
          </Text>
        </Reveal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 100,
    borderWidth: 1,
    alignSelf: 'flex-start',
  } satisfies ViewStyle,
  button: {
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  } satisfies ViewStyle,
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 58,
    borderWidth: 1.5,
    borderRadius: 14,
    borderCurve: 'continuous',
    paddingHorizontal: 18,
    backgroundColor: TOKENS.surface,
  } satisfies ViewStyle,
});
