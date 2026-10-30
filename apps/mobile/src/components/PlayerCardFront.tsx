// PlayerCardFront — the 9:16 player card, direction A (plans/player-card-v2.md).
//
// The 2026-10-15 audit found the old front spending 56% of the card on a hero
// that carried almost no data, a stat strip that made a score, a role, a side
// and a length look comparable, and position — the first thing a teammate
// wants to know — only implied by a ring colour. This front keeps the brand
// hero (mark, echo rings, gold member number) but shortens it, and gives the
// body to the answers: what they play, how good, and the four facts that
// shape a game (foot, height, age band, how often they play).
//
// The record, the mini pitch and the QR live on the back (PlayerCardBack);
// the one exception is the match count, which stays in the meta line.
//
// Rules carried over (do not regress):
// - The faction hue appears ONLY in the echo rings.
// - `skill_level` is NOT NULL DEFAULT 3, so it is not evidence of a filled
//   card: the Level block shows only when positions or foot are set.
// - Unset fields are omitted and the grid reflows — never "—".
// - The record is the subject's and only ever passed for a self-view; `null`
//   is "not known", never zero. NEW PLAYER goes the moment a match is played.
//
// All dimensions are design units at width 362, scaled by `u`.

import { displayFamily, displayHang, LudiMark, MARK_GOLD, TOKENS } from '@ludi/ui';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import {
  CRISP,
  echoRingPaths,
  factionFor,
  factionRingColor,
  HERO_GROUND,
  ON_HERO,
  ON_HERO_DIM,
} from '@/components/factions';
import {
  AGE_BAND_LABELS,
  alsoPlaysList,
  displayName,
  footLabelKey,
  formatMemberNo,
  formatSince,
  playFrequencyShortKey,
  positionNameKey,
  skillLevel,
  skillTierDescKey,
  skillTierNameKey,
  upperLabel,
  type AgeBand,
  type Foot,
  type Locale,
  type MyRecord,
  type PlayFrequency,
} from '@/lib/player-profile';

// The card's data shape — the `users` row the card reads (ADR-0012).
export interface PlayerCardData {
  first_name: string;
  last_name: string;
  handle: string | null;
  skill_level: number;
  positions: string[];
  preferred_foot: Foot | null;
  height_cm: number | null;
  age_band: AgeBand | null;
  play_frequency: PlayFrequency | null;
  member_no: number | null;
  created_at: string | null;
  city_name: string | null;
}

export const CARD_W = 362;
export const CARD_RATIO = 16 / 9;

/** A card's height for a width — both faces share it, so the flip lines up. */
export function cardHeight(width: number): number {
  return Math.round(width * CARD_RATIO);
}

/**
 * The card's outline and shadow. The shadow sits on an unclipped outer view
 * because iOS clips a layer's shadow along with its content.
 */
