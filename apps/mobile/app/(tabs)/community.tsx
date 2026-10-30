// Community tab — the open-matches board (ADR-0028, plans/open-matches.md).
//
// Every fixture whose organiser opened it: when, where, format, what it is
// short of — counts, never names, the same minimisation the invite preview
// commits to, because a board row IS an invite anyone may follow. Tapping a
// row routes to `/f/<token>`, so joining (free or paid, signed-in or not-yet)
// runs through the one join path the app has, not a second one grown here.
//
// A flat list, soonest first, with client-side filter chips over it —
// pulled forward 2026-09-01 by founder request (plans/open-matches.md
// changelog), re-cut 2026-09-11 (community-v4.md unit 2): time chips
// (tonight · tomorrow · this weekend) replaced the format and venue chips,
// because at one-city density time is the axis that filters to something
// and geography is not. Keeper stays; city stays only when more than one
// city has a row. Filters stay client-side: the whole board is one query's
// worth of rows for a long time, and `open_board_filtered` measures
// whether they earn server-side support.
//
// Community v4 (plans/community-v4.md) turned the tab into one page with a
// fixed order — Yours · the board · your regulars · the shelf — and drew
// the partition that keeps it honest: the board lists short fixtures the
// caller is NOT on; *Yours* lists short fixtures the caller IS on, hosting
// or joined. A fixture never appears twice, and a row you already stand
// on never presents itself as joinable.

import {
  Button,
  Card,
  EmptyState,
  FieldTile,
  Icon,
  MOTION,
  Press,
  RADII,
  ROW_LAYOUT,
  Reveal,
  Skeleton,
  Tag,
  Tally,
  TOKENS,
  haptic,
  useSettled,
} from '@ludi/ui';
import { useFocusEffect, useRouter, useScrollToTop } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FilterPill } from '@/components/FilterPill';
import { capture } from '@/lib/analytics';
import {
  fetchMyBookings,
  formatStart,
  relativeHeadline,
  segmentBookings,
  type BookingListItem,
} from '@/lib/bookings-list';
import {
  fetchCityGroups,
  fetchCrewSeats,
  fetchMySeries,
  fetchOpenMatches,
  fetchWeekStats,
  formatFixtureTimeRange,
  seriesLineParts,
  type CityGroup,
  type CrewSeat,
  type OpenMatch,
  type Series,
  type WeekStats,
} from '@/lib/fixture';
import { formatFixtureDate } from '@/lib/fixture';
import { claimKeeperRequest, fetchKeeperRequests, KeeperError, type KeeperRequest } from '@/lib/keeper';

type LoadState =
  | { status: 'loading' }
  | { status: 'success'; matches: OpenMatch[] }
  | { status: 'error' };

type TimeKey = 'tonight' | 'tomorrow' | 'weekend';

// Day keys on the venue's clock — the same calendar the section labels
// use, so a chip and the section it reveals can never disagree.
const VENUE_TZ = 'Europe/Nicosia';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: VENUE_TZ, dateStyle: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: VENUE_TZ, weekday: 'short' });
const dayKey = (iso: string | Date) => dayFmt.format(typeof iso === 'string' ? new Date(iso) : iso);

/**
 * Which day keys each time chip stands for, computed from "now". "This
 * weekend" is the coming Saturday and Sunday — including today when today
 * is one of them (on a Sunday it collapses onto Tonight; that is correct,
 * not a bug: the chip only renders if a row is behind it).
 */
function timeWindows(now: Date): Record<TimeKey, Set<string>> {
  const day = (offset: number) => new Date(now.getTime() + offset * 24 * 3_600_000);
  const weekend = new Set<string>();
  for (let d = 0; d < 7; d++) {
    const date = day(d);
    const wd = weekdayFmt.format(date);
    if (wd === 'Sat' || wd === 'Sun') weekend.add(dayKey(date));
    if (wd === 'Sun') break;
  }
  return {
    tonight: new Set([dayKey(now)]),
    tomorrow: new Set([dayKey(day(1))]),
    weekend,
  };
}

