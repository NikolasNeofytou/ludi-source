// Pitch detail + 7-day availability grid + booking entry (M2 #8 + #9),
// "Chalk & Aegean" pass (design handoff 2026-08-10). The one place the app
// should feel physically layered: full-bleed hero field tile, an elev3 title
// card overlapping it, and a sticky footer that slides up with the always-
// expanded price summary once a slot is selected (the €35→€43 mitigation —
// the breakdown appears BEFORE payment, not after).
//
// Addons (bibs + ball_rental): Cyprus law requires venues to OFFER them on
// every booking, not players to buy them. So they are always shown, start at
// 0, and the player opts in — EU consumer law (2011/83/EU art. 22) also bars
// pre-selected paid extras.

import {
  AMENITY_ICON,
  Button,
  Card,
  ELEV,
  FieldTile,
  FORMAT_DOT,
  MOTION,
  Pick,
  PickLabel,
  Press,
  PriceSummary,
  RADII,
  SPRING,
  Skeleton,
  TOKENS,
  Tally,
  effect,
  haptic,
  spatial,
  useReduceMotion,
  type PriceLine,
} from '@ludi/ui';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Reanimated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Svg, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';

import {
  ADDON_PRICES_CENTS,
  computePreviewTotalCents,
  formatEurAmount,
  SPLIT_PAYMENTS_ENABLED,
  type AddonCode,
  type AddonLine,
} from '@/lib/booking';
import { BackButton } from '@/components/BackButton';
import { capture } from '@/lib/analytics';
import { armCheckout } from '@/lib/checkout-intent';
import {
  fetchAvailableSlots,
  fetchPitchDetail,
  next7Days,
  venueDateStr,
  venueDayOfMonth,
  venueTimeStr,
  venueWeekdayMonIndex,
  type AvailableSlot,
  type PitchDetail,
  type SevenDays,
} from '@/lib/pitch-detail';
import { myRecordingDefault, pitchHasCamera } from '@/lib/recording';

// Quantity caps per the plan: bibs ≤ 4 sets, ball_rental ≤ 2 balls.
const ADDON_MAX: Record<AddonCode, number> = {
  bibs: 4,
  ball_rental: 2,
};

type DetailState =
  | { status: 'loading' }
  | { status: 'success'; pitch: PitchDetail; slots: AvailableSlot[] }
  | { status: 'error' };

