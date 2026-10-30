// Venue screen — the middle hop of the venue-first Discover flow:
// Discover lists venues, this screen lists one venue's courts, and a court
// opens the existing /pitch/[id] detail + booking screen. Same visual
// language as Discover: field-tile-led cards, mono eyebrows, price right.
//
// On a venue that hosts the CFA's children's matches, its Saturday comes
// first (plans/cfa-in-the-app.md K2): the day's matches by kick-off, each
// on its court, "now" while it is on, never a score. A team is tappable —
// that is how a parent follows their child's team (K3).

import {
  Button,
  ELEV,
  FieldTile,
  FORMAT_DOT,
  Press,
  PressScale,
  RADII,
  ROW_LAYOUT,
  Reveal,
  Skeleton,
  TOKENS,
} from '@ludi/ui';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { cyprusDate, cyprusDay, cyprusTime, fetchVenueSaturday, type VenueFixture, type VenueSaturday } from '@/lib/cfa';
import { openDirections } from '@/lib/directions';
import { fetchVenueDetail, type PitchListItem, type VenueDetail } from '@/lib/pitches';

type VenueState =
  | { status: 'loading' }
  | { status: 'success'; venue: VenueDetail }
  | { status: 'error' };

export default function VenueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<VenueState>({ status: 'loading' });
  const [saturday, setSaturday] = useState<VenueSaturday | null>(null);

  // The CFA day is secondary: on failure the section simply stays absent.
  // Re-read on focus, so a follow made in the sheet shows on return.
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let cancelled = false;
      fetchVenueSaturday(id)
        .then((s) => {
          if (!cancelled) setSaturday(s);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const cancelLoadRef = useRef<(() => void) | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    cancelLoadRef.current?.();
    setState({ status: 'loading' });
    let cancelled = false;
    cancelLoadRef.current = () => {
      cancelled = true;
    };
    fetchVenueDetail(id)
      .then((venue) => {
        if (cancelled) return;
        if (!venue) setState({ status: 'error' });
        else setState({ status: 'success', venue });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'error' });
      });
  }, [id]);

  useEffect(() => {
    load();
    return () => cancelLoadRef.current?.();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
        <BackButton onPress={() => router.back()} style={{ marginLeft: 16, marginTop: 8 }} />
        <View style={{ padding: 20, gap: 12 }}>
          <Skeleton variant="row" />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </View>
      </SafeAreaView>
    );
  }
  if (state.status === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
        <BackButton onPress={() => router.back()} style={{ marginLeft: 16, marginTop: 8 }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Text style={{ fontFamily: TOKENS.ui, color: TOKENS.ink2 }}>{t('discoverError')}</Text>
          <Button variant="secondary" size="sm" onPress={load}>
            {t('discoverRetry')}
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const { venue } = state;
  const courtsCount =
    venue.courts.length === 1 ? t('courtsOne') : t('courtsOther', { count: venue.courts.length });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <BackButton onPress={() => router.back()} style={{ marginLeft: 16, marginTop: 8 }} />
        <View style={{ padding: 20, gap: 4 }}>
          <Text
            style={{
              fontFamily: TOKENS.monoMedium,
              fontSize: 11,
              color: TOKENS.ink3,
              textTransform: 'uppercase',
              letterSpacing: 0.88,
            }}
          >
            {courtsCount}
          </Text>
          <Text
            style={{
              fontFamily: TOKENS.displaySemi,
              fontSize: 30,
              color: TOKENS.ink,
              letterSpacing: -0.6,
              lineHeight: 34,
            }}
          >
            {venue.name}
          </Text>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, color: TOKENS.ink2 }}>
            {venue.address}
          </Text>
          {venue.lat != null && venue.lng != null ? (
            <Press
              feel="control"
              accessibilityRole="link"
              onPress={() => openDirections({ lat: venue.lat!, lng: venue.lng!, name: venue.name })}
              hitSlop={8}
              style={{ alignSelf: 'flex-start' }}
            >
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, fontWeight: '600', color: TOKENS.primaryDeep }}>
                {t('directions')} →
              </Text>
            </Press>
          ) : null}
        </View>

        {/* The CFA day resolves after the venue, so it arrives as a Reveal and
            the courts below glide down instead of jumping. */}
        {saturday ? (
          <Reveal>
          <CfaSaturday
            saturday={saturday}
            locale={i18n.language === 'gr' ? 'gr' : 'en'}
            onTeam={(teamId, name, category) =>
              router.push({
                pathname: '/team/[id]',
                params: { id: teamId, name, category: category ?? '', venue: venue.name },
              })
            }
          />
          </Reveal>
        ) : null}

        <Animated.View layout={ROW_LAYOUT} style={{ paddingHorizontal: 20, gap: 12 }}>
          {venue.courts.map((court) => (
            <CourtCard
              key={court.id}
              court={court}
              perHourLabel={t('perHour')}
              onPress={() => router.push(`/pitch/${court.id}`)}
            />
          ))}
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

