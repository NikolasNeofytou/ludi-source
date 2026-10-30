// The tapped seat, as a native `formSheet` route (motion-v2 slice 7 /
// gesture-motion G3). Two readings of one sheet because they are two readings
// of one object — the seat — and splitting them into separate routes made the
// empty case drift into looking like a different screen.
//
// The drag belongs to the OS now: velocity handoff, rubber-banding above
// rest, an interruptible settle and the dismiss gestures all come from UIKit,
// none of which the hand-rolled sheet had. Nothing here animates.
//
// The player reading follows the card (plans/player-card-v2.md, WU6a): the
// one first-hand fact — matches played together — leads, then what they
// play (chips + a small pitch), the level, the foot. Height, age and how
// often they play wait for the roster view to carry them (WU6b).

import { Avatar, Button, Press, displayFamily, displayHang, TOKENS } from '@ludi/ui';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPitch } from '@/components/MiniPitch';
import { FootGlyph, LevelPips } from '@/components/PlayerCardFront';
import { factionFor } from '@/components/factions';
import { formatFixtureDate } from '@/lib/fixture';
import { afterDismiss, useFixtureSheets } from '@/lib/fixture-sheets';
import { fixtureType as type } from '@/lib/fixture-type';
import {
  footLabelKey,
  positionNameKey,
  skillLevel,
  skillTierDescKey,
  skillTierNameKey,
  upperLabel,
} from '@/lib/player-profile';
import { colorFor, initialFor, rosterName } from '@/lib/roster-display';

