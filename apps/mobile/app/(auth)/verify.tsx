// OTP entry — second step of phone-OTP auth, "Chalk & Aegean" pass.
// Six discrete boxes over a hidden TextInput (auto-advance, backspace steps
// back, SMS paste-fill). When the sixth digit lands we wait 750ms then verify
// — the pause is deliberate so the last digit is seen. Resend is a live 30s
// countdown, only tappable at 0:00.
//
// A wrong code is answered the way the phone's own passcode screen answers
// it (plans/motion-v3.md, D2): the boxes shake, the `error` haptic plays,
// the code clears and the field takes focus again for the retry — where it
// used to leave the bad code standing over a red line. A right one holds the
// button's spinner until the session swaps the screen, instead of flashing
// "Verify" back first.

import {
  Button,
  EASE,
  ELEV,
  MOTION,
  Press,
  RADII,
  Reveal,
  TOKENS,
  haptic,
  useReduceMotion,
} from '@ludi/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { digitsOnly, formatCyForDisplay, isValidOtpCode } from '@/lib/phone';
import { supabase } from '@/lib/supabase';

const RESEND_SECONDS = 30;

export default function VerifyScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ phone?: string }>();
  const e164 = params.phone ?? '';
  const display = formatCyForDisplay(e164.replace(/^\+357/, ''));

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const inputRef = useRef<TextInput>(null);
  const autoSubmitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useReduceMotion();

  // The passcode shake: a few decaying swings, ~400 ms. Spatial, so it drops
  // under Reduce Motion; the haptic, the cleared boxes and the line remain.
  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));
  const shake = () => {
    if (reduceMotion) return;
    const swing = (to: number, duration: number) =>
      withTiming(to, { duration, easing: EASE, reduceMotion: ReduceMotion.Never });
    shakeX.value = withSequence(
      swing(-10, 45),
      swing(9, 90),
      swing(-7, 80),
      swing(5, 70),
      swing(-2, 60),
      swing(0, 50),
    );
  };

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const onSubmit = async (value?: string) => {
    const token = value ?? code;
    setError(null);
    if (!isValidOtpCode(token)) {
      setError(t('errorInvalidCode'));
      return;
    }
    setSubmitting(true);
    const { error: authError } = await supabase.auth.verifyOtp({
      phone: e164,
      token,
      type: 'sms',
    });
    if (authError) {
      setSubmitting(false);
      // No answer from the server is not a wrong code: say so, keep the code.
      if (authError.status === 0 || authError.name === 'AuthRetryableFetchError') {
        setError(t('errorNetwork'));
        return;
      }
      // A wrong (or expired) code — one of ADR-0035's three `error` sites.
      haptic('error');
      shake();
      setCode('');
      setError(t('errorAuthFailed'));
      inputRef.current?.focus();
      return;
    }
    // Auth gate at the root redirects to (tabs) on next render; the spinner
    // stays until it does.
  };

  const onChange = (v: string) => {
    const clean = digitsOnly(v).slice(0, 6);
    setCode(clean);
    if (error) setError(null);
    if (autoSubmitRef.current) clearTimeout(autoSubmitRef.current);
    if (clean.length === 6) {
      // Deliberate 750ms pause so the last digit is seen before verifying.
      autoSubmitRef.current = setTimeout(() => onSubmit(clean), 750);
    }
  };

  useEffect(() => () => {
    if (autoSubmitRef.current) clearTimeout(autoSubmitRef.current);
  }, []);

  const onResend = async () => {
    if (countdown > 0) return;
    setError(null);
    setCountdown(RESEND_SECONDS);
    await supabase.auth.signInWithOtp({ phone: e164 });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'space-between' }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 24, marginTop: 8 }}>
            <BackButton onPress={() => router.back()} />

            <View style={{ gap: 8 }}>
              <Text
                style={{
                  fontFamily: TOKENS.displaySemi,
                  fontSize: 34,
                  color: TOKENS.ink,
                  letterSpacing: -0.68,
                }}
              >
                {t('verifyTitle')}
              </Text>
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2 }}>
                {t('verifySubtitle', { phone: display })}
              </Text>
              <Press
                feel="control"
                onPress={() => router.back()}
                hitSlop={6}
                style={{ alignSelf: 'flex-start' }}
              >
                <Text
                  style={{
                    fontFamily: TOKENS.ui,
                    fontSize: 15,
                    color: TOKENS.primary,
                    fontWeight: '600',
                    marginTop: 4,
                  }}
                >
                  {t('verifyChangeNumber')}
                </Text>
              </Press>
            </View>

            {/* Hidden input drives the six boxes. */}
            <Pressable onPress={() => inputRef.current?.focus()}>
              <Animated.View style={[{ flexDirection: 'row', gap: 8 }, shakeStyle]}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <OtpBox
                    key={i}
                    char={code[i] ?? ''}
                    active={i === code.length}
                    filled={i < code.length}
                  />
                ))}
              </Animated.View>
              <TextInput
                ref={inputRef}
                value={code}
                onChangeText={onChange}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                autoFocus
                maxLength={6}
                testID="otp-input"
                style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
              />
            </Pressable>

            {error && (
              <Reveal key={error}>
                <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.terraDeep }}>
                  {error}
                </Text>
              </Reveal>
            )}

            <Press
              feel="control"
              onPress={onResend}
              disabled={countdown > 0}
              style={{ alignSelf: 'center' }}
              hitSlop={8}
            >
              <Text
                style={{
                  fontFamily: TOKENS.ui,
                  fontSize: 14,
                  color: countdown > 0 ? TOKENS.ink3 : TOKENS.primary,
                  fontWeight: '600',
                }}
              >
                {countdown > 0
                  ? t('verifyResendIn', { s: `0:${String(countdown).padStart(2, '0')}` })
                  : t('verifyResend')}
              </Text>
            </Press>
          </View>

          <Button full size="lg" onPress={() => onSubmit()} loading={submitting} disabled={code.length < 6}>
            {t('verifyCta')}
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// One OTP box. Empty: bg + 1px line. Active: surface + 1.5px primary + e1.
// Filled: surface + e1 with a popIn (0.86 → 1.06 → 1) on entry, on the UI
// thread. Under reduce-motion the digit simply appears — scaling is one of
// Apple's named triggers, and the fill state is visible without it.
function OtpBox({ char, active, filled }: { char: string; active: boolean; filled: boolean }) {
  const pop = useSharedValue(1);
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (!filled || reduceMotion) return;
    pop.value = withSequence(
      withTiming(0, { duration: 0 }),
      withTiming(1, { duration: MOTION.quick, easing: EASE, reduceMotion: ReduceMotion.Never }),
    );
  }, [filled, pop, reduceMotion]);
  const popStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : interpolate(pop.value, [0, 0.6, 1], [0.86, 1.06, 1]) }],
  }));
  return (
    <Animated.View
      style={[
        {
          flex: 1,
          height: 64,
          borderRadius: RADII.md,
          borderCurve: 'continuous',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active || filled ? TOKENS.surface : TOKENS.bg,
          borderWidth: active ? 1.5 : filled ? 0 : 1,
          borderColor: active ? TOKENS.primary : TOKENS.line,
        },
        active || filled ? ELEV.e1 : null,
        popStyle,
      ]}
    >
      <Text style={{ fontFamily: TOKENS.mono, fontSize: 24, color: TOKENS.ink }}>{char}</Text>
    </Animated.View>
  );
}
