// Profile tab — "The Record" (Direction C, 2026-09-02).
//
// Rebuilt after a research pass over twelve shipping profile screens
// (FotMob, MLS, DAZN, NBA, Premier League; Strava, Hevy, Ladder, adidas
// Running; adiClub, Booking Genius, Panera). The old hub failed the one
// thing all twelve do first — put a person at the top. It led with a
// brand mark, spent its largest type on the words "Your profile", made a
// "0/5" completeness nag the visual centre of the screen, hid every
// football fact one tap away, and put Sign out and Delete account at
// thumb height. Five rules came out of that scan and this screen follows
// them:
//
//   R1  name at display scale with a personal mark beside it
//   R2  a stat strip immediately under the identity
//   R3  attributes as a dense spec grid, never as settings rows
//   R4  settings behind a gear; destructive actions off the tab entirely
//   R5  gaps read as an invitation ("Add"), never as a deficit score
//
// The broadcast hero carries identity + record on the dark Aegean ground,
// echoing the player card's own language so the two feel like one object;
// the 9:16 card itself stays one tap away, where Wallet and Share live.
// The hero stops below the status bar on purpose — the app sets
// StatusBar style="dark" globally, and a full-bleed dark band would eat
// the clock.

import {
  Button,
  Card,
  Icon,
  MOTION,
  Press,
  PressScale,
  ROW_LAYOUT,
  Reveal,
  Skeleton,
  Tally,
  TOKENS,
} from '@ludi/ui';
import { useFocusEffect, useRouter, useScrollToTop } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { echoRingPaths, factionFor, factionRingColor, HERO_GROUND } from '@/components/factions';
import { HomeMapCard, type MapPin } from '@/components/HomeMapCard';
import { capture, pinBucket } from '@/lib/analytics';
import { fetchMyBookings, formatStart, type BookingListItem } from '@/lib/bookings-list';
import { formatFixtureDate } from '@/lib/fixture';
import {
  AGE_BAND_LABELS,
  displayName,
  fetchMyGrounds,
  fetchMyRecord,
  footLabelKey,
  formatMemberNo,
  monogram,
  playFrequencyLabelKey,
  type AgeBand,
  type Foot,
  type Locale,
  type MyGround,
  type MyRecord,
  type PlayFrequency,
} from '@/lib/player-profile';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

interface HubProfile {
  first_name: string;
  last_name: string;
  skill_level: number;
  positions: string[];
  preferred_foot: Foot | null;
  height_cm: number | null;
  age_band: AgeBand | null;
  play_frequency: PlayFrequency | null;
  member_no: number | null;
  city_name: string | null;
}

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; profile: HubProfile };

const ON_HERO = '#FBF8F0';
const ON_HERO_DIM = 'rgba(251,248,240,0.85)';
const ON_HERO_FAINT = 'rgba(251,248,240,0.55)';
const HERO_LINE = 'rgba(251,248,240,0.16)';
const FORM_SLOTS = 5;

