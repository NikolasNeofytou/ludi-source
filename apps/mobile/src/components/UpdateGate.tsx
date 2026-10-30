// The minimum-version gate's one screen (plans/ops-readiness.md O7).
// Wraps the whole app above the consent gate: below the floor nothing else
// mounts — no session, no Stripe, no push — because the point is that a
// retired build stops doing anything. Checked at launch and every time the
// app comes back to the foreground, so lowering the floor lets people back
// in without a relaunch. Until the first answer the app renders as normal;
// the gate never holds the launch hostage to a network call.

import { Button, LudiMark, TOKENS } from '@ludi/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { readAppGate, type AppGate } from '@/lib/app-gate';

export function UpdateGate({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<AppGate>({ kind: 'open' });

  useEffect(() => {
    let alive = true;
    const check = () => {
      readAppGate().then((next) => {
        if (alive) setGate(next);
      });
    };
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  if (gate.kind === 'open') return <>{children}</>;
  return <UpdateScreen storeUrl={gate.storeUrl} />;
}

function UpdateScreen({ storeUrl }: { storeUrl: string }) {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, padding: 24, justifyContent: 'space-between' }}>
        <View style={{ gap: 16, marginTop: 56 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              borderCurve: 'continuous',
              overflow: 'hidden',
              marginBottom: 8,
            }}
          >
            <LudiMark size={72} density="full" />
          </View>
          <Text
            style={{
              fontFamily: TOKENS.display,
              fontSize: 34,
              fontWeight: '500',
              color: TOKENS.ink,
              letterSpacing: -1,
            }}
          >
            {t('updateTitle')}
          </Text>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2, lineHeight: 22 }}>
            {t('updateBody')}
          </Text>
        </View>

        <Button full size="lg" onPress={() => Linking.openURL(storeUrl).catch(() => {})}>
          {t('updateCta')}
        </Button>
      </View>
    </SafeAreaView>
  );
}
