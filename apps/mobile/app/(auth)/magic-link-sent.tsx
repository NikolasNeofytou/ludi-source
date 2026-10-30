// Magic-link "we sent it" screen (M4 #20). Pure read-only; the user goes to
// their email app and taps the link, which opens the app on /(auth)/callback
// (src/lib/auth-providers.ts, completeMagicLink). This screen just gives the
// user a clear next step.

import { Button, TOKENS } from '@ludi/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function MagicLinkSentScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = params.email ?? '';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'space-between' }}
      >
        <View style={{ gap: 24, marginTop: 32 }}>
          <Text
            style={{
              fontFamily: TOKENS.display,
              fontSize: 34,
              fontWeight: '500',
              color: TOKENS.ink,
              letterSpacing: -1,
            }}
          >
            {t('magicLinkSentTitle')}
          </Text>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2, lineHeight: 22 }}>
            {t('magicLinkSentBody', { email })}
          </Text>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink2, lineHeight: 20 }}>
            {t('magicLinkSentCheckSpam')}
          </Text>
        </View>

        <Button
          full
          size="lg"
          variant="secondary"
          onPress={() => router.replace('/(auth)/magic-link')}
        >
          {t('magicLinkUseDifferent')}
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
