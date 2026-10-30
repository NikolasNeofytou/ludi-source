// Haptics bridge. @ludi/ui deliberately carries no Expo dependency, so the
// primitives fire through this indirection: a no-op until the app injects a
// real handler (apps/mobile/app/_layout.tsx wires expo-haptics at startup).
// Web / tests / a host that never injects simply feel nothing.
//
// Vocabulary is fixed by the design handoff §7 and ADR-0035 — small on purpose:
//   press     → Button press (iOS impactLight / Android Virtual_Key)
//   selection → a choice changes: a chip, a day, a slot, a segment, a stepper,
//               a ruler tick (iOS selectionChanged / Android Segment_Tick)
//   success   → the app's two celebrations ONLY: a booking confirmed, and
//               "You're in" (ADR-0035 amendment, 2026-10-20) — iOS
//               notificationSuccess / Android Confirm. Nowhere else.
//   error     → exactly three places: a wrong one-time code, a join refused
//               (the game filled or ended), a payment declined — iOS
//               notificationError / Android Reject (same amendment). Every
//               other failure is silent in the hand and speaks on screen.
// A fifth word, or a new site for success/error, needs that ADR amended
// again — not a PR. Screens call `haptic()` too; nothing outside
// apps/mobile/app/_layout.tsx imports expo-haptics.
export type HapticKind = 'press' | 'selection' | 'success' | 'error';

type HapticHandler = (kind: HapticKind) => void;

let handler: HapticHandler | null = null;

export function setHapticsHandler(h: HapticHandler | null): void {
  handler = h;
}

/** Fire-and-forget; never throws. */
export function haptic(kind: HapticKind): void {
  try {
    handler?.(kind);
  } catch {
    // haptics must never take down a press handler
  }
}