function CourtCard({
  court,
  perHourLabel,
  onPress,
}: {
  court: PitchListItem;
  perHourLabel: string;
  onPress: () => void;
}) {
  const dot = FORMAT_DOT[court.type] ?? TOKENS.primary;
  return (
    <PressScale
      onPress={onPress}
      style={[
        {
          borderRadius: RADII.lg,
          borderCurve: 'continuous',
          backgroundColor: TOKENS.surface,
          borderColor: TOKENS.line,
          borderWidth: StyleSheet.hairlineWidth,
          overflow: 'hidden',
        },
        ELEV.e2,
      ]}
    >
      <FieldTile format={court.type} height={120} />
      <View
        style={{
          padding: 16,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 12,
        }}
      >
        <View style={{ gap: 6, flex: 1 }}>
          <Text
            numberOfLines={2}
            style={{
              fontFamily: TOKENS.displaySemi,
              fontSize: 20,
              color: TOKENS.ink,
              letterSpacing: -0.2,
            }}
          >
            {court.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
            <Text
              numberOfLines={1}
              style={{
                fontFamily: TOKENS.mono,
                fontSize: 11,
                color: TOKENS.ink3,
                textTransform: 'uppercase',
                letterSpacing: 0.77,
              }}
            >
              {court.type} · {court.surface}
            </Text>
          </View>
        </View>
        <Text style={{ fontFamily: TOKENS.displaySemi, fontSize: 22, color: TOKENS.ink }}>
          €{Math.round(court.price_per_hour_cents / 100)}
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>
            {perHourLabel}
          </Text>
        </Text>
      </View>
    </PressScale>
  );
}

// The venue's CFA day, grouped by kick-off. A card per match: court and age
// group on top, the two teams below, each a tap target. "Now" while it is
// on, "postponed" when the owner said so. No scores, ever (ADR-0050).
function CfaSaturday({
  saturday,
  locale,
  onTeam,
}: {
  saturday: VenueSaturday;
  locale: 'en' | 'gr';
  onTeam: (teamId: string, name: string, category: string | null) => void;
}) {
  const { t } = useTranslation();
  const now = Date.now();
  const isToday = saturday.date === cyprusDate(new Date());
  const day = isToday ? t('cfaToday') : cyprusDay(saturday.matches[0]!.kickoff_at, locale);

  const groups: { time: string; list: VenueFixture[] }[] = [];
  for (const m of saturday.matches) {
    const time = cyprusTime(m.kickoff_at);
    const last = groups[groups.length - 1];
    if (last && last.time === time) last.list.push(m);
    else groups.push({ time, list: [m] });
  }

  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: 24, gap: 10 }}>
      <Text
        style={{
          fontFamily: TOKENS.monoMedium,
          fontSize: 11,
          color: TOKENS.primaryDeep,
          textTransform: 'uppercase',
          letterSpacing: 0.88,
        }}
      >
        {t('cfaEyebrow', { day })}
      </Text>
      <Text style={{ fontFamily: TOKENS.ui, fontSize: 13.5, color: TOKENS.ink2 }}>{t('cfaTapTeam')}</Text>
      {groups.map((g) => (
        <View key={g.time} style={{ gap: 8 }}>
          <Text style={{ fontFamily: TOKENS.monoBold, fontSize: 15, color: TOKENS.ink, marginTop: 6 }}>{g.time}</Text>
          {g.list.map((m) => {
            const live =
              m.status === 'scheduled' && Date.parse(m.kickoff_at) <= now && now < Date.parse(m.ends_at);
            return (
              <View
                key={m.match_id}
                style={[
                  {
                    borderRadius: RADII.lg,
                    borderCurve: 'continuous',
                    backgroundColor: TOKENS.surface,
                    borderColor: live ? TOKENS.primary : TOKENS.line,
                    borderWidth: live ? 2 : StyleSheet.hairlineWidth,
                    padding: 14,
                    gap: 8,
                  },
                  ELEV.e1,
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {m.court ? (
                    <Text style={{ fontFamily: TOKENS.monoMedium, fontSize: 11, color: TOKENS.ink, letterSpacing: 0.5 }}>
                      {m.court.toUpperCase()}
                    </Text>
                  ) : null}
                  {m.category ? (
                    <Text style={{ fontFamily: TOKENS.mono, fontSize: 11, color: TOKENS.ink3, letterSpacing: 0.5 }}>
                      {m.category}
                    </Text>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  {m.status === 'postponed' ? (
                    <Text style={{ fontFamily: TOKENS.monoMedium, fontSize: 10.5, color: TOKENS.terraDeep, letterSpacing: 0.6 }}>
                      {t('cfaPostponed').toUpperCase()}
                    </Text>
                  ) : live ? (
                    <Text style={{ fontFamily: TOKENS.monoMedium, fontSize: 10.5, color: TOKENS.primaryDeep, letterSpacing: 0.6 }}>
                      {t('cfaNow').toUpperCase()}
                    </Text>
                  ) : null}
                </View>
                <TeamLine
                  name={m.home}
                  following={m.following_home}
                  onPress={() => onTeam(m.home_team_id, m.home, m.category)}
                />
                <TeamLine
                  name={m.away}
                  following={m.following_away}
                  onPress={() => onTeam(m.away_team_id, m.away, m.category)}
                />
              </View>
            );
          })}
        </View>
      ))}
      <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>{t('cfaNoScores')}</Text>
    </View>
  );
}

function TeamLine({ name, following, onPress }: { name: string; following: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Press
      feel="control"
      onPress={onPress}
      hitSlop={4}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
    >
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: TOKENS.displaySemi, fontSize: 17, color: TOKENS.ink }}>
        {name}
      </Text>
      {following ? (
        <Text style={{ fontFamily: TOKENS.monoMedium, fontSize: 10, color: TOKENS.pitchDeep, letterSpacing: 0.6 }}>
          ✓ {t('cfaFollowing').toUpperCase()}
        </Text>
      ) : null}
    </Press>
  );
}