export default function PitchDetailScreen() {
  // rebookFrom rides along when this screen was reached via "book again"
  // on a played fixture — it flows into checkout and becomes the booking's
  // rebooked_from chain link (community-v2.md).
  const { id, rebookFrom } = useLocalSearchParams<{ id: string; rebookFrom?: string }>();
  const router = useRouter();
  const { t } = useTranslation();

  // `days` is state, not a useMemo, so it can roll forward when the screen
  // refocuses across midnight (see M2 #8 notes).
  const [days, setDays] = useState<SevenDays>(() => next7Days());
  const [activeDateStr, setActiveDateStr] = useState(() => venueDateStr(days[0]));
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [bibs, setBibs] = useState(0);
  const [ballRental, setBallRental] = useState(0);
  // C2 W6: split fixture — the organiser pays their share now, the invite
  // collects the rest. Off by default; the whole-booking path is untouched.
  const [split, setSplit] = useState(false);
  // Court cameras (ADR-0042): a court with a camera offers the switch, and
  // it remembers the organiser's last answer. No camera, no switch.
  const [hasCamera, setHasCamera] = useState(false);
  const [record, setRecord] = useState(false);
  useEffect(() => {
    if (!id) return;
    let live = true;
    pitchHasCamera(id).then(async (yes) => {
      if (!live) return;
      setHasCamera(yes);
      if (yes) {
        const remembered = await myRecordingDefault();
        if (live) setRecord(remembered);
      }
    });
    return () => {
      live = false;
    };
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      const fresh = next7Days();
      setDays((prev) =>
        venueDateStr(prev[0]) === venueDateStr(fresh[0]) ? prev : fresh,
      );
    }, []),
  );

  useEffect(() => {
    const window = new Set(days.map(venueDateStr));
    if (!window.has(activeDateStr)) {
      setActiveDateStr(venueDateStr(days[0]));
      setSelectedSlot(null);
    }
  }, [days, activeDateStr]);

  const cancelLoadRef = useRef<(() => void) | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    cancelLoadRef.current?.();
    setState({ status: 'loading' });
    setSelectedSlot(null);
    let cancelled = false;
    cancelLoadRef.current = () => {
      cancelled = true;
    };
    const startDate = venueDateStr(days[0]);
    const endDate = venueDateStr(days[6]);
    Promise.all([fetchPitchDetail(id), fetchAvailableSlots(id, startDate, endDate)])
      .then(([pitch, slots]) => {
        if (cancelled) return;
        setState({ status: 'success', pitch, slots });
        capture('pitch_viewed', { pitch_id: id, price_cents: pitch.price_per_hour_cents });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'error' });
      });
  }, [id, days]);

  useEffect(() => {
    load();
    return () => cancelLoadRef.current?.();
  }, [load]);

  const slotsByDate = useMemo(() => {
    if (state.status !== 'success') return new Map<string, AvailableSlot[]>();
    const map = new Map<string, AvailableSlot[]>();
    for (const s of state.slots) {
      const key = venueDateStr(new Date(s.starts_at));
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [state]);

  const onSelectDay = useCallback((dateStr: string) => {
    setActiveDateStr(dateStr);
    setSelectedSlot(null);
  }, []);

  const onToggleSlot = useCallback((slot: AvailableSlot) => {
    haptic('selection');
    setSelectedSlot((prev) => (prev?.starts_at === slot.starts_at ? null : slot));
  }, []);

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
        <FloatingBack onBack={() => router.back()} inline />
        <View style={{ padding: 20, gap: 16 }}>
          <Skeleton variant="card" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Skeleton variant="tile" />
            <Skeleton variant="tile" />
            <Skeleton variant="tile" />
            <Skeleton variant="tile" />
          </View>
          <Skeleton variant="row" />
        </View>
      </SafeAreaView>
    );
  }
  if (state.status === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
        <FloatingBack onBack={() => router.back()} inline />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Text style={{ fontFamily: TOKENS.ui, color: TOKENS.ink2 }}>
            {t('pitchDetailError')}
          </Text>
          <Button variant="secondary" size="sm" onPress={load}>
            {t('discoverRetry')}
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const { pitch } = state;
  const activeSlots = slotsByDate.get(activeDateStr) ?? [];
  const dot = FORMAT_DOT[pitch.type] ?? TOKENS.primary;

  const addons: AddonLine[] = [
    { code: 'bibs' as const, quantity: bibs },
    { code: 'ball_rental' as const, quantity: ballRental },
  ].filter((a) => a.quantity > 0);

  const previewTotalCents = selectedSlot
    ? computePreviewTotalCents(
        pitch.price_per_hour_cents,
        new Date(selectedSlot.starts_at),
        new Date(selectedSlot.ends_at),
        addons,
      )
    : 0;

  const dayLabels = t('days', { returnObjects: true }) as string[];

  // C2 W6 — split preview math. Squad sizes mirror squad_slots_for()
  // (2 keepers + format outfield); the per-head preview mirrors
  // share-math.ts (floor — the organiser absorbs the remainder upward, so
  // "a head" is what a MATE pays and never understates it).
  const SPLIT_SLOTS: Record<string, number> = {
    '5-a-side': 10,
    '7-a-side': 14,
    '11-a-side': 22,
  };
  const splitSlots = SPLIT_SLOTS[pitch.type] ?? null;
  const splitShareCents =
    splitSlots && previewTotalCents > 0 ? Math.floor(previewTotalCents / splitSlots) : null;
  const splitEligible = selectedSlot
    ? Date.parse(selectedSlot.starts_at) - Date.now() >= 26 * 3_600_000
    : true;

  const priceLines: PriceLine[] = selectedSlot
    ? [
        {
          id: 'pitch',
          label: `${t('priceLinePitch')} · ${dayLabels[venueWeekdayMonIndex(new Date(selectedSlot.starts_at))]} ${venueTimeStr(selectedSlot.starts_at)}–${venueTimeStr(selectedSlot.ends_at)}`,
          amountCents:
            previewTotalCents -
            bibs * ADDON_PRICES_CENTS.bibs -
            ballRental * ADDON_PRICES_CENTS.ball_rental,
        },
        ...addons.map((a) => {
          const name = a.code === 'bibs' ? t('addonBibs') : t('addonBallRental');
          return {
            id: a.code,
            label: a.quantity > 1 ? `${name} ×${a.quantity}` : name,
            amountCents: a.quantity * ADDON_PRICES_CENTS[a.code],
          };
        }),
      ]
    : [];

  const onBook = () => {
    if (!selectedSlot) return;
    armCheckout(pitch.id, selectedSlot.starts_at);
    router.push({
      pathname: '/booking/[id]/checkout',
      params: {
        id: pitch.id,
        starts_at: selectedSlot.starts_at,
        ends_at: selectedSlot.ends_at,
        bibs: String(bibs),
        ball_rental: String(ballRental),
        split: SPLIT_PAYMENTS_ENABLED && split && splitEligible ? '1' : '0',
        ...(hasCamera && record ? { record: '1' } : {}),
        ...(rebookFrom ? { rebook_from: rebookFrom } : {}),
      },
    });
  };

  return (
    // First load only: the content fades in where the skeleton was, instead
    // of replacing it in one frame (plans/motion-v3.md, Load).
    <Reanimated.View entering={FadeIn.duration(MOTION.quick)} style={{ flex: 1, backgroundColor: TOKENS.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 240 }}>
        {/* Hero — full-bleed field tile, no safe-area inset. */}
        <FieldTile format={pitch.type} height={280} hero />
        <FloatingBack onBack={() => router.back()} />

        {/* Title card overlapping the hero. */}
        <Card
          elevation="e3"
          radius="xl"
          padded={20}
          style={{ marginTop: -20, marginHorizontal: 20 }}
        >
          <View style={{ gap: 6 }}>
            <Text
              style={{
                fontFamily: TOKENS.mono,
                fontSize: 11,
                color: TOKENS.ink3,
                textTransform: 'uppercase',
                letterSpacing: 0.77,
              }}
            >
              {pitch.venue.name}
            </Text>
            <Text
              style={{
                fontFamily: TOKENS.displaySemi,
                fontSize: 26,
                color: TOKENS.ink,
                letterSpacing: -0.52,
              }}
            >
              {pitch.name}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
                <Text
                  style={{
                    fontFamily: TOKENS.mono,
                    fontSize: 11,
                    color: TOKENS.ink3,
                    textTransform: 'uppercase',
                    letterSpacing: 0.77,
                  }}
                >
                  {pitch.type} · {pitch.surface}
                </Text>
              </View>
              <Text style={{ fontFamily: TOKENS.displaySemi, fontSize: 24, color: TOKENS.ink }}>
                €{Math.round(pitch.price_per_hour_cents / 100)}
                <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink3 }}>
                  {t('perHour')}
                </Text>
              </Text>
            </View>
          </View>
        </Card>

        {pitch.amenities.length > 0 && (
          <View style={{ paddingHorizontal: 20, paddingTop: 24, gap: 8 }}>
            <SectionLabel>{t('amenities')}</SectionLabel>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {pitch.amenities.map((a) => (
                <AmenityTile key={a} label={a} />
              ))}
            </View>
          </View>
        )}

        <View style={{ paddingHorizontal: 20, paddingVertical: 20 }}>
          <Button variant="secondary" onPress={() => openInMaps(pitch.venue.address)}>
            {t('pitchOpenInMaps')}
          </Button>
        </View>

        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          <SectionLabel>{t('pitchAvailability')}</SectionLabel>
          <DayStrip days={days} activeDateStr={activeDateStr} onSelect={onSelectDay} />
          {/* A new day's slots fade in rather than replace the last day's
              in one frame. */}
          <Reanimated.View key={activeDateStr} entering={FadeIn.duration(MOTION.quick)}>
          <SlotArea
            slots={activeSlots}
            selectedStartsAt={selectedSlot?.starts_at ?? null}
            onToggle={onToggleSlot}
            closedLabel={t('pitchClosedToday')}
            days={days}
            slotsByDate={slotsByDate}
            activeDateStr={activeDateStr}
            onSelectDay={onSelectDay}
            dayLabels={dayLabels}
          />
          </Reanimated.View>
        </View>

        <View style={{ padding: 20, gap: 12 }}>
          <SectionLabel>{t('addonsTitle')}</SectionLabel>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink2, lineHeight: 19 }}>
            {t('addonsNote')}
          </Text>
          <AddonRow
            label={t('addonBibs')}
            unit={t('addonBibsUnit')}
            value={bibs}
            min={0}
            max={ADDON_MAX.bibs}
            onChange={setBibs}
          />
          <AddonRow
            label={t('addonBallRental')}
            unit={t('addonBallRentalUnit')}
            value={ballRental}
            min={0}
            max={ADDON_MAX.ball_rental}
            onChange={setBallRental}
          />
        </View>

        {/* C2 W6 — split the cost. Eligibility mirrors the server's
            SPLIT_TOO_LATE guard (kickoff ≥ 26h away: the T-24h deadline
            plus the organiser's 2h cover grace must both fit). Hidden while
            SPLIT_PAYMENTS_ENABLED is off (launch audit 2026-09-13). */}
        {SPLIT_PAYMENTS_ENABLED && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 20, gap: 12 }}>
          <SectionLabel>{t('splitTitle')}</SectionLabel>
          <Card padded={16} elevation="e0" style={{ gap: 6 }}>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Text style={{ fontFamily: TOKENS.ui,
              fontWeight: '600', fontSize: 15, color: TOKENS.ink, flex: 1 }}>
                {t('splitToggleLabel')}
              </Text>
              <Switch
                value={split && splitEligible}
                disabled={!splitEligible}
                onValueChange={setSplit}
                trackColor={{ true: TOKENS.primary }}
              />
            </View>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink2, lineHeight: 19 }}>
              {!splitEligible
                ? t('splitTooLateHint')
                : split && splitShareCents != null
                  ? t('splitOnHint', {
                      share: formatEurAmount(splitShareCents),
                      slots: splitSlots ?? 0,
                    })
                  : t('splitOffHint')}
            </Text>
          </Card>
        </View>
        )}

        {hasCamera && (
          <View style={{ paddingHorizontal: 20, paddingBottom: 20, gap: 12 }}>
            <SectionLabel>{t('recordTitle')}</SectionLabel>
            <Card padded={16} elevation="e0" style={{ gap: 6 }}>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Text style={{ fontFamily: TOKENS.ui, fontWeight: '600', fontSize: 15, color: TOKENS.ink, flex: 1 }}>
                  {t('recordToggle')}
                </Text>
                <Switch value={record} onValueChange={setRecord} trackColor={{ true: TOKENS.primary }} />
              </View>
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink2, lineHeight: 19 }}>
                {record ? t('recordHintOn') : t('recordHintOff')}
              </Text>
            </Card>
          </View>
        )}
      </ScrollView>

      <StickyFooter
        selected={!!selectedSlot}
        priceLines={priceLines}
        totalLabel={t('total')}
        totalCents={previewTotalCents}
        ctaLabel={
          selectedSlot
            ? t('bookCta', { total: formatEurAmount(previewTotalCents) })
            : t('bookCtaPickSlot')
        }
        onPress={onBook}
      />
    </Reanimated.View>
  );
}