export function CardFrame({
  width,
  background,
  children,
}: {
  width: number;
  background: string;
  children: ReactNode;
}) {
  const u = width / CARD_W;
  const radius = 20 * u;
  return (
    <View
      style={{
        width,
        height: cardHeight(width),
        borderRadius: radius,
        borderCurve: 'continuous',
        shadowColor: '#10181C',
        shadowOpacity: 0.28,
        shadowRadius: 27 * u,
        shadowOffset: { width: 0, height: 11 * u },
        elevation: 10,
        backgroundColor: background,
      }}
    >
      <View
        style={{
          flex: 1,
          borderRadius: radius,
          borderCurve: 'continuous',
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: CRISP.lineBold,
          backgroundColor: background,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** "Larnaca · since June 2026" — the hero's and the back footer's sub-line. */
export function useCardSubLine(data: PlayerCardData, locale: Locale): string {
  const { t } = useTranslation();
  const since = formatSince(data.created_at, locale);
  return [data.city_name, since ? t('playerCardSince', { when: since }) : null].filter(Boolean).join(' · ');
}

export function PlayerCardFront({
  data,
  verified,
  locale,
  width = CARD_W,
  record = null,
  showBackHint = true,
}: {
  data: PlayerCardData;
  verified: boolean;
  locale: Locale;
  width?: number;
  /** The subject's record — self-view only; `null` = not known (never zero). */
  record?: MyRecord | null;
  /** The footer's "Record and QR on the back" — only where the card flips. */
  showBackHint?: boolean;
}) {
  const { t } = useTranslation();
  const u = width / CARD_W;
  const P = CRISP;

  const faction = factionFor(data.positions);
  const ringColor = factionRingColor(faction);
  const fullName = displayName(data, t('profileNameFallback'));
  const memberNo = formatMemberNo(data.member_no);
  const subLine = useCardSubLine(data, locale);

  const played = record?.matches_played ?? null;
  const matchesLine =
    played != null && played > 0
      ? played === 1
        ? t('playerCardMatchesOne')
        : t('playerCardMatches', { count: played })
      : null;
  const firstName = data.first_name.trim();
  const fillsIn = firstName ? t('playerCardFillsIn', { name: firstName }) : t('playerCardFillsInAnon');
  // Positions and foot are genuinely optional; one of them being set is what
  // says a human filled the card in — and only then is the level believable.
  const hasSpecs = data.positions.length > 0 || data.preferred_foot !== null;

  // Mark + echo geometry: rings centred on the mark's visual centroid
  // (markTop + 0.674 · markSize).
  const heroH = 320 * u;
  const markSize = 124 * u;
  const markTop = 46 * u;
  const ringCx = width / 2;
  const ringCy = markTop + 0.674 * markSize;
  const rings = useMemo(
    () => echoRingPaths(ringCx, ringCy, [175 * u, 245 * u, 325 * u, 420 * u]),
    [ringCx, ringCy, u],
  );
  const ringOpacity = [0.6, 0.44, 0.3, 0.18];

  return (
    <CardFrame width={width} background={P.surface}>
      {/* ───── Hero — the mark radiating; corners carry the metadata ───── */}
      <View style={{ height: heroH, backgroundColor: HERO_GROUND }}>
        <View
          style={{ position: 'absolute', left: 0, top: 0 }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Svg width={width} height={heroH}>
            {rings.map((d, i) => (
              <Path
                key={d}
                d={d}
                fill="none"
                stroke={ringColor}
                strokeOpacity={ringOpacity[i] ?? 0.14}
                strokeWidth={1.5 * u}
                strokeLinejoin="round"
              />
            ))}
          </Svg>
          <View style={{ position: 'absolute', left: (width - markSize) / 2, top: markTop }}>
            <LudiMark size={markSize} density="compact" ground={null} />
          </View>
        </View>

        <Text
          style={{
            position: 'absolute',
            top: 16 * u,
            left: 16 * u,
            fontFamily: TOKENS.ui,
            fontSize: 10 * u,
            letterSpacing: 1.6 * u,
            fontWeight: '700',
            color: ON_HERO_DIM,
          }}
        >
          {`FACTIO · ${faction.latin}`}
        </Text>

        {/* member number — the shirt number, top-right in the mark's gold */}
        {memberNo ? (
          <View style={{ position: 'absolute', top: 14 * u, right: 16 * u, alignItems: 'flex-end' }}>
            <Text
              style={{
                fontFamily: TOKENS.ui,
                fontSize: 9 * u,
                letterSpacing: 2 * u,
                fontWeight: '700',
                color: ON_HERO_DIM,
              }}
            >
              {upperLabel(t('playerCardMemberLabel'))}
            </Text>
            <Text
              style={{
                fontFamily: TOKENS.displaySemi,
                fontSize: 40 * u,
                lineHeight: 42 * u,
                color: MARK_GOLD,
              }}
            >
              {memberNo}
            </Text>
          </View>
        ) : null}

        {/* the name — the typographic anchor at the hero's foot */}
        <View style={{ position: 'absolute', left: 18 * u, right: 18 * u, bottom: 16 * u, gap: 6 * u }}>
          <Text
            numberOfLines={2}
            adjustsFontSizeToFit
            style={{
              fontFamily: displayFamily(fullName),
              fontSize: 30 * u,
              lineHeight: 33 * u,
              letterSpacing: -0.5 * u,
              color: ON_HERO,
              ...displayHang(fullName, 30 * u),
            }}
          >
            {fullName}
          </Text>
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8 * u, rowGap: 2 * u }}
          >
            {verified ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 * u }}>
                <Svg width={11 * u} height={11 * u} viewBox="0 0 12 12">
                  <Path
                    d="M2 6.5 L5 9.2 L10 3"
                    fill="none"
                    stroke={MARK_GOLD}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
                <Text style={metaText(u, { color: MARK_GOLD, fontWeight: '700' })}>{t('playerCardVerified')}</Text>
              </View>
            ) : null}
            {/* The one record fact on the front rides in the same run as the
                city, so a wrap breaks between words instead of opening a line
                with a dot. Only a known record speaks: a count when there is
                one, NEW PLAYER when it is zero (and the body is not already
                saying so). */}
            {subLine || matchesLine ? (
              <Text style={metaText(u)}>
                {subLine}
                {matchesLine ? (
                  <>
                    {subLine ? ' · ' : ''}
                    <Text style={{ fontWeight: '700', color: ON_HERO }}>{matchesLine}</Text>
                  </>
                ) : null}
              </Text>
            ) : null}
            {played === 0 && hasSpecs ? <NewPlayerChip u={u} small /> : null}
          </View>
        </View>
      </View>

      {/* ───── Body — what they play, how good, the four facts ───── */}
      {hasSpecs ? (
        <SpecsBody data={data} u={u} />
      ) : (
        <View style={{ paddingTop: 22 * u, paddingHorizontal: 18 * u, alignItems: 'flex-start', gap: 12 * u }}>
          {played === 0 ? <NewPlayerChip u={u} /> : null}
          <Text
            style={{
              fontFamily: displayFamily(fillsIn, 'medium'),
              fontSize: 22 * u,
              lineHeight: 28 * u,
              color: P.ink,
              ...displayHang(fillsIn, 22 * u),
            }}
          >
            {fillsIn}
          </Text>
        </View>
      )}

      {/* ───── Footer ───── */}
      <View
        style={{
          marginTop: 'auto',
          marginHorizontal: 18 * u,
          borderTopWidth: 1,
          borderTopColor: P.line,
          paddingTop: 11 * u,
          paddingBottom: 14 * u,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12 * u,
        }}
      >
        <Text style={{ fontFamily: TOKENS.mono, fontSize: 11 * u, letterSpacing: 0.6 * u, color: P.ink3 }}>
          ludi.football
        </Text>
        {showBackHint ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 * u, flexShrink: 1 }}>
            <FlipGlyph size={13 * u} color={P.ink3} />
            <Text numberOfLines={1} style={{ fontFamily: TOKENS.ui, fontSize: 11 * u, color: P.ink3, flexShrink: 1 }}>
              {t('playerCardBackHint')}
            </Text>
          </View>
        ) : null}
      </View>
    </CardFrame>
  );
}

