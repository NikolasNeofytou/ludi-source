// Delete-account confirmation screen (M5 #32).
// The user-facing half of GDPR erasure — calls the anonymize-me Edge Function
// (ADR-0018) then clears the local session. Reached from Profile → Delete
// account. Apple Guideline 5.1.1(v) requires in-app account deletion.
//
// On success we sign out with scope:'local' — the account is already gone
// server-side, so a global sign-out would fail; the root AuthGate redirects to
// sign-in as soon as the session clears.
//
// Sign in with Apple accounts confirm with Apple once more first: the fresh
// authorization code lets anonymize-me revoke Ludi's Apple token, so Ludi
// drops off the user's Apple ID (5.1.1(v)). Cancelling that sheet cancels
// the deletion; any other Apple failure still deletes (the server records
// the revoke as skipped).

import { Button, TOKENS } from '@ludi/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deleteAccount, DeleteAccountError } from '@/lib/account';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type State =
  | { kind: 'idle' }
  | { kind: 'deleting' }
  | { kind: 'error'; appleMismatch: boolean };

// A fresh Apple authorization code, or null when the user cancelled the
// sheet. undefined = unavailable (not iOS, or Apple failed) — delete anyway.
async function confirmWithApple(): Promise<string | null | undefined> {
  if (Platform.OS !== 'ios') return undefined;
  try {
    const Apple = await import('expo-apple-authentication');
    if (!(await Apple.isAvailableAsync())) return undefined;
    const credential = await Apple.signInAsync({ requestedScopes: [] });
    return credential.authorizationCode ?? undefined;
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'ERR_REQUEST_CANCELED') return null;
    return undefined;
  }
}

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useSession();
  const [state, setState] = useState<State>({ kind: 'idle' });

  const providers = session?.user.app_metadata?.providers;
  const isAppleAccount = Array.isArray(providers) && providers.includes('apple');

  const onConfirm = async () => {
    setState({ kind: 'deleting' });
    let appleAuthorizationCode: string | undefined;
    if (isAppleAccount) {
      const code = await confirmWithApple();
      if (code === null) {
        setState({ kind: 'idle' });
        return;
      }
      appleAuthorizationCode = code;
    }
    try {
      await deleteAccount({ appleAuthorizationCode });
      await supabase.auth.signOut({ scope: 'local' });
      // No manual navigation: clearing the session trips the root AuthGate.
    } catch (err) {
      setState({
        kind: 'error',
        appleMismatch: err instanceof DeleteAccountError && err.code === 'APPLE_ACCOUNT_MISMATCH',
      });
    }
  };

  const deleting = state.kind === 'deleting';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 20, flexGrow: 1 }}>
        <Text
          style={{
            fontFamily: TOKENS.display,
            fontSize: 30,
            fontWeight: '500',
            color: TOKENS.ink,
            letterSpacing: -1,
          }}
        >
          {t('deleteAccountTitle')}
        </Text>

        <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, lineHeight: 22, color: TOKENS.ink2 }}>
          {t('deleteAccountBody')}
        </Text>

        {isAppleAccount && Platform.OS === 'ios' && (
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, lineHeight: 22, color: TOKENS.ink2 }}>
            {t('deleteAccountAppleNote')}
          </Text>
        )}

        <View style={{ flex: 1 }} />

        <View style={{ gap: 12 }}>
          {state.kind === 'error' && (
            <Text
              style={{
                fontFamily: TOKENS.ui,
                fontSize: 13,
                color: TOKENS.terracotta,
                textAlign: 'center',
              }}
            >
              {state.appleMismatch ? t('deleteAccountAppleMismatch') : t('deleteAccountError')}
            </Text>
          )}
          <Button
            full
            size="lg"
            color={TOKENS.terracotta}
            onPress={onConfirm}
            disabled={deleting}
          >
            {deleting ? t('deleteAccountDeleting') : t('deleteAccountConfirmCta')}
          </Button>
          <Button variant="secondary" onPress={() => router.back()} disabled={deleting}>
            {t('deleteAccountCancel')}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