// Floating back button over the hero (or inline on loading/error states
// where there is no hero).
function FloatingBack({ onBack, inline = false }: { onBack: () => void; inline?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <BackButton
      onPress={onBack}
      style={
        inline
          ? { marginLeft: 16, marginTop: 8 }
          : { position: 'absolute', top: insets.top + 8, left: 16 }
      }
    />
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: TOKENS.monoMedium,
        fontSize: 11,
        color: TOKENS.ink3,
        textTransform: 'uppercase',
        letterSpacing: 0.88,
      }}
    >
      {children}
    </Text>
  );
}

function AmenityTile({ label }: { label: string }) {
  const icon = AMENITY_ICON[label as keyof typeof AMENITY_ICON];
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: RADII.sm,
          borderCurve: 'continuous',
          backgroundColor: TOKENS.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: TOKENS.line,
        },
        ELEV.e1,
      ]}
    >
      {icon ? icon(TOKENS.ink2, 16) : null}
      <Text
        style={{
          fontFamily: TOKENS.mono,
          fontSize: 10,
          color: TOKENS.ink2,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function DayStrip({
  days,
  activeDateStr,
  onSelect,
}: {
  days: SevenDays;
  activeDateStr: string;
  onSelect: (dateStr: string) => void;
}) {
  const { t } = useTranslation();
  const labels = t('days', { returnObjects: true }) as string[];
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 36 }}
      >
        {days.map((d) => {
          const dateStr = venueDateStr(d);
          const active = dateStr === activeDateStr;
          // A Pick: gives under the finger, ticks, and cross-fades fill and
          // labels together (it used to snap with no pressed state at all).
          return (
            <Pick
              key={dateStr}
              selected={active}
              silent={active}
              onPress={() => onSelect(dateStr)}
              fill={{ off: TOKENS.surface, on: TOKENS.primary }}
              border={{ off: TOKENS.line, on: TOKENS.primary }}
              style={[
                {
                  alignItems: 'center',
                  paddingVertical: 10,
                  borderRadius: RADII.md,
                  borderCurve: 'continuous',
                  borderWidth: StyleSheet.hairlineWidth,
                  minWidth: 56,
                },
                active ? ELEV.e2 : ELEV.e1,
              ]}
            >
              <PickLabel
                on="rgba(255,255,255,0.85)"
                off={TOKENS.ink3}
                style={{
                  fontFamily: TOKENS.monoMedium,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                }}
              >
                {labels[venueWeekdayMonIndex(d)]}
              </PickLabel>
              <PickLabel on="#fff" off={TOKENS.ink} style={{ fontFamily: TOKENS.displaySemi, fontSize: 19 }}>
                {venueDayOfMonth(d)}
              </PickLabel>
            </Pick>
          );
        })}
      </ScrollView>
      {/* Right-edge fade so horizontal scroll is discoverable — SAT 15 used
          to clip mid-glyph and read as a bug. */}
      <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 36 }}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={TOKENS.bg} stopOpacity="0" />
              <Stop offset="1" stopColor={TOKENS.bg} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#fade)" />
        </Svg>
      </View>
    </View>
  );
}

