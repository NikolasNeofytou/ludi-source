// Player card screen (Player Card, ADR-0012). Loads a user row by id and
// renders the two-sided card (plans/player-card-v2.md): the front, and the
// back with the position, the record and the QR — a tap on the card or the
// button under it turns it over. Today this is reached only for the
// signed-in user ("View my card" on the profile tab) — users RLS lets a
// player read only their own row. The route is id-addressable so Stage 3
// matchmaking can open another player's card once a public-player read
// path exists (a future RLS decision, deliberately deferred).

import { Button, MOTION, Press, Skeleton, TOKENS, useReduceMotion } from '@ludi/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { PlayerCardBack } from '@/components/PlayerCardBack';
import {
  CARD_W,
  cardHeight,
  FlipGlyph,
  PlayerCardFront,
  type PlayerCardData,
} from '@/components/PlayerCardFront';
import { fetchMyRecord, type Locale, type MyRecord } from '@/lib/player-profile';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { walletPassUrl } from '@/lib/wallet-pass';

type Face = 'front' | 'back';

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; data: PlayerCardData };

export default function PlayerCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { session } = useSession();
  const locale = (i18n.language === 'gr' ? 'gr' : 'en') as Locale;

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [face, setFace] = useState<Face>('front');
  const [walletBusy, setWalletBusy] = useState(false);
  const flip = () => setFace((f) => (f === 'front' ? 'back' : 'front'));

  const onAddToWallet = async () => {
    setWalletBusy(true);
    try {
      const url = await walletPassUrl();
      if (url) await Linking.openURL(url);
    } finally {
      setWalletBusy(false);
    }
  };
  // The card is drawn at 362 and scales down to fit a narrower phone.
  const { width: windowW } = useWindowDimensions();
  const cardW = Math.min(CARD_W, windowW - 40);
  // The record is the SUBJECT's, and my_record() only ever answers for the
  // caller — so it may back the band on a self-view alone. Another player's
  // card keeps the em-dash until a consent-gated public record exists.
  const [record, setRecord] = useState<MyRecord | null>(null);
  // On a self-view the card waits for the record too, so it arrives whole
  // instead of the record popping into it a beat later (plans/motion-v3.md).
  const [recordKnown, setRecordKnown] = useState(false);

  // Verification is a property of the CARD'S SUBJECT, not the viewer. The
  // session only knows the viewer's auth state, so it may back the badge
  // only when viewer == subject; any other card renders unverified until a
  // server-side verified field exists on the public read path (needed
  // before Stage-3 cross-player cards or the public /p/ page ship —
  // flagged in the 2026-08-30 card data audit).
  const user = session?.user;
  const isSelf = Boolean(id && user?.id === id);
  const verified =
    isSelf && Boolean(user?.phone_confirmed_at || user?.email_confirmed_at || user?.confirmed_at);

  const load = useCallback(async () => {
    if (!id) return;
    setState({ kind: 'loading' });
    const { data, error } = await supabase
      .from('users')
      .select(
        'first_name, last_name, handle, skill_level, positions, preferred_foot, height_cm, age_band, play_frequency, member_no, created_at, cities(name_en, name_gr)',
      )
      .eq('id', id)
      .single();
    if (error || !data) {
      setState({ kind: 'error' });
      return;
    }
    const row = data as Record<string, unknown>;
    const cityRel = row.cities as { name_en: string; name_gr: string } | { name_en: string; name_gr: string }[] | null;
    const city = Array.isArray(cityRel) ? cityRel[0] ?? null : cityRel;
    const cityName = city ? (locale === 'gr' ? city.name_gr : city.name_en) : null;
    setState({
      kind: 'ready',
      data: {
        first_name: (row.first_name as string) ?? '',
        last_name: (row.last_name as string) ?? '',
        handle: (row.handle as string | null) ?? null,
        skill_level: (row.skill_level as number) ?? 3,
        positions: (row.positions as string[]) ?? [],
        preferred_foot: (row.preferred_foot as PlayerCardData['preferred_foot']) ?? null,
        height_cm: (row.height_cm as number | null) ?? null,
        age_band: (row.age_band as PlayerCardData['age_band']) ?? null,
        play_frequency: (row.play_frequency as PlayerCardData['play_frequency']) ?? null,
        member_no: (row.member_no as number | null) ?? null,
        created_at: (row.created_at as string | null) ?? null,
        city_name: cityName,
      },
    });
  }, [id, locale]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isSelf) {
      setRecord(null);
      setRecordKnown(true);
      return;
    }
    setRecordKnown(false);
    fetchMyRecord()
      .then(setRecord)
      .catch(() => setRecord(null))
      .finally(() => setRecordKnown(true));
  }, [isSelf]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
        <BackButton onPress={() => router.back()} />
      </View>

      {state.kind === 'loading' || (state.kind === 'ready' && !recordKnown) ? (
        // The card's own shape, in the card's own place, while it loads — not
        // a dot in the middle of the screen (motion-v3 slice 6) — fading out
        // under the card as it fades in.
        <Animated.View
          exiting={FadeOut.duration(MOTION.instant)}
          accessible
          accessibilityLabel={t('profileLoading')}
          style={{ flex: 1, padding: 20, alignItems: 'center' }}
        >
          <Skeleton variant="block" width={cardW} height={cardHeight(cardW)} radius={20 * (cardW / CARD_W)} />
        </Animated.View>
      ) : state.kind === 'error' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2, textAlign: 'center' }}>
            {t('profileLoadError')}
          </Text>
        </View>
      ) : (
        <Animated.View entering={FadeIn.duration(MOTION.quick)} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ padding: 20, paddingBottom: 40, alignItems: 'center', gap: 16 }}
          >
            <FlipCard
              face={face}
              width={cardW}
              onPress={flip}
              front={
                <PlayerCardFront data={state.data} verified={verified} locale={locale} record={record} width={cardW} />
              }
              back={
                <PlayerCardBack
                  data={state.data}
                  locale={locale}
                  record={record}
                  recordPrivate={!isSelf}
                  width={cardW}
                />
              }
            />
            <Press
              feel="control"
              onPress={flip}
              hitSlop={4}
              style={{
                minHeight: 44,
                paddingHorizontal: 16,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <FlipGlyph size={15} color={TOKENS.primaryDeep} />
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, fontWeight: '600', color: TOKENS.primaryDeep }}>
                {face === 'front' ? t('playerCardShowBack') : t('playerCardShowFront')}
              </Text>
            </Press>
            {/* Add to Apple Wallet — self-view + iOS only. Opens the signed
                .pkpass from the wallet-pass Edge Function; iOS intercepts the
                content type and shows the add sheet (no native module). The
                URL carries a single-use, 60-second ticket, never the session's
                token (src/lib/wallet-pass.ts). */}
            {isSelf && Platform.OS === 'ios' && session ? (
              <Button variant="secondary" loading={walletBusy} onPress={onAddToWallet}>
                {t('playerCardAddToWallet')}
              </Button>
            ) : null}
          </ScrollView>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

