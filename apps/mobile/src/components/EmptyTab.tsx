// Shared empty state for tabs whose feature is not built yet.
//
// These screens used to ship internal roadmap vocabulary to end users —
// "Mapbox integration arrives in Stage 4", "Upcoming + Results arrive in
// Stage 3" — in hardcoded English, so a Greek user saw an untranslated
// sprint plan. A user does not know what a stage is and should never be
// asked to care.
//
// So: say what the screen will do for them, in their language, and give them
// somewhere to go now. The design handoff's rule is "no roadmap vocabulary
// anywhere near a user"; this is that rule with a route out.

import { Button, TOKENS, RADII, SPACE } from '@ludi/ui';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Path, Svg } from 'react-native-svg';

export function EmptyTab({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: string;
}) {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: SPACE.s6,
        }}
      >
        {/* The mark's outer plane alone, faint — the same "waiting to be
            filled" shape the Nest uses for an empty gauge. */}
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: RADII.sm,
            borderCurve: 'continuous',
            overflow: 'hidden',
            marginBottom: SPACE.s5,
          }}
        >
          <Svg width={72} height={72} viewBox="0 0 180 180">
            <Path d="M90 20 L178 172 L2 172 Z" fill={TOKENS.primary} opacity={0.12} />
            <Path d="M90 96 L126 172 L54 172 Z" fill={TOKENS.primary} opacity={0.18} />
          </Svg>
        </View>

        <Text
          style={{
            fontFamily: TOKENS.displaySemi,
            fontSize: 24,
            color: TOKENS.ink,
            textAlign: 'center',
          }}
        >
          {title}
        </Text>

        <Text
          style={{
            fontFamily: TOKENS.ui,
            fontSize: 15,
            lineHeight: 22,
            color: TOKENS.ink2,
            textAlign: 'center',
            marginTop: SPACE.s3,
            maxWidth: 300,
          }}
        >
          {body}
        </Text>

        <View style={{ marginTop: SPACE.s6 }}>
          <Button onPress={() => router.replace('/(tabs)')}>{cta}</Button>
        </View>
      </View>
    </SafeAreaView>
  );
}
