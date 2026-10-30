// Booking confirmation (M2 #9), "Chalk & Aegean" pass (2026-08-10).
// The app's celebration: ring-pop check, the headline in Fraunces 40, and the
// booking-code card — the artifact players screenshot and send to their
// group chat, so it is worth screenshotting.
// The `success` haptic fires here and on "You're in" only — the rule lives in
// packages/ui/src/haptics.ts (ADR-0035, amended 2026-10-20).
//
// Two beats (plans/motion-v3.md slice 2, motion-v2 slice 2). Checkout lands
// here the frame the Payment Sheet succeeds, with `settling=1`:
//   1. PAID — true the moment the sheet returns: the ring pops, the check
//      draws, the headline says "Paid." and a line says the venue is
//      confirming. No code, no Share, no `success` yet.
//   2. BOOKED — when the webhook has flipped the booking (pollBookingState):
//      the headline rolls to "Booked.", the code card rises, Share wakes,
//      and `success` fires with the code.
// If the venue hasn't confirmed inside the poll window the screen says so in
// place — the money went through, it isn't charged twice — and keeps checking
// at a slower cadence; it never claims "Booked." it can't stand behind, and
// it never navigates on its own. Split bookings never come here (checkout
// lands them on the fixture). Without `settling`, it opens booked.
//
// The code on the card is read from the booking itself, never from the URL:
// a screen people screenshot and forward must not print a link's text
// (security audit 2026-10-19; +native-intent.tsx keeps links out anyway).

