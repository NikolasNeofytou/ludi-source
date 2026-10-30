// Phone entry + auth fan-out (M2 #6 + M4 #20), "Chalk & Aegean" pass.
// Primary flow: 8-digit Cyprus mobile → signInWithOtp({phone}) → /verify.
// The block sits on a chalk card at the foot of the screen, over the
// touchline at night, with the brand mark on the card's edge; phone is the
// primary method (what the Cypriot market expects), Apple/Google/email are
// secondary and equal. Continue stays disabled until 8 digits.

import { Button, ELEV, Icon, Input, ROW_LAYOUT, Reveal, TOKENS } from '@ludi/ui';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { enabledAuthMethods, signInWithGoogle } from '@/lib/auth-providers';
import { openHelpMail } from '@/lib/help';
import { digitsOnly, isValidCyMobile, toE164Cy } from '@/lib/phone';
import { supabase } from '@/lib/supabase';

const APPLE_AVAILABLE = Platform.OS === 'ios';

// Which methods this build's backend can actually answer for. See
// enabledAuthMethods() — unset env means all four, as in production.
const METHODS = enabledAuthMethods();

// The art: the site hero's cage from its touchline at night, floodlights on.
// A flat illustration in the site palette with no people — art, not a photo,
// so community-v4's "no photos, never faked" holds. Higgsfield GPT Image 2.5,
// job e657b0ba-6b0b-440d-9c52-0aafb3da649a, the hero still as its style
// reference (picked by the founder over a rooftop band, 2026-10-20). Drawn
// with empty sky on top and plain grass in its lower 45%, so the card can
// cover any amount of it and the screen can end anywhere.
const ART = require('../../assets/signin/touchline.jpg');
const ART_RATIO = 2132 / 1206; // the file's height / width
const ART_LIFT = 70; // pt of empty sky cut off the top, so the floodlights clear the card
const LAMPS_AT = 0.19; // the lamp heads' height in the art, as a share of its height
const GRASS = '#1D6141'; // sampled from the art's pitch: shows wherever the art ends
const TILE_OVERLAP = 26; // the 52-pt brand tile sits half over the card's top edge

