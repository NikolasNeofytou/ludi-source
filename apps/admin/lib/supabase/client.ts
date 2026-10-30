import { createBrowserClient } from '@supabase/ssr';

// flowType 'implicit', deliberately (2026-09-01). The default PKCE flow
// stamps every OTP this client requests as `pkce_…` — verified by reading
// a real magic-link email's raw source — which couples the emailed link to
// the requesting browser's verifier cookie. That broke sign-in twice over:
// a link opened anywhere else (or after ANY later signInWithOtp call
// rotated the verifier) died with "expired or already used", and owners
// read email on their phones. With implicit flow the token is plain, the
// `?token_hash=` email templates verify via verifyOtp from any device, and
// /auth/callback already handles every link shape either flow produces.
// PKCE's protections matter for OAuth redirects; this app's only sign-in
// is emailed one-time tokens, where single-use + expiry do that work.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'implicit' } },
  );
}
