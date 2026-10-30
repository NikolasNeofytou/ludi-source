// The filter pill Discover and Community share — Mono 11 uppercase on r-sm,
// per the handoff. It is a `Pick` (plans/motion-v3.md, "The tabs"): it gives
// under the finger, plays `selection`, and cross-fades fill, border and label
// together on the UI thread, where each tab used to hand-roll a pill that
// snapped (Discover's dipped to 0.6; Community's had no pressed state at all).
//
// Community's pills carry a role: an idle dot keys the pill to what it
// filters (deep Aegean for time, Aegean for city, sun for keeper), and the
// active fill wears that role instead of universal ink, so the chip row
// doubles as a legend for the board below.

import { ELEV, Pick, PickLabel, RADII, TOKENS } from '@ludi/ui';
import { View } from 'react-native';

export function FilterPill({
  label,
  active,
  onPress,
  dot,
  activeFill = TOKENS.ink,
  activeColor = TOKENS.surface,
  lifted = false,
  hitSlop = { top: 8, bottom: 8 },
  accessibilityLabel,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  /** The idle role dot; hidden while active, when the fill carries the role. */
  dot?: string;
  activeFill?: string;
  activeColor?: string;
  /** Discover's active pills stand on e1. */
  lifted?: boolean;
  hitSlop?: { top?: number; bottom?: number; left?: number; right?: number };
  accessibilityLabel?: string;
}) {
  return (
    <Pick
      selected={active}
      onPress={onPress}
      fill={{ off: TOKENS.surface, on: activeFill }}
      border={{ off: TOKENS.lineBold, on: activeFill }}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 7,
          paddingHorizontal: 12,
          borderRadius: RADII.sm,
          borderCurve: 'continuous',
          borderWidth: 1,
        },
        lifted && active ? ELEV.e1 : null,
      ]}
    >
      {dot && !active && <View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: dot }} />}
      <PickLabel
        on={activeColor}
        off={TOKENS.ink2}
        style={{
          fontFamily: TOKENS.monoMedium,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.66,
        }}
      >
        {label}
      </PickLabel>
    </Pick>
  );
}
