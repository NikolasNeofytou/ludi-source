import { APP_URL as PUBLIC_APP_URL, SITE_URL as CANONICAL_SITE_URL } from './app-url.mjs';

// One source of truth for the canonical origin. Used by `metadataBase`
// (so per-page OG/canonical URLs resolve absolute), `robots.ts`, and
// `sitemap.ts` — these must agree or search engines see conflicting hosts.
export const SITE_URL: string = CANONICAL_SITE_URL;

// Owner onboarding is founder-mediated (features.md M8), so every CTA on the
// site is a direct line rather than a form. See docs/plans/site.md for why
// there is no waitlist capture in this phase.
export const CONTACT_EMAIL = 'nikiforialicht@gmail.com';

// The address the app's Help row and sign-in screen open, and the site
// footer shows (plans/ops-readiness.md O8). A Workspace alias, read daily.
export const HELP_EMAIL = 'hello@ludi.football';

// Every publicly listed route, locale-agnostic. `localePath()` maps these onto
// the unprefixed EN and `/el`-prefixed ΕΛ variants.
//
// `/pitches` is deliberately absent: the page is built, but it lists real,
// identifiable Larnaca businesses and has no verified venue data yet. Add it
// here (and to the header nav) in the same commit that adds the real list.
// Consolidated 2026-08-17 from eight routes to four. /players, /pitches,
// /about and /roadmap were each a thin page restating something said better
// elsewhere; their content now lives in the home rooms and on /owners, which
// is the one page with a real ask. Nothing was deployed, so no redirects are
// owed. See docs/plans/site.md.
export const ROUTES = ['/', '/players', '/keepers', '/owners', '/privacy', '/terms'] as const;

/** Routes that belong in the sitemap and the nav. */
export const LISTED_ROUTES = ROUTES;

/**
 * The public app link — a TestFlight invite or an App Store listing.
 *
 * The value itself lives in `app-url.mjs` so `next.config.mjs` can read the
 * same constant for the `/get` redirect (the URL printed on every poster).
 * Every player call-to-action reads from here and falls back to the founder
 * contact line while it is null, so the site never renders a button that
 * goes nowhere. Do not guess this value.
 */
export const APP_URL: string | null = PUBLIC_APP_URL;

export function mailto(subject: string): string {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/**
 * The founder's WhatsApp, in wa.me form — digits only, country code, no `+`.
 *
 * `null` until the real number is set, and `contactLink()` falls back to
 * `mailto:` while it is. Same posture as `APP_URL`: do not guess it. A
 * recruitment button that opens a chat with the wrong person is worse than
 * one that opens an email.
 *
 * WhatsApp is the destination that matters for /keepers specifically. The
 * goalkeeper trial runs concierge-first — dispatch happens in a WhatsApp
 * broadcast (docs/plans/goalkeeper-trial.md §Phasing), so a keeper who lands
 * in that thread is already in the loop, and one who lands anywhere else is
 * not.
 */
export const WHATSAPP_NUMBER: string | null = '35796666897';

/**
 * A contact link carrying a prepared message.
 *
 * Distinct from `mailto()`, which only carries a subject. Used by the keeper
 * signup, where the page composes a structured message from the fields and
 * hands it to whichever channel is configured — the site itself stores
 * nothing and has no backend. See docs/plans/site.md §Explicit decision.
 */
export function contactLink(subject: string, body: string): string {
  if (WHATSAPP_NUMBER) {
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(body)}`;
  }
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

// Request header the middleware stamps with the resolved locale. Lives here
// rather than in middleware.ts so pages can read it without importing the
// middleware module (which pulls `next/server` into the page bundle).
export const LOCALE_HEADER = 'x-ludi-locale';

/**
 * Ludi Member's seller (docs/plans/ludi-member.md, Phase 0).
 *
 * The seller is whoever holds the Stripe account that takes the money, as
 * Stripe has them on record: a company or a sole trader. A consumer sale
 * needs the trader's name and geographic address (Law 112(I)/2021), so the
 * buy button stays hidden until both are set, with the two Stripe links, as
 * Vercel environment variables (runbook step 4). The number (a company
 * registration or tax number) is shown when set. These are build-time
 * values: a change needs a redeploy. They are not in git, because a sole
 * trader's address is a home address. Do not guess them.
 */
export const SELLER = {
  name: (process.env.NEXT_PUBLIC_SELLER_NAME || null) as string | null,
  number: (process.env.NEXT_PUBLIC_SELLER_NUMBER || null) as string | null,
  address: (process.env.NEXT_PUBLIC_SELLER_ADDRESS || null) as string | null,
};

/** Stripe Payment Link for the founding membership. Public by nature. */
export const MEMBER_PAYMENT_LINK: string | null = process.env.NEXT_PUBLIC_MEMBER_PAYMENT_LINK || null;

/** Stripe customer portal login link: cancel, and the online withdrawal option. */
export const MEMBER_PORTAL_LINK: string | null = process.env.NEXT_PUBLIC_MEMBER_PORTAL_LINK || null;

/** The sale opens only when the seller is identified and the payment link exists. */
export const MEMBER_SALE_OPEN: boolean = Boolean(
  MEMBER_PAYMENT_LINK && MEMBER_PORTAL_LINK && SELLER.name && SELLER.address,
);

/**
 * Campeone's off-peak hours, from the memorandum's Annex A once signed.
 * `null` until then; the cup rules say they will be published.
 */
export const CAMPEONE_OFFPEAK: { en: string; el: string } | null = null;
