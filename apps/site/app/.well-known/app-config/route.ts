// The app's minimum-version floor (plans/ops-readiness.md O7). Every Ludi
// build from 1.0.0 (41) reads this at launch and on every return to the
// foreground; one below `minVersion` shows a single Update screen and
// nothing else (apps/mobile/src/lib/app-gate.ts).
//
// To retire a build: raise `minVersion` to the first good version, merge,
// let Vercel deploy. Only raise it once that version is LIVE in the store
// — a floor above what the store sells locks everyone out with nowhere to
// go. Any failure to read this file lets the app through, so a site outage
// never becomes an app outage.
//
// Static on purpose: served from the CDN, no function call, no Data Cache
// write (the Hobby pause of 2026-10-16). The middleware matcher excludes
// `.well-known`, so it answers on the bare path in both locales.
export const dynamic = 'force-static';

const APP_CONFIG = {
  ios: {
    minVersion: '1.0.0',
    storeUrl: 'https://apps.apple.com/app/id6800232498',
  },
  android: {
    minVersion: '1.0.0',
    // No public Play listing yet; /get carries whatever Android build exists.
    storeUrl: 'https://ludi.football/get',
  },
} as const;

export function GET() {
  return Response.json(APP_CONFIG);
}
