// Bookings tab (M2 #10), "Chalk & Aegean" pass (2026-08-10). Two segments —
// Upcoming and History — over the user's own bookings (RLS keeps it scoped).
// Rows carry a 4px state rail; the rail is never the only signal — the state
// name repeats as text in the rail's colour. The next booking gets a
// relative-time headline (<24h relative, absolute beyond).
// Above them in Upcoming, "My teams": the matches of the CFA teams the
// parent follows, here and away (plans/cfa-in-the-app.md K3) — not
// bookings, so no state, no code, no price.

import {
  Button,
  Card,
  EmptyState,
  Icon,
  MOTION,
  PressScale,
  Reveal,
  SegmentedControl,
  Skeleton,
  Tag,
  TOKENS,
  useSettled,
} from '@ludi/ui';
import { useFocusEffect, useRouter, useScrollToTop } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  fetchMyBookings,
  formatWhen,
  relativeHeadline,
  segmentBookings,
  type BookingListItem,
  type BookingState,
} from '@/lib/bookings-list';
import { cyprusDay, cyprusTime, fetchMyTeamFixtures, type TeamFixture } from '@/lib/cfa';

type Segment = 'upcoming' | 'history';

type LoadState =
  | { status: 'loading' }
  | { status: 'success'; bookings: BookingListItem[] }
  | { status: 'error' };

export default function BookingsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [segment, setSegment] = useState<Segment>('upcoming');
  const [refreshing, setRefreshing] = useState(false);
  const [teams, setTeams] = useState<TeamFixture[]>([]);
  // Tapping Bookings while on it goes back to the top (plans/motion-v3.md).
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  // The list used to load on mount only, so a booking made a minute ago
  // was missing until a pull. It now re-reads every time the tab comes
  // back — quietly when a list is already on screen (plans/motion-v3.md,
  // slice 0), and a quiet failure keeps the list it has.
  const hasList = useRef(false);
  const load = useCallback(async (mode: 'initial' | 'refresh' | 'quiet') => {
    if (mode === 'initial') setState({ status: 'loading' });
    if (mode === 'refresh') setRefreshing(true);
    try {
      const [bookings, teamRows] = await Promise.all([
        fetchMyBookings(),
        // secondary: a failure leaves the section absent, never the tab
        fetchMyTeamFixtures().catch(() => [] as TeamFixture[]),
      ]);
      hasList.current = true;
      setState({ status: 'success', bookings });
      setTeams(teamRows);
    } catch {
      if (mode !== 'quiet') setState({ status: 'error' });
    } finally {
      if (mode === 'refresh') setRefreshing(false);
    }
  }, []);

  // Every focus re-reads — the first one shows the skeleton. The teams
  // section rides along, so a follow made on a venue's Saturday shows here
  // when the tab comes back.
  useFocusEffect(
    useCallback(() => {
      void load(hasList.current ? 'quiet' : 'initial');
    }, [load]),
  );

  const segmented = useMemo(() => {
    if (state.status !== 'success') return { upcoming: [], history: [] };
    return segmentBookings(state.bookings);
  }, [state]);

  const visible = segment === 'upcoming' ? segmented.upcoming : segmented.history;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 16 }}>
        <Text
          style={{
            fontFamily: TOKENS.displaySemi,
            fontSize: 32,
            color: TOKENS.ink,
            letterSpacing: -0.64,
          }}
        >
          {t('bookings')}
        </Text>
        <SegmentedControl<Segment>
          segments={[
            { value: 'upcoming', label: t('bookingsUpcoming'), count: segmented.upcoming.length },
            { value: 'history', label: t('bookingsHistory'), count: segmented.history.length },
          ]}
          value={segment}
          onChange={setSegment}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        // Scrolls under the floating tab bar and stops clear of it.
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingTop: 0, paddingBottom: 40, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load('refresh')}
            tintColor={TOKENS.ink2}
          />
        }
      >
        {state.status === 'loading' && (
          // Leaves on a fade, under the list fading in.
          <Animated.View exiting={FadeOut.duration(MOTION.instant)} style={{ gap: 12, paddingTop: 8 }}>
            <Skeleton variant="row" />
            <Skeleton variant="row" />
          </Animated.View>
        )}

        {state.status === 'error' && (
          <Reveal style={{ paddingVertical: 40, alignItems: 'center', gap: 12 }}>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, color: TOKENS.ink2 }}>
              {t('bookingsError')}
            </Text>
            <Button variant="secondary" size="sm" onPress={() => load('initial')}>
              {t('bookingsRefresh')}
            </Button>
          </Reveal>
        )}

        {/* Upcoming ⇄ History: the thumb glides and the list under it
            cross-fades with it, instead of hard-cutting (plans/motion-v3.md,
            "The tabs"). Keyed by segment, so each side mounts fresh. */}
        {state.status === 'success' && (
          <SegmentPane key={segment}>
            {(settled) => (
              <>
                {segment === 'upcoming' && teams.length > 0 && (
                  <Reveal enter={settled} style={{ gap: 10, paddingBottom: 8 }}>
                    <Text
                      style={{
                        fontFamily: TOKENS.monoMedium,
                        fontSize: 10.5,
                        color: TOKENS.ink3,
                        textTransform: 'uppercase',
                        letterSpacing: 0.84,
                      }}
                    >
                      {t('myTeamsSection')}
                    </Text>
                    {teams.map((f) => (
                      <TeamFixtureRow
                        key={f.match_id}
                        fixture={f}
                        locale={i18n.language === 'gr' ? 'gr' : 'en'}
                        onPress={
                          f.venue_id
                            ? () => router.push({ pathname: '/venue/[id]', params: { id: f.venue_id! } })
                            : undefined
                        }
                      />
                    ))}
                  </Reveal>
                )}

                {visible.length === 0 && !(segment === 'upcoming' && teams.length > 0) && (
                  <Reveal enter={settled}>
                    <EmptyState
                      icon={Icon.cal(TOKENS.primary, 40)}
                      title={t('bookingsEmptyTitle')}
                      body={t('bookingsEmptyBody')}
                      action={
                        segment === 'upcoming'
                          ? { label: t('bookingsFindPitch'), onPress: () => router.replace('/(tabs)') }
                          : undefined
                      }
                    />
                  </Reveal>
                )}

                {/* A booking made or cancelled elsewhere shows up on the quiet
                    refetch as a row arriving or leaving, the rest gliding. */}
                {visible.map((b, i) => (
                  <Reveal key={b.id} enter={settled}>
                    <BookingRow
                      booking={b}
                      locale={i18n.language === 'gr' ? 'gr' : 'en'}
                      hero={segment === 'upcoming' && i === 0}
                      past={segment === 'history'}
                      showSquad={segment === 'upcoming'}
                      relTonight={t('relTonight')}
                      relTomorrow={t('relTomorrow')}
                      onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })}
                    />
                  </Reveal>
                ))}
              </>
            )}
          </SegmentPane>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One segment's list: fades in as the other fades out, and passes its rows
 *  the switch between "arrived with the list" and "arrived later". */