export default function SeatSheet() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const locale: 'en' | 'gr' = i18n.language === 'gr' ? 'gr' : 'en';
  const insets = useSafeAreaInsets();
  const { seat } = useFixtureSheets();

  // Reached without the screen having published a seat — a deep link, or a
  // state restore. There is nothing to show and an empty sheet is a trap.
  useEffect(() => {
    if (!seat && router.canGoBack()) router.back();
  }, [seat, router]);

  if (!seat) return null;

  const pad = { padding: 22, paddingBottom: Math.max(insets.bottom, 16) + 8, gap: 14 } as const;

  if (seat.seat.kind === 'empty') {
    const keeper = seat.seat.slot === 'gk';
    return (
      <View style={pad}>
        <Text style={[type.h1, { fontSize: 21, lineHeight: 27 }]}>
          {keeper ? t('rosterOpenSheetTitleKeeper') : t('rosterOpenSheetTitleOutfield')}
        </Text>
        <Text style={[type.body, { fontSize: 15, lineHeight: 21 }]}>
          {keeper ? t('rosterOpenSheetBodyKeeper') : t('rosterOpenSheetBody')}
        </Text>
        {seat.canInvite && (
          <Button
            full
            onPress={() => {
              router.back();
              afterDismiss(seat.onInvite);
            }}
          >
            {keeper ? t('fixtureKeeperAsk') : t('fixtureInviteCta')}
          </Button>
        )}
        <Press feel="control" onPress={() => router.back()} style={{ alignSelf: 'center', padding: 10 }}>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, fontWeight: '600', color: TOKENS.ink2 }}>
            {t('rosterSheetClose')}
          </Text>
        </Press>
      </View>
    );
  }

  const p = seat.seat.player;
  const realName = rosterName(p);
  const positions = p.positions ?? [];
  // `skill_level` is NOT NULL DEFAULT 3, so it cannot tell "picked Regular"
  // from "never opened the profile" — on its own it is not evidence of a
  // card. Positions and foot are both genuinely optional, so one of them
  // being set is what says a human filled this in, and only then is the
  // skill line worth believing.
  const hasCard = positions.length > 0 || p.preferred_foot !== null;
  const gone = p.status === 'out';

  // "3 matches together" is worth more than any single attribute — it is the
  // only line on the sheet the viewer has first-hand evidence for, so it
  // leads, as a band. Null on your own row, where it would be a tautology.
  const together = p.played_with_you;

  const when = gone && p.left_at
    ? t('rosterSheetLeft', { when: formatFixtureDate(p.left_at, locale) })
    : t('rosterSheetJoined', { when: formatFixtureDate(p.joined_at, locale) });

  const name = p.is_you ? t('fixtureYou') : realName;
  const faction = factionFor(positions);
  // The faction hue rings the avatar — the card's rule, rings only. The
  // no-position faction's chalk would vanish on the white sheet: no ring.
  const ring = faction.key === 'albata' ? null : faction.hue;
  const level = p.skill_level !== null ? skillLevel(p.skill_level) : null;
  const tierName = level ? t(skillTierNameKey(level)) : '';

  return (
    <View style={[pad, { gap: 16 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
        <View
          style={
            ring
              ? { borderRadius: 999, borderWidth: 2.5, borderColor: ring, padding: 2 }
              : { padding: 4.5 }
          }
        >
          <Avatar initial={initialFor(realName)} color={colorFor(p.user_id)} size={46} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={[
              type.h1,
              {
                fontFamily: displayFamily(name),
                fontSize: 23,
                lineHeight: 28,
                letterSpacing: 0,
                ...displayHang(name, 23),
              },
            ]}
            numberOfLines={1}
          >
            {name}
          </Text>
          <Text style={[type.body, { fontSize: 13, color: TOKENS.ink3 }]}>
            {[
              p.slot_kind === 'gk' ? t('rosterSheetRoleKeeper') : t('rosterSheetRoleOutfield'),
              p.is_organiser ? t('fixtureOrganiserTag') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {seat.showPaid && !p.is_organiser && (
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 9,
              paddingVertical: 4,
              backgroundColor: p.share_paid ? TOKENS.pitchSoft : TOKENS.sunSoft,
            }}
          >
            <Text
              style={{
                fontFamily: TOKENS.monoMedium,
                fontSize: 10,
                letterSpacing: 0.8,
                color: p.share_paid ? TOKENS.pitchDeep : TOKENS.sunDeep,
              }}
            >
              {p.share_paid ? t('fixturePaidTag') : t('fixtureUnpaidTag')}
            </Text>
          </View>
        )}
      </View>

      {together !== null && (
        <View
          accessible
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: TOKENS.primarySoft,
            borderRadius: 14,
            borderCurve: 'continuous',
            paddingVertical: 11,
            paddingHorizontal: 14,
          }}
        >
          {together > 0 && (
            <Text
              style={{ fontFamily: TOKENS.displaySemi, fontSize: 30, lineHeight: 32, color: TOKENS.primaryDeep }}
            >
              {together}
            </Text>
          )}
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, lineHeight: 19, fontWeight: '600', color: TOKENS.ink }}>
              {together === 0
                ? t('rosterSheetTogetherNone')
                : together === 1
                  ? t('rosterSheetTogetherLabelOne')
                  : t('rosterSheetTogetherLabel')}
            </Text>
            {/* When they took the seat, or gave it up — provenance, so it
                rides under the one first-hand fact rather than as a row. */}
            <Text
              style={{ fontFamily: TOKENS.ui, fontSize: 12.5, lineHeight: 16, color: gone ? TOKENS.sunDeep : TOKENS.ink2 }}
            >
              {when}
            </Text>
          </View>
        </View>
      )}

      {hasCard && positions.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={labelStyle}>{upperLabel(t('playerCardPosition'))}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {positions.map((pos, i) => {
                const key = positionNameKey(pos);
                const primary = i === 0;
                const fg = primary ? '#FBF8F0' : TOKENS.primaryDeep;
                return (
                  <View
                    key={pos}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 7,
                      borderRadius: 10,
                      borderCurve: 'continuous',
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      backgroundColor: primary ? TOKENS.ink : TOKENS.primarySoft,
                    }}
                  >
                    <Text style={{ fontFamily: TOKENS.monoBold, fontSize: 11, letterSpacing: 0.6, color: fg }}>
                      {pos}
                    </Text>
                    {key && (
                      <Text
                        style={{ fontFamily: TOKENS.ui, fontSize: 13, fontWeight: primary ? '600' : '400', color: fg }}
                      >
                        {t(key)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
          <MiniPitch
            variant="light"
            positions={positions}
            ringColor={faction.hue}
            label={t('playerCardPitchA11y', { list: positions.join(', ') })}
          />
        </View>
      )}

      {hasCard && <View style={{ height: 1, backgroundColor: TOKENS.line }} />}

      {hasCard && level !== null && (
        <View
          style={{ gap: 4 }}
          accessible
          accessibilityLabel={`${t('playerCardLevelA11y', { n: level, tier: tierName })}. ${t(skillTierDescKey(level))}`}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexShrink: 1 }}>
              <Text style={labelStyle}>{upperLabel(t('playerCardLevel'))}</Text>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: displayFamily(tierName),
                  fontSize: 17,
                  lineHeight: 22,
                  color: TOKENS.ink,
                  flexShrink: 1,
                  ...displayHang(tierName, 17),
                }}
              >
                {tierName}
              </Text>
            </View>
            <LevelPips level={level} />
          </View>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 12.5, lineHeight: 16, color: TOKENS.ink3 }}>
            {t(skillTierDescKey(level))}
          </Text>
        </View>
      )}

      {p.preferred_foot && (
        <View style={{ gap: 3 }}>
          <Text style={labelStyle}>{upperLabel(t('playerCardFootShort'))}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <FootGlyph foot={p.preferred_foot} size={16} />
            <Text
              style={{
                fontFamily: displayFamily(t(footLabelKey(p.preferred_foot))),
                fontSize: 15,
                lineHeight: 19,
                color: TOKENS.ink,
              }}
            >
              {t(footLabelKey(p.preferred_foot))}
            </Text>
          </View>
        </View>
      )}

      {/* Your own seat has no band to carry the provenance line. */}
      {together === null && (
        <Text style={[type.body, { fontSize: 13, color: gone ? TOKENS.sunDeep : TOKENS.ink3 }]}>{when}</Text>
      )}

      {!hasCard && (
        <Text style={[type.body, { fontSize: 13, color: TOKENS.ink3 }]}>
          {p.is_you ? t('rosterSheetYouEmpty') : t('rosterSheetEmpty')}
        </Text>
      )}

      <Press feel="control" onPress={() => router.back()} style={{ alignSelf: 'center', padding: 10 }}>
        <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, fontWeight: '600', color: TOKENS.ink2 }}>
          {t('rosterSheetClose')}
        </Text>
      </Press>
    </View>
  );
}

const labelStyle = {
  fontFamily: TOKENS.ui,
  fontSize: 10.5,
  letterSpacing: 1,
  fontWeight: '700',
  color: TOKENS.ink3,
} as const;