// Slot grid, or — when the venue is open but every slot is taken — the
// sold-out card with a next-free-day hint. A grid of struck text is not an
// empty state.
function SlotArea({
  slots,
  selectedStartsAt,
  onToggle,
  closedLabel,
  days,
  slotsByDate,
  activeDateStr,
  onSelectDay,
  dayLabels,
}: {
  slots: AvailableSlot[];
  selectedStartsAt: string | null;
  onToggle: (slot: AvailableSlot) => void;
  closedLabel: string;
  days: SevenDays;
  slotsByDate: Map<string, AvailableSlot[]>;
  activeDateStr: string;
  onSelectDay: (dateStr: string) => void;
  dayLabels: string[];
}) {
  const { t } = useTranslation();

  if (slots.length === 0) {
    return (
      <View style={{ paddingVertical: 32, alignItems: 'center' }}>
        <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, color: TOKENS.ink3 }}>
          {closedLabel}
        </Text>
      </View>
    );
  }

  const allTaken = slots.every((s) => !s.is_available);
  if (allTaken) {
    // Find the next day in the window with at least one free slot.
    const idx = days.findIndex((d) => venueDateStr(d) === activeDateStr);
    let next: { date: Date; dateStr: string } | null = null;
    for (let i = idx + 1; i < days.length; i++) {
      const day = days[i];
      if (!day) continue;
      const ds = venueDateStr(day);
      if ((slotsByDate.get(ds) ?? []).some((s) => s.is_available)) {
        next = { date: day, dateStr: ds };
        break;
      }
    }
    const activeDay = days[idx];
    const dayName = activeDay ? dayLabels[venueWeekdayMonIndex(activeDay)] ?? '' : '';
    return (
      <Card elevation="e2" radius="lg" padded={20}>
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: TOKENS.sun }} />
            <Text
              style={{
                fontFamily: TOKENS.monoMedium,
                fontSize: 10.5,
                color: TOKENS.sunDeep,
                textTransform: 'uppercase',
                letterSpacing: 0.84,
              }}
            >
              {t('soldOutBadge')}
            </Text>
          </View>
          <Text style={{ fontFamily: TOKENS.displaySemi, fontSize: 21, color: TOKENS.ink }}>
            {t('soldOutTitle', { day: dayName })}
          </Text>
          {next && (
            <Press
              feel="control"
              onPress={() => onSelectDay(next!.dateStr)}
              style={{
                alignSelf: 'flex-start',
                marginTop: 4,
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: RADII.full,
                backgroundColor: TOKENS.bg,
              }}
            >
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, fontWeight: '600', color: TOKENS.ink }}>
                {t('soldOutTryNext', {
                  day: `${dayLabels[venueWeekdayMonIndex(next.date)]} ${venueDayOfMonth(next.date)}`,
                })}
              </Text>
            </Press>
          )}
        </View>
      </Card>
    );
  }

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {slots.map((s) => (
        <SlotTile
          key={s.starts_at}
          slot={s}
          selected={s.starts_at === selectedStartsAt}
          onToggle={onToggle}
        />
      ))}
    </View>
  );
}