function SpecsBody({ data, u }: { data: PlayerCardData; u: number }) {
  const { t } = useTranslation();
  const P = CRISP;

  const code = data.positions[0] ?? null;
  const nameKey = code ? positionNameKey(code) : null;
  const also = alsoPlaysList(data.positions);

  const level = skillLevel(data.skill_level);
  const tierName = t(skillTierNameKey(level));
  const tierDesc = t(skillTierDescKey(level));

  const cells: Array<{ k: string; v: string; foot?: Foot }> = [
    ...(data.preferred_foot
      ? [{ k: t('playerCardFootShort'), v: t(footLabelKey(data.preferred_foot)), foot: data.preferred_foot }]
      : []),
    ...(data.height_cm != null ? [{ k: t('profileHeight'), v: `${data.height_cm} cm` }] : []),
    ...(data.age_band ? [{ k: t('profileAge'), v: AGE_BAND_LABELS[data.age_band] }] : []),
    ...(data.play_frequency ? [{ k: t('playerCardPlays'), v: t(playFrequencyShortKey(data.play_frequency)) }] : []),
  ];

  const hairline = <View style={{ height: 1, backgroundColor: P.line }} />;

  return (
    <View style={{ paddingTop: 18 * u, paddingHorizontal: 18 * u, gap: 15 * u }}>
      {code ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 * u }}>
            <Text
              style={{
                fontFamily: TOKENS.displaySemi,
                fontSize: 34 * u,
                lineHeight: 36 * u,
                letterSpacing: -0.5 * u,
                color: P.ink,
                minWidth: 56 * u,
              }}
            >
              {code}
            </Text>
            <View style={{ flex: 1, gap: 2 * u }}>
              {nameKey ? (
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: TOKENS.ui, fontSize: 16 * u, lineHeight: 20 * u, fontWeight: '600', color: P.ink }}
                >
                  {t(nameKey)}
                </Text>
              ) : null}
              {also ? (
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: TOKENS.ui, fontSize: 12.5 * u, lineHeight: 16 * u, color: P.ink3 }}
                >
                  {t('playerCardAlsoPlays', { list: also })}
                </Text>
              ) : null}
            </View>
          </View>
          {hairline}
        </>
      ) : null}

      <View
        style={{ gap: 4 * u }}
        accessible
        accessibilityLabel={`${t('playerCardLevelA11y', { n: level, tier: tierName })}. ${tierDesc}`}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 * u }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 * u, flexShrink: 1 }}>
            <Text style={labelText(u)}>{upperLabel(t('playerCardLevel'))}</Text>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: displayFamily(tierName),
                fontSize: 17 * u,
                lineHeight: 22 * u,
                color: P.ink,
                flexShrink: 1,
                ...displayHang(tierName, 17 * u),
              }}
            >
              {tierName}
            </Text>
          </View>
          <LevelPips level={level} u={u} />
        </View>
        <Text style={{ fontFamily: TOKENS.ui, fontSize: 12.5 * u, lineHeight: 16 * u, color: P.ink3 }}>{tierDesc}</Text>
      </View>

      {cells.length > 0 ? (
        <>
          {hairline}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 * u, columnGap: 16 * u }}>
            {cells.map((c) => (
              // Two per row whatever the frame's border leaves; a lone last
              // cell keeps its left edge on the column.
              <View key={c.k} style={{ flexBasis: '40%', flexGrow: 1, gap: 3 * u }}>
                <Text style={labelText(u)}>{upperLabel(c.k)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 * u }}>
                  {c.foot ? <FootGlyph foot={c.foot} u={u} /> : null}
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: displayFamily(c.v),
                      fontSize: 16 * u,
                      lineHeight: 20 * u,
                      color: P.ink,
                      flexShrink: 1,
                      ...displayHang(c.v, 16 * u),
                    }}
                  >
                    {c.v}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** Five pips, the level filled in the primary — the 1–5 scale at a glance. */
