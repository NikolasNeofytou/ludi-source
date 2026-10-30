// push.ts — the push substrate on the client (plans/reach.md R2).
//
// Three rules, all from the plan:
//   1. The permission is asked at a moment that makes the reason obvious —
//      a booking confirmed, a fixture joined, "in goal" switched on, a
//      replacement asked for — and never at launch. iOS shows the system
//      dialog once; after that the answer is read, not asked again.
//   2. A granted permission's token is registered on every launch so the
//      server's last_seen_at is honest, and dropped on sign-out so the
//      device is nobody's until someone signs in on it again.
//   3. A notice carries `data.url` — `/booking/<id>`, `/community`, or
//      `/bookings` for a followed CFA team's match (plans/cfa-in-the-app.md)
//      — and a tap routes there, nowhere else. Anything else in the payload
//      is ignored.
//
// Nothing here sends: that is the ledger and the sender (R3). On a
// simulator there is no APNs token; the permission dialog still works, so
// the moments can be verified there, and `xcrun simctl push` exercises the
// tap routing.

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { capture } from './analytics';
import { supabase } from './supabase';

export type PushMoment = 'booking_confirmed' | 'fixture_joined' | 'in_goal' | 'replacement_asked' | 'team_followed';

/** Where a tapped notice may land. The payload is data; the route is ours. */
const BOOKING_URL = /^\/booking\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Foreground notices show as a banner and in the list; nothing touches the
// badge (Ludi has no unread count to keep honest).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registeredToken: string | null = null;

export async function getPushPermission(): Promise<Notifications.PermissionStatus> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status;
  } catch {
    return Notifications.PermissionStatus.UNDETERMINED;
  }
}

/**
 * Ask at one of the four moments. Already granted → just make sure the
 * token is registered; already denied → nothing (the setting lives in the
 * OS now); undetermined → the system dialog, once.
 */
export async function askForPush(moment: PushMoment): Promise<void> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status === Notifications.PermissionStatus.GRANTED) {
      await registerPushToken();
      return;
    }
    if (current.status === Notifications.PermissionStatus.DENIED || !current.canAskAgain) return;
    capture('push_prompted', { moment });
    const asked = await Notifications.requestPermissionsAsync();
    const granted = asked.status === Notifications.PermissionStatus.GRANTED;
    capture('push_permission', { moment, granted });
    if (granted) await registerPushToken();
  } catch {
    // A permission API that throws (an odd simulator, a managed device) is
    // not worth interrupting the moment the player is in.
  }
}

/** Registers the device's token when permission is granted. Safe to call on every launch. */
export async function syncPushToken(): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === Notifications.PermissionStatus.GRANTED) await registerPushToken();
  } catch {
    // Same as above: never a crash, never a dialog.
  }
}

async function registerPushToken(): Promise<void> {
  // A simulator has no APNs/FCM; the token call rejects. Nothing to register.
  if (!Device.isDevice) return;
  const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: platform });
  if (!error) registeredToken = token;
}

/** Sign-out: drop this device's token while the session can still vouch for it. */
export async function unregisterPushToken(): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  registeredToken = null;
  await supabase.rpc('unregister_push_token', { p_token: token }).then(
    () => {},
    () => {},
  );
}

/** The route a tapped notice opens, or null when the payload says nothing we route to. */
export function routeForNotice(data: unknown): string | null {
  const url = (data as { url?: unknown } | null)?.url;
  if (typeof url !== 'string') return null;
  if (BOOKING_URL.test(url)) return url;
  if (url === '/community' || url === '/(tabs)/community') return '/(tabs)/community';
  if (url === '/bookings' || url === '/(tabs)/bookings') return '/(tabs)/bookings';
  return null;
}
