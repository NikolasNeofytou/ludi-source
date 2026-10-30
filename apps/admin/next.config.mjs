import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withSentryConfig } from '@sentry/nextjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No `X-Powered-By: Next.js` — it tells a scanner which CVEs to try.
  poweredByHeader: false,
  // Monorepo root — silence the multi-lockfile warning.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Nothing here is meant to be framed. Without these, any site could
  // load a signed-in owner's pages in an invisible iframe and steer their
  // clicks onto Cancel or Refund (clickjacking) — the session cookie rides
  // along. Both headers, because older browsers only honour the first.
  //
  // The page CSP itself (scripts, connections, images) is set per request
  // in middleware.ts, because it carries a nonce (lib/csp.ts). This
  // frame-ancestors-only policy is the floor for whatever the middleware
  // does not match (static files, images); where both arrive the browser
  // enforces both, and this one restricts nothing the full one allows.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // The venue map picker's "Use my location" (components/map-picker)
          // is the one feature that asks for a device sensor; nothing uses
          // the camera or the microphone.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self)',
          },
        ],
      },
    ];
  },
};

// Sentry (ADR-0010). Source-map upload runs only when SENTRY_AUTH_TOKEN is
// present (CI/build env); without it the wrap is a safe pass-through, so the
// admin app builds fine with Sentry dormant. org/project read from env.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT ?? 'ludi-admin',
  silent: !process.env.CI,
});
