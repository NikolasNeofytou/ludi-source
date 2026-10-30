import { headers } from 'next/headers';

// What the request's user agent says about the visitor's phone and browser.
// Read on the server only and recorded as enums (lib/analytics.ts), never as
// the string itself.

export type Platform = 'ios' | 'android' | 'other';

/**
 * Instagram and Facebook open every link in their own browser
 * (plans/instagram.md IG-4), and both say so in the user agent:
 * "Instagram 3xx.x.x" in Instagram's, FBAN/FBAV (FB_IAB on Android) in
 * Facebook's and Messenger's.
 */
export type InAppBrowser = 'instagram' | 'facebook' | 'other';

export function detectPlatform(userAgent: string | null): Platform {
  if (!userAgent) return 'other';
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  return 'other';
}

export function detectInAppBrowser(userAgent: string | null): InAppBrowser {
  if (!userAgent) return 'other';
  if (/\bInstagram\b/.test(userAgent)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB/.test(userAgent)) return 'facebook';
  return 'other';
}

/** Both, for the request being rendered. Reading headers makes the page dynamic. */
export async function requestAgent(): Promise<{ platform: Platform; browser: InAppBrowser }> {
  const ua = (await headers()).get('user-agent');
  return { platform: detectPlatform(ua), browser: detectInAppBrowser(ua) };
}