export default function CommunityScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale: 'en' | 'gr' = i18n.language === 'gr' ? 'gr' : 'en';

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  // The shelf loads independently and fails silently to absence — standing
  // content must never block or error the board.
  const [cityGroups, setCityGroups] = useState<CityGroup[]>([]);
  const [weekStats, setWeekStats] = useState<WeekStats | null>(null);
  // Yours and the thread load the same way: independently, and to absence
  // on failure. Neither is the board, and neither may keep the board from
  // rendering. `mine` is every upcoming fixture the caller stands on — the
  // same read the Bookings tab makes — and it does two jobs here: the short
  // ones become *Yours*, and all of them are subtracted from the board.
  const [mine, setMine] = useState<BookingListItem[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  // Your crew's seats (ADR-0044): a teammate can't make it and is holding
  // the seat for whoever takes it. Loads to absence, like Yours.
  const [crew, setCrew] = useState<CrewSeat[]>([]);
  // Keepers wanted (ADR-0047): only ever rows for a player who said he goes
  // in goal — the view answers everyone else with nothing.
  const [keeperWanted, setKeeperWanted] = useState<KeeperRequest[]>([]);
  const [keeperBusy, setKeeperBusy] = useState<string | null>(null);
  const [keeperNote, setKeeperNote] = useState<string | null>(null);
  // One board-view event per focus, not per pull-to-refresh.
  const viewCaptured = useRef(false);
  // Tapping Community while on it goes back to the top (plans/motion-v3.md).
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  // Filters — time and city are exclusive picks (tap active to clear),
  // keeper-needed is a toggle. City is keyed by the EN value so a language
  // switch mid-session doesn't orphan an active filter.
  const [timeFilter, setTimeFilter] = useState<TimeKey | null>(null);
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [keeperOnly, setKeeperOnly] = useState(false);

  // 'quiet' is the tab coming back into focus with a board already on
  // screen: it re-reads behind the rows instead of throwing them back to a
  // skeleton on every visit (plans/motion-v3.md, slice 0), and a failure
  // keeps the board it has.
  const hasBoard = useRef(false);
  const load = useCallback(async (mode: 'initial' | 'refresh' | 'quiet') => {
    if (mode === 'initial') setState({ status: 'loading' });
    if (mode === 'refresh') setRefreshing(true);
    try {
      const matches = await fetchOpenMatches();
      hasBoard.current = true;
      setState({ status: 'success', matches });
      if (!viewCaptured.current) {
        viewCaptured.current = true;
        capture('open_board_viewed', { open_count: matches.length });
      }
    } catch {
      if (mode !== 'quiet') setState({ status: 'error' });
    } finally {
      if (mode === 'refresh') setRefreshing(false);
    }
  }, []);

  // Refetch on every focus — a board of other people's fixtures goes stale
  // in the background in a way the user's own bookings don't.
  useFocusEffect(
    useCallback(() => {
      viewCaptured.current = false;
      void load(hasBoard.current ? 'quiet' : 'initial');
      fetchCityGroups().then(setCityGroups).catch(() => setCityGroups([]));
      fetchWeekStats().then(setWeekStats).catch(() => setWeekStats(null));
      fetchMyBookings()
        .then((rows) => setMine(segmentBookings(rows).upcoming))
        .catch(() => setMine([]));
      fetchMySeries().then(setSeries).catch(() => setSeries([]));
      fetchCrewSeats().then(setCrew).catch(() => setCrew([]));
      fetchKeeperRequests().then(setKeeperWanted).catch(() => setKeeperWanted([]));
    }, [load]),
  );

  const openMatch = (m: OpenMatch) => {
    capture('open_match_tapped', { booking_id: m.booking_id, series_weeks: m.series_weeks });
    router.push(`/f/${m.invite_token}`);
  };

  // Yours' one action. Deliberately the same message the fixture screen
  // shares — one invite wording in the product, not two — and open to the
  // joiner as much as the organiser: the invite is a capability anyone on
  // the roster already holds (ADR-0021).
  const shareYours = (b: BookingListItem) => {
    capture('organiser_lane_shared', {
      booking_id: b.id,
      role: b.is_organiser ? 'hosting' : 'joined',
    });
    Share.share({
      message: t('fixtureShareInvite', {
        when: `${formatFixtureDate(b.starts_at, locale)} · ${formatFixtureTimeRange(b.starts_at, b.ends_at, locale)}`,
        venue: `${b.pitch.venue.name} · ${b.pitch.name}`,
        short: b.squad.total - b.squad.filled,
        link: `https://ludi.football/f/${b.invite_token}`,
      }),
    }).catch(() => {});
  };

  // The partition. Yours = short fixtures I stand on; the board = short
  // fixtures I do not. The subtraction runs on every fixture of mine, not
  // only the short ones, so a full fixture I organised and listed cannot
  // linger on the board as a row I could "join".
  // A crew seat or a keeper request is shown once, in its own section,
  // never again on the board.
  const mineIds = useMemo(
    () =>
      new Set([
        ...mine.map((b) => b.id),
        ...crew.map((c) => c.booking_id),
        ...keeperWanted.map((k) => k.booking_id),
      ]),
    [mine, crew, keeperWanted],
  );

  const claimKeeper = async (k: KeeperRequest) => {
    setKeeperBusy(k.request_id);
    setKeeperNote(null);
    try {
      const bookingId = await claimKeeperRequest(k.request_id);
      capture('keeper_claimed', { booking_id: bookingId });
      // In goal for someone's game: the second celebration, then the squad.
      router.push({
        pathname: '/booking/[id]/joined',
        params: {
          id: bookingId,
          starts_at: k.starts_at,
          ends_at: k.ends_at,
          where: [k.venue_name, k.pitch_name, locale === 'gr' ? k.city_name_gr : k.city_name_en]
            .filter(Boolean)
            .join(' · '),
        },
      });
    } catch (err) {
      const code = err instanceof KeeperError ? err.code : '';
      // Someone else got there first: a join refused (ADR-0035's error haptic).
      if (code === 'GK_ALREADY_TAKEN') haptic('error');
      setKeeperNote(code === 'GK_ALREADY_TAKEN' ? t('communityKeeperTaken') : t('communityKeeperError'));
      fetchKeeperRequests().then(setKeeperWanted).catch(() => {});
    } finally {
      setKeeperBusy(null);
    }
  };
  const yours = useMemo(
    () => mine.filter((b) => b.squad.filled < b.squad.total),
    [mine],
  );
  const matches = useMemo(
    () =>
      state.status === 'success'
        ? state.matches.filter((m) => !mineIds.has(m.booking_id))
        : [],
    [state, mineIds],
  );

  // Chip options come from the rows themselves — a day or city with no
  // open match behind it is not worth a dead chip. Time windows are cut
  // from "now" once per board load, not per render.
  const windows = useMemo(() => timeWindows(new Date()), [matches]);
  const timeOptions = useMemo(
    () =>
      (['tonight', 'tomorrow', 'weekend'] as const).filter((k) =>
        matches.some((m) => windows[k].has(dayKey(m.starts_at))),
      ),
    [matches, windows],
  );
  const cityOptions = useMemo(
    () =>
      [...new Map(matches.map((m) => [m.city_name_en, m])).values()].map((m) => ({
        key: m.city_name_en,
        label: locale === 'gr' ? m.city_name_gr : m.city_name_en,
      })),
    [matches, locale],
  );

  const applyFilters = (next: { time?: TimeKey | null; city?: string | null; keeper?: boolean }) => {
    const time = next.time !== undefined ? next.time : timeFilter;
    const city = next.city !== undefined ? next.city : cityFilter;
    const keeper = next.keeper !== undefined ? next.keeper : keeperOnly;
    setTimeFilter(time);
    setCityFilter(city);
    setKeeperOnly(keeper);
    capture('open_board_filtered', { time, city, keeper_only: keeper });
  };

  const visible = matches.filter(
    (m) =>
      (timeFilter === null || windows[timeFilter].has(dayKey(m.starts_at))) &&
      (cityFilter === null || m.city_name_en === cityFilter) &&
      (!keeperOnly || m.gk_open > 0),
  );
  // Chips only make sense once the list can outgrow them: a single row's
  // board renders chip-free.
  const showFilters = matches.length > 1;
  const keeperShort = matches.filter((m) => m.gk_open > 0).length;
  // Capacity, not population (community-v4.md unit 3): the header states
  // spots open, never matches — a small match count reads as "nobody comes
  // here"; a small spot count reads as "nearly full".
  const spotsOpen = matches.reduce((n, m) => n + m.gk_open + m.outfield_open, 0);

  // Day sections — matchday-listings structure. Keys are venue-timezone
  // days; labels reuse the relative vocabulary the rows gave up (the pill
  // inside a section shows pure kickoff time, the section carries the day).
  const sections = useMemo(() => {
    const today = dayKey(new Date());
    const tomorrow = dayKey(new Date(Date.now() + 24 * 3_600_000));
    const out: Array<{ label: string; items: OpenMatch[] }> = [];
    for (const m of visible) {
      const key = dayKey(m.starts_at);
      const label =
        key === today
          ? t('relTonight')
          : key === tomorrow
            ? t('relTomorrow')
            : formatFixtureDate(m.starts_at, locale);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
  }, [visible, locale, t]);

  // The board arrives whole, cross-fading with its skeleton; after that a
  // chip or a refocus changes it row by row — a row that goes fades, a day
  // that empties folds away, the rest glide (plans/motion-v3.md, "The tabs").
  const boardSettled = useSettled(state.status === 'success');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <Text
            style={{
              fontFamily: TOKENS.displaySemi,
              fontSize: 32,
              color: TOKENS.ink,
              letterSpacing: -0.64,
            }}
          >
            {t('communityTitle')}
          </Text>
          {/* Create, present but small, at the top (community-v4.md unit 4
              — Meetup's "New event" pill, Strava's utility row). Join is the
              page's primary action; this is the one create affordance on
              the screen, and it routes to the ledger where opening a
              fixture actually lives. */}
          <Press
            feel="control"
            onPress={() => {
              capture('community_create_tapped', { yours_count: yours.length });
              router.push('/(tabs)/bookings');
            }}
            hitSlop={{ top: 8, bottom: 8 }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingVertical: 7,
              paddingHorizontal: 11,
              borderRadius: RADII.sm,
              borderCurve: 'continuous',
              borderWidth: 1,
              borderColor: TOKENS.lineBold,
              backgroundColor: TOKENS.surface,
              marginBottom: 4,
            }}
          >
            {Icon.plus(TOKENS.primaryDeep, 13)}
            <Text
              style={{
                fontFamily: TOKENS.monoMedium,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 0.66,
                color: TOKENS.primaryDeep,
              }}
            >
              {t('communityCreateCta')}
            </Text>
          </Press>
        </View>
        {/* The board states its own score once it has one — information as
            vividness (the round-1 criterion, applied to the header) — and
            the score is capacity, not population. It rolls when a spot
            fills behind the visitor's back. */}
        <Tally
          style={{ fontFamily: TOKENS.ui, fontSize: 13.5, color: TOKENS.ink3 }}
          value={
            matches.length === 0
              ? t('communityIntro')
              : [
                  spotsOpen === 1
                    ? t('communityOpenSpotsOne')
                    : t('communityOpenSpotsMany', { count: spotsOpen }),
                  keeperShort === 0
                    ? null
                    : keeperShort === 1
                      ? t('communityKeepersOne')
                      : t('communityKeepersMany', { count: keeperShort }),
                ]
                  .filter(Boolean)
                  .join(' · ')
          }
        />
      </View>

      {showFilters && (
        <Reveal
          style={{
            paddingHorizontal: 20,
            paddingBottom: 4,
            flexDirection: 'row',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {/* Time first — the universal first control in every booking app
              the research looked at — and only the windows a row falls in.
              Labels reuse the section vocabulary (Tonight / Tomorrow) so a
              chip names exactly the section it reveals. */}
          {timeOptions.map((k) => (
            <FilterPill
              key={k}
              active={timeFilter === k}
              label={
                k === 'tonight'
                  ? t('relTonight')
                  : k === 'tomorrow'
                    ? t('relTomorrow')
                    : t('communityFilterWeekend')
              }
              dot={TOKENS.primaryDeep}
              onPress={() => applyFilters({ time: timeFilter === k ? null : k })}
            />
          ))}
          <FilterPill
            active={keeperOnly}
            label={t('communityFilterKeeper')}
            dot={TOKENS.sun}
            activeFill={TOKENS.sun}
            activeColor={TOKENS.primaryDeep}
            onPress={() => applyFilters({ keeper: !keeperOnly })}
          />
          {/* City only once more than one city has a row — until then the
              chip would filter to everything or to nothing. */}
          {cityOptions.length > 1 &&
            cityOptions.map((c) => (
              <FilterPill
                key={c.key}
                active={cityFilter === c.key}
                label={c.label}
                dot={TOKENS.primary}
                onPress={() => applyFilters({ city: cityFilter === c.key ? null : c.key })}
              />
            ))}
        </Reveal>
      )}

      <ScrollView
        ref={scrollRef}
        // Scrolls under the floating tab bar and stops clear of it.
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 40, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load('refresh')}
            tintColor={TOKENS.ink2}
          />
        }
      >
        {/* Yours (community-v4.md unit 1) — above the board, because the
            person who carries a fixture has a job here and the browser does
            not. Hosting or joined: the role is a chip on the row, not a
            section. Capped, and one line per row, so it structurally cannot
            out-shout the matches the tab exists to show (the v3 defect).
            Absent entirely for most people most of the time, and it sits
            outside the board's load state on purpose: someone two players
            short still needs this when the board itself is empty. */}
        {/* Six reads resolve separately here. Each section arrives as a
            Reveal and everything under it glides down to make room, so the
            board is never shoved (plans/motion-v3.md, "The tabs"). */}
        {yours.length > 0 && (
          <Reveal style={{ gap: 8, marginBottom: 4 }}>
            <SectionRule label={t('communityYoursLabel')} color={TOKENS.sunDeep} marginTop={0} />
            {yours.slice(0, YOURS_CAP).map((b) => (
              <YoursRow
                key={b.id}
                booking={b}
                locale={locale}
                onShare={() => shareYours(b)}
                onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })}
              />
            ))}
            {yours.length > YOURS_CAP && (
              <Press
                feel="control"
                onPress={() => router.push('/(tabs)/bookings')}
                hitSlop={{ top: 6, bottom: 6 }}
                style={{ paddingLeft: 4, alignSelf: 'flex-start' }}
              >
                <Text
                  style={{
                    fontFamily: TOKENS.monoMedium,
                    fontSize: 11,
                    color: TOKENS.ink3,
                    textTransform: 'uppercase',
                    letterSpacing: 0.66,
                  }}
                >
                  {t('communityYoursMore', { count: yours.length - YOURS_CAP })} →
                </Text>
              </Press>
            )}
          </Reveal>
        )}

        {/* Keepers wanted (ADR-0047) — games near you short a keeper, for a
            player who said he goes in goal. First, because a keeper is the
            one place that does not fill itself. */}
        {keeperWanted.length > 0 && (
          <Reveal style={{ gap: 8, marginBottom: 4 }}>
            <SectionRule label={t('communityKeepersLabel')} color={TOKENS.sunDeep} marginTop={0} />
            {keeperWanted.slice(0, YOURS_CAP).map((k) => (
              <KeeperRow
                key={k.request_id}
                req={k}
                locale={locale}
                busy={keeperBusy === k.request_id}
                onClaim={() => claimKeeper(k)}
              />
            ))}
            {keeperNote ? (
              <Reveal key={keeperNote}>
                <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.alertDeep, paddingLeft: 4 }}>
                  {keeperNote}
                </Text>
              </Reveal>
            ) : null}
          </Reveal>
        )}

        {/* From your crew (ADR-0044) — someone you have played with can't
            make it and is holding the seat. Above the board: it is the
            likeliest game for you to say yes to, and it is gone the moment
            somebody takes it. */}
        {crew.length > 0 && (
          <Reveal style={{ gap: 8, marginBottom: 4 }}>
            <SectionRule label={t('communityCrewLabel')} color={TOKENS.sunDeep} marginTop={0} />
            {crew.slice(0, YOURS_CAP).map((c) => (
              <CrewRow
                key={c.booking_id}
                seat={c}
                locale={locale}
                onPress={() => router.push(`/f/${c.invite_token}`)}
              />
            ))}
          </Reveal>
        )}

        {state.status === 'loading' && (
          // Leaves on a fade, under the board fading in.
          <Animated.View exiting={FadeOut.duration(MOTION.instant)} style={{ gap: 12 }}>
            <Skeleton variant="row" />
            <Skeleton variant="row" />
          </Animated.View>
        )}

        {state.status === 'error' && (
          <Reveal style={{ paddingVertical: 40, alignItems: 'center', gap: 12 }}>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, color: TOKENS.ink2 }}>
              {t('communityError')}
            </Text>
            <Button variant="secondary" size="sm" onPress={() => load('initial')}>
              {t('bookingsRefresh')}
            </Button>
          </Reveal>
        )}

        {state.status === 'success' && (
          <Animated.View entering={FadeIn.duration(MOTION.quick)} layout={ROW_LAYOUT} style={{ gap: 12 }}>
            {/* Empty board (community-v4.md unit 5): status + pathway, one CTA.
                Yours renders above it and the shelf below it, so the tab is
                never a blank list — and the ball, not a crowd glyph: the
                sport's own iconography is the art here too. */}
            {matches.length === 0 && (
              <Reveal enter={boardSettled}>
                <EmptyState
                  icon={Icon.ball(TOKENS.primary, 40)}
                  title={t('communityEmptyTitle')}
                  body={t('communityEmptyBody')}
                  action={{ label: t('communityEmptyCta'), onPress: () => router.replace('/(tabs)') }}
                />
              </Reveal>
            )}

            {matches.length > 0 && visible.length === 0 && (
              <Reveal>
                <Text
                  style={{
                    paddingVertical: 32,
                    textAlign: 'center',
                    fontFamily: TOKENS.ui,
                    fontSize: 14,
                    color: TOKENS.ink3,
                  }}
                >
                  {t('communityFilterNone')}
                </Text>
              </Reveal>
            )}

            {sections.map((section) => (
              <Reveal key={section.label} enter={boardSettled} style={{ gap: 12 }}>
                <SectionRule label={section.label} color={TOKENS.primaryDeep} marginTop={4} />
                {section.items.map((m) => (
                  <Reveal key={m.booking_id} enter={boardSettled}>
                    <OpenMatchRow match={m} locale={locale} onPress={() => openMatch(m)} />
                  </Reveal>
                ))}
              </Reveal>
            ))}
          </Animated.View>
        )}

        {/* The thread (community-v3.md unit 3) — the repeated slot as one
            object instead of scattered history. Server-floored at two
            played matches, so this section is absent until a habit exists
            rather than dressing a single game up as one. */}
        {series.length > 0 && (
          <Reveal style={{ gap: 12 }}>
            <SectionRule label={t('communitySeriesLabel')} color={TOKENS.pitchDeep} marginTop={12} />
            {series.map((s) => (
              <SeriesRow
                key={`${s.venue_name}-${s.weekday}-${s.kickoff_hour}`}
                series={s}
                locale={locale}
                onPress={
                  s.next_booking_id ? () => router.push(`/booking/${s.next_booking_id}`) : undefined
                }
              />
            ))}
          </Reveal>
        )}

        {/* The shelf — standing, real-action content (community-v2.md).
            Renders under rows AND under the empty state: it is what gives
            an empty board substance without simulating activity. Two cards
            since unit 4: the "open a match" card moved up to the header
            as the create pill. */}
        {state.status === 'success' && (
          <Reveal style={{ gap: 12 }}>
            <SectionRule label={t('communityShelfLabel')} color={TOKENS.primaryDeep} marginTop={12} />

            {/* Floored at five (unit 3): below that a population count is
                the number NN/g warns about — it reads as an empty room. */}
            {weekStats && weekStats.matches_7d >= 5 && (
              <Reveal>
                <Card padded={16} elevation="e1">
                  <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
                    <ShelfStat value={weekStats.matches_7d} label={t('communityWeekMatches')} />
                    <View style={{ width: 1, backgroundColor: TOKENS.line, marginHorizontal: 16 }} />
                    <ShelfStat value={weekStats.players_7d} label={t('communityWeekPlayers')} />
                  </View>
                </Card>
              </Reveal>
            )}

            {cityGroups.map((g) => (
              <ShelfCard
                key={g.name_en}
                fill={TOKENS.pitchSoft}
                titleColor={TOKENS.pitchDeep}
                title={t('communityWaTitle', {
                  city: locale === 'gr' ? g.name_gr : g.name_en,
                })}
                body={t('communityWaBody')}
                cta={t('communityWaCta')}
                onPress={() => {
                  capture('shelf_card_tapped', { card: 'whatsapp' });
                  Linking.openURL(g.whatsapp_group_url).catch(() => {});
                }}
              />
            ))}

            <ShelfCard
              fill={TOKENS.sunSoft}
              titleColor={TOKENS.sunDeep}
              title={t('communityKeeperTitle')}
              body={t('communityKeeperBody')}
              cta={keeperShort > 0 ? t('communityKeeperCtaFilter') : t('communityKeeperCtaPool')}
              onPress={() => {
                if (keeperShort > 0) {
                  capture('shelf_card_tapped', { card: 'keeper_filter' });
                  applyFilters({ keeper: true });
                } else {
                  // The pool is a profile setting now (ADR-0047); the web
                  // page stays for keepers who have not got the app yet.
                  capture('shelf_card_tapped', { card: 'keeper_pool' });
                  router.push('/account/edit-profile');
                }
              }}
            />
          </Reveal>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// The board row — Direction A ("field art"), picked 2026-09-01 from a
// three-way on-device gallery (B: Aegean color block, C: poster + roster
// gauge, both rejected). The criterion the pick wrote down: vivid means the
// sport's own iconography — the format-tinted pitch from Discover's cards —
// not louder color or bigger type. Kickoff rides the art in a surface pill;
// keeper urgency is pinned to the art's corner; everything below stays the
// quiet Chalk hierarchy.
//
// 2026-09-11 (community-v4.md unit 3), a second three-way gallery on the
// numeral: the pill became a SCORELINE — kickoff | spots — picked over twin
// pills (three surface objects fighting for the art's base line) and a
// shirt-number badge that folded keeper urgency into its label and misread
// as "13 keepers". The criterion this pick wrote down: the loud number is
// the one that shrinks as things go well, and it shares the kickoff's
// object because the sport already has a grammar for two numbers in one
// box. The keeper banner keeps its corner and its voice.
function OpenMatchRow({
  match,
  locale,
  onPress,
}: {
  match: OpenMatch;
  locale: 'en' | 'gr';
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const cityName = locale === 'gr' ? match.city_name_gr : match.city_name_en;
  const keeperNeeded = match.gk_open > 0;
  const open = match.gk_open + match.outfield_open;
  // Pure kickoff time — the day lives on the section divider above.
  const headline = formatFixtureTimeRange(match.starts_at, match.ends_at, locale);
  // The capacity numeral (community-v4.md unit 3): the one number on the
  // card that shrinks as things go well, so it is the honest thing to make
  // loud at any density. Sun when a keeper is among the missing.
  const numeralColor = keeperNeeded ? TOKENS.sunDeep : TOKENS.primaryDeep;
  const capLabel = open === 1 ? t('communityLastSpot') : t('communitySpotsLabel');

  return (
    <Press onPress={onPress}>
      <Card elevation="e2" radius="lg" style={{ overflow: 'hidden' }}>
        <View>
          <FieldTile format={match.pitch_type} height={96} />
          {/* The scoreline: kickoff | spots, one surface pill on the art. */}
          <View
            style={{
              position: 'absolute',
              left: 14,
              bottom: 12,
              backgroundColor: TOKENS.surface,
              borderRadius: RADII.sm,
              borderCurve: 'continuous',
              paddingHorizontal: 12,
              paddingVertical: 6,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Text
              style={{
                fontFamily: TOKENS.displaySemi,
                fontSize: 20,
                color: TOKENS.ink,
                letterSpacing: -0.4,
              }}
            >
              {headline}
            </Text>
            <View style={{ width: 1, height: 18, backgroundColor: TOKENS.lineBold }} />
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              {/* Rolls down when a spot fills while the board is open. */}
              <Tally
                value={open}
                style={{
                  fontFamily: TOKENS.displaySemi,
                  fontSize: 20,
                  lineHeight: 20,
                  color: numeralColor,
                  letterSpacing: -0.5,
                  fontVariant: ['tabular-nums'],
                }}
              />
              <Text
                style={{
                  fontFamily: TOKENS.monoMedium,
                  fontSize: 9,
                  color: TOKENS.ink3,
                  letterSpacing: 0.7,
                  textTransform: 'uppercase',
                }}
              >
                {capLabel}
              </Text>
            </View>
          </View>
          {keeperNeeded && (
            <View
              style={{
                position: 'absolute',
                right: 14,
                top: 12,
                backgroundColor: TOKENS.sunSoft,
                borderRadius: 99,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text
                style={{
                  fontFamily: TOKENS.monoMedium,
                  fontSize: 10,
                  color: TOKENS.sunDeep,
                  letterSpacing: 0.6,
                }}
              >
                {t('inviteKeeperUrgent').toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        <View style={{ padding: 14, paddingTop: 12, gap: 5 }}>
          {/* Reddit's card grammar (round-3 density pass): ONE whisper line
              of place metadata, ONE quiet footer line, and the only loud
              element stays the art. Urgency lives solely in the art's
              banner — the footer is deliberately colourless. */}
          <Text
            style={{
              fontFamily: TOKENS.monoMedium,
              fontSize: 10.5,
              color: TOKENS.ink3,
              letterSpacing: 0.84,
            }}
            numberOfLines={1}
          >
            {/* City before pitch: when the line runs long, the pitch's
                sub-name is the honest thing to lose — it is one tap away. */}
            {`${match.venue_name} · ${cityName} · ${match.pitch_name}`.toUpperCase()}
          </Text>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, color: TOKENS.ink2 }} numberOfLines={1}>
            {[
              t('communitySpotsShort', { gk: match.gk_open, outfield: match.outfield_open }),
              match.is_split && match.share_amount_cents != null
                ? t('communityShareShort', {
                    amount: `€${(match.share_amount_cents / 100).toFixed(2)}`,
                  })
                : match.total_cents > 0
                  ? `≈${t('communityShareShort', {
                      amount: `€${(
                        match.total_cents /
                        (match.gk_slots + match.outfield_slots) /
                        100
                      ).toFixed(2)}`,
                    })}`
                  : null,
              match.open_level
                ? match.open_level === 'casual'
                  ? t('levelCasual')
                  : t('levelCompetitive')
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {/* The group's weekly run (plans/strava-build.md B2): a fact about
              the fixture, never about a person, so it answers "should I
              join?" without the host the board refuses to show. The view
              floors it at week 4; below that it is null and the row says
              nothing. Grey, so the familiarity line below stays the
              footer's one colour. */}
          {match.series_weeks != null && match.series_since != null && (() => {
            const parts = seriesLineParts(match.starts_at, match.series_since, locale);
            return (
              <Text
                style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink2, marginTop: 1 }}
                numberOfLines={1}
              >
                {parts.year
                  ? t('communitySeriesLineYear', { day: parts.day, month: parts.month, year: parts.year })
                  : t('communitySeriesLine', { day: parts.day, month: parts.month })}
              </Text>
            );
          })()}
          {/* The familiarity signal (community-v3.md unit 2). The research
              says a row must answer "should I join?" before the tap, and
              every comp answers it by naming the host — which we rejected
              and still reject. This is the counts-never-names form: it is
              symmetric, so it can only reflect matches the viewer
              themselves played. Absent at zero, which is most rows for
              most people, so the card's anatomy is unchanged by default.
              The one coloured line in a deliberately colourless footer,
              because belonging is the thing worth seeing here. */}
          {match.played_with_squad > 0 && (
            <Text
              style={{
                fontFamily: TOKENS.ui,
                fontSize: 13,
                color: TOKENS.pitchDeep,
                marginTop: 1,
              }}
              numberOfLines={1}
            >
              {match.played_with_squad === 1
                ? t('communityPlayedWithOne')
                : t('communityPlayedWithMany', { count: match.played_with_squad })}
            </Text>
          )}
        </View>
      </Card>
    </Press>
  );
}

/** One eyebrow-and-rule, used by every section on this screen. */
function SectionRule({
  label,
  color,
  marginTop,
}: {
  label: string;
  color: string;
  marginTop: number;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop }}>
      <Text
        style={{
          fontFamily: TOKENS.monoMedium,
          fontSize: 11,
          color,
          textTransform: 'uppercase',
          letterSpacing: 0.88,
        }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: TOKENS.line }} />
    </View>
  );
}

// Yours renders at most this many rows; the rest are one tap away in the
// Bookings ledger. Two is the number at which the board's first card is
// still above the fold on the smallest supported phone.
const YOURS_CAP = 2;

/**
 * A Yours row: one fixture I stand on that still has seats, and the one tap
 * that does something about it. Two quiet lines — when, then what it is
 * short of · where — because on device (2026-09-11) a single
 * line ran out of width before the status finished, and a truncated "keeper
 * ne…" is worse than a second 12pt line. No field art: this is a to-do, not
 * an invitation, and it must not out-shout the board.
 */
function YoursRow({
  booking,
  locale,
  onShare,
  onPress,
}: {
  booking: BookingListItem;
  locale: 'en' | 'gr';
  onShare: () => void;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const short = booking.squad.total - booking.squad.filled;
  const keeper = booking.squad.gkFilled < booking.squad.gkTotal;
  const when =
    relativeHeadline(booking.starts_at, locale, t('relTonight'), t('relTomorrow')) ??
    formatStart(booking.starts_at, locale);
  const need = keeper
    ? t('communityYoursKeeper')
    : short === 1
      ? t('communityYoursShortOne')
      : t('communityYoursShortMany', { count: short });

  return (
    <Press onPress={onPress}>
      <Card padded={12} elevation="e1" radius="lg">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Tag
            label={booking.is_organiser ? t('communityYoursHosting') : t('communityYoursJoined')}
            fill={booking.is_organiser ? TOKENS.sunSoft : TOKENS.pitchSoft}
            color={booking.is_organiser ? TOKENS.sunDeep : TOKENS.pitchDeep}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              numberOfLines={1}
              style={{ fontFamily: TOKENS.displaySemi, fontSize: 15, color: TOKENS.ink }}
            >
              {when}
            </Text>
            {/* Status first, venue last: if this line runs out of width the
                venue is the honest thing to lose — the roster is one tap
                away, the gap is the reason the row exists. */}
            <Text
              numberOfLines={1}
              style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink3 }}
            >
              <Text style={{ color: TOKENS.sunDeep }}>{need}</Text>
              {` · ${booking.pitch.venue.name}`}
            </Text>
          </View>
          <Press
            feel="control"
            onPress={onShare}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            accessibilityLabel={t('communityYoursShare')}
            style={{
              width: 32,
              height: 32,
              borderRadius: RADII.sm,
              borderCurve: 'continuous',
              borderWidth: 1,
              borderColor: TOKENS.lineBold,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {Icon.share(TOKENS.ink2, 15)}
          </Press>
        </View>
      </Card>
    </Press>
  );
}

function KeeperRow({
  req,
  locale,
  busy,
  onClaim,
}: {
  req: KeeperRequest;
  locale: 'en' | 'gr';
  busy: boolean;
  onClaim: () => void;
}) {
  const { t } = useTranslation();
  const when =
    relativeHeadline(req.starts_at, locale, t('relTonight'), t('relTomorrow')) ??
    formatStart(req.starts_at, locale);
  return (
    <Card padded={12} elevation="e1" radius="lg">
      <View style={{ gap: 10 }}>
        <View style={{ gap: 2 }}>
          <Text numberOfLines={1} style={{ fontFamily: TOKENS.displaySemi, fontSize: 15, color: TOKENS.ink }}>
            {when}
          </Text>
          <Text numberOfLines={1} style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink3 }}>
            <Text style={{ color: TOKENS.sunDeep }}>
              {req.shape === 'rotation' ? t('communityKeeperRotation') : t('communityKeeperWhole')}
            </Text>
            {` · ${req.venue_name} · ${req.pitch_type}`}
          </Text>
          {req.keepers_played > 0 ? (
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>
              {t('communityKeeperRecord', { back: req.keepers_would_return, played: req.keepers_played })}
            </Text>
          ) : null}
        </View>
        <Button size="sm" color={TOKENS.sun} loading={busy} disabled={busy} onPress={onClaim}>
          {t('communityKeeperClaim')}
        </Button>
      </View>
    </Card>
  );
}

function CrewRow({
  seat,
  locale,
  onPress,
}: {
  seat: CrewSeat;
  locale: 'en' | 'gr';
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const when =
    relativeHeadline(seat.starts_at, locale, t('relTonight'), t('relTomorrow')) ??
    formatStart(seat.starts_at, locale);
  const what = seat.gk_replacing > 0 ? t('communityCrewSeatKeeper') : t('communityCrewSeat');
  const price =
    seat.is_split && seat.share_amount_cents != null
      ? ` · €${(seat.share_amount_cents / 100).toFixed(2)}`
      : '';
  return (
    <Press onPress={onPress}>
      <Card padded={12} elevation="e1" radius="lg">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={1} style={{ fontFamily: TOKENS.displaySemi, fontSize: 15, color: TOKENS.ink }}>
              {when}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink3 }}>
              <Text style={{ color: TOKENS.sunDeep }}>{what}</Text>
              {`${price} · ${seat.venue_name}`}
            </Text>
          </View>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 18, color: TOKENS.ink3 }}>›</Text>
        </View>
      </Card>
    </Press>
  );
}

/**
 * A repeated slot. The weekday comes off the last one actually played
 * rather than a name table, so it is correct in both languages and on the
 * venue's own clock for free.
 */
function SeriesRow({
  series,
  locale,
  onPress,
}: {
  series: Series;
  locale: 'en' | 'gr';
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const weekday = series.last_played_at
    ? new Intl.DateTimeFormat(locale === 'gr' ? 'el-GR' : 'en-GB', {
        timeZone: 'Europe/Nicosia',
        weekday: 'long',
      }).format(new Date(series.last_played_at))
    : '';
  const time = `${String(series.kickoff_hour).padStart(2, '0')}:00`;

  const body = (
    <Card padded={16} elevation="e1" radius="lg">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontFamily: TOKENS.displaySemi, fontSize: 17, color: TOKENS.ink }} numberOfLines={1}>
            {series.venue_name}
          </Text>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 13.5, color: TOKENS.ink2 }} numberOfLines={1}>
            {t('communitySeriesSlot', { weekday, time })}
          </Text>
          {series.next_starts_at && (
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.pitchDeep }} numberOfLines={1}>
              {t('communitySeriesNext', {
                when: formatFixtureDate(series.next_starts_at, locale),
              })}
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text
            style={{
              fontFamily: TOKENS.displaySemi,
              fontSize: 26,
              color: TOKENS.pitchDeep,
              letterSpacing: -0.5,
            }}
          >
            {series.played}
          </Text>
          <Text
            style={{
              fontFamily: TOKENS.monoMedium,
              fontSize: 9.5,
              color: TOKENS.ink3,
              letterSpacing: 0.7,
            }}
          >
            {t('communitySeriesPlayed').toUpperCase()}
          </Text>
        </View>
      </View>
    </Card>
  );

  return onPress ? (
    <Press onPress={onPress}>
      {body}
    </Press>
  ) : (
    body
  );
}

