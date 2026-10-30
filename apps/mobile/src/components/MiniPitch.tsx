// MiniPitch — where a player stands, drawn on a pitch (plans/player-card-v2.md).
//
// Ten spots, one per position code. The primary position (positions[0]) is a
// chalk disc with its code and two echo rings in the faction's on-dark tint —
// the second place the faction hue may appear, and only as rings. Other
// positions they play are outlined discs; the rest are bare dots, so the
// shape of the team is always there to read the lit spots against.
//
// `dark` is the card back (133 × 216 on HERO_PANEL); `light` is the small
// seat-sheet version (56 × 74 on chalk), which drops the codes.

import { TOKENS } from '@ludi/ui';
import { Text, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { HERO_PANEL, ON_HERO } from '@/components/factions';

// Spot centres as fractions of the pitch, attack at the top.
const SPOTS: Record<string, readonly [number, number]> = {
  GK: [0.5, 0.9],
  CB: [0.5, 0.77],
  LB: [0.13, 0.7],
  RB: [0.87, 0.7],
  CDM: [0.5, 0.61],
  CM: [0.5, 0.47],
  CAM: [0.5, 0.33],
  LW: [0.15, 0.22],
  RW: [0.85, 0.22],
  ST: [0.5, 0.09],
};

const DARK_W = 133;
const DARK_H = 216;
const LIGHT_W = 56;
const LIGHT_H = 74;

export function MiniPitch({
  positions,
  ringColor,
  label,
  variant = 'dark',
  width,
}: {
  positions: string[];
  /** Dark: the faction's on-dark tint for the echo rings. Light: the faction hue. */
  ringColor: string;
  /** The pitch is one image to a screen reader — "Plays ST, RW". */
  label: string;
  variant?: 'dark' | 'light';
  width?: number;
}) {
  const primary = positions[0] ?? null;
  const others = positions.slice(1);
  const stateOf = (code: string) => (code === primary ? 'primary' : others.includes(code) ? 'secondary' : 'off');

  if (variant === 'light') {
    const w = width ?? LIGHT_W;
    const line = 'rgba(16,24,28,0.16)';
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ flexShrink: 0 }}>
        <Svg width={w} height={(w * LIGHT_H) / LIGHT_W} viewBox={`0 0 ${LIGHT_W} ${LIGHT_H}`}>
          <Rect x={0.75} y={0.75} width={54.5} height={72.5} rx={5} fill={TOKENS.bg} stroke={line} strokeWidth={1} />
          <Path d="M1 37 H55" stroke={line} strokeWidth={1} />
          <Circle cx={28} cy={37} r={7} fill="none" stroke={line} strokeWidth={1} />
          <Rect x={16} y={0.75} width={24} height={10} fill="none" stroke={line} strokeWidth={1} />
          <Rect x={16} y={63.25} width={24} height={10} fill="none" stroke={line} strokeWidth={1} />
          {Object.entries(SPOTS).map(([code, [fx, fy]]) => {
            const cx = fx * LIGHT_W;
            const cy = fy * LIGHT_H;
            const state = stateOf(code);
            if (state === 'primary') return <Circle key={code} cx={cx} cy={cy} r={5} fill={ringColor} />;
            if (state === 'secondary') {
              return <Circle key={code} cx={cx} cy={cy} r={3.6} fill="#FFFFFF" stroke={ringColor} strokeWidth={1.6} />;
            }
            return <Circle key={code} cx={cx} cy={cy} r={1.8} fill="rgba(16,24,28,0.28)" />;
          })}
        </Svg>
      </View>
    );
  }

  const w = width ?? DARK_W;
  const s = w / DARK_W;
  const h = DARK_H * s;
  const chalkLine = 'rgba(251,248,240,0.2)';
  const primarySpot = primary ? SPOTS[primary] : undefined;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: w, height: h, alignSelf: 'center' }}
    >
      <Svg width={w} height={h} viewBox={`0 0 ${DARK_W} ${DARK_H}`} style={{ position: 'absolute' }}>
        {/* mowing stripes */}
        {[0, 54, 108, 162].map((y) => (
          <Rect key={y} x={0} y={y} width={DARK_W} height={27} fill="rgba(251,248,240,0.03)" />
        ))}
        <G fill="none" stroke={chalkLine} strokeWidth={1}>
          <Rect x={0.5} y={0.5} width={132} height={215} rx={4} />
          <Path d="M0 108 H133" />
          <Circle cx={66.5} cy={108} r={18} />
          <Rect x={26.5} y={0.5} width={80} height={32} />
          <Rect x={47.5} y={0.5} width={38} height={12} />
          <Path d="M51.3 32.5 A18 18 0 0 0 81.7 32.5" />
          <Rect x={26.5} y={183.5} width={80} height={32} />
          <Rect x={47.5} y={203.5} width={38} height={12} />
          <Path d="M51.3 183.5 A18 18 0 0 1 81.7 183.5" />
        </G>
        <Circle cx={66.5} cy={108} r={1.6} fill="rgba(251,248,240,0.35)" />
      </Svg>

      {/* Echo rings around the primary — Views, not SVG, so a wing's outer
          ring can run past the touchline instead of being cut by it. */}
      {primarySpot
        ? [
            { r: 27, opacity: 0.4 },
            { r: 21, opacity: 0.8 },
          ].map(({ r, opacity }) => (
            <View
              key={r}
              style={{
                position: 'absolute',
                left: primarySpot[0] * w - r * s,
                top: primarySpot[1] * h - r * s,
                width: 2 * r * s,
                height: 2 * r * s,
                borderRadius: r * s,
                borderWidth: 1.5 * s,
                borderColor: ringColor,
                opacity,
              }}
            />
          ))
        : null}

      {Object.entries(SPOTS).map(([code, [fx, fy]]) => {
        const state = stateOf(code);
        const size = (state === 'primary' ? 30 : state === 'secondary' ? 22 : 6) * s;
        return (
          <View
            key={code}
            style={{
              position: 'absolute',
              left: fx * w - size / 2,
              top: fy * h - size / 2,
              width: size,
              height: size,
              borderRadius: size / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor:
                state === 'primary' ? ON_HERO : state === 'secondary' ? HERO_PANEL : 'rgba(251,248,240,0.38)',
              borderWidth: state === 'secondary' ? 1.5 * s : 0,
              borderColor: ON_HERO,
            }}
          >
            {state !== 'off' ? (
              <Text
                allowFontScaling={false}
                style={{
                  fontFamily: TOKENS.monoBold,
                  fontSize: (state === 'primary' ? 10.5 : 8.5) * s,
                  letterSpacing: 0.2 * s,
                  color: state === 'primary' ? TOKENS.ink : ON_HERO,
                }}
              >
                {code}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