function SlotTile({
  slot,
  selected,
  onToggle,
}: {
  slot: AvailableSlot;
  selected: boolean;
  onToggle: (s: AvailableSlot) => void;
}) {
  const time = venueTimeStr(slot.starts_at);
  // A Pick (press, fill and label cross-fade; the screen plays `selection`),
  // plus the select pop — scale 1 → 1.04 → 1 — now on the spatial spring: a
  // quick lift, then the spring settles it (plans/motion-v3.md, sweep 3).
  // Reduce Motion: no pop. Hooks sit above the unavailable early-return so
  // their order never changes.
  const pop = useSharedValue(1);
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (!selected || reduceMotion) return;
    pop.value = withSequence(
      withTiming(1.04, { duration: MOTION.quick / 2 }),
      withSpring(1, SPRING.spatial),
    );
  }, [selected, reduceMotion, pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  if (!slot.is_available) {
    return (
      <View
        accessibilityLabel={`${time}, unavailable`}
        style={{
          width: 79,
          paddingVertical: 11,
          borderRadius: RADII.md,
          borderCurve: 'continuous',
          backgroundColor: TOKENS.bg,
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: TOKENS.mono,
            fontSize: 13,
            color: TOKENS.ink3,
            textDecorationLine: 'line-through',
          }}
        >
          {time}
        </Text>
      </View>
    );
  }
  return (
    <Reanimated.View style={popStyle}>
      <Pick
        selected={selected}
        silent
        onPress={() => onToggle(slot)}
        accessibilityLabel={`${time}, available`}
        fill={{ off: TOKENS.surface, on: TOKENS.primary }}
        border={{ off: TOKENS.line, on: TOKENS.primary }}
        style={[
          {
            width: 79,
            paddingVertical: 11,
            borderRadius: RADII.md,
            borderCurve: 'continuous',
            borderWidth: StyleSheet.hairlineWidth,
            alignItems: 'center',
          },
          selected ? ELEV.e2 : ELEV.e1,
        ]}
      >
        <PickLabel
          on="#fff"
          off={TOKENS.ink}
          style={{ fontFamily: selected ? TOKENS.monoMedium : TOKENS.mono, fontSize: 13 }}
        >
          {time}
        </PickLabel>
      </Pick>
    </Reanimated.View>
  );
}

