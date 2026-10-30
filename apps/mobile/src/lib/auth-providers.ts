// Auth providers for M4 #20 — Apple, Google, magic-link.
// Phone OTP is still the primary flow (M2 #6) and lives directly in the
// signin screen. This module wraps the three extra flows so the UI can
// treat them as a uniform "press button → session arrives" pattern.
//
// All four flows end up populating the Supabase session via the same
// onAuthStateChange listener in session.tsx, so no UI plumbing changes
// in the rest of the app.

import { beginSignIn, endSignIn, pendingSignIn } from './pending-sign-in';
import { supabase } from './supabase';

// ─── Magic link (email) ──────────────────────────────────────────────────────
//
// The link comes back as a universal link, https://ludi.football/auth/callback/
// <nonce>, not as ludi://callback. Only Ludi can claim an https path on its
// own domain (the AASA file on the site, and Android App Links); any app can
// register the `ludi` scheme and catch what is sent to it. The nonce is the
// pending sign-in this phone just wrote (pending-sign-in.ts), so the link
// can only finish the request that produced it.
//
// The email template builds the link from it: {{ .RedirectTo }}?token_hash=…
// (packages/supabase/supabase/templates/magic-link.html). If the link lands
// in a browser instead of the app, the site's /auth/callback page says what
// to do; it never forwards the token on to the `ludi` scheme.
//
// NOTE the app route is `callback`, not `auth/callback`: the screen lives at
// app/(auth)/callback.tsx, and a directory in parentheses is a route GROUP
// that adds nothing to the URL. +native-intent.tsx maps the universal link's
// /auth/callback/<nonce> onto that route.
const MAGIC_LINK_BASE = 'https://ludi.football/auth/callback';

export interface MagicLinkSendResult {
  ok: boolean;
  code?: 'INVALID_EMAIL' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'UNKNOWN';
}

export async function sendMagicLink(email: string): Promise<MagicLinkSendResult> {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, code: 'INVALID_EMAIL' };
  }
  const nonce = await beginSignIn('magic_link');
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: { emailRedirectTo: `${MAGIC_LINK_BASE}/${nonce}` },
  });
  if (error) {
    // Supabase's GoTrue rate-limit error surfaces as a 429 with a specific
    // message. Treat anything else as a generic network/unknown error.
    if (error.status === 429) return { ok: false, code: 'RATE_LIMITED' };
    if (error.message?.toLowerCase().includes('network')) return { ok: false, code: 'NETWORK_ERROR' };
    return { ok: false, code: 'UNKNOWN' };
  }
  return { ok: true };
}

// ─── Google (web OAuth via the system browser) ───────────────────────────────
//
// The native id-token flow needs per-platform Google client IDs baked into
// the build and a nonce handshake GoTrue is picky about. The web flow needs
// neither: GoTrue runs the OAuth exchange server-side (one Web client
// configured on the Supabase provider) and the app only opens the authorize
// URL in an auth session, then reads the redirect it comes back with.
//
// The client runs the PKCE flow (supabase.ts), so the redirect carries a
// one-time `?code` that only this phone's stored verifier can redeem — an
// app that catches ludi://callback on its way back holds nothing usable.
// The code is read from openAuthSessionAsync's own return value; the
// callback screen never finishes a Google sign-in, and tokens in a
// redirect are never accepted.

export interface GoogleSignInResult {
  ok: boolean;
  code?: 'CANCELLED' | 'NOT_CONFIGURED' | 'UNKNOWN';
}

const OAUTH_REDIRECT = 'ludi://callback';