export default function ProfileHubScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const locale = (i18n.language === 'gr' ? 'gr' : 'en') as Locale;

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [heroW, setHeroW] = useState(0);
  // The record and the fixture history each load independently of the
  // profile row — neither may take the identity screen down with it.
  const [record, setRecord] = useState<MyRecord | null>(null);
  const [played, setPlayed] = useState<BookingListItem[] | null>(null);
  // Your grounds (plans/maps.md): the venues of your completed games.
  const [grounds, setGrounds] = useState<MyGround[]>([]);
  // Tapping Profile while on it goes back to the top (plans/motion-v3.md).
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  const user = session?.user;
  const verified = Boolean(
    user?.phone_confirmed_at || user?.email_confirmed_at || user?.confirmed_at,
  );

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('users')
      .select(
        'first_name, last_name, skill_level, positions, preferred_foot, height_cm, age_band, play_frequency, member_no, cities(name_en, name_gr)',
      )
      .eq('id', userId)
      .single();
    if (error || !data) {
      // A refocus that fails keeps the profile already on screen; only a
      // screen with nothing to show falls to the error.
      setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'error' }));
      return;
    }
    const row = data as Record<string, unknown>;
    const cityRel = row.cities as
      | { name_en: string; name_gr: string }
      | { name_en: string; name_gr: string }[]
      | null;
    const city = Array.isArray(cityRel) ? (cityRel[0] ?? null) : cityRel;
    setState({
      kind: 'ready',
      profile: {
        first_name: (row.first_name as string) ?? '',
        last_name: (row.last_name as string) ?? '',
        skill_level: (row.skill_level as number) ?? 3,
        positions: (row.positions as string[]) ?? [],
        preferred_foot: (row.preferred_foot as Foot | null) ?? null,
        height_cm: (row.height_cm as number | null) ?? null,
        age_band: (row.age_band as AgeBand | null) ?? null,
        play_frequency: (row.play_frequency as PlayFrequency | null) ?? null,
        member_no: (row.member_no as number | null) ?? null,
        city_name: city ? (locale === 'gr' ? city.name_gr : city.name_en) : null,
      },
    });
  }, [userId, locale]);

  // Refresh whenever the tab regains focus — edit-profile and settings both
  // save behind this screen's back, so a mount-time load would show stale data.
  useFocusEffect(
    useCallback(() => {
      load();
      fetchMyRecord()
        .then(setRecord)
        .catch(() => setRecord(null));
      fetchMyGrounds()
        .then(setGrounds)
        .catch(() => setGrounds([]));
      fetchMyBookings()
        .then((all) => setPlayed(all.filter((b) => b.state === 'completed')))
        .catch(() => setPlayed(null));
    }, [load]),
  );

  if (state.kind === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
        {/* Leaves on a fade, under the record fading in. */}
        <Animated.View exiting={FadeOut.duration(MOTION.instant)} style={{ flex: 1, padding: 20, gap: 16 }}>
          <Skeleton variant="card" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </Animated.View>
      </SafeAreaView>
    );
  }

  if (state.kind === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}
        >
          <Text
            style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2, textAlign: 'center' }}
          >
            {t('profileLoadError')}
          </Text>
          {/* A Do, so a Button — the same retry every other tab offers. */}
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              setState({ kind: 'loading' });
              void load();
            }}
          >
            {t('discoverRetry')}
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const p = state.profile;
  const faction = factionFor(p.positions);
  const hasName = `${p.first_name} ${p.last_name}`.trim().length > 0;
  const fullName = displayName(p, t('profileNameFallback'));
  const memberNo = formatMemberNo(p.member_no);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
      {/* The record cross-fades in over its skeleton instead of swapping
          the whole screen in one frame (plans/motion-v3.md, "The tabs"). */}
      <Animated.View entering={FadeIn.duration(MOTION.quick)} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          // Scrolls under the floating tab bar and stops clear of it.
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* ───── Hero — the person, then the record (R1 + R2) ───── */}
          <View
            onLayout={(e) => setHeroW(Math.round(e.nativeEvent.layout.width))}
            style={{
              backgroundColor: HERO_GROUND,
              borderBottomLeftRadius: 20,
              borderBottomRightRadius: 20,
              overflow: 'hidden',
            }}
          >
            {heroW > 0 ? <HeroRings width={heroW} ringColor={factionRingColor(faction)} /> : null}

            <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16, gap: 14 }}>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Text
                  style={{
                    fontFamily: TOKENS.ui,
                    fontSize: 10,
                    letterSpacing: 1.6,
                    fontWeight: '700',
                    color: ON_HERO_DIM,
                  }}
                >
                  {`FACTIO · ${faction.latin}`}
                </Text>
                <Press
                  feel="control"
                  onPress={() => router.push('/account/settings')}
                  hitSlop={10}
                  accessibilityLabel={t('profileHubSettings')}
                >
                  {Icon.gear(ON_HERO_DIM, 20)}
                </Press>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
                {/* Monogram — initials where a photo would go. Photos stay
                    deferred (ADR-0012); the formula only needs a personal
                    mark, and initials cost no storage and no moderation. */}
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: 'rgba(251,248,240,0.13)',
                    borderWidth: 1,
                    borderColor: 'rgba(251,248,240,0.28)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{ fontFamily: TOKENS.displaySemi, fontSize: 19, color: ON_HERO }}
                  >
                    {monogram(p, p.member_no)}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  {/* With no name set, the identity slot is the emptiest thing
                      on the screen — so it becomes the invitation to fill it
                      (R5) rather than a dead placeholder. */}
                  <Press
                    feel="control"
                    disabled={hasName}
                    onPress={() => router.push('/account/edit-profile')}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <Text
                      numberOfLines={2}
                      style={{
                        fontFamily: TOKENS.displaySemi,
                        fontSize: 25,
                        lineHeight: 29,
                        letterSpacing: -0.6,
                        color: hasName ? ON_HERO : ON_HERO_FAINT,
                      }}
                    >
                      {fullName}
                    </Text>
                  </Press>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {verified ? (
                      <Text
                        style={{
                          fontFamily: TOKENS.ui,
                          fontSize: 11.5,
                          fontWeight: '700',
                          color: '#D99520',
                        }}
                      >
                        ✓ {t('playerCardVerified')}
                      </Text>
                    ) : null}
                    {p.city_name ? (
                      <Text style={{ fontFamily: TOKENS.ui, fontSize: 11.5, color: ON_HERO_DIM }}>
                        {p.city_name}
                      </Text>
                    ) : null}
                    {memberNo ? (
                      <Text style={{ fontFamily: TOKENS.ui, fontSize: 11.5, color: ON_HERO_DIM }}>
                        {`${t('playerCardMemberLabel')} ${memberNo}`}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>
            </View>

            {/* The record. Zeros are honest here — they are a count of a real
                thing, not a score of how incomplete you are. `venues` is
                null against a database that predates the migration, and the
                strip simply drops to two rather than inventing a zero. */}
            <View
              style={{
                flexDirection: 'row',
                borderTopWidth: 1,
                borderTopColor: HERO_LINE,
                paddingHorizontal: 20,
                paddingTop: 12,
                paddingBottom: 15,
              }}
            >
              <HeroStat value={record?.matches_played ?? 0} label={t('profileRecordMatches')} />
              <HeroStat value={record?.teammates ?? 0} label={t('profileRecordTeammates')} />
              {/* The venues column is held while the record is still coming,
                  so the strip doesn't re-flow from two columns to three. */}
              {record == null || record.venues != null ? (
                <HeroStat value={record?.venues ?? 0} label={t('profileRecordVenues')} />
              ) : null}
            </View>
          </View>

          <View style={{ padding: 20, gap: 22 }}>
            {/* ───── The card, one tap away ───── */}
            {userId ? (
              <PressScale
                onPress={() => router.push({ pathname: '/player/[id]', params: { id: userId } })}
                scale={0.98}
              >
                <Card padded={0}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingHorizontal: 14,
                      paddingVertical: 13,
                    }}
                  >
                    <CardThumb ringColor={factionRingColor(faction)} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        style={{
                          fontFamily: TOKENS.ui,
                          fontSize: 15,
                          fontWeight: '600',
                          color: TOKENS.ink,
                        }}
                      >
                        {t('profileHubCardRow')}
                      </Text>
                      <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>
                        {t('profileHubCardRowHint')}
                      </Text>
                    </View>
                    {Icon.chevR(TOKENS.ink3, 14)}
                  </View>
                </Card>
              </PressScale>
            ) : null}

            {/* ───── Your grounds (plans/maps.md M4): where you have played,
                from your own completed games. A record, not a streak. ───── */}
            {grounds.length > 0 ? (
              <Reveal style={{ gap: 12 }}>
                <SectionLabel>{t('profileGroundsTitle')}</SectionLabel>
                <GroundsMap grounds={grounds} />
                <Card padded={0}>
                  {grounds.map((g, i) => (
                    <PressScale key={g.venue_id} onPress={() => router.push(`/venue/${g.venue_id}`)} scale={0.98}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          paddingHorizontal: 14,
                          paddingVertical: 12,
                          borderTopWidth: i === 0 ? 0 : 1,
                          borderTopColor: TOKENS.line,
                        }}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, fontWeight: '600', color: TOKENS.ink }}>
                            {g.name}
                          </Text>
                          <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>
                            {g.games === 1 ? t('profileGroundsGamesOne') : t('profileGroundsGames', { count: g.games })}
                            {' · '}
                            {t('profileGroundsLast', { date: formatFixtureDate(g.last_played, locale) })}
                          </Text>
                        </View>
                        {Icon.chevR(TOKENS.ink3, 14)}
                      </View>
                    </PressScale>
                  ))}
                </Card>
              </Reveal>
            ) : null}

            {/* Everything under the grounds glides down when they arrive. */}
            <Animated.View layout={ROW_LAYOUT} style={{ gap: 22 }}>

              {/* ───── Player — the ADR-0012 substrate as a spec grid (R3) ─────
                  Unset cells read "Add" in the accent and route to the edit
                  form. That is R5: an invitation, not the "0/5" deficit the
                  old completeness meter shouted. */}
              <View style={{ gap: 12 }}>
                <SectionLabel>{t('profileHubPlayerSection')}</SectionLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 }}>
                  <AttrCell
                    label={t('profileAttrPosition')}
                    value={p.positions.length > 0 ? p.positions.slice(0, 2).join(' · ') : null}
                    onAdd={() => router.push('/account/edit-profile')}
                    addLabel={t('profileHubAddAttribute')}
                  />
                  <AttrCell
                    label={t('profileAttrFoot')}
                    value={p.preferred_foot ? t(footLabelKey(p.preferred_foot)) : null}
                    onAdd={() => router.push('/account/edit-profile')}
                    addLabel={t('profileHubAddAttribute')}
                  />
                  <AttrCell
                    label={t('profileAttrLevel')}
                    value={`${p.skill_level}/5`}
                    onAdd={() => router.push('/account/edit-profile')}
                    addLabel={t('profileHubAddAttribute')}
                  />
                  <AttrCell
                    label={t('profileAttrHeight')}
                    value={p.height_cm != null ? `${p.height_cm} cm` : null}
                    onAdd={() => router.push('/account/edit-profile')}
                    addLabel={t('profileHubAddAttribute')}
                  />
                  <AttrCell
                    label={t('profileAttrAge')}
                    value={p.age_band ? AGE_BAND_LABELS[p.age_band] : null}
                    onAdd={() => router.push('/account/edit-profile')}
                    addLabel={t('profileHubAddAttribute')}
                  />
                  <AttrCell
                    label={t('profileAttrPlays')}
                    value={p.play_frequency ? t(playFrequencyLabelKey(p.play_frequency)) : null}
                    onAdd={() => router.push('/account/edit-profile')}
                    addLabel={t('profileHubAddAttribute')}
                  />
                </View>
              </View>

              <View style={{ height: 1, backgroundColor: TOKENS.line }} />

              {/* ───── Form — where the record accumulates ───── */}
              <View style={{ gap: 12 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <SectionLabel>{t('profileHubFormSection')}</SectionLabel>
                  {played && played.length > 0 ? (
                    <Press feel="control" onPress={() => router.push('/(tabs)/bookings')} hitSlop={8}>
                      <Text
                        style={{
                          fontFamily: TOKENS.ui,
                          fontSize: 12.5,
                          fontWeight: '600',
                          color: TOKENS.primaryDeep,
                        }}
                      >
                        {t('profileHubSeeAll')}
                      </Text>
                    </Press>
                  ) : null}
                </View>

                <FormStrip count={played?.length ?? 0} />

                {/* Nothing until the history is known: the empty line used to show
                    while the games were still loading, then swap for them. */}
                {played == null ? null : played.length > 0 ? (
                  <Reveal>
                    {played.slice(0, 3).map((b) => (
                      <Press
                        key={b.id}
                        onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          paddingVertical: 11,
                          borderTopWidth: 1,
                          borderTopColor: TOKENS.line,
                        }}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text
                            numberOfLines={1}
                            style={{
                              fontFamily: TOKENS.ui,
                              fontSize: 14,
                              fontWeight: '600',
                              color: TOKENS.ink,
                            }}
                          >
                            {b.pitch.venue.name}
                          </Text>
                          <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>
                            {formatStart(b.starts_at, locale)}
                          </Text>
                        </View>
                        {Icon.chevR(TOKENS.ink3, 14)}
                      </Press>
                    ))}
                  </Reveal>
                ) : (
                  <Reveal>
                    <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink3 }}>
                      {t('profileHubFormEmpty')}
                    </Text>
                  </Reveal>
                )}
              </View>
            </Animated.View>
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

