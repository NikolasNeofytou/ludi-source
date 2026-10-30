// ShareCard — the 1080×1920 share card, Turn 13 of "Ludi - Share Card.dc.html".
//
// Six bands in a FIXED reading order:
//   portrait → name → position → spec row → record rings → claim
//
// The design lists "the cold-start rule for rings under five matches" as
// unsettled. It is settled here the way the repo already settled it elsewhere:
// match-fit-card.md calls reliability "the reserved hero — it renders as the
// prominent 'earned as you play' empty state (ADR-0012), no data plumbing.
// This is the card's promise of what it becomes."
//
// So with no history the record band KEEPS its position and its rule, and the
// rings are replaced by that promise. It is not dropped. Dropping it was the
// first thing tried and it is visibly wrong: the bottom-up drop rule exists for
// SHORTER CANVASES, and on a full 1920 canvas a dropped band is just a hole.
// ADR-0012 forbids zeros or invented ratings, so rendering 0% three times is
// not an option either — an empty ring reads as "bad player", not "new".
//
// Geometry is transcribed from the drawing at 1080×1920 and then scaled, so the
// composition is exact rather than re-approximated at phone size. letterSpacing
// is converted from the design's em values to px, because RN takes px.
//
// Type is Literata, per the drawing — TOKENS.poster/posterSemi, which exist for
// this surface alone. The app UI stays on Fraunces; the share card is an export,
// not a screen, so it is allowed its own serif without putting two display
// serifs into one interface.
//
// NOT the plane geometry in share-card-geometry.ts — that is Turn 5 ("the whole
// set in whisper"), superseded at Turn 7 when the portrait became the hero. The
// ground here is flat ink with a photo over it. That file currently has no
// consumers.

import { TOKENS } from '@ludi/ui';
import { Text, View } from 'react-native';
import { Circle, Defs, LinearGradient, Path, Rect, Stop, Svg, Text as SvgText } from 'react-native-svg';

const W = 1080;
const H = 1920;

const INK = '#10181C';
const CHALK = '#F2F4F3';
const AEGEAN = '#9DC6D1'; // the design uses Aegean on exactly two labels
const dim = (a: number) => `rgba(242,244,243,${a})`;

export interface ShareCardRecord {
  matches: number;
  sinceLabel: string; // "JUN"
  turnedUpPct: number;
  onTimePct: number;
  repliedPct: number;
}

export interface ShareCardData {
  firstName: string;
  city: string; // "LARNACA"
  position: string | null; // full words — "CENTRE MIDFIELD", not "CM"
  alsoPosition: string | null; // "ALSO ATTACKING MID"
  heightCm: number | null;
  foot: string | null; // "RIGHT"
  ageBand: string | null; // "26–35"
  skillLevel: number | null; // 1–5 → "III OF V"
  claimUrl: string; // "LUDI.FOOTBALL/P/ANDREAS-4K"
  /** Omit entirely until there is real history — see the band-drop rule above. */
  record?: ShareCardRecord | null;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/* ── the Ludi mark, three stacked planes ── */
function Mark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 180 180">
      <Path d="M90 20 L178 172 L2 172 Z" fill={CHALK} />
      <Path d="M90 66 L146 172 L34 172 Z" fill="rgba(242,244,243,0.55)" />
      <Path d="M90 112 L110 172 L70 172 Z" fill={CHALK} />
    </Svg>
  );
}

/* ── one record ring ── */
function Ring({ pct, label }: { pct: number; label: string }) {
  const C = 402; // circumference at r=64, as drawn
  return (
    <View style={{ alignItems: 'center', gap: 14 }}>
      <Svg width={152} height={152} viewBox="0 0 160 160">
        <Circle cx={80} cy={80} r={64} fill="none" stroke="rgba(242,244,243,0.14)" strokeWidth={12} />
        <Circle
          cx={80}
          cy={80}
          r={64}
          fill="none"
          stroke={CHALK}
          strokeWidth={12}
          strokeDasharray={`${Math.round((C * pct) / 100)} 403`}
          transform="rotate(-90 80 80)"
        />
        <SvgText
          x={80}
          y={95}
          textAnchor="middle"
          fontFamily={TOKENS.monoMedium}
          fontSize={44}
          fill={CHALK}
        >
          {`${pct}%`}
        </SvgText>
      </Svg>
      <Text style={{ fontFamily: TOKENS.mono, fontSize: 20, letterSpacing: 20 * 0.18, color: dim(0.7) }}>
        {label}
      </Text>
    </View>
  );
}