// Hermes ships no full URL implementation, so parse by hand. A PKCE code
// arrives in the query; an error can arrive in either part.
function authParams(url: string): Record<string, string> {
  const raw = url.split(/[#?]/).slice(1).join('&');
  const params: Record<string, string> = {};
  for (const pair of raw.split('&')) {
    const [k, v] = pair.split('=');
    if (k && v !== undefined) params[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return params;
}

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  await beginSignIn('google');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error || !data?.url) {
    await endSignIn();
    return { ok: false, code: 'NOT_CONFIGURED' };
  }

  const WebBrowser = await import('expo-web-browser');
  const result = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT);
  if (result.type !== 'success') {
    await endSignIn();
    return {
      ok: false,
      code: result.type === 'cancel' || result.type === 'dismiss' ? 'CANCELLED' : 'UNKNOWN',
    };
  }

  const { code } = authParams(result.url);
  const exchanged = code ? !(await supabase.auth.exchangeCodeForSession(code)).error : false;
  if (!exchanged) await endSignIn();
  return exchanged ? { ok: true } : { ok: false, code: 'UNKNOWN' };
}

// ─── Finishing a magic link ─────────────────────────────────────────────────
//
// What the callback screen calls with the link the phone was opened on.
// Three gates, in order (audit 2026-10-19, A4):
//
//   1. a session already on the phone is never replaced — signing in as
//      someone else starts with signing out;
//   2. the link must carry the nonce of a magic link this phone asked for
//      in the last 15 minutes;
//   3. only a `?token_hash` (what the template sends) or a PKCE `?code`
//      (what a {{ .ConfirmationURL }} template would send — bound to this
//      phone's verifier) finishes it. Raw access/refresh tokens in a link
//      are never read: setSession() from a URL is how a stranger's session
//      gets onto this phone.
export type MagicLinkOutcome = 'signed_in' | 'already_signed_in' | 'google_in_flight' | 'not_requested' | 'invalid';

const EMAIL_OTP_TYPES = ['email', 'magiclink', 'signup', 'invite', 'recovery', 'email_change'] as const;
type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

const LINK_NONCE =
  /^(?:https:\/\/(?:www\.)?ludi\.football\/auth\/callback|[a-z0-9.+-]+:\/\/callback)\/([0-9a-f]{32})(?:[/?#]|$)/i;

/** The nonce a callback link carries in its path, if any. */
export function callbackNonce(url: string): string | null {
  return LINK_NONCE.exec(url)?.[1]?.toLowerCase() ?? null;
}

export async function completeMagicLink(url: string): Promise<MagicLinkOutcome> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return 'already_signed_in';

  const pending = await pendingSignIn();
  // Android hands Google's redirect to the router as well as to the auth
  // session; signInWithGoogle is the one finishing it.
  if (pending?.method === 'google') return 'google_in_flight';
  if (!pending || callbackNonce(url) !== pending.nonce) return 'not_requested';

  const params = authParams(url);
  let ok = false;
  if (params.code) {
    ok = !(await supabase.auth.exchangeCodeForSession(params.code)).error;
  } else if (params.token_hash) {
    const type = (EMAIL_OTP_TYPES as readonly string[]).includes(params.type ?? '')
      ? (params.type as EmailOtpType)
      : 'email';
    ok = !(await supabase.auth.verifyOtp({ token_hash: params.token_hash, type })).error;
  }
  if (!ok) return 'invalid';
  await endSignIn();
  return 'signed_in';
}

// ─── Method availability ─────────────────────────────────────────────────────
//
// The sign-in screen offers four ways in, but a Supabase project only answers
// for the ones actually configured on it: phone OTP needs a real SMS provider,
// Apple and Google need their provider rows filled in. A method the server
// cannot serve is worse than a missing one — the user picks it, waits, and
// gets an error on the first screen of the app.
//
// EXPO_PUBLIC_AUTH_METHODS is a comma-separated allowlist letting a build show
// only what its own backend answers for. Unset means all four, which is the
// production intent and preserves the behaviour every existing build has.
//
//   EXPO_PUBLIC_AUTH_METHODS=magic_link           // internal beta, email only
//   EXPO_PUBLIC_AUTH_METHODS=phone,apple,magic_link

export interface EnabledAuthMethods {
  phone: boolean;
  apple: boolean;
  google: boolean;
  magicLink: boolean;
}

const ALL_METHODS: EnabledAuthMethods = {
  phone: true,
  apple: true,
  google: true,
  magicLink: true,
};

export function enabledAuthMethods(): EnabledAuthMethods {
  // Cast: expo-env.d.ts widens process.env, which makes split()/map() infer any.
  const raw = (process.env.EXPO_PUBLIC_AUTH_METHODS as string | undefined)?.trim();
  if (!raw) return ALL_METHODS;

  const listed = new Set(
    raw
      .split(',')
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean),
  );

  const methods: EnabledAuthMethods = {
    phone: listed.has('phone'),
    apple: listed.has('apple'),
    google: listed.has('google'),
    magicLink: listed.has('magic_link') || listed.has('magiclink'),
  };

  // A typo'd allowlist would otherwise strand the user on a screen with no way
  // forward at all. Showing too much is recoverable; showing nothing is not.
  const anyEnabled = methods.phone || methods.apple || methods.google || methods.magicLink;
  return anyEnabled ? methods : ALL_METHODS;
}
