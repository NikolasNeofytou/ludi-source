// Digital Asset Links — Android's half of what the AASA file does for iOS:
// it lets https://ludi.football/auth/callback/* (the magic link, see
// apps/mobile/app.json's intentFilters) open the app instead of the browser,
// and only the app signed with one of these keys (security audit 2026-10-19).
//
// Android checks it at install time for an intent filter with autoVerify.
// Like the AASA file it must answer 200 with application/json and no
// redirect, so it is a route; the middleware matcher skips `.well-known`.
//
// The fingerprints are public (anyone can read them off an APK). Two keys
// sign Ludi's Android builds and both belong here:
//   - the EAS upload key, which signs the direct-APK beta builds
//     (`eas credentials -p android` → SHA-256 Fingerprint);
//   - Google Play's app-signing key, which signs what Play installs
//     (Play Console → Test and release → App integrity → App signing).
// While the list is empty Android does not verify the link: a magic link
// tapped on Android opens /auth/callback on the site, which says so.
export const dynamic = 'force-static';

const PACKAGE_NAME = 'com.nikolasneofytou.ludi';

const SHA256_CERT_FINGERPRINTS: string[] = [];

export function GET() {
  return Response.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: PACKAGE_NAME,
        sha256_cert_fingerprints: SHA256_CERT_FINGERPRINTS,
      },
    },
  ]);
}