export default function SigninScreen() {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [providerStatus, setProviderStatus] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // On a short phone (an SE) the card leaves only a strip of art; lift it
  // further there, so the strip holds the lamp heads just under the status
  // bar rather than sky over lamps cut by the card.
  const artHeight = width * ART_RATIO;
  const artLift = Math.max(ART_LIFT, artHeight * LAMPS_AT - insets.top - 16);
  // Light status bar over the night sky, only while this screen is in front:
  // the screens pushed over it (verify, magic link) are chalk and need the
  // root layout's dark one back.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      // Back from verify: Continue holds its spinner through the push (see
      // onSubmit), so it is released here, when this screen is in front again.
      setSubmitting(false);
      return () => setFocused(false);
    }, []),
  );

  const canSubmit = isValidCyMobile(digitsOnly(phone));

  const onSubmit = async () => {
    setError(null);
    const clean = digitsOnly(phone);
    if (!isValidCyMobile(clean)) {
      setError(t('errorInvalidPhone'));
      return;
    }
    const e164 = toE164Cy(clean);
    setSubmitting(true);
    const { error: authError } = await supabase.auth.signInWithOtp({ phone: e164 });
    if (authError) {
      setSubmitting(false);
      setError(t('errorNetwork'));
      return;
    }
    // The spinner holds through the push instead of flashing back to
    // "Continue" first (plans/motion-v3.md); focus releases it.
    router.push({ pathname: '/(auth)/verify', params: { phone: e164 } });
  };

  const onApple = async () => {
    setProviderStatus(null);
    try {
      const Apple = await import('expo-apple-authentication');
      const available = await Apple.isAvailableAsync();
      if (!available) {
        setProviderStatus(t('signinProviderUnavailable'));
        return;
      }
      // A fresh nonce per attempt: Apple signs its SHA-256 into the identity
      // token, and GoTrue hashes the raw value and checks it matches. A token
      // lifted from another sign-in therefore cannot be replayed here.
      const rawNonce = randomUUID();
      const hashedNonce = await digestStringAsync(CryptoDigestAlgorithm.SHA256, rawNonce);
      const credential = await Apple.signInAsync({
        requestedScopes: [
          Apple.AppleAuthenticationScope.FULL_NAME,
          Apple.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      const idToken = credential.identityToken;
      if (!idToken) {
        setProviderStatus(t('errorAuthFailed'));
        return;
      }
      const { error: signinError } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: idToken,
        nonce: rawNonce,
      });
      if (signinError) setProviderStatus(t('errorAuthFailed'));
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'ERR_REQUEST_CANCELED') return;
      setProviderStatus(t('signinProviderNotConfigured'));
    }
  };

  const onGoogle = async () => {
    setProviderStatus(null);
    const result = await signInWithGoogle();
    // Success lands via onAuthStateChange → AuthGate, same as every flow; a
    // cancelled browser sheet is the user changing their mind, not an error.
    if (result.ok || result.code === 'CANCELLED') return;
    setProviderStatus(
      result.code === 'NOT_CONFIGURED' ? t('signinProviderNotConfigured') : t('errorAuthFailed'),
    );
  };

  const onMagicLink = () => {
    setProviderStatus(null);
    router.push('/(auth)/magic-link');
  };

  return (
    <View style={{ flex: 1, backgroundColor: GRASS }}>
      {focused && <StatusBar style="light" />}
      <Image
        source={ART}
        style={{ position: 'absolute', left: 0, top: -artLift, width, height: artHeight }}
      />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
            // "handled" — a tap on any touchable keeps the keyboard, a tap on
            // dead space dismisses it. This was briefly "always" while the
            // focus bug was misdiagnosed as tap handling; "always" means NO tap
            // ever dismisses the pad, so on this screen — which the app lands on
            // at launch — the keyboard could never be put away. The real cause
            // was the Input style shape (see primitives.tsx).
            keyboardShouldPersistTaps="handled"
          >
            {/* The card. It runs under the home indicator, so the inset is
              padding inside it rather than a SafeAreaView edge below it. */}
            <View
              style={{
                backgroundColor: TOKENS.bg,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                borderCurve: 'continuous',
                paddingHorizontal: 24,
                paddingBottom: 24 + insets.bottom,
                gap: 24,
              }}
            >
              <View style={{ gap: 20 }}>
                {/* Brand mark — 52×52 primary tile, ball icon, half over the
                card's edge with a chalk ring to part it from the art. */}
                <View
                  style={[
                    {
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      borderCurve: 'continuous',
                      backgroundColor: TOKENS.primary,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    ELEV.e2,
                    { marginTop: -TILE_OVERLAP, borderWidth: 3, borderColor: TOKENS.bg },
                  ]}
                >
                  {Icon.ball('#FFFFFF', 28)}
                </View>
                <View style={{ gap: 8 }}>
                  <Text
                    style={{
                      fontFamily: TOKENS.displaySemi,
                      fontSize: 34,
                      color: TOKENS.ink,
                      letterSpacing: -0.68,
                    }}
                  >
                    {t('signinTitle')}
                  </Text>
                  <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2 }}>
                    {METHODS.phone ? t('signinSubtitle') : t('signinSubtitleEmail')}
                  </Text>
                </View>

                {METHODS.phone && (
                  <>
                    <Input
                      label={t('signinPhoneLabel')}
                      prefix="+357"
                      value={phone}
                      onChangeText={(v) => {
                        setPhone(digitsOnly(v).slice(0, 8));
                        if (error) setError(null);
                      }}
                      keyboardType="phone-pad"
                      // Deliberately NOT autoFocus. This is the screen the app
                      // opens on, and the launch sequence still covers it for up
                      // to LAUNCH_MAX_MS — autoFocus raised the pin pad behind the
                      // splash, before the user had asked for it. Screens the user
                      // navigates TO on purpose (verify, magic-link) do autofocus.
                      maxLength={8}
                      error={error ?? undefined}
                      testID="phone-input"
                    />

                    {/* Glides down for the field's error instead of jumping. */}
                    <Animated.View layout={ROW_LAYOUT}>
                      <Button
                        full
                        size="lg"
                        onPress={onSubmit}
                        disabled={!canSubmit}
                        loading={submitting}
                      >
                        {t('signinCta')}
                      </Button>
                    </Animated.View>
                  </>
                )}
              </View>

              {METHODS.phone && <Divider label={t('signinOr')} />}

              <View style={{ gap: 12 }}>
                {METHODS.apple && APPLE_AVAILABLE && (
                  <Button full size="lg" variant="secondary" onPress={onApple}>
                    {t('signinAppleCta')}
                  </Button>
                )}
                {METHODS.google && (
                  <Button full size="lg" variant="secondary" onPress={onGoogle}>
                    {t('signinGoogleCta')}
                  </Button>
                )}
                {METHODS.magicLink && (
                  // Promoted to the primary button when it is the only way in, so
                  // the screen still has one obvious action rather than a row of
                  // equal-weight secondaries.
                  <Button
                    full
                    size="lg"
                    variant={METHODS.phone ? 'secondary' : 'primary'}
                    onPress={onMagicLink}
                  >
                    {t('signinMagicLinkCta')}
                  </Button>
                )}
                {/* A Fail: it arrives as a Reveal, in the error colour — it
                    used to mount in one frame, in body grey. */}
                {providerStatus && (
                  <Reveal key={providerStatus}>
                    <Text
                      style={{
                        fontFamily: TOKENS.ui,
                        fontSize: 13,
                        color: TOKENS.alertDeep,
                        textAlign: 'center',
                      }}
                    >
                      {providerStatus}
                    </Text>
                  </Reveal>
                )}
                {/* The stranger stuck at sign-in has no Settings to find Help in
                    (plans/ops-readiness.md O8). */}
                <Text
                  onPress={() => openHelpMail(t('helpMailSubject'))}
                  accessibilityRole="link"
                  style={{
                    fontFamily: TOKENS.ui,
                    fontSize: 13,
                    color: TOKENS.ink3,
                    textAlign: 'center',
                    marginTop: 4,
                  }}
                >
                  {t('signinHelp')}
                </Text>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: TOKENS.line }} />
      <Text
        style={{
          fontFamily: TOKENS.mono,
          fontSize: 12,
          color: TOKENS.ink3,
          textTransform: 'lowercase',
        }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: TOKENS.line }} />
    </View>
  );
}
