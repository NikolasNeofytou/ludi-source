// "You're in" — the app's second celebration (ADR-0035, amended 2026-10-20;
// plans/motion-v3.md, D1 = C).
//
// Joining someone else's game is the moment a stranger becomes a player in
// their squad, and for most invitees it is their first act in the app. It
// gets the booking's beat: the ring pops, the check draws and `success`
// fires with it, "You're in." rises with the game's day, time and place, and
// one button goes to the squad. Nothing here waits on a webhook — the seat is
// theirs when this screen opens — so there is no second beat.
//
// Reached from the three ways in: a join from an invite, taking a seat
// someone handed over, and claiming a keeper request on Community. Each
// passes what it already knows about the game, so this screen reads nothing.

import { Button, TOKENS, haptic, useReduceMotion } from '@ludi/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CelebrationRing, celebrate, useCelebrationRise } from '@/components/Celebration';
import { formatFixtureDate, formatFixtureTimeRange } from '@/lib/fixture';
import { askForPush } from '@/lib/push';

export default function JoinedScreen() {
  const { id, starts_at, ends_at, where } = useLocalSearchParams<{
    id: string;
    starts_at?: string;
    ends_at?: string;
    where?: string;
  }>();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const locale: 'en' | 'gr' = i18n.language === 'gr' ? 'gr' : 'en';
  const reduceMotion = useReduceMotion();
  const scale = reduceMotion ? 0.5 : 1;

  const rise1 = useSharedValue(0);
  const rise2 = useSharedValue(0);
  useEffect(() => {
    rise1.value = celebrate(1, 260 * scale, 260 * scale);
    rise2.value = celebrate(1, 260 * scale, 320 * scale);
    // A fixture joined: the second push moment (plans/reach.md R2) — asked
    // once the beat has landed, not over it.
    const ask = setTimeout(() => void askForPush('fixture_joined'), 1400);
    return () => clearTimeout(ask);
    // Mount-only: the celebration plays once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rise1Style = useCelebrationRise(rise1, reduceMotion);
  const rise2Style = useCelebrationRise(rise2, reduceMotion);

  const when =
    starts_at && ends_at
      ? `${formatFixtureDate(starts_at, locale)} · ${formatFixtureTimeRange(starts_at, ends_at, locale)}`
      : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, padding: 28, justifyContent: 'center', gap: 24 }}>
        {/* "You're in" is true the moment this opens, so `success` lands with
            the check, not after it. */}
        <CelebrationRing onChecked={() => haptic('success')} />

        <Animated.View style={rise1Style}>
          <Text
            style={{
              fontFamily: TOKENS.displaySemi,
              fontSize: 40,
              color: TOKENS.ink,
              letterSpacing: -1.2,
            }}
          >
            {t('joinedTitle')}
          </Text>
        </Animated.View>

        {(when || where) && (
          <Animated.View style={[{ gap: 4 }, rise2Style]}>
            {when && (
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 17, fontWeight: '600', color: TOKENS.ink }}>
                {when}
              </Text>
            )}
            {where && (
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2 }}>{where}</Text>
            )}
          </Animated.View>
        )}

        <Button onPress={() => router.replace(`/booking/${id}`)} full>
          {t('joinedSquadCta')}
        </Button>
      </View>
    </SafeAreaView>
  );
}
