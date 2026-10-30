// Deep-link callback handler (M4 #20).
// A magic link opens the app on https://ludi.football/auth/callback/<nonce>
// (a universal link, mapped onto this route by +native-intent.tsx) or, from
// older builds' emails, ludi://callback. The token can sit where expo-router's
// search params never look, so this reads the raw URL captured by
// src/lib/auth-callback.ts and hands it to completeMagicLink(), which accepts
// it only for a magic link this phone asked for and never over an existing
// session (audit 2026-10-19, A4). On success SessionProvider picks up the
// session and AuthGate routes into (tabs).

import { Button, NestWait, TOKENS } from '@ludi/ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthCallbackUrl } from '@/lib/auth-callback';
import { completeMagicLink } from '@/lib/auth-providers';

type State = { kind: 'pending' } | { kind: 'error'; reason: 'invalid' | 'not_requested' };

export default function CallbackScreen() {
  const { t } = useTranslation();
  const url = useAuthCallbackUrl();
  const [state, setState] = useState<State>({ kind: 'pending' });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Nothing to finish here: the launch URL never arrived, or Google's
    // redirect is being finished by signInWithGoogle. A session that lands
    // meanwhile unmounts this screen; otherwise don't spin forever.
    const giveUp = () => {
      timer = setTimeout(() => setState({ kind: 'error', reason: 'invalid' }), 8_000);
    };
    if (!url) {
      giveUp();
    } else {
      completeMagicLink(url)
        .then((outcome) => {
          if (cancelled) return;
          if (outcome === 'not_requested' || outcome === 'invalid') {
            setState({ kind: 'error', reason: outcome });
          } else if (outcome === 'google_in_flight') {
            giveUp();
          }
          // signed_in / already_signed_in: AuthGate routes out of (auth).
        })
        .catch(() => {
          if (!cancelled) setState({ kind: 'error', reason: 'invalid' });
        });
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [url]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'space-between' }}
      >
        <View style={{ gap: 24, marginTop: 32, alignItems: 'center' }}>
          {state.kind === 'pending' ? (
            <>
              {/* The space is held; the Nest arrives only if this is slow. */}
              <NestWait />
              <Text
                style={{
                  fontFamily: TOKENS.display,
                  fontSize: 24,
                  fontWeight: '500',
                  color: TOKENS.ink,
                  textAlign: 'center',
                }}
              >
                {t('callbackTitle')}
              </Text>
            </>
          ) : (
            <Text
              style={{
                fontFamily: TOKENS.ui,
                fontSize: 16,
                color: TOKENS.ink2,
                textAlign: 'center',
                lineHeight: 24,
              }}
            >
              {state.reason === 'not_requested' ? t('callbackNotRequested') : t('callbackError')}
            </Text>
          )}
        </View>

        {state.kind === 'error' ? (
          <Button full size="lg" onPress={() => router.replace('/(auth)/signin')}>
            {t('callbackRetry')}
          </Button>
        ) : (
          <View />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
