// Profile edit form (M4 #21), moved out of the tab when the Profile tab
// became a view-first hub — the tab shows who you are; this screen is where
// you change it. Reached from Profile → Edit profile.
//
// Editable fields (per data-model.md + api-contract.md §2.2):
//   first_name, last_name, city_id, skill_level (1–5, shown with a
//   plain-language tier anchor), preferred_locale ('en'|'gr'),
//   positions (text[]), preferred_foot, and the Player Card substrate
//   (ADR-0012): height_cm, age_band (coarse bracket, not DOB), play_frequency.
// Not editable here: role, stripe_customer_id, handle (deferred), id.

import {
  Button,
  Chip,
  Input,
  LevelBars,
  MOTION,
  Press,
  RADII,
  ROW_LAYOUT,
  Reveal,
  Skeleton,
  TOKENS,
  haptic,
} from '@ludi/ui';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { setLocale } from '@/lib/i18n';
import { askForPush } from '@/lib/push';
import {
  AGE_BAND_LABELS,
  AGE_BANDS,
  HEIGHT_MAX,
  HEIGHT_MIN,
  PLAY_FREQUENCIES,
  playFrequencyLabelKey,
  POSITIONS,
  skillTierKey,
  type AgeBand,
  type Foot,
  type Locale,
  type PlayFrequency,
  type Position,
} from '@/lib/player-profile';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { GoesInGoal } from '@/lib/keeper';

interface City {
  id: string;
  code: string;
  name_en: string;
  name_gr: string;
}

