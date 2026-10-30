// The app's one back control. It replaces six hand-typed "←" glyphs and two
// local copies of a white circle (docs/plans/ios-current.md, tier 0).
//
// On iOS 26+ it is a Liquid Glass circle — the same 44pt control the system
// puts in its own navigation bars, so the hero screens read like the rest of
// the phone. Elsewhere it is the surface circle the hero screens already
// used. Callers position it; it never stretches.

import { GlassView } from 'expo-glass-effect';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { ELEV, Icon, Press, RADII, TOKENS } from '@ludi/ui';
import { LIQUID_GLASS } from '@/lib/glass';

const SIZE = 44;

const circle = {
  width: SIZE,
  height: SIZE,
  borderRadius: RADII.full,
  alignItems: 'center',
  justifyContent: 'center',
} as const;

export function BackButton({
  onPress,
  style,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const chevron = Icon.chevL(TOKENS.ink, 22);

  if (LIQUID_GLASS) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        style={[{ alignSelf: 'flex-start' }, style]}
      >
        <GlassView isInteractive style={circle}>
          {chevron}
        </GlassView>
      </Pressable>
    );
  }

  // Glass answers the finger itself (isInteractive); the surface circle
  // gives on the press spring like every other control (plans/motion-v3.md).
  return (
    <Press
      feel="control"
      onPress={onPress}
      accessibilityLabel="Back"
      hitSlop={8}
      style={[circle, { alignSelf: 'flex-start', backgroundColor: TOKENS.surface }, ELEV.e2, style]}
    >
      {chevron}
    </Press>
  );
}