function AddonRow({
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Card elevation="e1" radius="md" padded={14}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ gap: 2 }}>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink, fontWeight: '600' }}>
            {label}
          </Text>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>{unit}</Text>
        </View>
        <Stepper value={value} min={min} max={max} onChange={onChange} />
      </View>
    </Card>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  // Each step is a choice changing: it ticks, and the number rolls the way it
  // moved (a Tally) instead of swapping.
  const dec = () => {
    if (value <= min) return;
    haptic('selection');
    onChange(value - 1);
  };
  const inc = () => {
    if (value >= max) return;
    haptic('selection');
    onChange(value + 1);
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <StepperButton onPress={dec} disabled={value <= min} label="−" />
      <View style={{ minWidth: 18 }}>
        <Tally
          value={value}
          align="center"
          style={{ fontFamily: TOKENS.displaySemi, fontSize: 18, color: TOKENS.ink, textAlign: 'center' }}
        />
      </View>
      <StepperButton onPress={inc} disabled={value >= max} label="+" />
    </View>
  );
}

function StepperButton({
  onPress,
  disabled,
  label,
}: {
  onPress: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <Press
      feel="control"
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityLabel={label === '+' ? 'Add one' : 'Remove one'}
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: TOKENS.lineBold,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: TOKENS.bg,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Text style={{ fontFamily: TOKENS.ui, fontSize: 18, color: TOKENS.ink, lineHeight: 20 }}>
        {label}
      </Text>
    </Press>
  );
}