interface ProfileRow {
  first_name: string;
  last_name: string;
  city_id: string;
  skill_level: number;
  preferred_locale: Locale;
  positions: string[];
  preferred_foot: Foot | null;
  height_cm: number | null;
  age_band: AgeBand | null;
  play_frequency: PlayFrequency | null;
  public_profile: boolean;
  public_profile_at: string | null;
  goes_in_goal: GoesInGoal;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; profile: ProfileRow; cities: City[] };

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export default function EditProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  // Form fields — only populated once state becomes 'ready'.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [cityId, setCityId] = useState('');
  const [skill, setSkill] = useState(3);
  const [locale, setLocaleState] = useState<Locale>('en');
  const [positions, setPositions] = useState<string[]>([]);
  const [foot, setFoot] = useState<Foot | null>(null);
  // The goalkeeper pool (ADR-0047): whether keeper requests reach this player.
  const [inGoal, setInGoal] = useState<GoesInGoal>('no');
  // What the row said when it loaded, so a save knows whether "in goal"
  // was just switched on — the third push moment (plans/reach.md R2).
  const loadedInGoal = useRef<GoesInGoal>('no');
  const [height, setHeight] = useState<number | null>(null);
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [playFreq, setPlayFreq] = useState<PlayFrequency | null>(null);
  // Consent to publish a player card. Separate from the marketing/analytics
  // consent — turning either of those on must never publish anything. The
  // timestamp is kept so an existing consent keeps its original date rather
  // than being silently re-dated on every unrelated profile save.
  const [publicProfile, setPublicProfile] = useState(false);
  const [publicProfileAt, setPublicProfileAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setState({ kind: 'loading' });
    const [profileRes, citiesRes] = await Promise.all([
      supabase
        .from('users')
        .select(
          'first_name, last_name, city_id, skill_level, preferred_locale, positions, preferred_foot, height_cm, age_band, play_frequency, public_profile, public_profile_at, goes_in_goal',
        )
        .eq('id', userId)
        .single(),
      supabase
        .from('cities')
        .select('id, code, name_en, name_gr')
        .eq('is_enabled', true)
        .order('display_order'),
    ]);
    if (profileRes.error || !profileRes.data || citiesRes.error || !citiesRes.data) {
      setState({ kind: 'error' });
      return;
    }
    const profile = profileRes.data as ProfileRow;
    setFirstName(profile.first_name ?? '');
    setLastName(profile.last_name ?? '');
    setCityId(profile.city_id);
    setSkill(profile.skill_level ?? 3);
    setLocaleState((profile.preferred_locale ?? 'en') as Locale);
    setPositions(profile.positions ?? []);
    setInGoal(profile.goes_in_goal ?? 'no');
    loadedInGoal.current = profile.goes_in_goal ?? 'no';
    setFoot((profile.preferred_foot ?? null) as Foot | null);
    setHeight(profile.height_cm ?? null);
    setAgeBand((profile.age_band ?? null) as AgeBand | null);
    setPlayFreq((profile.play_frequency ?? null) as PlayFrequency | null);
    setPublicProfile(profile.public_profile ?? false);
    setPublicProfileAt(profile.public_profile_at ?? null);
    setState({ kind: 'ready', profile, cities: citiesRes.data as City[] });
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // "Saved." is news, not a state: it arrives, stays a beat, and goes
  // (plans/motion-v3.md, Fail) — it used to stay until the next edit.
  useEffect(() => {
    if (save.kind !== 'saved') return;
    const timer = setTimeout(() => setSave((s) => (s.kind === 'saved' ? { kind: 'idle' } : s)), 2400);
    return () => clearTimeout(timer);
  }, [save.kind]);

  const togglePosition = (pos: Position) => {
    setSave({ kind: 'idle' });
    setPositions((prev) => (prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]));
  };

  const onPickLocale = async (next: Locale) => {
    setSave({ kind: 'idle' });
    setLocaleState(next);
    // Apply immediately so the rest of the form re-renders in the new
    // language without an app restart. Saves to AsyncStorage as a side
    // effect — the DB write happens on Save.
    await setLocale(next);
  };

  const onSave = async () => {
    if (!userId) return;
    if (!firstName.trim() || !lastName.trim()) {
      setSave({ kind: 'error', message: t('profileErrorRequired') });
      return;
    }
    setSave({ kind: 'saving' });
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('users')
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        city_id: cityId,
        skill_level: skill,
        preferred_locale: locale,
        positions,
        preferred_foot: foot,
        goes_in_goal: inGoal,
        height_cm: height,
        age_band: ageBand,
        play_frequency: playFreq,
        public_profile: publicProfile,
        // The DB CHECK requires the flag and its timestamp to agree. Keep the
        // original date when consent is already granted; stamp only on the
        // save that actually grants it.
        public_profile_at: publicProfile ? (publicProfileAt ?? nowIso) : null,
      })
      .eq('id', userId);
    if (error) {
      setSave({ kind: 'error', message: t('profileErrorSaveFailed') });
      return;
    }
    setPublicProfileAt(publicProfile ? (publicProfileAt ?? nowIso) : null);
    setSave({ kind: 'saved' });
    if (loadedInGoal.current === 'no' && inGoal !== 'no') void askForPush('in_goal');
    loadedInGoal.current = inGoal;
  };

  const cityName = useMemo(() => {
    if (state.kind !== 'ready') return '';
    const c = state.cities.find((x) => x.id === cityId);
    if (!c) return '';
    return locale === 'gr' ? c.name_gr : c.name_en;
  }, [state, cityId, locale]);

  if (state.kind === 'loading') {
    // The form's own shape while the profile loads (motion-v3 slice 6), not a
    // spinner: the back button already in its place, the title, the two name
    // fields and the first rows of choices — fading out under the form.
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <BackButton onPress={() => router.back()} />
        </View>
        <Animated.View
          exiting={FadeOut.duration(MOTION.instant)}
          accessible
          accessibilityLabel={t('profileLoading')}
          style={{ padding: 20, gap: 24 }}
        >
          <Skeleton variant="block" width="55%" height={30} radius={RADII.sm} />
          <View style={{ gap: 12 }}>
            <Skeleton variant="block" height={56} />
            <Skeleton variant="block" height={56} />
          </View>
          <Skeleton variant="row" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </Animated.View>
      </SafeAreaView>
    );
  }

  if (state.kind === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }}>
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}
        >
          <Text
            style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2, textAlign: 'center' }}
          >
            {t('profileLoadError')}
          </Text>
          <Button variant="secondary" onPress={load}>
            {t('discoverRetry')}
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <BackButton onPress={() => router.back()} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text
            style={{
              fontFamily: TOKENS.display,
              fontSize: 30,
              fontWeight: '500',
              color: TOKENS.ink,
              letterSpacing: -1,
            }}
          >
            {t('profileHubEditRow')}
          </Text>

          {/* Name */}
          <View style={{ gap: 12 }}>
            <Input
              label={t('profileFirstName')}
              value={firstName}
              onChangeText={(v) => {
                setFirstName(v);
                if (save.kind !== 'idle') setSave({ kind: 'idle' });
              }}
              autoCapitalize="words"
              testID="profile-first-name"
            />
            <Input
              label={t('profileLastName')}
              value={lastName}
              onChangeText={(v) => {
                setLastName(v);
                if (save.kind !== 'idle') setSave({ kind: 'idle' });
              }}
              autoCapitalize="words"
              testID="profile-last-name"
            />
          </View>

          {/* Language */}
          <Section label={t('profileLanguage')}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip active={locale === 'en'} onPress={() => onPickLocale('en')}>
                {t('profileLanguageEn')}
              </Chip>
              <Chip active={locale === 'gr'} onPress={() => onPickLocale('gr')}>
                {t('profileLanguageEl')}
              </Chip>
            </View>
          </Section>

          {/* Home city */}
          <Section label={t('profileHomeCity')}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {state.cities.map((c) => (
                <Chip
                  key={c.id}
                  active={cityId === c.id}
                  onPress={() => {
                    setCityId(c.id);
                    setSave({ kind: 'idle' });
                  }}
                >
                  {locale === 'gr' ? c.name_gr : c.name_en}
                </Chip>
              ))}
            </View>
            {cityName ? (
              <Text
                style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3, marginTop: 4 }}
              >
                {cityName}
              </Text>
            ) : null}
          </Section>

          {/* Skill level */}
          <Section label={t('profileSkill')}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Chip
                  key={n}
                  active={skill === n}
                  onPress={() => {
                    setSkill(n);
                    setSave({ kind: 'idle' });
                  }}
                >
                  {String(n)}
                </Chip>
              ))}
              <View style={{ marginLeft: 8 }}>
                <LevelBars level={skill} />
              </View>
            </View>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>
              {t(skillTierKey(skill))}
            </Text>
          </Section>

          {/* Positions */}
          <Section label={t('profilePositions')} hint={t('profilePositionsHint')}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {POSITIONS.map((pos) => (
                <Chip
                  key={pos}
                  active={positions.includes(pos)}
                  onPress={() => togglePosition(pos)}
                >
                  {pos}
                </Chip>
              ))}
            </View>
          </Section>

          {/* Preferred foot */}
          <Section label={t('profileFoot')}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['left', 'right', 'both'] as const).map((f) => (
                <Chip
                  key={f}
                  active={foot === f}
                  onPress={() => {
                    // Tap-to-clear when already active so the column can stay NULL.
                    setFoot((prev) => (prev === f ? null : f));
                    setSave({ kind: 'idle' });
                  }}
                >
                  {t(
                    f === 'left'
                      ? 'profileFootLeft'
                      : f === 'right'
                        ? 'profileFootRight'
                        : 'profileFootBoth',
                  )}
                </Chip>
              ))}
            </View>
          </Section>

          {/* In goal (ADR-0047) — the keeper pool, the reserve, or neither */}
          <Section label={t('profileInGoal')} hint={t('profileInGoalHint')}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(['full', 'rotation', 'no'] as const).map((g) => (
                <Chip
                  key={g}
                  active={inGoal === g}
                  onPress={() => {
                    setInGoal(g);
                    setSave({ kind: 'idle' });
                  }}
                >
                  {t(g === 'full' ? 'profileInGoalFull' : g === 'rotation' ? 'profileInGoalRotation' : 'profileInGoalNo')}
                </Chip>
              ))}
            </View>
          </Section>

          {/* Height (player card) — ruler-scrubber, no keyboard */}
          <Section label={t('profileHeight')} hint={t('profileHeightHint')}>
            <HeightRuler
              value={height}
              onChange={(v) => {
                setHeight(v);
                if (save.kind !== 'idle') setSave({ kind: 'idle' });
              }}
            />
          </Section>

          {/* Everything under the ruler glides when it opens or closes. */}
          <Animated.View layout={ROW_LAYOUT} style={{ gap: 24 }}>
            {/* Age band (player card) — coarse bracket, never a birth date */}
            <Section label={t('profileAge')}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {AGE_BANDS.map((b) => (
                  <Chip
                    key={b}
                    active={ageBand === b}
                    onPress={() => {
                      // Tap-to-clear so the column can stay NULL (optional).
                      setAgeBand((prev) => (prev === b ? null : b));
                      setSave({ kind: 'idle' });
                    }}
                  >
                    {AGE_BAND_LABELS[b]}
                  </Chip>
                ))}
              </View>
            </Section>

            {/* Play frequency (player card) */}
            <Section label={t('profilePlayFrequency')}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {PLAY_FREQUENCIES.map((f) => (
                  <Chip
                    key={f}
                    active={playFreq === f}
                    onPress={() => {
                      setPlayFreq((prev) => (prev === f ? null : f));
                      setSave({ kind: 'idle' });
                    }}
                  >
                    {t(playFrequencyLabelKey(f))}
                  </Chip>
                ))}
              </View>
            </Section>

            {/* Consent to publish a player card. Two explicit choices rather than
                a switch: a switch invites a stray tap, and this one puts a
                person's name on the open internet. Default is Private, and the
                body says plainly what publishing means before you can pick it. */}
            <Section label={t('profilePublicTitle')}>
              <Text
                style={{
                  fontFamily: TOKENS.ui,
                  fontSize: 13,
                  lineHeight: 19,
                  color: TOKENS.ink2,
                  marginBottom: 10,
                }}
              >
                {t('profilePublicBody')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Chip
                  active={!publicProfile}
                  onPress={() => {
                    setPublicProfile(false);
                    setSave({ kind: 'idle' });
                  }}
                >
                  {t('profilePublicOff')}
                </Chip>
                <Chip
                  active={publicProfile}
                  onPress={() => {
                    setPublicProfile(true);
                    setSave({ kind: 'idle' });
                  }}
                >
                  {t('profilePublicOn')}
                </Chip>
              </View>
              <Text
                style={{
                  fontFamily: TOKENS.ui,
                  fontSize: 12,
                  lineHeight: 17,
                  color: TOKENS.ink3,
                  marginTop: 10,
                }}
              >
                {t('profilePublicNote')}
              </Text>
            </Section>

            {/* Save + status. `loading` also makes Save inert, so a second tap
                mid-save no longer writes twice. */}
            <View style={{ gap: 8 }}>
              <Button full size="lg" onPress={onSave} loading={save.kind === 'saving'}>
                {t('profileSaveCta')}
              </Button>
              {save.kind === 'saved' && (
                <Reveal>
                  <Text
                    style={{
                      fontFamily: TOKENS.ui,
                      fontSize: 13,
                      color: TOKENS.sea,
                      textAlign: 'center',
                    }}
                  >
                    {t('profileSaved')}
                  </Text>
                </Reveal>
              )}
              {save.kind === 'error' && (
                <Reveal key={save.message}>
                  <Text
                    style={{
                      fontFamily: TOKENS.ui,
                      fontSize: 13,
                      color: TOKENS.terracotta,
                      textAlign: 'center',
                    }}
                  >
                    {save.message}
                  </Text>
                </Reveal>
              )}
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, fontWeight: '600', color: TOKENS.ink2 }}>
        {label}
      </Text>
      {children}
      {hint ? (
        <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>{hint}</Text>
      ) : null}
    </View>
  );
}

