// Magic-link email entry screen (M4 #20).
// User types email, we call supabase.auth.signInWithOtp({ email, emailRedirectTo }),
// then push to /magic-link-sent. The user opens the email on this phone, taps
// the link, the universal link https://ludi.football/auth/callback/<nonce>
// opens the app, and the /callback screen finishes it — only for the request
// sendMagicLink() just recorded (src/lib/pending-sign-in.ts).

import { Button, Input, Press, TOKENS } from '@ludi/ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { sendMagicLink } from '@/lib/auth-providers';

export default function MagicLinkScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The button holds its spinner through the push to "check your email";
  // coming back here releases it.
  useFocusEffect(
    useCallback(() => {
      setSubmitting(false);
    }, []),
  );

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const result = await sendMagicLink(email);
    if (!result.ok) {
      setSubmitting(false);
      switch (result.code) {
        case 'INVALID_EMAIL':
          setError(t('errorInvalidEmail'));
          break;
        case 'RATE_LIMITED':
          setError(t('errorRateLimited'));
          break;
        case 'NETWORK_ERROR':
          setError(t('errorNetwork'));
          break;
        default:
          setError(t('errorAuthFailed'));
      }
      return;
    }
    router.push({
      pathname: '/(auth)/magic-link-sent',
      params: { email: email.trim().toLowerCase() },
    });
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
          <View style={{ gap: 24, marginTop: 32 }}>
            <View style={{ gap: 8 }}>
              <Text
                style={{
                  fontFamily: TOKENS.display,
                  fontSize: 34,
                  fontWeight: '500',
                  color: TOKENS.ink,
                  letterSpacing: -1,
                }}
              >
                {t('magicLinkTitle')}
              </Text>
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2 }}>
                {t('magicLinkSubtitle')}
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
                    fontSize: 14,
                    color: TOKENS.sea,
                    fontWeight: '600',
                    marginTop: 4,
                  }}
                >
                  {t('verifyChangeNumber')}
                </Text>
              </Press>
            </View>

            <Input
              label={t('magicLinkEmailLabel')}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (error) setError(null);
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              error={error ?? undefined}
              testID="email-input"
            />
          </View>

          {/* `loading` makes it inert as well as showing it, so a second tap
              can no longer send a second link (plans/motion-v3.md, Do). */}
          <Button full size="lg" onPress={onSubmit} loading={submitting}>
            {t('magicLinkCta')}
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
