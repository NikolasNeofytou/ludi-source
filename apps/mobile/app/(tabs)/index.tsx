// Discover tab — M2 #7, "Chalk & Aegean" pass (design handoff 2026-08-10);
// home reorg 2026-08-31: next-match strip + time-aware greeting + header
// language pill. Pitches come from Supabase per docs/api-contract.md §3.1.
// The commercial screen: image-led PitchCards over the generated field tile
// (there is no pitch photography yet — the tile IS the visual identity, not
// a placeholder). Order of answers: "when do I play next?" (strip, only when
// a fixture exists), then "where can I play?" (mini-map of partner venues
// where the platform can render one, then the venue list).

import {
  Button,
  Card,
  EmptyState,
  FieldTile,
  FORMAT_DOT,
  Icon,
  MOTION,
  Press,
  PressScale,
  RADII,
  ROW_LAYOUT,
  Reveal,
  RiseIn,
  Skeleton,
  ELEV,
  Tag,
  Tally,
  TOKENS,
  effect,
  useReduceMotion,
  useSettled,
} from '@ludi/ui';
import { useFocusEffect, useRouter, useScrollToTop } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FilterPill } from '@/components/FilterPill';
import { HomeMapCard, MAP_AVAILABLE, type MapPin } from '@/components/HomeMapCard';
import { cyprusTime, fetchCfaToday, type CfaToday } from '@/lib/cfa';
import { capture, pinBucket } from '@/lib/analytics';
import { fetchOpenMatches, type OpenMatch } from '@/lib/fixture';
import { fetchKeeperRequests, type KeeperRequest } from '@/lib/keeper';
import { venueTimeStr } from '@/lib/pitch-detail';
import {
  fetchMyBookings,
  formatStart,
  relativeHeadline,
  segmentBookings,
  type BookingListItem,
  type BookingState,
} from '@/lib/bookings-list';
import { setLocale } from '@/lib/i18n';
import {
  fetchEnabledCities,
  fetchPitchesInCity,
  groupPitchesByVenue,
  type CityRow,
  type PitchListItem,
  type VenueListItem,
} from '@/lib/pitches';

type FilterId = 'tonight' | 'fiveAside' | 'indoor' | 'underForty';

// What is on at a venue, for its pin and its row (plans/maps.md M2).
interface ActivityItem {
  /** The booking. */
  key: string;
  kind: 'game' | 'keeper';
  startsAt: string;
  /** "21:00 · 2 spots" or "23:00 · keeper wanted", already in the language. */
  label: string;
  /** A game's invite; null for a keeper wanted, which lives on the board. */
  inviteToken: string | null;
}

// `copyIndex` lines up with COPY.filters[0..3]. 'Tonight' (plans/maps.md)
// is not a pitch predicate: it narrows the map and the list to the venues
// with a game or a keeper request tonight, computed below.
const FILTER_CONFIG: Array<{
  id: FilterId;
  copyIndex: number;
  predicate: (p: PitchListItem) => boolean;
}> = [
  { id: 'tonight', copyIndex: 0, predicate: () => true },
  { id: 'fiveAside', copyIndex: 1, predicate: (p) => p.type === '5-a-side' },
  { id: 'indoor', copyIndex: 2, predicate: (p) => p.surface === 'indoor' },
  { id: 'underForty', copyIndex: 3, predicate: (p) => p.price_per_hour_cents < 4000 },
];

type LoadState =
  | { status: 'loading' }
  | { status: 'success'; pitches: PitchListItem[] }
  | { status: 'error'; message: string };