function ShelfStat({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text
        style={{
          fontFamily: TOKENS.displaySemi,
          fontSize: 26,
          color: TOKENS.ink,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontFamily: TOKENS.monoMedium,
          fontSize: 10.5,
          color: TOKENS.ink3,
          textTransform: 'uppercase',
          letterSpacing: 0.63,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// One anatomy for every shelf card: soft role fill, serif title, one body
// line, one quiet CTA. The card is the button — no nested targets.
function ShelfCard({
  fill,
  titleColor,
  title,
  body,
  cta,
  onPress,
}: {
  fill: string;
  titleColor: string;
  title: string;
  body: string;
  cta: string;
  onPress: () => void;
}) {
  return (
    <Press onPress={onPress}>
      <Card padded={16} elevation="e0" color={fill} style={{ borderColor: 'transparent', gap: 6 }}>
        <Text style={{ fontFamily: TOKENS.displaySemi, fontSize: 17, color: titleColor }}>
          {title}
        </Text>
        <Text style={{ fontFamily: TOKENS.ui, fontSize: 13.5, lineHeight: 19, color: TOKENS.ink2 }}>
          {body}
        </Text>
        <Text
          style={{
            fontFamily: TOKENS.monoMedium,
            fontSize: 11,
            color: titleColor,
            textTransform: 'uppercase',
            letterSpacing: 0.66,
            marginTop: 2,
          }}
        >
          {cta} →
        </Text>
      </Card>
    </Press>
  );
}
