/**
 * The public app link — a TestFlight invite today, the App Store listing
 * once 1.0.0 is released.
 *
 * Lives in a plain `.mjs` because it has two readers that cannot share a
 * TypeScript module: `next.config.mjs` (the `/get` redirect the printed QR
 * codes land on) and `lib/site.ts` (every download CTA on the site). One
 * constant, so the QR and the buttons can never point at different places.
 *
 * `null` means "no public build exists yet": CTAs fall back to the founder
 * contact line and `/get` falls back to the homepage. Do not guess this
 * value — a download button pointing at the wrong place is worse than none.
 */
export const APP_URL = 'https://testflight.apple.com/join/4AaaU5Zu';

/**
 * The canonical origin. `lib/site.ts` re-exports it for pages; the config
 * reads it here for the company-domain redirect above the `/get` rule.
 */
export const SITE_URL = 'https://ludi.football';
