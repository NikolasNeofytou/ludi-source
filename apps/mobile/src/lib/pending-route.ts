// A venue link that has to survive sign-in (plans/release-1-0.md E1).
//
// A parent scans the "follow your child's team" QR on the venue's TV,
// installs Ludi, opens the link and is sent to sign in. Without this, the
// first screen after sign-in is Discover and the venue they came for is
// gone. The invite already survives the same round trip (invite.ts); this is
// the same idea for the venue, kept separate so the invite's own resume
// logic stays exactly as it was.
//
// Only venue routes are kept, by a closed pattern: whatever the link said,
// sign-in can only ever land on a venue screen or the venue's link route.

import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_ROUTE_KEY = 'ludi.pendingRoute';

const RESUMABLE = /^\/(venue\/[0-9a-f-]{36}|v\/[a-z0-9-]{1,60})$/;

export function isResumableRoute(path: string): boolean {
  return RESUMABLE.test(path);
}

export async function setPendingRoute(path: string): Promise<void> {
  if (!isResumableRoute(path)) return;
  await AsyncStorage.setItem(PENDING_ROUTE_KEY, path);
}

export async function takePendingRoute(): Promise<string | null> {
  const path = await AsyncStorage.getItem(PENDING_ROUTE_KEY);
  if (path) await AsyncStorage.removeItem(PENDING_ROUTE_KEY);
  return path && isResumableRoute(path) ? path : null;
}