function SpecItem({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontFamily: TOKENS.monoMedium, fontSize: 56, color: CHALK, lineHeight: 56 }}>
        {value}
      </Text>
      <Text style={{ fontFamily: TOKENS.mono, fontSize: 21, letterSpacing: 21 * 0.18, color: dim(0.5) }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Renders at exactly 1080×1920 and is scaled by the caller. Keeping the inner
 * canvas at true size is what makes this the same object as the drawing — and
 * it is what a future PNG export needs, since the export must rasterise at
 * 1080×1920 regardless of the phone it was triggered from.
 */
export function ShareCard({ data, scale = 1 }: { data: ShareCardData; scale?: number }) {
  const spec = [
    data.heightCm ? { value: String(data.heightCm), label: 'HEIGHT CM' } : null,
    data.foot ? { value: data.foot.toUpperCase(), label: 'FOOT' } : null,
    data.ageBand ? { value: data.ageBand, label: 'AGE' } : null,
  ].filter((x): x is { value: string; label: string } => x !== null);

  const rec = data.record;

  return (
    <View
      style={{
        width: W * scale,
        height: H * scale,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: W,
          height: H,
          backgroundColor: INK,
          transform: [{ scale }],
          transformOrigin: 'top left',
        }}
      >
        {/* ── band 1 · portrait ──────────────────────────────────────────
            No photo pipeline exists (Supabase Storage + a moderation tail is
            deferred), and the design lists the no-photo fallback as unsettled.
            Until it lands, the hero is the mark on ink at poster scale — the
            one thing that is honestly ours and needs no upload. */}
        <View style={{ position: 'absolute', left: 0, top: 0, width: W, height: 940 }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', opacity: 0.13 }}>
            <Mark size={620} />
          </View>
        </View>
        <Svg
          width={W}
          height={940}
          style={{ position: 'absolute', left: 0, top: 0 }}
          pointerEvents="none"
        >
          <Defs>
            <LinearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={INK} stopOpacity="0.62" />
              <Stop offset="0.26" stopColor={INK} stopOpacity="0" />
              <Stop offset="0.68" stopColor={INK} stopOpacity="0" />
              <Stop offset="1" stopColor={INK} stopOpacity="0.9" />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={W} height={940} fill="url(#scrim)" />
        </Svg>

        {/* ── header ── */}
        <View
          style={{
            position: 'absolute',
            left: 72,
            right: 72,
            top: 74,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Mark size={44} />
            <Text
              style={{
                fontFamily: TOKENS.posterSemi,
                fontSize: 27,
                color: CHALK,
                letterSpacing: 27 * 0.2,
              }}
            >
              LUDI
            </Text>
          </View>
          <Text
            style={{ fontFamily: TOKENS.mono, fontSize: 22, letterSpacing: 22 * 0.24, color: dim(0.8) }}
          >
            {data.city.toUpperCase()}
          </Text>
        </View>

        {/* ── band 2+3 · name, then position in full words ── */}
        <View style={{ position: 'absolute', left: 72, right: 72, top: 986 }}>
          <Text
            style={{
              fontFamily: TOKENS.poster,
              fontSize: 124,
              color: CHALK,
              lineHeight: 124 * 0.9,
            }}
          >
            {data.firstName}
          </Text>
          {data.position ? (
            <Text
              style={{
                marginTop: 26,
                fontFamily: TOKENS.mono,
                fontSize: 29,
                letterSpacing: 29 * 0.22,
                color: CHALK,
              }}
            >
              {data.position.toUpperCase()}
            </Text>
          ) : null}
          {data.alsoPosition ? (
            <Text
              style={{
                marginTop: 14,
                fontFamily: TOKENS.mono,
                fontSize: 25,
                letterSpacing: 25 * 0.2,
                color: dim(0.5),
              }}
            >
              {`ALSO ${data.alsoPosition.toUpperCase()}`}
            </Text>
          ) : null}
        </View>

        {/* ── band 4 · spec row, one flat row, no fact repeated ── */}
        <View
          style={{
            position: 'absolute',
            left: 72,
            right: 72,
            top: 1252,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          {spec.map((it) => (
            <SpecItem key={it.label} value={it.value} label={it.label} />
          ))}
        </View>
        <View
          style={{
            position: 'absolute',
            left: 72,
            right: 72,
            top: 1394,
            height: 1,
            backgroundColor: dim(0.28),
          }}
        />

        {/* ── band 5 · record. Dropped entirely when there is no history. ── */}
        {(
          <>
            <View
              style={{
                position: 'absolute',
                left: 72,
                right: 72,
                top: 1436,
                flexDirection: 'row',
                alignItems: 'baseline',
                justifyContent: 'space-between',
              }}
            >
              <Text
                style={{ fontFamily: TOKENS.mono, fontSize: 20, letterSpacing: 20 * 0.32, color: AEGEAN }}
              >
                RECORD
              </Text>
              <Text
                style={{ fontFamily: TOKENS.mono, fontSize: 20, letterSpacing: 20 * 0.14, color: dim(0.45) }}
              >
                {rec ? `OF ${rec.matches} MATCHES SINCE ${rec.sinceLabel}` : 'NOT YET PLAYED'}
              </Text>
            </View>
            <View
              style={{
                position: 'absolute',
                left: 72,
                right: 72,
                top: 1476,
                height: 2,
                backgroundColor: dim(0.45),
              }}
            />
            {rec ? (
              <View
                style={{
                  position: 'absolute',
                  left: 72,
                  right: 72,
                  top: 1500,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                }}
              >
                <Ring pct={rec.turnedUpPct} label="TURNED UP" />
                <Ring pct={rec.onTimePct} label="ON TIME" />
                <Ring pct={rec.repliedPct} label="REPLIED" />
              </View>
            ) : (
              /* the reserved hero — the promise, not a zero */
              <View style={{ position: 'absolute', left: 72, right: 72, top: 1524, gap: 22 }}>
                <Text
                  style={{
                    fontFamily: TOKENS.poster,
                    fontSize: 54,
                    color: CHALK,
                    lineHeight: 54 * 1.12,
                  }}
                >
                  Turned up, on time,{'\n'}replied.
                </Text>
                <Text
                  style={{
                    fontFamily: TOKENS.mono,
                    fontSize: 22,
                    letterSpacing: 22 * 0.14,
                    color: dim(0.45),
                    lineHeight: 22 * 1.5,
                  }}
                >
                  EARNED AS YOU PLAY
                </Text>
              </View>
            )}
          </>
        )}

        {/* ── band 6 · declared skill ── */}
        {data.skillLevel ? (
          <View
            style={{
              position: 'absolute',
              left: 72,
              right: 72,
              top: 1740,
              flexDirection: 'row',
              alignItems: 'baseline',
              gap: 20,
            }}
          >
            <Text
              style={{ fontFamily: TOKENS.mono, fontSize: 18, letterSpacing: 18 * 0.3, color: AEGEAN }}
            >
              DECLARED
            </Text>
            <Text
              style={{ fontFamily: TOKENS.mono, fontSize: 24, letterSpacing: 24 * 0.12, color: dim(0.5) }}
            >
              {`SKILL ${ROMAN[data.skillLevel] ?? '—'} OF V`}
            </Text>
          </View>
        ) : null}

        {/* ── claim ── */}
        <View
          style={{
            position: 'absolute',
            left: 72,
            right: 72,
            bottom: 78,
            alignItems: 'center',
          }}
        >
          <Text
            style={{ fontFamily: TOKENS.mono, fontSize: 23, letterSpacing: 23 * 0.26, color: CHALK }}
          >
            {data.claimUrl.toUpperCase()}
          </Text>
        </View>
      </View>
    </View>
  );
}
