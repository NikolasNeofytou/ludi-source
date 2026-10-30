// Captures the raw sign-in link URL for the magic-link screen.
//
// The screen can't listen for it itself: when the app is already running,
// the OS delivers the link as a `url` event, expo-router navigates to
// /callback, and by the time the screen mounts that event has fired — while
// Linking.useURL() falls back to the launch URL. So a listener installed at
// module load (imported from app/_layout.tsx) records the latest callback URL,
// and the screen reads it — fragment included, which expo-router's search
// params never carry.
//
// Two shapes reach it: the universal link https://ludi.football/auth/callback/
// <nonce>?… that magic links use, and ludi://callback… (Google's redirect on
// Android, and links minted for builds before the universal link). Recording
// a URL decides nothing; completeMagicLink() is where a link is accepted or
// refused.

import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';

const CALLBACK_URL = /^(?:https:\/\/(?:www\.)?ludi\.football\/auth\/callback|[a-z0-9.+-]+:\/\/callback)\b/i;

let latest: string | null = null;
const subscribers = new Set<(url: string) => void>();

function record(url: string | null) {
  if (!url || !CALLBACK_URL.test(url)) return;
  latest = url;
  subscribers.forEach((fn) => fn(url));
}

let started = false;
export function startAuthCallbackCapture(): void {
  if (started) return;
  started = true;
  Linking.getInitialURL().then(record).catch(() => {});
  Linking.addEventListener('url', ({ url }) => record(url));
}

/** The latest callback URL, consumed once so stale tokens are never replayed. */
export function useAuthCallbackUrl(): string | null {
  const [url, setUrl] = useState<string | null>(latest);
  useEffect(() => {
    subscribers.add(setUrl);
    if (latest) setUrl(latest);
    return () => {
      subscribers.delete(setUrl);
      latest = null;
    };
  }, []);
  return url;
}
