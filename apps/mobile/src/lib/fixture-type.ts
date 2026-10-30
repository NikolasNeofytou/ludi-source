// The fixture screen's typography scale. Extracted from the screen when its
// two sheets became their own routes and needed the same `h1` and `body` —
// a second StyleSheet with the same names is how a heading quietly ends up
// two points apart from the one it was copied off.

import { TOKENS } from '@ludi/ui';
import { StyleSheet } from 'react-native';

export const fixtureType = StyleSheet.create({
  eyebrow: {
    fontFamily: TOKENS.monoMedium,
    fontSize: 10.5,
    color: TOKENS.primaryDeep,
    letterSpacing: 1.05,
  },
  h1: { fontFamily: TOKENS.displaySemi, fontSize: 30, color: TOKENS.ink, letterSpacing: -1 },
  body: { fontFamily: TOKENS.ui, fontSize: 14, color: TOKENS.ink2 },
  section: {
    fontFamily: TOKENS.ui,
    fontSize: 12,
    fontWeight: '600',
    color: TOKENS.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  label: { fontFamily: TOKENS.monoMedium, fontSize: 10.5, letterSpacing: 1.05 },
  count: { fontFamily: TOKENS.monoBold, fontSize: 15, color: TOKENS.ink },
  money: { fontFamily: TOKENS.displaySemi, fontSize: 22, color: TOKENS.ink },
  bigMoney: { fontFamily: TOKENS.displaySemi, fontSize: 34, color: TOKENS.ink, letterSpacing: -1 },
});
