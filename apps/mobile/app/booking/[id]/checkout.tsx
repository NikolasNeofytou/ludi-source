// Checkout orchestrator (M2 #9), "Chalk & Aegean" pass (2026-08-10).
// One screen owns the whole booking attempt lifecycle so cancellation,
// retry, and polling stay coherent.
//
//   mount → createBooking → presentPaymentSheet → confirmed (settling)
//
// The wait for the webhook used to happen here, behind a spinner, for up to
// 20 s after the player had already paid. It now happens on the confirmation
// screen behind its first beat — "Paid." is true the moment the sheet
// returns; "Booked." follows when the booking flips (motion-v3 slice 2).
// Split bookings still poll here: their success is the fixture, not a
// celebration.
//
// Only after a Book tap on the pitch screen (checkout-intent.ts): a checkout
// opened any other way shows the way back to the pitch and creates nothing.
//
// Retry semantics unchanged: a failure at the Payment Sheet re-presents the
// SAME client_secret; only earlier failures trigger a fresh createBooking
// with a new idempotency key.
//
// Design rules: each phase gets a real screen; after 10s the in-progress
// state escalates honestly ("your card has not been charged twice"); the
// failure state leads with the money position and NEVER renders a raw
// runtime message (it used to print `Property 'crypto' doesn't exist`).

import { Button, Card, ELEV, NestWait, RADII, TOKENS, haptic } from '@ludi/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  createBooking,
  CreateBookingError,
  newIdempotencyKey,
  pollBookingState,
  type AddonLine,
  type BookingError,
  type CreateBookingResult,
} from '@/lib/booking';
import { capture } from '@/lib/analytics';
import { cancelBooking } from '@/lib/cancellation';
import { takeCheckout } from '@/lib/checkout-intent';
import { setRecording } from '@/lib/recording';
import { runCheckout } from '@/lib/stripe-checkout';

type Phase =
  | { kind: 'creating' }
  | { kind: 'presenting'; booking: CreateBookingResult['booking'] }
  | { kind: 'polling'; booking: CreateBookingResult['booking'] }
  | { kind: 'error'; code: BookingError['code']; message: string }
  | { kind: 'cancelled' }
  | { kind: 'from_pitch' };

