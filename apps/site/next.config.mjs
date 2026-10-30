import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from './lib/app-url.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// See the Content-Security-Policy note in headers() below.
const SITE_CSP = [
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No `X-Powered-By: Next.js` — it tells a scanner which CVEs to try.
  poweredByHeader: false,
  experimental: {
    // app/global-not-found.tsx: the 404 for a URL that matches no route,
    // rendered with no layout around it. This app's root layout is
    // `app/[locale]/layout.tsx`, so without it Next wrapped the 404 in a
    // default layout and sent two <html> tags. Experimental as of Next 15.5:
    // recheck it on every Next upgrade.
    globalNotFound: true,
  },
  // Monorepo root — silence the multi-lockfile warning.
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // `/get` used to be a bare redirect straight off the site (launch plan,
  // QR asset) — no Ludi branding, and nothing for an Android visitor since
  // the destination was always the iOS TestFlight/App Store link. It's now
  // a real page (`app/[locale]/get/page.tsx`) that renders through the
  // normal locale routing below, still resolving the iOS destination from
  // `APP_DOWNLOAD_URL` (env, no commit) falling back to `APP_URL` (the
  // committed constant every on-site download button also reads) — see
  // that page for why both still matter.
  async redirects() {
    return [
      // Every host other than the apex 308s to it, path and query
      // preserved: `www.ludi.football` (people type it), and
      // `ludiltd.com` + its `www` (the company's domain, not the
      // product's). All four were added to this project on 2026-09-05
      // so the names resolve, but only `ludi.football` serves pages —
      // never a second copy of the site for search engines or for a
      // printed URL to drift onto.
      ...['www.ludi.football', 'ludiltd.com', 'www.ludiltd.com'].map((host) => ({
        source: '/:path*',
        has: [{ type: 'host', value: host }],
        destination: `${SITE_URL}/:path*`,
        permanent: true,
      })),
    ];
  },

  // Security headers live here rather than in vercel.json so they apply to
  // `next start` and any future host too, not just Vercel.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // The site is HTTPS-only in production; two years, subdomains included.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Nothing here needs a camera, a microphone or a location.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          // A baseline CSP that names no script, style, image or connect
          // source, so it cannot block the map, the hero frames or Next's
          // own scripts (audit C21): no plugins, no <base> hijack, no form
          // posting off-site, no framing. A full nonce policy like the
          // admin's would need every page rendered per request; the site's
          // pages are static. Upgrading requests only in a production build:
          // Safari upgrades http://localhost too, which breaks `next dev`.
          { key: 'Content-Security-Policy', value: SITE_CSP },
        ],
      },
    ];
  },
};

export default nextConfig;
