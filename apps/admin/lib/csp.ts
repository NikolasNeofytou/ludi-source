// lib/csp.ts — the admin's Content-Security-Policy (audit C1, 2026-10-19).
//
// Built per request in middleware.ts, because the script rule is a nonce:
// Next.js reads `'nonce-…'` back out of the request's own CSP header and
// stamps it on every script it renders, and `'strict-dynamic'` lets those
// scripts load the chunks they import. Nothing else may run — an injected
// <script> or an `onerror=` attribute has no nonce, so an XSS that gets
// markup into a page still cannot execute in an owner's signed-in session.
//
// This only works on pages rendered per request. The root layout reads the
// locale cookie, so every admin page is dynamic today; a page that became
// static would ship scripts without the nonce, and the browser would block
// them — check `next build` prints ƒ, not ○, for any new page.
//
// PURE module (runs in the edge middleware): no Node imports.

// Every origin the browser talks to, and why. Anything not listed is
// blocked, so a new third party starts here.
//
// - Supabase: the REST, auth and edge-function calls (https), and realtime
//   if a page ever opens a channel (wss). Read from the build's env, so a
//   local stack (http://127.0.0.1:…) and prod both work.
// - Sentry: the browser SDK posts envelopes to the DSN's ingest host.
// - OpenStreetMap: the venue map picker's tiles (a/b/c subdomains, Leaflet's
//   `{s}` default) and Nominatim, its address search.
const OSM_TILES = [
  'https://a.tile.openstreetmap.org',
  'https://b.tile.openstreetmap.org',
  'https://c.tile.openstreetmap.org',
];
const NOMINATIM = 'https://nominatim.openstreetmap.org';

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    // `origin` drops the DSN's public key (userinfo) and path.
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function supabaseOrigins(url: string | undefined): string[] {
  const https = originOf(url);
  if (!https) return [];
  // https → wss, http → ws (the local stack).
  return [https, https.replace(/^http/, 'ws')];
}

export function sentryOrigin(dsn: string | undefined): string[] {
  const origin = originOf(dsn);
  return origin ? [origin] : [];
}

export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function contentSecurityPolicy({
  nonce,
  dev,
  https,
}: {
  nonce: string;
  /** `next dev` evaluates code for fast refresh and source maps. */
  dev: boolean;
  /** Only an HTTPS page upgrades its requests; a local http run would break. */
  https: boolean;
}): string {
  const connect = [
    "'self'",
    ...supabaseOrigins(process.env.NEXT_PUBLIC_SUPABASE_URL),
    ...sentryOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN),
    NOMINATIM,
  ];

  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // React and Leaflet write style attributes, and the root layout inlines
    // the palette in a <style>. Styles cannot run code, so inline is allowed.
    "style-src 'self' 'unsafe-inline'",
    // QR codes are inline SVG markup, not image requests.
    `img-src 'self' data: blob: ${OSM_TILES.join(' ')}`,
    // next/font self-hosts Literata and JetBrains Mono.
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ];
  if (https) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