export default function CheckoutScreen() {
  const params = useLocalSearchParams<{
    id: string;
    starts_at: string;
    ends_at: string;
    bibs?: string;
    ball_rental?: string;
    split?: string;
    rebook_from?: string;
    record?: string;
  }>();
  const router = useRouter();
  const { t } = useTranslation();

  // Read once, at mount: was this checkout opened by the Book tap for this
  // very slot? Retry taps happen inside the screen and keep the answer.
  const [tapped] = useState(
    () => !!params.id && !!params.starts_at && takeCheckout(params.id, params.starts_at),
  );
  const [phase, setPhase] = useState<Phase>({ kind: 'creating' });
  const [attemptKey, setAttemptKey] = useState(0);
  // Escalation copy after 10s of a single in-progress phase.
  const [slow, setSlow] = useState(false);
  const idempotencyRef = useRef<string | null>(null);
  const pendingPaymentRef = useRef<CreateBookingResult | null>(null);

  useEffect(() => {
    if (phase.kind !== 'creating' && phase.kind !== 'polling') {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [phase.kind]);

  useEffect(() => {
    if (!params.id || !params.starts_at || !params.ends_at) {
      setPhase({
        kind: 'error',
        code: 'VALIDATION_FAILED',
        message: t('errorMissingParams'),
      });
      return;
    }
    if (!tapped) {
      setPhase({ kind: 'from_pitch' });
      return;
    }

    // Bibs + ball_rental are opt-in (venues must offer them; players choose).
    // Zero-quantity lines are dropped — the server only accepts positive ones.
    const addons: AddonLine[] = [
      { code: 'bibs' as const, quantity: clampAddonQty(params.bibs) },
      { code: 'ball_rental' as const, quantity: clampAddonQty(params.ball_rental) },
    ].filter((a) => a.quantity > 0);

    let cancelled = false;

    (async () => {
      try {
        let result = pendingPaymentRef.current;
        if (!result) {
          idempotencyRef.current = newIdempotencyKey();
          setPhase({ kind: 'creating' });
          result = await createBooking(
            {
              pitch_id: params.id!,
              starts_at: params.starts_at!,
              ends_at: params.ends_at!,
              addons,
              split: params.split === '1',
              // The rebook chain (community-v2.md) — server-verified, and a
              // bad value costs nothing but the link.
              rebooked_from: params.rebook_from || undefined,
            },
            idempotencyRef.current,
          );
          if (cancelled) return;
          pendingPaymentRef.current = result;
          // The organiser's recording switch (ADR-0042). Best effort: the
          // fixture screen shows the state and can set it until kickoff.
          if (params.record === '1') setRecording(result.booking.id, true).catch(() => {});
        }

        capture('booking_started', { pitch_id: params.id!, slot_starts_at: params.starts_at! });
        setPhase({ kind: 'presenting', booking: result.booking });
        const checkout = await runCheckout({
          clientSecret: result.payment.client_secret,
        });
        if (cancelled) return;

        if (checkout.outcome === 'cancelled') {
          // Release the slot now. Otherwise the pending booking holds it
          // until the 15-minute sweep, and the player's own second tap on
          // Book (say, after changing extras) fails with SLOT_UNAVAILABLE.
          // The server refuses if the payment is actually completing.
          pendingPaymentRef.current = null;
          cancelBooking(result.booking.id, newIdempotencyKey()).catch(() => {});
          setPhase({ kind: 'cancelled' });
          router.back();
          return;
        }
        if (checkout.outcome === 'failed') {
          // One of the three places the error haptic is earned (ADR-0035,
          // amended 2026-10-20): the card was declined.
          haptic('error');
          capture('booking_failed', { error_code: 'STRIPE_ERROR' });
          setPhase({
            kind: 'error',
            code: 'STRIPE_ERROR',
            message: checkout.message,
          });
          return;
        }

        pendingPaymentRef.current = null;

        if (!result.booking.is_split) {
          // Paid. Land on the confirmation now — it shows the payment at once
          // and waits for the booking itself (`settling`), so the most
          // expensive seconds in the app are no longer a spinner.
          router.replace({
            pathname: '/booking/[id]/confirmed',
            params: {
              id: result.booking.id,
              settling: '1',
              total: String(result.booking.total_cents),
            },
          });
          return;
        }

        // Split: unchanged. Its success state is 'collecting' — the anchor
        // share settled and the invite now collects the rest (C2 W6) — and it
        // lands on the fixture, where the invite is the hero; no ring-pop for
        // a fixture that is not yet bought whole.
        setPhase({ kind: 'polling', booking: result.booking });
        const outcome = await pollBookingState(result.booking.id, {
          until: ['collecting', 'confirmed'],
        });
        if (cancelled) return;
        if (outcome === 'confirmed') {
          capture('booking_confirmed', { booking_id: result.booking.id, total_cents: result.booking.total_cents });
        }
        // Confirmed or not, the fixture shows the booking's real state as it
        // settles; it never claims more than it knows.
        router.replace({ pathname: '/booking/[id]', params: { id: result.booking.id } });
      } catch (err) {
        if (cancelled) return;
        pendingPaymentRef.current = null;
        capture('booking_failed', { error_code: err instanceof CreateBookingError ? err.code : 'UNKNOWN' });
        if (err instanceof CreateBookingError) {
          setPhase({ kind: 'error', code: err.code, message: err.message });
        } else {
          setPhase({
            kind: 'error',
            code: 'UNKNOWN',
            message: err instanceof Error ? err.message : 'Booking failed',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // attemptKey in deps so Retry re-runs the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptKey]);

  const onRetry = () => setAttemptKey((k) => k + 1);
  const onCancel = () => router.back();

  const inProgress =
    phase.kind === 'creating' || phase.kind === 'presenting' || phase.kind === 'polling';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
        {inProgress && (
          <InProgress
            title={phase.kind === 'polling' ? t('checkoutConfirming') : t('checkoutHolding')}
            slow={slow}
            slowTitle={t('checkoutStillConfirmingTitle')}
            slowBody={t('checkoutStillConfirmingBody')}
          />
        )}
        {phase.kind === 'from_pitch' && (
          <View style={{ gap: 16, alignItems: 'center', alignSelf: 'stretch' }}>
            <Text
              style={{
                fontFamily: TOKENS.displaySemi,
                fontSize: 30,
                color: TOKENS.ink,
                textAlign: 'center',
                letterSpacing: -0.6,
              }}
            >
              {t('checkoutFromPitchTitle')}
            </Text>
            <Text
              style={{
                fontFamily: TOKENS.ui,
                fontSize: 15,
                color: TOKENS.ink2,
                textAlign: 'center',
                lineHeight: 22,
              }}
            >
              {t('checkoutFromPitchBody')}
            </Text>
            <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
              <Button
                full
                onPress={() => router.replace({ pathname: '/pitch/[id]', params: { id: params.id! } })}
              >
                {t('checkoutOpenPitch')}
              </Button>
            </View>
          </View>
        )}
        {phase.kind === 'error' && (
          <Failure
            title={failTitleFor(phase.code, t)}
            noCharge={t('checkoutFailNoCharge')}
            refLine={`${phase.code}`}
            onRetry={isRetryable(phase.code) ? onRetry : undefined}
            retryLabel={
              phase.code === 'STRIPE_ERROR' ? t('checkoutTryAnotherCard') : t('bookingRetry')
            }
            onCancel={onCancel}
            cancelLabel={t('checkoutBackToPitch')}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function InProgress({
  title,
  slow,
  slowTitle,
  slowBody,
}: {
  title: string;
  slow: boolean;
  slowTitle: string;
  slowBody: string;
}) {
  return (
    <View style={{ gap: 20, alignItems: 'stretch' }}>
      <View style={{ alignItems: 'center', gap: 16 }}>
        {/* The Nest is the app's one loading gesture, and checkout polling
            is one of its named sites (nest.tsx); held space, so nothing moves. */}
        <NestWait />
        <Text
          style={{
            fontFamily: TOKENS.displaySemi,
            fontSize: 30,
            color: TOKENS.ink,
            textAlign: 'center',
            letterSpacing: -0.6,
          }}
        >
          {title}
        </Text>
      </View>
      {slow && (
        <Card elevation="e1" radius="lg" padded={16} color={TOKENS.sunSoft}>
          <View style={{ gap: 4 }}>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 14.5, fontWeight: '600', color: TOKENS.sunDeep }}>
              {slowTitle}
            </Text>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 13.5, color: TOKENS.ink2, lineHeight: 19 }}>
              {slowBody}
            </Text>
          </View>
        </Card>
      )}
    </View>
  );
}

function Failure({
  title,
  noCharge,
  refLine,
  onRetry,
  retryLabel,
  onCancel,
  cancelLabel,
}: {
  title: string;
  noCharge: string;
  refLine: string;
  onRetry?: () => void;
  retryLabel: string;
  onCancel: () => void;
  cancelLabel: string;
}) {
  return (
    <View style={{ gap: 16, alignItems: 'center', alignSelf: 'stretch' }}>
      <View
        style={[
          {
            width: 88,
            height: 88,
            borderRadius: RADII.full,
            backgroundColor: TOKENS.terraSoft,
            alignItems: 'center',
            justifyContent: 'center',
          },
          ELEV.e1,
        ]}
      >
        <Text style={{ fontFamily: TOKENS.display, fontSize: 40, color: TOKENS.terraDeep, lineHeight: 46 }}>
          ×
        </Text>
      </View>
      <Text
        style={{
          fontFamily: TOKENS.displaySemi,
          fontSize: 30,
          color: TOKENS.ink,
          textAlign: 'center',
          letterSpacing: -0.6,
        }}
      >
        {title}
      </Text>
      {/* Money position first. */}
      <Text
        style={{
          fontFamily: TOKENS.ui,
          fontSize: 15,
          color: TOKENS.ink2,
          textAlign: 'center',
          lineHeight: 22,
        }}
      >
        {noCharge}
      </Text>
      {/* Support reference — the error code, never the raw message. */}
      <View
        style={{
          paddingVertical: 4,
          paddingHorizontal: 10,
          borderRadius: RADII.sm,
          borderCurve: 'continuous',
          backgroundColor: 'rgba(16,24,28,0.06)',
        }}
      >
        <Text
          style={{
            fontFamily: TOKENS.mono,
            fontSize: 10.5,
            color: TOKENS.ink3,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}
        >
          {refLine}
        </Text>
      </View>
      <View style={{ gap: 12, alignSelf: 'stretch', marginTop: 8 }}>
        {onRetry && (
          <Button variant="destructive" onPress={onRetry} full>
            {retryLabel}
          </Button>
        )}
        <Button variant="secondary" onPress={onCancel} full>
          {cancelLabel}
        </Button>
      </View>
    </View>
  );
}

function failTitleFor(code: BookingError['code'], t: (key: string) => string): string {
  switch (code) {
    case 'SLOT_UNAVAILABLE':
      return t('checkoutFailTitleSlot');
    case 'SPLIT_TOO_LATE':
      return t('checkoutFailTitleSplitLate');
    case 'PITCH_NOT_BOOKABLE':
      return t('checkoutFailTitlePitch');
    case 'STRIPE_ERROR':
      return t('checkoutFailTitleStripe');
    case 'NETWORK_ERROR':
      return t('checkoutFailTitleNetwork');
    case 'RATE_LIMITED':
      return t('checkoutFailTitleRateLimited');
    case 'VALIDATION_FAILED':
    case 'IDEMPOTENCY_MISMATCH':
    case 'UNAUTHORIZED':
    case 'UNKNOWN':
    default:
      return t('checkoutFailTitleGeneric');
  }
}

function clampAddonQty(raw: string | undefined): number {
  const n = Number(raw ?? '0');
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 50);
}

function isRetryable(code: BookingError['code']): boolean {
  return code === 'STRIPE_ERROR' || code === 'NETWORK_ERROR' || code === 'UNKNOWN';
}