function SegmentPane({ children }: { children: (settled: boolean) => ReactNode }) {
  const settled = useSettled();
  return (
    <Animated.View
      entering={FadeIn.duration(MOTION.quick)}
      exiting={FadeOut.duration(MOTION.instant)}
      style={{ gap: 12 }}
    >
      {children(settled)}
    </Animated.View>
  );
}

// State rides in a Tag — soft fill + deep text (design correction 2026-08-31:
// state is never an edge stripe; the old 4px rail read as decoration).
const STATE_FILL: Record<BookingState, string> = {
  pending: TOKENS.sunSoft,
  collecting: TOKENS.sunSoft,
  paid: TOKENS.pitchSoft,
  confirmed: TOKENS.pitchSoft,
  completed: TOKENS.bg,
  cancelled: TOKENS.terraSoft,
  refunded: TOKENS.terraSoft,
  refunded_by_admin: TOKENS.terraSoft,
  cancelled_no_refund: TOKENS.terraSoft,
};
// Dot — the role's base colour, the tag's shape channel.
const STATE_DOT: Record<BookingState, string> = {
  pending: TOKENS.sun,
  collecting: TOKENS.sun,
  paid: TOKENS.pitch,
  confirmed: TOKENS.pitch,
  completed: TOKENS.ink3,
  cancelled: TOKENS.terracotta,
  refunded: TOKENS.terracotta,
  refunded_by_admin: TOKENS.terracotta,
  cancelled_no_refund: TOKENS.terracotta,
};
// Text on the soft fills needs the deep variants (the base colours at text
// size fail AA).
const STATE_TEXT: Record<BookingState, string> = {
  pending: TOKENS.sunDeep,
  collecting: TOKENS.sunDeep,
  paid: TOKENS.pitchDeep,
  confirmed: TOKENS.pitchDeep,
  completed: TOKENS.ink3,
  cancelled: TOKENS.terraDeep,
  refunded: TOKENS.terraDeep,
  refunded_by_admin: TOKENS.terraDeep,
  cancelled_no_refund: TOKENS.terraDeep,
};

