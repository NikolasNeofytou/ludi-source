// First-launch GDPR consent screen (M4 #22).
// Rendered by ConsentGate in _layout.tsx when no local consent is
// recorded. Two separate things on one screen:
//   - the privacy notice (what the app needs to work — contract and
//     legitimate interest, not consent): read, then Continue;
//   - the one real choice, product analytics: a switch that starts OFF, so
//     continuing without touching it sends nothing. Refusing is exactly as
//     easy as accepting, and Settings changes it later (consent v2).
// Continue → recordConsent({ analytics }) persists to AsyncStorage, the
// gate flips and the rest of the app mounts.

import { Button, TOKENS } from '@ludi/ui';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { recordConsent } from '@/lib/consent';

const PRIVACY_URL = 'https://ludi.football/privacy';

export function ConsentScreen({ onAccepted }: { onAccepted: () => void }) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  const onAccept = async () => {
    setSubmitting(true);
    await recordConsent({ analytics });
    setSubmitting(false);
    onAccepted();
  };

  const onOpenPrivacy = () => {
    WebBrowser.openBrowserAsync(PRIVACY_URL).catch(() => {});
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: 24,
          gap: 24,
          justifyContent: 'space-between',
        }}
      >
        <View style={{ gap: 16, marginTop: 32 }}>
          <Text
            style={{
              fontFamily: TOKENS.display,
              fontSize: 34,
              fontWeight: '500',
              color: TOKENS.ink,
              letterSpacing: -1,
            }}
          >
            {t('consentTitle')}
          </Text>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2, lineHeight: 22 }}>
            {t('consentSubtitle')}
          </Text>

          <View style={{ gap: 8, marginTop: 8 }}>
            <Bullet>{t('consentBulletIdentity')}</Bullet>
            <Bullet>{t('consentBulletBookings')}</Bullet>
            <Bullet>{t('consentBulletPayments')}</Bullet>
            <Bullet>{t('consentBulletCrashes')}</Bullet>
          </View>

          <View
            style={{
              marginTop: 8,
              padding: 16,
              borderRadius: 16,
              borderCurve: 'continuous',
              backgroundColor: TOKENS.surface,
              gap: 6,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text
                style={{
                  flex: 1,
                  fontFamily: TOKENS.ui,
                  fontSize: 15,
                  fontWeight: '600',
                  color: TOKENS.ink,
                }}
              >
                {t('analyticsChoiceLabel')}
              </Text>
              <Switch
                value={analytics}
                onValueChange={setAnalytics}
                trackColor={{ true: TOKENS.primary }}
                accessibilityLabel={t('analyticsChoiceLabel')}
                testID="consent-analytics-switch"
              />
            </View>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink2, lineHeight: 19 }}>
              {t('consentAnalyticsHint')}
            </Text>
          </View>

          <Text
            style={{
              fontFamily: TOKENS.ui,
              fontSize: 13,
              color: TOKENS.ink2,
              marginTop: 8,
              lineHeight: 20,
            }}
          >
            {t('consentResidency')}
          </Text>

          <Text
            onPress={onOpenPrivacy}
            style={{
              fontFamily: TOKENS.ui,
              fontSize: 14,
              color: TOKENS.sea,
              fontWeight: '600',
              marginTop: 4,
            }}
            testID="consent-privacy-link"
          >
            {t('consentReadPolicy')}
          </Text>
        </View>

        <Button full size="lg" onPress={onAccept} disabled={submitting}>
          {submitting ? '…' : t('consentAcceptCta')}
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2 }}>•</Text>
      <Text
        style={{
          fontFamily: TOKENS.ui,
          fontSize: 15,
          color: TOKENS.ink2,
          flex: 1,
          lineHeight: 22,
        }}
      >
        {children}
      </Text>
    </View>
  );
}
