import { randomUUID } from 'node:crypto';

import type { AppLinkSource } from '@/lib/app-link';
import type { ScanSource, ScanVenue } from '@/lib/scan-source';
import type { InAppBrowser } from '@/lib/user-agent';

// PostHog for the invite funnel (C1 W4) — the site's first analytics slice,
// deliberately shaped like apps/mobile/src/lib/analytics.ts (ADR-0011):
// key-guarded no-op, EU host, snake_case events, no-PII properties, explicit
// capture only.
//
// Where the mobile app is consent-gated, this module is **anonymous by
// construction** instead, which is why no banner appears on the landing
// page: capture happens server-side, so no cookie is set and no client JS
// runs; the visitor's IP never reaches PostHog (the server is the sender,
// and `$process_person_profile: false` keeps it event-only); and the
// distinct_id is a random one-time UUID, linking nothing to nothing. What
// remains is an aggregate page count — the joiners-per-fixture number the
// community arc is accountable to — not behavioural tracking of a person.
// Adding any identifier, cookie, or client-side capture here would change
// that calculus and reopen the ADR-0011 consent question: don't.

const KEY = process.env.POSTHOG_API_KEY;
const HOST = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com';

/** The site's event taxonomy. Properties are enums only:
 * never the token, never a name, never an IP. */
interface SiteAnalyticsEvents {
  invite_landing_viewed: {
    state: 'open' | 'full' | 'started' | 'off' | 'invalid' | 'error';
    locale: 'en' | 'el';
    // The tag the link carried (a Story card, a keyword DM, the venue page).
    source: ScanSource;
    // Instagram's or Facebook's own browser (plans/instagram.md IG-4).
    browser: InAppBrowser;
  };
  // Platform is UA-sniffed, not self-reported — the only signal that tells
  // the founder how much real Android demand the printed QR is generating,
  // ahead of investing in a Play Store listing.
  get_landing_viewed: {
    platform: 'ios' | 'android' | 'other';
    locale: 'en' | 'el';
    // Which printed piece was scanned, or which channel (lib/scan-source.ts).
    source: ScanSource;
    browser: InAppBrowser;
  };
  // The venue's own page (plans/reach.md R1). The slug is a closed list for
  // the same reason as the scan source; anything else counts as 'other'.
  venue_page_viewed: {
    locale: 'en' | 'el';
    venue: ScanVenue;
    bookable: boolean;
    source: ScanSource;
    browser: InAppBrowser;
    // How many open games the page showed (ADR-0056); 'off' behind the flag.
    open: 'off' | '0' | '1' | '2+';
  };
  // /keepers, where the KEEPER keyword DM lands (plans/instagram.md IG-8).
  keepers_page_viewed: {
    locale: 'en' | 'el';
    source: ScanSource;
    browser: InAppBrowser;
  };
  // A "Get the app" button was pressed (app/[locale]/download/route.ts):
  // which button, from the closed list in lib/app-link.ts.
  app_link_clicked: {
    from: AppLinkSource;
    locale: 'en' | 'el';
    // The tag the page was reached with, when the button carried one.
    source: ScanSource;
  };
  // The island map was served (plans/maps.md M5); pins bucketed as an enum.
  map_shown: {
    surface: 'players' | 'venue';
    locale: 'en' | 'el';
    pins: '1' | '2-5' | '6+';
  };
}

/**
 * Fire one event at PostHog, or silently do nothing without a key (the site
 * ships dormant, same as the mobile client). Never throws and never blocks
 * rendering — call it from `after()` so it runs once the response is sent.
 */
export async function capture<E extends keyof SiteAnalyticsEvents>(
  event: E,
  properties: SiteAnalyticsEvents[E],
): Promise<void> {
  if (!KEY) return;
  try {
    await fetch(`${HOST}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        event,
        distinct_id: randomUUID(),
        properties: { ...properties, $process_person_profile: false, $lib: 'ludi-site' },
      }),
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
  } catch {
    // Analytics must never take the page down with it.
  }
}