// Settles without overshoot — a card turning over should land, not bounce
// (ADR-0035's "gentle" spring: critically damped).
const FLIP_SPRING = { duration: 550, dampingRatio: 1 } as const;

/**
 * Two faces in one place, turned about the vertical axis. Reduce Motion
 * swaps the turn for a cross-fade (still animated: the fade IS the reduced
 * form). Only the face in front is in the accessibility tree; the button
 * under the card is how a screen reader turns it.
 */
function FlipCard({
  face,
  width,
  front,
  back,
  onPress,
}: {
  face: Face;
  width: number;
  front: ReactNode;
  back: ReactNode;
  onPress: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(face === 'back' ? 1 : 0);

  useEffect(() => {
    const to = face === 'back' ? 1 : 0;
    progress.value = reduceMotion
      ? withTiming(to, { duration: MOTION.quick, reduceMotion: ReduceMotion.Never })
      : withSpring(to, FLIP_SPRING);
  }, [face, reduceMotion, progress]);

  // Past 90° the face is edge-on; switching opacity there backs up
  // backfaceVisibility on platforms that honour it loosely.
  const frontStyle = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: 1 - progress.value, transform: [{ perspective: 1200 }, { rotateY: '0deg' }] }
      : {
          opacity: progress.value < 0.5 ? 1 : 0,
          transform: [{ perspective: 1200 }, { rotateY: `${progress.value * 180}deg` }],
        },
  );
  const backStyle = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: progress.value, transform: [{ perspective: 1200 }, { rotateY: '0deg' }] }
      : {
          opacity: progress.value < 0.5 ? 0 : 1,
          transform: [{ perspective: 1200 }, { rotateY: `${progress.value * 180 - 180}deg` }],
        },
  );

  const hidden = (f: Face) =>
    face === f
      ? { importantForAccessibility: 'auto' as const }
      : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };

  // The card gives under the finger before it turns (plans/motion-v3.md, Go):
  // the tap used to show nothing until the flip began. `accessible={false}`
  // as before — a screen reader reads the face, and the button under the
  // card turns it.
  return (
    <Press onPress={onPress} accessible={false} style={{ width, height: cardHeight(width) }}>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.face, frontStyle]}
        pointerEvents="none"
        {...hidden('front')}
      >
        {front}
      </Animated.View>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.face, backStyle]}
        pointerEvents="none"
        {...hidden('back')}
      >
        {back}
      </Animated.View>
    </Press>
  );
}

const styles = StyleSheet.create({
  face: { backfaceVisibility: 'hidden' },
});