// Sticky footer — surface, top hairline, elev3. Slides up with the price
// summary when a slot is selected; before that, a disabled "Pick a time".
function StickyFooter({
  selected,
  priceLines,
  totalLabel,
  totalCents,
  ctaLabel,
  onPress,
}: {
  selected: boolean;
  priceLines: PriceLine[];
  totalLabel: string;
  totalCents: number;
  ctaLabel: string;
  onPress: () => void;
}) {
  // The price summary opens and closes on the UI thread (it used to animate
  // maxHeight on the JS thread, so a slot fetch stuttered it): the height
  // follows the spatial spring to the summary's measured height, the opacity
  // fades on MOTION.standard. Reduce Motion: the height jumps, the fade halves.
  // The last lines stay mounted while it closes — clearing the slot used to
  // unmount the summary first, so an empty box shrank.
  const reduceMotion = useReduceMotion();
  const last = useRef({ lines: priceLines, totalCents });
  if (priceLines.length > 0) last.current = { lines: priceLines, totalCents };
  const open = selected && priceLines.length > 0;
  const [contentHeight, setContentHeight] = useState(0);
  const height = useSharedValue(0);
  const opacity = useSharedValue(0);
  useEffect(() => {
    height.value = spatial(open ? contentHeight : 0, reduceMotion, SPRING.spatial);
    opacity.value = effect(open ? 1 : 0, reduceMotion, MOTION.standard);
  }, [open, contentHeight, reduceMotion, height, opacity]);
  const summaryStyle = useAnimatedStyle(() => ({
    height: height.value,
    opacity: opacity.value,
  }));

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: TOKENS.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: TOKENS.line,
        },
        ELEV.e3,
        { shadowOffset: { width: 0, height: -6 } },
      ]}
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 14 }}>
        <Reanimated.View style={[{ overflow: 'hidden' }, summaryStyle]}>
          {/* Absolutely placed so it measures its natural height while the
              box around it is still closed. */}
          <View
            style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
            onLayout={(e) => setContentHeight(e.nativeEvent.layout.height)}
          >
            {last.current.lines.length > 0 && (
              <PriceSummary
                lines={last.current.lines}
                totalLabel={totalLabel}
                totalCents={last.current.totalCents}
              />
            )}
          </View>
        </Reanimated.View>
        <Button onPress={onPress} disabled={!selected} size="lg" full tally>
          {ctaLabel}
        </Button>
      </View>
    </SafeAreaView>
  );
}

function openInMaps(address: string) {
  const q = encodeURIComponent(address);
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?q=${q}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`;
  Linking.openURL(url).catch(() => {});
}