function BookingRow({
  booking,
  locale,
  hero,
  past,
  showSquad,
  relTonight,
  relTomorrow,
  onPress,
}: {
  booking: BookingListItem;
  locale: 'en' | 'gr';
  hero: boolean;
  past: boolean;
  showSquad: boolean;
  relTonight: string;
  relTomorrow: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const stateLabels = t('bookingState', { returnObjects: true }) as Record<BookingState, string>;
  const cityName =
    locale === 'gr' ? booking.pitch.venue.city_name_gr : booking.pitch.venue.city_name_en;
  const headline = hero ? relativeHeadline(booking.starts_at, locale, relTonight, relTomorrow) : null;

  return (
    <PressScale onPress={onPress}>
      <Card
        elevation={past ? 'e1' : 'e2'}
        radius="lg"
        style={{ overflow: 'hidden', opacity: past ? 0.78 : 1 }}
      >
        <View style={{ padding: 18, gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Tag
                label={stateLabels[booking.state] ?? booking.state}
                fill={STATE_FILL[booking.state] ?? TOKENS.sunSoft}
                color={STATE_TEXT[booking.state] ?? TOKENS.sunDeep}
                dot={STATE_DOT[booking.state] ?? TOKENS.sun}
              />
              <Text
                style={{
                  fontFamily: TOKENS.mono,
                  fontSize: 10.5,
                  color: TOKENS.ink3,
                  letterSpacing: 0.42,
                }}
              >
                {booking.code}
              </Text>
            </View>

            {headline && (
              <Text
                style={{
                  fontFamily: TOKENS.displaySemi,
                  fontSize: 24,
                  color: TOKENS.ink,
                  letterSpacing: -0.48,
                }}
              >
                {headline}
              </Text>
            )}

            <Text
              style={{
                fontFamily: TOKENS.displaySemi,
                fontSize: 18,
                color: TOKENS.ink,
              }}
            >
              {booking.pitch.name}
            </Text>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 13.5, color: TOKENS.ink3 }}>
              {booking.pitch.venue.name}
              {cityName ? ` · ${cityName}` : ''}
            </Text>

            {/* "A fixture that is short should say so from the list" — only
                for an incomplete squad; a full one needs no line here. Never
                in History: the count stops being actionable once it's over. */}
            {showSquad && booking.squad.filled < booking.squad.total && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text
                  style={{
                    fontFamily: TOKENS.monoMedium,
                    fontSize: 11,
                    color: TOKENS.ink2,
                    letterSpacing: 0.5,
                  }}
                >
                  {t('bookingsRowSquad', { filled: booking.squad.filled, total: booking.squad.total })}
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

            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                borderTopWidth: 1,
                borderTopColor: TOKENS.line,
                paddingTop: 10,
                marginTop: 2,
              }}
            >
              <Text
                style={{
                  fontFamily: TOKENS.mono,
                  fontSize: 11,
                  color: TOKENS.ink2,
                  textTransform: 'uppercase',
                  letterSpacing: 0.66,
                }}
              >
                {formatWhen(booking.starts_at, booking.ends_at, locale)}
              </Text>
              <Text style={{ fontFamily: TOKENS.displaySemi, fontSize: 20, color: TOKENS.ink }}>
                €{Math.round(booking.total_cents / 100)}
              </Text>
            </View>
        </View>
      </Card>
    </PressScale>
  );
}

// relativeHeadline / formatWhen live in @/lib/bookings-list — shared with the
// home screen's next-match strip so the two can never disagree.

// A followed team's match (plans/cfa-in-the-app.md K3): when, the two
// teams, the age group and where — a court here, or the CFA's venue name
// away. Postponed or cancelled says so; there is never a score.
function TeamFixtureRow({
  fixture,
  locale,
  onPress,
}: {
  fixture: TeamFixture;
  locale: 'en' | 'gr';
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const where = fixture.elsewhere
    ? t('myTeamsAway', { venue: fixture.elsewhere })
    : [fixture.court, fixture.venue_name].filter(Boolean).join(' · ');
  const flag =
    fixture.status === 'postponed' ? t('cfaPostponed') : fixture.status === 'cancelled' ? t('cfaCancelled') : null;
  const off = fixture.status === 'cancelled';

  const body = (
    <Card elevation="e1" radius="lg" style={{ opacity: off ? 0.6 : 1 }}>
      <View style={{ padding: 16, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text
            style={{ fontFamily: TOKENS.mono, fontSize: 11, color: TOKENS.ink2, textTransform: 'uppercase', letterSpacing: 0.66 }}
          >
            {cyprusDay(fixture.kickoff_at, locale)} · {cyprusTime(fixture.kickoff_at)}
          </Text>
          {flag ? (
            <Tag label={flag} fill={TOKENS.terraSoft} color={TOKENS.terraDeep} dot={TOKENS.terracotta} />
          ) : null}
        </View>
        <Text style={{ fontFamily: TOKENS.displaySemi, fontSize: 17, color: TOKENS.ink }}>
          {fixture.home} – {fixture.away}
        </Text>
        <Text style={{ fontFamily: TOKENS.ui, fontSize: 13.5, color: TOKENS.ink3 }}>
          {[fixture.category, where].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Card>
  );
  return onPress ? <PressScale onPress={onPress}>{body}</PressScale> : body;
}