import { Button, Card, ROW_LAYOUT, Reveal, TOKENS, Tally, haptic, useReduceMotion } from '@ludi/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, Text, View } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CelebrationRing, celebrate as play, useCelebrationRise as useRise } from '@/components/Celebration';
import { capture } from '@/lib/analytics';
import { pollBookingState } from '@/lib/booking';
import { askForPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';

/** Where the booking stands, as far as this screen can honestly say. */
type Stage = 'paid' | 'slow' | 'booked';

// After the first window (pollBookingState's 2 s × 10) the screen keeps
// checking every 5 s for two more minutes, so a late webhook still lands
// here as "Booked." instead of only in Bookings.
const SLOW_POLL = { intervalMs: 5_000, maxAttempts: 24 } as const;

export default function BookingConfirmedScreen() {
  const { id, settling, total } = useLocalSearchParams<{
    id: string;
    settling?: string;
    total?: string;
  }>();
  const router = useRouter();
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>(settling === '1' ? 'paid' : 'booked');
  const [code, setCode] = useState<string | null>(null);

  // The booking has its code from the moment it is created, so it is read
  // once on mount; the card only shows it once the stage is "booked".
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    supabase
      .from('bookings')
      .select('code')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && typeof data?.code === 'string') setCode(data.code);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const rise1 = useSharedValue(0);
  const rise2 = useSharedValue(0);
  // Read synchronously from the shared last-known value: this screen mounts
  // long after launch, so the one-shot celebration starts with the right
  // answer instead of guessing `false` while an async query resolves.
  const reduceMotion = useReduceMotion();
  const scale = reduceMotion ? 0.5 : 1;

  // Beat one — the payment. The ring and check play on mount (CelebrationRing,
  // shared with "You're in"); the headline rises under them.
  useEffect(() => {
    rise1.value = play(1, 260 * scale, 260 * scale);
    // Mount-only on purpose: `reduceMotion` is read at that moment; a
    // mid-animation toggle is not worth a replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rise1]);

  // Beat two — the booking. The code card rises and `success` fires with it,
  // not with the check: the check says "paid", the code says "booked".
  useEffect(() => {
    if (stage !== 'booked') return;
    haptic('success');
    // A fresh mount (a link, no settling) lets the check land first.
    rise2.value = play(1, 260 * scale, settling === '1' ? 0 : 320 * scale);
    // The first of the four moments the push permission is asked at
    // (plans/reach.md R2): the booking is confirmed, the reason is
    // obvious. After the celebration has landed, not over it.
    const ask = setTimeout(() => void askForPush('booking_confirmed'), 1400);
    return () => clearTimeout(ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Waiting for the webhook — the polling checkout used to do behind a
  // spinner, now done here behind the first beat.
  useEffect(() => {
    if (settling !== '1' || !id) return;
    const ctrl = new AbortController();
    (async () => {
      let outcome = await pollBookingState(id, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (outcome !== 'confirmed') {
        setStage('slow');
        outcome = await pollBookingState(id, { ...SLOW_POLL, signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
      }
      if (outcome === 'confirmed') {
        capture('booking_confirmed', { booking_id: id, total_cents: Number(total) || 0 });
        setStage('booked');
      }
    })();
    return () => ctrl.abort();
  }, [id, settling, total]);

  const rise1Style = useRise(rise1, reduceMotion);
  const rise2Style = useRise(rise2, reduceMotion);

  const booked = stage === 'booked';
  const onShare = () => {
    Share.share({ message: code ? `⚽ ${t('bookingConfirmed')} ${code} — Ludi` : 'Ludi' }).catch(
      () => {},
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, padding: 28, justifyContent: 'center', gap: 24 }}>
        <CelebrationRing />

        <Animated.View style={[{ gap: 10 }, rise1Style]}>
          {/* "Paid." rolls up into "Booked." the moment it is true. */}
          <Tally
            value={booked ? t('bookingConfirmed') : t('bookingPaid')}
            direction={1}
            style={{
              fontFamily: TOKENS.displaySemi,
              fontSize: 40,
              color: TOKENS.ink,
              letterSpacing: -1.2,
            }}
          />
          {stage === 'paid' && (
            <Reveal key="paid">
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink3 }}>
                {t('checkoutConfirming')}
              </Text>
            </Reveal>
          )}
          {stage === 'slow' && (
            <Reveal key="slow">
              <Card elevation="e1" radius="lg" padded={16} color={TOKENS.sunSoft}>
                <View style={{ gap: 4 }}>
                  <Text
                    style={{
                      fontFamily: TOKENS.ui,
                      fontSize: 14.5,
                      fontWeight: '600',
                      color: TOKENS.sunDeep,
                    }}
                  >
                    {t('bookingSettlingSlowTitle')}
                  </Text>
                  <Text
                    style={{ fontFamily: TOKENS.ui, fontSize: 13.5, color: TOKENS.ink2, lineHeight: 19 }}
                  >
                    {t('bookingSettlingSlowBody')}
                  </Text>
                </View>
              </Card>
            </Reveal>
          )}
        </Animated.View>

        {/* The code card's place is kept while the venue confirms, so the
            buttons below never jump when it arrives. */}
        {code && (
          <Animated.View layout={ROW_LAYOUT} style={rise2Style}>
            <Card elevation="e3" radius="xl" color={TOKENS.primarySoft} style={{ borderColor: 'transparent' }}>
              <View style={{ paddingVertical: 28, paddingHorizontal: 24, gap: 10 }}>
                <Text
                  style={{
                    fontFamily: TOKENS.monoMedium,
                    fontSize: 10.5,
                    color: TOKENS.primaryDeep,
                    textTransform: 'uppercase',
                    letterSpacing: 1.05,
                  }}
                >
                  {t('bookingCode')}
                </Text>
                <Text
                  style={{
                    fontFamily: TOKENS.monoBold,
                    fontSize: 28,
                    color: TOKENS.ink,
                    letterSpacing: 0.56,
                  }}
                >
                  {code}
                </Text>
              </View>
            </Card>
          </Animated.View>
        )}

        <Animated.View layout={ROW_LAYOUT} style={{ gap: 12 }}>
          {/* Sharing says "Booked" with the code, so it waits for beat two. */}
          <Button variant="secondary" onPress={onShare} disabled={!booked} full>
            {t('shareBooking')}
          </Button>
          {/* The booking is a fixture now, and the next useful act is filling
              it — so this lands on the roster rather than on the bookings tab.
              It works in every stage: the fixture shows the booking's real
              state as it settles. */}
          <Button onPress={() => router.replace(`/booking/${id}`)} full>
            {t('bookingConfirmedRosterCta')}
          </Button>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}