// ── Hero pieces ──────────────────────────────────────────────────────

// The card's own echo rings, tucked into the top-right corner behind the
// identity. Sized so every ring CLOSES inside the hero — the first pass
// used the card's ring heights, whose bases fell outside the band, and the
// surviving legs read as stray diagonals ruled across the stats rather
// than as the mark's echo. Only the outermost ring is allowed to crop, and
// only against the right edge.
function HeroRings({ width, ringColor }: { width: number; ringColor: string }) {
  const H = 186;
  const cx = width - 76;
  const cy = 66;
  const rings = useMemo(() => echoRingPaths(cx, cy, [78, 112, 152, 200]), [cx, cy]);
  const opacity = [0.5, 0.34, 0.22, 0.13];
  return (
    <Svg width={width} height={H} style={{ position: 'absolute' }} pointerEvents="none">
      {rings.map((d, i) => (
        <Path
          key={d}
          d={d}
          fill="none"
          stroke={ringColor}
          strokeOpacity={opacity[i] ?? 0.1}
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

// The record's numbers roll up to their value as it arrives, rather than
// standing at 0 and snapping (plans/motion-v3.md, Count).
function HeroStat({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <Tally
        value={value}
        style={{
          fontFamily: TOKENS.displaySemi,
          fontSize: 26,
          lineHeight: 29,
          color: ON_HERO,
          fontVariant: ['tabular-nums'],
        }}
      />
      <Text
        numberOfLines={1}
        style={{
          fontFamily: TOKENS.monoMedium,
          fontSize: 9.5,
          color: ON_HERO_FAINT,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// A miniature of the card's hero — enough of the object to be recognised
// as "the card" in a row, without redrawing it.
function CardThumb({ ringColor }: { ringColor: string }) {
  return (
    <View
      style={{
        width: 54,
        height: 34,
        borderRadius: 8,
        borderCurve: 'continuous',
        backgroundColor: HERO_GROUND,
        overflow: 'hidden',
      }}
    >
      <Svg width={54} height={34}>
        {echoRingPaths(36, 15, [34, 50, 70]).map((d, i) => (
          <Path
            key={d}
            d={d}
            fill="none"
            stroke={ringColor}
            strokeOpacity={[0.7, 0.45, 0.28][i] ?? 0.2}
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  );
}

// ── Body pieces ──────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: TOKENS.monoMedium,
        fontSize: 10.5,
        color: TOKENS.ink3,
        textTransform: 'uppercase',
        letterSpacing: 0.7,
      }}
    >
      {children}
    </Text>
  );
}

// One cell of the spec grid. Three per row at a third of the width each —
// a fixed 33.33% basis rather than flex, so a two-item final row lines its
// columns up with the row above instead of stretching to fill.
function AttrCell({
  label,
  value,
  onAdd,
  addLabel,
}: {
  label: string;
  value: string | null;
  onAdd: () => void;
  addLabel: string;
}) {
  const body = (
    <View style={{ width: '33.33%', gap: 3, paddingRight: 8 }}>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: TOKENS.ui,
          fontSize: 15,
          fontWeight: '700',
          color: value == null ? TOKENS.primaryDeep : TOKENS.ink,
        }}
      >
        {value ?? addLabel}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: TOKENS.monoMedium,
          fontSize: 9.5,
          color: TOKENS.ink3,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        {label}
      </Text>
    </View>
  );
  // A set value is display; an unset one is the invitation, so only the
  // empty cell is a control.
  if (value != null) return body;
  return (
    // The width sits on a plain wrapper: in this wrapping row the flex item
    // is Press's outer Pressable, and a percentage on its inner view would
    // resolve against a parent that has shrunk to the text.
    <View style={{ width: '33.33%' }}>
      <Press
        feel="control"
        onPress={onAdd}
        accessibilityLabel={`${addLabel} ${label}`}
      >
        <View style={{ gap: 3, paddingRight: 8 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: TOKENS.ui,
              fontSize: 15,
              fontWeight: '700',
              color: TOKENS.primaryDeep,
            }}
          >
            {addLabel}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: TOKENS.monoMedium,
              fontSize: 9.5,
              color: TOKENS.ink3,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
            }}
          >
            {label}
          </Text>
        </View>
      </Press>
    </View>
  );
}

// Five slots, filled left-to-right by matches actually played. The dashed
// remainder is the "earned as you play" promise in miniature — it shows
// there is somewhere for the next match to go, without claiming a record
// that does not exist.
function FormStrip({ count }: { count: number }) {
  const filled = Math.min(count, FORM_SLOTS);
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {Array.from({ length: FORM_SLOTS }, (_, i) => i).map((i) =>
        i < filled ? (
          <View
            key={i}
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              backgroundColor: TOKENS.pitch,
            }}
          />
        ) : (
          <View
            key={i}
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: TOKENS.lineBold,
            }}
          />
        ),
      )}
    </View>
  );
}

// The grounds as pins, sized by nothing and labelled by games: the map is
// a picture of where you have played, and a tap opens the venue.
function GroundsMap({ grounds }: { grounds: MyGround[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const pins = useMemo<MapPin[]>(
    () =>
      grounds
        .filter((g) => g.lat != null && g.lng != null)
        .map((g) => ({
          id: g.venue_id,
          kind: 'venue' as const,
          lat: g.lat!,
          lng: g.lng!,
          title: g.name,
          label: g.games === 1 ? t('profileGroundsGamesOne') : t('profileGroundsGames', { count: g.games }),
        })),
    [grounds, t],
  );
  const hasPins = pins.length > 0;
  useEffect(() => {
    if (hasPins) capture('map_shown', { surface: 'record', pins: pinBucket(pins.length) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPins]);
  if (!hasPins) return null;
  return (
    <HomeMapCard
      pins={pins}
      a11yLabel={t('profileGroundsA11y')}
      onPinPress={(pin) => {
        capture('map_pin_tapped', { surface: 'record', kind: 'venue' });
        router.push(`/venue/${pin.id}`);
      }}
    />
  );
}