export function LevelPips({ level, u = 1 }: { level: number; u?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 * u, flexShrink: 0 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          style={{
            width: 18 * u,
            height: 6 * u,
            borderRadius: 3 * u,
            backgroundColor: i <= level ? TOKENS.primary : TOKENS.primarySoft,
          }}
        />
      ))}
    </View>
  );
}

/** Two soles, the preferred one filled; both filled for "both". */
export function FootGlyph({ foot, u = 1, size = 18 }: { foot: Foot; u?: number; size?: number }) {
  const ink = CRISP.ink;
  const left = foot === 'left' || foot === 'both';
  const right = foot === 'right' || foot === 'both';
  const w = size * u;
  return (
    <Svg width={w} height={(w * 16) / 18} viewBox="0 0 18 16">
      <Rect
        x={1.5}
        y={1}
        width={6}
        height={14}
        rx={3}
        fill={left ? ink : 'none'}
        stroke={ink}
        strokeWidth={1.3}
        transform="rotate(-6 4.5 8)"
      />
      <Rect
        x={10.5}
        y={1}
        width={6}
        height={14}
        rx={3}
        fill={right ? ink : 'none'}
        stroke={ink}
        strokeWidth={1.3}
        transform="rotate(6 13.5 8)"
      />
    </Svg>
  );
}

/** The turn-over arrow beside "Record and QR on the back" and on the flip button. */
export function FlipGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path d="M12 7 A5 5 0 1 1 10.5 3.5" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M11 1 V4 H8" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function NewPlayerChip({ u, small = false }: { u: number; small?: boolean }) {
  const { t } = useTranslation();
  return (
    <View
      style={{
        backgroundColor: CRISP.gold,
        borderRadius: (small ? 6 : 8) * u,
        borderCurve: 'continuous',
        paddingHorizontal: (small ? 6 : 9) * u,
        paddingVertical: (small ? 1.5 : 3) * u,
      }}
    >
      <Text
        style={{
          fontFamily: TOKENS.ui,
          fontSize: (small ? 9.5 : 10.5) * u,
          fontWeight: '800',
          letterSpacing: (small ? 0.5 : 0.6) * u,
          color: CRISP.goldInk,
        }}
      >
        {upperLabel(t('playerCardNewPlayer'))}
      </Text>
    </View>
  );
}

function metaText(u: number, extra?: { color?: string; fontWeight?: '700' }) {
  return {
    fontFamily: TOKENS.ui,
    fontSize: 12 * u,
    lineHeight: 16 * u,
    color: ON_HERO_DIM,
    ...extra,
  } as const;
}

function labelText(u: number) {
  return {
    fontFamily: TOKENS.ui,
    fontSize: 10.5 * u,
    letterSpacing: 1 * u,
    fontWeight: '700',
    color: CRISP.ink3,
  } as const;
}
