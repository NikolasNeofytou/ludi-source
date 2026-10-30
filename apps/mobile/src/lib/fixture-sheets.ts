// The hand-off between the fixture screen and its two sheet routes.
//
// The sheets became `formSheet` routes (motion-v2 slice 7 / gesture-motion
// G3) so the OS owns the drag — velocity, rubber-banding, interruptibility
// and the dismiss gestures, none of which the hand-rolled sheet had. A route
// cannot see the screen's props, and the app has no query cache to re-read
// the fixture from, so opening a seat would otherwise cost a refetch and show
// a spinner inside the sheet — worse than the sheet it replaced.
//
// So the screen publishes what the sheets need just before it navigates, and
// the routes subscribe. What crosses is display data and ALREADY-BOUND
// callbacks: the share strings are built from a dozen derived values on the
// screen (`whenLine`, `perHeadFull`, `ownRow`, …) and re-deriving them in a
// route would duplicate the screen's arithmetic and let the two drift.
//
// Deliberately a module store rather than a context: the alternative provider
// would have to sit in the ROOT layout (the sheet routes are declared there,
// so there is no shared layout lower down), and every fixture refresh would
// then re-render the whole app.

import { useSyncExternalStore } from 'react';
import type { RosterEntry, SlotKind } from '@/lib/fixture';

export type SeatTarget =
  | { kind: 'player'; player: RosterEntry }
  | { kind: 'empty'; slot: SlotKind };

export type SeatSheetData = {
  seat: SeatTarget;
  showPaid: boolean;
  canInvite: boolean;
  onInvite: () => void;
};

export type LeaveSheetData = {
  isKeeper: boolean;
  late: boolean;
  organiserName: string;
  onLeave: () => void;
  onAskAndStay: () => void;
  /** Find my replacement (ADR-0044): offered on a live, bought fixture;
   * 'paid' when the leaver's share comes back once the seat is taken. */
  replacement?: 'free' | 'paid' | null;
  /** The frozen share, formatted, for the notes that name it. */
  shareAmount?: string;
  /** What the plain leave does to the money: nothing, refunds the share
   * (collecting), or keeps it (a bought split fixture). */
  leaveMode?: 'plain' | 'refund' | 'no_refund';
  onFindReplacement?: () => void;
};

type Store = {
  seat: SeatSheetData | null;
  leave: LeaveSheetData | null;
};

let store: Store = { seat: null, leave: null };
const listeners = new Set<() => void>();

function emit() {
  store = { ...store };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return store;
}

export function openSeatSheet(data: SeatSheetData) {
  store.seat = data;
  emit();
}

export function openLeaveSheet(data: LeaveSheetData) {
  store.leave = data;
  emit();
}

/**
 * Cleared by the screen when it unmounts, not by the sheet on dismiss: the
 * native sheet fades its content out AFTER `router.back()` resolves, and a
 * store cleared on dismiss empties the card mid-dismissal — the same reason
 * the old `RosterSheet` held its last seat in a ref.
 */
export function clearFixtureSheets() {
  store = { seat: null, leave: null };
  listeners.forEach((l) => l());
}

export function useFixtureSheets(): Store {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Dismissing a `formSheet` and presenting something else in the same tick is
 * the classic iOS "attempt to present while presenting" conflict — the share
 * sheet silently never appears. Both sheet routes hand their action to this
 * instead of calling it straight after `router.back()`.
 *
 * 260 ms is a little over the system sheet's dismissal; it is not a duration
 * token because it is the OS's animation, not ours to choose.
 */
export function afterDismiss(action: () => void) {
  setTimeout(action, 260);
}
