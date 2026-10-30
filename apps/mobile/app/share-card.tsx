// Share-card preview — "Ludi - Share Card.dc.html", Turn 13.
//
// Shows the 1080×1920 composition at true proportions, in both states the app
// can actually produce today:
//   · cold start — no match history, so the record band holds its place and
//     states the promise instead of rendering zeros (ADR-0012 reserved hero)
//   · with a record — the full six bands, as drawn
//
// This is a preview, not the share action. Turning the card into a PNG needs
// react-native-view-shot + expo-sharing, neither of which is installed, and
// both are native — so that step costs a prebuild and a rebuild and is a
// separate decision.

import { TOKENS } from '@ludi/ui';
import { Stack } from 'expo-router';
import { Dimensions, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ShareCard, type ShareCardData } from '@/components/ShareCard';

const BASE: ShareCardData = {
  firstName: 'Andreas',
  city: 'Larnaca',
  position: 'Centre midfield',
  alsoPosition: 'Attacking mid',
  heightCm: 178,
  foot: 'Right',
  ageBand: '26–35',
  skillLevel: 3,
  claimUrl: 'ludi.football/p/andreas-4k',
  record: null,
};

const WITH_RECORD: ShareCardData = {
  ...BASE,
  record: {
    matches: 42,
    sinceLabel: 'JUN',
    turnedUpPct: 100,
    onTimePct: 98,
    repliedPct: 92,
  },
};

export default function ShareCardPreview() {
  const w = Dimensions.get('window').width - 36;
  const scale = w / 1080;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 18, gap: 22, paddingBottom: 60 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: TOKENS.displaySemi, fontSize: 23, color: TOKENS.ink }}>
            Share card — Turn 13
          </Text>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink2 }}>
            1080×1920, six bands in a fixed reading order.
          </Text>
        </View>

        <View style={{ gap: 8 }}>
          <Text
            style={{
              fontFamily: TOKENS.monoMedium,
              fontSize: 10,
              letterSpacing: 1.6,
              color: TOKENS.ink3,
            }}
          >
            COLD START — RESERVED RECORD BAND
          </Text>
          <ShareCard data={BASE} scale={scale} />
        </View>

        <View style={{ gap: 8 }}>
          <Text
            style={{
              fontFamily: TOKENS.monoMedium,
              fontSize: 10,
              letterSpacing: 1.6,
              color: TOKENS.ink3,
            }}
          >
            WITH A RECORD — ALL SIX BANDS
          </Text>
          <ShareCard data={WITH_RECORD} scale={scale} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
