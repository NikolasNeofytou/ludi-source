// The minimum-version gate (plans/ops-readiness.md O7). The site serves one
// static JSON (apps/site/app/.well-known/app-config/route.ts), edited by PR
// and live a minute after Vercel deploys it. Below its floor the app shows
// one screen that sends the player to the store, and nothing else.
//
// Every failure lets the app through: offline, a timeout, the site down or
// paused, a body that does not parse. The gate exists to retire a broken
// build — or the pk_test build on the day money goes live
// (runbooks/money-flip.md) — never to lock people out because ludi.football
// is having a bad day.
//
// Deliberately not expo-updates: one floor is enough at this scale, and it
// keeps "which JS is this user running?" out of every Sentry issue.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const CONFIG_URL = process.env.EXPO_PUBLIC_APP_CONFIG_URL ?? 'https://ludi.football/.well-known/app-config';
const TIMEOUT_MS = 5000;

// Where Update goes when the config names no store: the App Store app itself
// on iOS; on Android, which has no public listing yet, the site's /get.
const FALLBACK_STORE_URL =
  Platform.OS === 'ios' ? 'itms-apps://apps.apple.com/app/id6800232498' : 'https://ludi.football/get';

export type AppGate = { kind: 'open' } | { kind: 'update'; storeUrl: string };

// The marketing version baked in at build time from app.json — the same
// string the store shows, and the one the floor is written in.
export function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

// Dotted numeric compare: '1.0.10' is above '1.0.9'. A part that is not a
// number counts as 0, so a malformed floor never retires anything newer.
export function isBelow(version: string, floor: string): boolean {
  const a = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = floor.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

// Only a store or the site — the config is ours, but a typo should not be
// able to send someone to a scheme the phone does something odd with.
function storeUrlFrom(value: unknown): string {
  if (typeof value === 'string' && /^(https:|itms-apps:|market:)/.test(value)) return value;
  return FALLBACK_STORE_URL;
}

export async function readAppGate(): Promise<AppGate> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(CONFIG_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    });
    if (!res.ok) return { kind: 'open' };
    const body: unknown = await res.json();
    const entry = (body as Record<string, { minVersion?: unknown; storeUrl?: unknown } | undefined>)?.[
      Platform.OS
    ];
    const floor = typeof entry?.minVersion === 'string' ? entry.minVersion : null;
    if (!floor || !isBelow(appVersion(), floor)) return { kind: 'open' };
    return { kind: 'update', storeUrl: storeUrlFrom(entry?.storeUrl) };
  } catch {
    return { kind: 'open' };
  } finally {
    clearTimeout(timer);
  }
}