// Height ruler-scrubber — the premium pattern (Cal AI / Noom style): drag a
// tick ruler past a fixed centre crosshair, big live readout, snap-to-cm,
// selection haptic per tick. Value commits at rest (drag/momentum end), not
// every frame; clearable back to NULL (optional).
const HEIGHT_DEFAULT = 175;
const TICK_W = 12;

function HeightRuler({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [display, setDisplay] = useState(value ?? HEIGHT_DEFAULT);
  const [interacted, setInteracted] = useState(value != null);
  // Two states: collapsed (plain saved value / "Add height") and expanded
  // (the ruler). Expand only while actively changing it.
  const [editing, setEditing] = useState(false);
  // Only a drag commits a height. Positioning the ruler on open is a
  // programmatic scrollTo, and under the New Architecture that fires
  // onMomentumScrollEnd too — so opening the ruler and pressing Done saved
  // 175 cm for someone who never touched it (found in motion-v3 sweep 5).
  const dragged = useRef(false);
  // The swap animates only once the ruler has been opened or closed; on the
  // screen's first draw the row is simply there.
  const toggled = useRef(false);
  const toggle = (next: boolean) => {
    toggled.current = true;
    if (next) dragged.current = false;
    setEditing(next);
  };

  const ticks = useMemo(
    () => Array.from({ length: HEIGHT_MAX - HEIGHT_MIN + 1 }, (_, i) => HEIGHT_MIN + i),
    [],
  );
  const pad = width > 0 ? width / 2 - TICK_W / 2 : 0;

  const valueFromOffset = (x: number) =>
    Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, HEIGHT_MIN + Math.round(x / TICK_W)));

  // Mirror external value into the local readout (load / clear).
  useEffect(() => {
    if (value == null) {
      setInteracted(false);
      setDisplay(HEIGHT_DEFAULT);
    } else {
      setInteracted(true);
      setDisplay(value);
    }
  }, [value]);

  // Position the ruler whenever it's shown (entering edit) or value changes
  // from outside (load / clear). animated:false so it's an instant jump.
  useEffect(() => {
    if (!editing || width <= 0) return;
    const target = ((value ?? HEIGHT_DEFAULT) - HEIGHT_MIN) * TICK_W;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ x: target, animated: false }));
  }, [editing, width, value]);

  // Collapsed — plain saved value, or an "Add height" affordance when empty.
  // Each state is a keyed Reveal, so opening and closing the ruler is a
  // cross-fade, and the sections under it glide (plans/motion-v3.md, List).
  if (!editing) {
    return value != null ? (
      <Reveal key="value" enter={toggled.current}>
        <Press
          onPress={() => toggle(true)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 4,
          }}
        >
          <Text
            style={{ fontFamily: TOKENS.display, fontSize: 22, fontWeight: '500', color: TOKENS.ink }}
          >
            {`${value} cm`}
          </Text>
          <Text
            style={{ fontFamily: TOKENS.ui, fontSize: 13, fontWeight: '600', color: TOKENS.pitch }}
          >
            {t('profileHeightChange')}
          </Text>
        </Press>
      </Reveal>
    ) : (
      <Reveal key="empty" enter={toggled.current}>
        <Press
          onPress={() => toggle(true)}
          style={{
            paddingVertical: 14,
            borderRadius: 12,
            borderCurve: 'continuous',
            borderWidth: 1,
            borderColor: TOKENS.lineBold,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2 }}>
            {t('profileHeightEmpty')}
          </Text>
        </Press>
      </Reveal>
    );
  }

  // Expanded — the ruler scrubber.
  return (
    <Reveal key="ruler" enter={toggled.current} style={{ gap: 10 }}>
      <Text
        style={{
          fontFamily: TOKENS.display,
          fontSize: 30,
          fontWeight: '500',
          textAlign: 'center',
          color: interacted ? TOKENS.ink : TOKENS.ink3,
        }}
      >
        {interacted ? `${display} cm` : t('profileHeightEmpty')}
      </Text>

      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: 56, justifyContent: 'flex-start' }}
      >
        {width > 0 ? (
          <>
            <ScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={TICK_W}
              decelerationRate="fast"
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingHorizontal: pad }}
              onScrollBeginDrag={() => {
                dragged.current = true;
                if (!interacted) setInteracted(true);
              }}
              onScroll={(e) => {
                const v = valueFromOffset(e.nativeEvent.contentOffset.x);
                if (v !== display) {
                  setDisplay(v);
                  // The one continuous-gesture haptic in the app: one tick per
                  // detent crossed, never per scroll event (HIG "harmony").
                  haptic('selection');
                }
              }}
              onScrollEndDrag={(e) => {
                if (dragged.current) onChange(valueFromOffset(e.nativeEvent.contentOffset.x));
              }}
              onMomentumScrollEnd={(e) => {
                if (dragged.current) onChange(valueFromOffset(e.nativeEvent.contentOffset.x));
              }}
            >
              {ticks.map((tk) => {
                const major = tk % 10 === 0;
                const mid = tk % 5 === 0;
                return (
                  <View key={tk} style={{ width: TICK_W, alignItems: 'center' }}>
                    <View
                      style={{
                        width: major ? 2 : 1,
                        height: major ? 28 : mid ? 20 : 12,
                        backgroundColor: major ? TOKENS.ink2 : TOKENS.ink3,
                        borderRadius: 1,
                      }}
                    />
                    {major ? (
                      <Text
                        style={{
                          position: 'absolute',
                          top: 30,
                          width: 40,
                          textAlign: 'center',
                          fontFamily: TOKENS.ui,
                          fontSize: 10,
                          color: TOKENS.ink3,
                        }}
                      >
                        {tk}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
            {/* Fixed centre crosshair — the value comes to the indicator. */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: width / 2 - 1,
                top: 0,
                width: 2,
                height: 34,
                backgroundColor: TOKENS.pitch,
                borderRadius: 1,
              }}
            />
          </>
        ) : null}
      </View>

      <View
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 }}
      >
        {value != null ? (
          <Press
            feel="control"
            onPress={() => {
              onChange(null);
              toggle(false);
            }}
            style={{ padding: 4 }}
          >
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink3 }}>
              {t('profileHeightClear')}
            </Text>
          </Press>
        ) : null}
        <Press feel="control" onPress={() => toggle(false)} style={{ padding: 4 }}>
          <Text
            style={{ fontFamily: TOKENS.ui, fontSize: 13, fontWeight: '600', color: TOKENS.pitch }}
          >
            {t('profileHeightDone')}
          </Text>
        </Press>
      </View>
    </Reveal>
  );
}
