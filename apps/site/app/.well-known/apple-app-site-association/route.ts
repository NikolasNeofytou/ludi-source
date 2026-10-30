// Apple App Site Association — what lets an https invite link open the app
// directly instead of landing on the web preview (C1 W2, ADR-0025).
//
// iOS fetches https://ludi.football/.well-known/apple-app-site-association
// once per install/update of any app claiming `applinks:ludi.football`
// (the associated-domains entitlement, added to apps/mobile in W3), via
// Apple's CDN. Two consequences worth remembering:
//   - changes here take an hour to a day to reach devices (the CDN caches);
//   - the file must answer 200 with application/json and no redirect,
//     which is why it is a route, not a static file a host might redirect.
//
// The middleware matcher excludes `.well-known`, so no locale rewrite.
//
// Team ID verified against the founder's signing certificate
// (OU=33B4MKXY82, O=Nikolas Neofytou); the W3 on-device tap test is the
// end-to-end proof — a wrong team fails there, loudly.
export const dynamic = 'force-static';

const APP_ID = '33B4MKXY82.com.nikolasneofytou.ludi';

// Only invite links and sign-in links open the app. Everything else on the
// site — /keepers, /owners, legal — is meant to be read in the browser even
// when the app is installed, so the patterns stay narrow rather than
// claiming "/*".
//
// /auth/callback/* is the magic link (security audit 2026-10-19): an https
// path only this app can claim, where ludi://callback could be caught by any
// app registering the scheme. Not localised — the app writes the URL itself.
const APP_PATTERNS = ['/f/*', '/el/f/*', '/auth/callback/*'];

export function GET() {
  return Response.json({
    applinks: {
      details: [
        {
          appIDs: [APP_ID],
          components: APP_PATTERNS.map((pattern) => ({ '/': pattern })),
        },
      ],
    },
  });
}
