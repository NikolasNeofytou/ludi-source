// Liquid Glass — iOS 26's material for controls and navigation.
//
// True when the binary was built with the iOS 26 SDK AND runs on iOS 26 or
// later: the condition under which the system draws its own sheets and bars
// in glass, and under which `GlassView` renders. Both checks, because some
// iOS 26 betas shipped without the API and crashed (expo/expo#40911).
// Android and older iOS keep the opaque surfaces. Read once at load — the
// answer cannot change while the app runs. See docs/plans/ios-current.md.

import { Platform } from 'react-native';
import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';

export const LIQUID_GLASS =
  Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