export default function DiscoverScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const filterCopy = t('filters', { returnObjects: true }) as string[];

  const [cities, setCities] = useState<CityRow[]>([]);
  const [citiesError, setCitiesError] = useState<string | null>(null);
  const [activeCityId, setActiveCityId] = useState<string | null>(null);
  const [pitchesState, setPitchesState] = useState<LoadState>({ status: 'loading' });
  const [activeFilters, setActiveFilters] = useState<Set<FilterId>>(new Set());
  const [nextMatch, setNextMatch] = useState<BookingListItem | null>(null);
  // Activity for the map (plans/maps.md): the board's games and the keeper
  // requests, island-wide; narrowed to the active city below.
  const [openMatches, setOpenMatches] = useState<OpenMatch[]>([]);
  const [keeperWanted, setKeeperWanted] = useState<KeeperRequest[]>([]);
  // Today's CFA mornings in the city (plans/cfa-in-the-app.md K7): a card
  // per venue with the count and the next kick-off. Secondary, like the
  // strip — absent on failure, absent on any day without one.
  const [cfaToday, setCfaToday] = useState<CfaToday[]>([]);

  // Next-match strip data. Refetched on every tab focus so booking a pitch
  // and returning home shows it immediately. Secondary data: on failure the
  // strip simply stays absent — the home screen never errors over it.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchMyBookings()
        .then((rows) => {
          if (cancelled) return;
          setNextMatch(segmentBookings(rows).upcoming[0] ?? null);
        })
        .catch(() => {});
      fetchOpenMatches()
        .then((rows) => {
          if (!cancelled) setOpenMatches(rows);
        })
        .catch(() => {});
      fetchKeeperRequests()
        .then((rows) => {
          if (!cancelled) setKeeperWanted(rows);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, []),
  );

  useEffect(() => {
    let cancelled = false;
    fetchEnabledCities()
      .then((rows) => {
        if (cancelled) return;
        setCities(rows);
        setActiveCityId(rows[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCitiesError(err instanceof Error ? err.message : 'unknown');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hold the in-flight cancellation in a ref so direct callers (Retry CTA)
  // also abandon the prior request — see the M2 #7 note in git history.
  const cancelLoadRef = useRef<(() => void) | null>(null);

  const loadPitches = useCallback((cityId: string) => {
    cancelLoadRef.current?.();
    setPitchesState({ status: 'loading' });
    let cancelled = false;
    cancelLoadRef.current = () => {
      cancelled = true;
    };
    fetchPitchesInCity(cityId)
      .then((rows) => {
        if (cancelled) return;
        setPitchesState({ status: 'success', pitches: rows });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPitchesState({
          status: 'error',
          message: err instanceof Error ? err.message : 'unknown',
        });
      });
  }, []);

  useEffect(() => {
    if (!activeCityId) return;
    loadPitches(activeCityId);
    return () => cancelLoadRef.current?.();
  }, [activeCityId, loadPitches]);

  useFocusEffect(
    useCallback(() => {
      if (!activeCityId) return;
      let cancelled = false;
      fetchCfaToday(activeCityId)
        .then((rows) => {
          if (!cancelled) setCfaToday(rows);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [activeCityId]),
  );

  // Pull-to-refresh refetches in place — the list stays visible (no skeleton
  // flash), and a failed refresh keeps what's on screen rather than erroring.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    if (!activeCityId) return;
    setRefreshing(true);
    fetchPitchesInCity(activeCityId)
      .then((rows) => setPitchesState({ status: 'success', pitches: rows }))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [activeCityId]);

  const toggleFilter = useCallback((id: FilterId) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const visiblePitches = useMemo(() => {
    if (pitchesState.status !== 'success') return [];
    if (activeFilters.size === 0) return pitchesState.pitches;
    const predicates = FILTER_CONFIG.filter((f) => activeFilters.has(f.id)).map((f) => f.predicate);
    return pitchesState.pitches.filter((p) => predicates.every((pred) => pred(p)));
  }, [pitchesState, activeFilters]);

  // Venue-first list: a venue appears when at least one pitch matches the
  // active filters; court count and from-price describe the matching subset.
  const visibleVenues = useMemo(() => groupPitchesByVenue(visiblePitches), [visiblePitches]);

  // The map shows activity, not inventory (plans/maps.md): this city's open
  // games and keeper requests as pins, the venues under them. "Tonight"
  // narrows both to kickoffs before five tomorrow morning.
  const tonightActive = activeFilters.has('tonight');
  const cityVenueIds = useMemo(
    () => new Set(pitchesState.status === 'success' ? pitchesState.pitches.map((p) => p.venue.id) : []),
    [pitchesState],
  );
  const cityGames = useMemo(
    () => openMatches.filter((m) => cityVenueIds.has(m.venue_id) && (!tonightActive || isTonight(m.starts_at))),
    [openMatches, cityVenueIds, tonightActive],
  );
  const cityKeepers = useMemo(
    () => keeperWanted.filter((k) => cityVenueIds.has(k.venue_id) && (!tonightActive || isTonight(k.starts_at))),
    [keeperWanted, cityVenueIds, tonightActive],
  );
  const listedVenues = useMemo(
    () =>
      tonightActive
        ? visibleVenues.filter(
            (v) => cityGames.some((g) => g.venue_id === v.id) || cityKeepers.some((k) => k.venue_id === v.id),
          )
        : visibleVenues,
    [tonightActive, visibleVenues, cityGames, cityKeepers],
  );
  // One pin per venue (plans/maps.md): a booking on the board is a game
  // (the wider audience; its invite shows the keeper's seat too), a request
  // on a private booking is a keeper wanted. The venue's row beneath lists
  // the same items, so a pin with several opens the row.
  const activityByVenue = useMemo(() => {
    const byVenue = new Map<string, ActivityItem[]>();
    const add = (venueId: string, item: ActivityItem) => {
      const list = byVenue.get(venueId) ?? [];
      list.push(item);
      byVenue.set(venueId, list);
    };
    const onBoard = new Set(cityGames.map((g) => g.booking_id));
    for (const g of cityGames) {
      const spots = Math.max(0, g.gk_open) + Math.max(0, g.outfield_open);
      const time = venueTimeStr(g.starts_at);
      add(g.venue_id, {
        key: g.booking_id,
        kind: 'game',
        startsAt: g.starts_at,
        label: spots === 1 ? t('mapPinSpotsOne', { time }) : t('mapPinSpots', { time, count: spots }),
        inviteToken: g.invite_token,
      });
    }
    for (const k of cityKeepers) {
      if (onBoard.has(k.booking_id)) continue;
      add(k.venue_id, {
        key: k.booking_id,
        kind: 'keeper',
        startsAt: k.starts_at,
        label: t('mapPinKeeper', { time: venueTimeStr(k.starts_at) }),
        inviteToken: null,
      });
    }
    for (const list of byVenue.values()) {
      list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    }
    return byVenue;
  }, [cityGames, cityKeepers, t]);
  const mapPins = useMemo<MapPin[]>(() => {
    const point = new Map<string, { lat: number; lng: number; name: string }>();
    for (const g of cityGames) {
      if (g.lat != null && g.lng != null) point.set(g.venue_id, { lat: g.lat, lng: g.lng, name: g.venue_name });
    }
    for (const k of cityKeepers) {
      if (k.lat != null && k.lng != null) point.set(k.venue_id, { lat: k.lat, lng: k.lng, name: k.venue_name });
    }
    const pins: MapPin[] = [];
    for (const [venueId, items] of activityByVenue) {
      const at = point.get(venueId);
      const first = items[0];
      if (!at || !first) continue;
      pins.push({
        id: venueId,
        kind: items.every((i) => i.kind === 'keeper') ? 'keeper' : 'game',
        lat: at.lat,
        lng: at.lng,
        title: at.name,
        label:
          items.length === 1
            ? first.label
            : t('mapPinGames', { time: venueTimeStr(first.startsAt), count: items.length }),
      });
    }
    for (const v of listedVenues) {
      if (v.lat == null || v.lng == null || activityByVenue.has(v.id)) continue;
      pins.push({ id: v.id, kind: 'venue', lat: v.lat, lng: v.lng, title: v.name });
    }
    return pins;
  }, [activityByVenue, cityGames, cityKeepers, listedVenues, t]);
  const hasPins = mapPins.length > 0;
  useEffect(() => {
    if (hasPins) capture('map_shown', { surface: 'discover', pins: pinBucket(mapPins.length) });
    // Once per city with pins; the count is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPins, activeCityId]);

  // Tap a pin, the row opens: one game, its invite; a keeper wanted, the
  // board; several, the venue's row lights up under the map for a moment.
  const scrollRef = useRef<ScrollView>(null);
  // Tapping Discover while on it goes back to the top (plans/motion-v3.md).
  useScrollToTop(scrollRef);
  const listYRef = useRef(0);
  const cardYRef = useRef<Record<string, number>>({});
  const [litVenueId, setLitVenueId] = useState<string | null>(null);
  useEffect(() => {
    if (!litVenueId) return;
    const timer = setTimeout(() => setLitVenueId(null), 3000);
    return () => clearTimeout(timer);
  }, [litVenueId]);
  const openActivity = useCallback(
    (item: ActivityItem) => {
      if (item.kind === 'game' && item.inviteToken) router.push(`/f/${item.inviteToken}`);
      else router.push('/(tabs)/community');
    },
    [router],
  );
  const onPinPress = useCallback(
    (pin: MapPin) => {
      capture('map_pin_tapped', { surface: 'discover', kind: pin.kind });
      const items = activityByVenue.get(pin.id) ?? [];
      const listed = listedVenues.some((v) => v.id === pin.id);
      if (items.length === 1 && items[0]) {
        openActivity(items[0]);
      } else if (items.length > 1 && listed) {
        setLitVenueId(pin.id);
        const y = listYRef.current + (cardYRef.current[pin.id] ?? 0) - 12;
        scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true });
      } else {
        router.push(`/venue/${pin.id}`);
      }
    },
    [activityByVenue, listedVenues, openActivity, router],
  );

  const activeCity = cities.find((c) => c.id === activeCityId);
  const cityName = activeCity
    ? i18n.language === 'gr'
      ? activeCity.name_gr
      : activeCity.name_en
    : '';
  const locale = i18n.language === 'gr' ? 'gr' : 'en';

  // Greeting follows the clock — Kaliméra until noon, Kalispéra after. The
  // 05:00 lower bound keeps post-midnight sessions on the evening greeting.
  const hour = new Date().getHours();
  const isMorning = hour >= 5 && hour < 12;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        // Scrolls under the floating tab bar and stops clear of it.
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TOKENS.ink3} />
        }
      >
        <View style={{ padding: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text
              style={{
                fontFamily: TOKENS.monoMedium,
                fontSize: 11,
                color: TOKENS.ink3,
                textTransform: 'uppercase',
                letterSpacing: 0.88,
              }}
            >
              {cityName || ' '}
            </Text>
            <Text
              style={{
                fontFamily: TOKENS.displaySemi,
                fontSize: 34,
                color: TOKENS.ink,
                letterSpacing: -0.68,
                lineHeight: 38,
              }}
            >
              {t(isMorning ? 'greetMorning' : 'greet')}.
            </Text>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2 }}>
              {t(isMorning ? 'greetSubMorning' : 'greetSub')}
            </Text>
          </View>
          {/* A choice made in place, so a Pick: it never shows as selected —
              the whole screen changing language is the answer. */}
          <FilterPill
            active={false}
            label={locale === 'en' ? 'ΕΛ' : 'EN'}
            onPress={() => setLocale(locale === 'en' ? 'gr' : 'en')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('langToggleA11y')}
          />
        </View>

        {/* The strip and the CFA cards resolve after the list has drawn: each
            arrives as a Reveal, and what is below glides down to make room
            instead of jumping (plans/motion-v3.md, "The tabs"). */}
        {nextMatch && (
          <Reveal style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
            <NextMatchStrip
              booking={nextMatch}
              locale={locale}
              relTonight={t('relTonight')}
              relTomorrow={t('relTomorrow')}
              onPress={() =>
                router.push({ pathname: '/booking/[id]', params: { id: nextMatch.id } })
              }
            />
          </Reveal>
        )}

        <Animated.View layout={ROW_LAYOUT}>
          {cities.length > 1 && (
            <View style={{ paddingHorizontal: 20, paddingBottom: 4, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {cities.map((city) => (
                <FilterPill
                  key={city.id}
                  active={city.id === activeCityId}
                  lifted
                  label={i18n.language === 'gr' ? city.name_gr : city.name_en}
                  onPress={() => setActiveCityId(city.id)}
                />
              ))}
            </View>
          )}

          <View style={{ paddingHorizontal: 20, flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {FILTER_CONFIG.map((f) => (
              <FilterPill
                key={f.id}
                active={activeFilters.has(f.id)}
                lifted
                label={filterCopy[f.copyIndex] ?? ''}
                onPress={() => toggleFilter(f.id)}
              />
            ))}
          </View>

          {cfaToday.length > 0 && (
            <Reveal style={{ paddingHorizontal: 20, paddingTop: 20, gap: 10 }}>
              <Text
                style={{
                  fontFamily: TOKENS.monoMedium,
                  fontSize: 10.5,
                  color: TOKENS.primaryDeep,
                  textTransform: 'uppercase',
                  letterSpacing: 0.84,
                }}
              >
                {t('cfaTodayEyebrow')}
              </Text>
              {cfaToday.map((c) => (
                <PressScale key={c.venue_id} onPress={() => router.push({ pathname: '/venue/[id]', params: { id: c.venue_id } })}>
                  <Card elevation="e1" radius="lg">
                    <View style={{ padding: 16, gap: 4 }}>
                      <Text style={{ fontFamily: TOKENS.displaySemi, fontSize: 18, color: TOKENS.ink }}>{c.venue_name}</Text>
                      <Text style={{ fontFamily: TOKENS.ui, fontSize: 13.5, color: TOKENS.ink2 }}>
                        {c.next_kickoff
                          ? t('cfaTodayLine', { count: c.matches, time: cyprusTime(c.next_kickoff) })
                          : t('cfaTodayDone', { count: c.matches })}
                      </Text>
                    </View>
                  </Card>
                </PressScale>
              ))}
            </Reveal>
          )}

          {/* The map needs the activity reads as well as the list, so it is
              often the last thing in: same arrival, same glide. */}
          {MAP_AVAILABLE && pitchesState.status === 'success' && hasPins && (
            <Reveal style={{ paddingHorizontal: 20, paddingTop: 20, gap: 10 }}>
              <Text
                style={{
                  fontFamily: TOKENS.monoMedium,
                  fontSize: 10.5,
                  color: TOKENS.ink3,
                  textTransform: 'uppercase',
                  letterSpacing: 0.84,
                }}
              >
                {t('homeMapSection')}
              </Text>
              <HomeMapCard pins={mapPins} a11yLabel={t('homeMapA11y')} onPinPress={onPinPress} />
            </Reveal>
          )}

          <Animated.View layout={ROW_LAYOUT}>
            {pitchesState.status === 'success' && listedVenues.length > 0 && (
              <View
                style={{
                  paddingHorizontal: 20,
                  paddingTop: 20,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Text style={SECTION_EYEBROW}>{t('homePitchesSection')} —</Text>
                {/* A filter narrowing the list is seen in its count too. */}
                <Tally value={listedVenues.length} style={SECTION_EYEBROW} />
              </View>
            )}

            {tonightActive && pitchesState.status === 'success' && listedVenues.length === 0 ? (
              <Reveal>
                <Text
                  style={{
                    paddingHorizontal: 20,
                    paddingTop: 20,
                    fontFamily: TOKENS.ui,
                    fontSize: 14,
                    color: TOKENS.ink2,
                    lineHeight: 20,
                  }}
                >
                  {t('homeTonightEmpty')}
                </Text>
              </Reveal>
            ) : (
            <VenueList
              state={pitchesState}
              visible={listedVenues}
              activity={activityByVenue}
              litVenueId={litVenueId}
              onActivityPress={openActivity}
              onListLayout={(y) => {
                listYRef.current = y;
              }}
              onCardLayout={(venueId, y) => {
                cardYRef.current[venueId] = y;
              }}
              emptyTitle={t('discoverEmptyTitle', { city: cityName })}
              emptyBody={t('discoverEmptyBody')}
              errorLabel={t('discoverError')}
              retryLabel={t('discoverRetry')}
              perHourLabel={t('perHour')}
              courtsLabel={(n) => (n === 1 ? t('courtsOne') : t('courtsOther', { count: n }))}
              fromLabel={t('fromLabel')}
              onRetry={() => activeCityId && loadPitches(activeCityId)}
              onVenuePress={(venueId) => router.push(`/venue/${venueId}`)}
            />
            )}

            {citiesError && (
              <Text
                style={{
                  paddingHorizontal: 20,
                  paddingTop: 12,
                  fontFamily: TOKENS.ui,
                  fontSize: 13,
                  color: TOKENS.ink3,
                }}
              >
                {t('discoverError')}
              </Text>
            )}
          </Animated.View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const SECTION_EYEBROW = {
  fontFamily: TOKENS.monoMedium,
  fontSize: 10.5,
  color: TOKENS.ink3,
  textTransform: 'uppercase',
  letterSpacing: 0.84,
} as const;

// Only the four active states can reach the strip (segmentBookings keeps
// terminal states out of `upcoming`). State is never an edge stripe (design
// correction 2026-08-31) — it rides in a Tag; soft fill + deep text pairs.
const STATE_TAG_FILL: Partial<Record<BookingState, string>> = {
  pending: TOKENS.sunSoft,
  collecting: TOKENS.sunSoft,
  paid: TOKENS.pitchSoft,
  confirmed: TOKENS.pitchSoft,
};
const STATE_TAG_TEXT: Partial<Record<BookingState, string>> = {
  pending: TOKENS.sunDeep,
  collecting: TOKENS.sunDeep,
  paid: TOKENS.pitchDeep,
  confirmed: TOKENS.pitchDeep,
};
const STATE_TAG_DOT: Partial<Record<BookingState, string>> = {
  pending: TOKENS.sun,
  collecting: TOKENS.sun,
  paid: TOKENS.pitch,
  confirmed: TOKENS.pitch,
};

// The answer to "when do I play next?", pinned under the greeting. Compact
// on purpose: overline + when + where + (only if actionable) squad gap.
function NextMatchStrip({
  booking,
  locale,
  relTonight,
  relTomorrow,
  onPress,
}: {
  booking: BookingListItem;
  locale: 'en' | 'gr';
  relTonight: string;
  relTomorrow: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const stateLabels = t('bookingState', { returnObjects: true }) as Record<BookingState, string>;
  const when =
    relativeHeadline(booking.starts_at, locale, relTonight, relTomorrow) ??
    formatStart(booking.starts_at, locale);
  const squadShort = booking.squad.filled < booking.squad.total;
  return (
    <PressScale onPress={onPress}>
      <Card elevation="e2" radius="lg" style={{ overflow: 'hidden' }}>
        <View style={{ padding: 16, gap: 6 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Text
              style={{
                fontFamily: TOKENS.monoMedium,
                fontSize: 10.5,
                color: TOKENS.primaryDeep,
                textTransform: 'uppercase',
                letterSpacing: 0.84,
              }}
            >
              {t('homeNextMatch')}
            </Text>
            <Tag
              label={stateLabels[booking.state] ?? booking.state}
              fill={STATE_TAG_FILL[booking.state] ?? TOKENS.pitchSoft}
              color={STATE_TAG_TEXT[booking.state] ?? TOKENS.pitchDeep}
              dot={STATE_TAG_DOT[booking.state] ?? TOKENS.pitch}
            />
          </View>
          <Text
            style={{
              fontFamily: TOKENS.displaySemi,
              fontSize: 22,
              color: TOKENS.ink,
              letterSpacing: -0.44,
            }}
          >
            {when}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontFamily: TOKENS.ui, fontSize: 13.5, color: TOKENS.ink3 }}
          >
            {booking.pitch.name} · {booking.pitch.venue.name}
          </Text>
          {squadShort && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text
                style={{
                  fontFamily: TOKENS.monoMedium,
                  fontSize: 11,
                  color: TOKENS.ink2,
                  letterSpacing: 0.5,
                }}
              >
                {t('bookingsRowSquad', {
                  filled: booking.squad.filled,
                  total: booking.squad.total,
                })}
              </Text>
              {booking.squad.gkFilled < booking.squad.gkTotal && (
                <Text
                  style={{
                    fontFamily: TOKENS.monoMedium,
                    fontSize: 11,
                    color: TOKENS.sunDeep,
                    letterSpacing: 0.5,
                  }}
                >
                  · {t('bookingsRowKeeperNeeded')}
                </Text>
              )}
            </View>
          )}
        </View>
      </Card>
    </PressScale>
  );
}

function VenueList({
  state,
  visible,
  emptyTitle,
  emptyBody,
  errorLabel,
  retryLabel,
  perHourLabel,
  courtsLabel,
  fromLabel,
  onRetry,
  onVenuePress,
  activity,
  litVenueId,
  onActivityPress,
  onListLayout,
  onCardLayout,
}: {
  state: LoadState;
  visible: VenueListItem[];
  emptyTitle: string;
  emptyBody: string;
  errorLabel: string;
  retryLabel: string;
  perHourLabel: string;
  courtsLabel: (n: number) => string;
  fromLabel: string;
  onRetry: () => void;
  onVenuePress: (venueId: string) => void;
  activity: Map<string, ActivityItem[]>;
  litVenueId: string | null;
  onActivityPress: (item: ActivityItem) => void;
  /** Where the list and each card sit in the scroll, so a pin can find its row. */
  onListLayout: (y: number) => void;
  onCardLayout: (venueId: string, y: number) => void;
}) {
  // The first screenful rises (RiseIn); after that a card that comes back
  // under a filter arrives as news, and one that goes fades while the rest
  // glide up — survivors no longer jump, returners no longer re-rise
  // (plans/motion-v3.md, "The tabs"). A city change resets it.
  const settled = useSettled(state.status === 'success');
  if (state.status === 'loading') {
    // Leaves on a fade, so it cross-fades with the cards rising in its
    // place instead of blinking out first.
    return (
      <Animated.View
        exiting={FadeOut.duration(MOTION.instant)}
        style={{ paddingHorizontal: 20, paddingTop: 16, gap: 12 }}
      >
        <Skeleton variant="card" />
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </Animated.View>
    );
  }
  if (state.status === 'error') {
    return (
      <Reveal style={{ padding: 40, alignItems: 'center', gap: 12 }}>
        <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, color: TOKENS.ink2 }}>
          {errorLabel}
        </Text>
        <Button variant="secondary" size="sm" onPress={onRetry}>
          {retryLabel}
        </Button>
      </Reveal>
    );
  }
  if (visible.length === 0) {
    return (
      <Reveal>
        <EmptyState
          icon={Icon.pin(TOKENS.terracotta, 44)}
          title={emptyTitle}
          body={emptyBody}
        />
      </Reveal>
    );
  }
  return (
    <View
      style={{ paddingHorizontal: 20, paddingTop: 16, gap: 12 }}
      onLayout={(e) => onListLayout(e.nativeEvent.layout.y)}
    >
      {visible.map((v, i) => (
        <Reveal key={v.id} enter={settled} onLayout={(e) => onCardLayout(v.id, e.nativeEvent.layout.y)}>
          <RiseIn index={i} animateFirst={settled ? 0 : 6}>
            <VenueCard
              venue={v}
              perHourLabel={perHourLabel}
              courtsLabel={courtsLabel}
              fromLabel={fromLabel}
              activity={activity.get(v.id)}
              lit={litVenueId === v.id}
              onPress={() => onVenuePress(v.id)}
              onActivityPress={onActivityPress}
            />
          </RiseIn>
        </Reveal>
      ))}
    </View>
  );
}

// Card entry animation is the shared RiseIn from @ludi/ui — fade + 14px rise,
// 200ms, 40ms stagger, first six items only, reduce-motion aware.

function VenueCard({
  venue,
  perHourLabel,
  courtsLabel,
  fromLabel,
  activity,
  lit = false,
  onPress,
  onActivityPress,
}: {
  venue: VenueListItem;
  perHourLabel: string;
  courtsLabel: (n: number) => string;
  fromLabel: string;
  /** Tonight's games and keeper requests here — the same items as the pin. */
  activity?: ActivityItem[];
  /** Lit for a moment after its pin was tapped. */
  lit?: boolean;
  onPress: () => void;
  onActivityPress?: (item: ActivityItem) => void;
}) {
  const dot = FORMAT_DOT[venue.dominantType] ?? TOKENS.primary;
  // The pin's light, cross-faded on the UI thread rather than switched in
  // one frame — a ring laid over the card's own hairline, so lighting it
  // never shifts the card's content by a pixel.
  const reduceMotion = useReduceMotion();
  const glow = useSharedValue(lit ? 1 : 0);
  useEffect(() => {
    glow.value = effect(lit ? 1 : 0, reduceMotion, MOTION.quick);
  }, [lit, reduceMotion, glow]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
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
      <FieldTile format={venue.dominantType} height={170} />
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
            {venue.name}
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
              {courtsLabel(venue.courtCount)}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}
          >
            {venue.address}
          </Text>
        </View>
        <Text style={{ fontFamily: TOKENS.displaySemi, fontSize: 22, color: TOKENS.ink }}>
          {!venue.hasSinglePrice && (
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>
              {fromLabel}{' '}
            </Text>
          )}
          €{Math.round(venue.fromPriceCents / 100)}
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>
            {perHourLabel}
          </Text>
        </Text>
      </View>
      {activity && activity.length > 0 && (
        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: TOKENS.line,
            paddingHorizontal: 16,
            paddingVertical: 10,
            gap: 8,
          }}
        >
          {/* Each line is its own control: it gives under the finger, and
              the card behind it stays still. */}
          {activity.map((item) => (
            <Press
              key={item.key}
              feel="control"
              onPress={() => onActivityPress?.(item)}
              accessibilityLabel={item.label}
              hitSlop={{ top: 4, bottom: 4 }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: item.kind === 'keeper' ? TOKENS.sun : TOKENS.primary,
                }}
              />
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  fontFamily: TOKENS.monoMedium,
                  fontSize: 11.5,
                  color: TOKENS.ink,
                  letterSpacing: 0.3,
                }}
              >
                {item.label}
              </Text>
              {Icon.chevR(TOKENS.ink3, 14)}
            </Press>
          ))}
        </View>
      )}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: RADII.lg,
            borderCurve: 'continuous',
            borderWidth: 1.5,
            borderColor: TOKENS.primary,
          },
          glowStyle,
        ]}
      />
    </PressScale>
  );
}

// "Tonight": a kickoff from an hour ago until five tomorrow morning, on the
// device's clock (a Cypriot phone in Cyprus).
function isTonight(startsAt: string): boolean {
  const start = new Date(startsAt).getTime();
  const cutoff = new Date();
  if (cutoff.getHours() >= 5) cutoff.setDate(cutoff.getDate() + 1);
  cutoff.setHours(5, 0, 0, 0);
  return start >= Date.now() - 3_600_000 && start < cutoff.getTime();
}
