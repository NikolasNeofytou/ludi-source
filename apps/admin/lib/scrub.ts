// lib/scrub.ts
// Source-level PII scrubber for Sentry (ADR-0010). PII must never leave the
// admin app inside a Sentry event — scrubbing here is the primary control.
// PURE module. Started as a verbatim mirror of the Deno-tested copy at
// packages/supabase/supabase/functions/_shared/scrub.ts; since the
// 2026-10-19 audit (C4) this copy also redacts URL secrets and cookies, and
// walks transactions safely — fold the same into the Deno copy when a
// shared, testable package exists.

export const SENSITIVE_KEYS: readonly string[] = [
  'phone',
  'phone_number',
  'email',
  'password',
  'token',
  'token_hash',
  'access_token',
  'refresh_token',
  'ticket',
  'authorization',
  'cookie',
  'cookies',
  'set-cookie',
  'apikey',
  'api_key',
  'first_name',
  'last_name',
  'full_name',
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\+\d[\d\s().-]{6,17}\d/g;

// A lobby-TV link is a bearer secret: whoever holds /tv/<token> reads that
// venue's day, and it reaches Sentry in page URLs, transaction names,
// navigation breadcrumbs and span URLs. The route's own name, /tv/[token],
// is left alone (16+ token characters, no brackets).
const TV_PATH_RE = /\/tv\/[A-Za-z0-9_-]{16,}/g;

// Sign-in and session secrets that ride in a URL's query or fragment: the
// magic link's token_hash, PKCE's code, an implicit-flow access/refresh
// token, a ticket. Matched only as a parameter (after ?, &, # or ; — or at
// the start of a bare query string), so `error_code=` and prose survive.
const URL_SECRET_RE =
  /(^|[?&#;])(token_hash|token|access_token|refresh_token|code|ticket)=[^&#\s"'<>]*/gi;

export const EMAIL_PLACEHOLDER = '[redacted-email]';
export const PHONE_PLACEHOLDER = '[redacted-phone]';
export const VALUE_PLACEHOLDER = '[redacted]';
export const TV_PATH_PLACEHOLDER = '/tv/[redacted]';

export function scrubString(input: string): string {
  return input
    .replace(URL_SECRET_RE, `$1$2=${VALUE_PLACEHOLDER}`)
    .replace(TV_PATH_RE, TV_PATH_PLACEHOLDER)
    .replace(EMAIL_RE, EMAIL_PLACEHOLDER)
    .replace(PHONE_RE, PHONE_PLACEHOLDER);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.includes(key.toLowerCase());
}

// The SDK's own bookkeeping on an event (scopes, the client, the sampling
// context). Never sent — the SDK deletes it before the envelope is built —
// so it is passed through untouched: walking it would copy the whole client.
const PASS_THROUGH_KEYS = new Set(['sdkProcessingMetadata']);

// `ancestors` holds only the objects on the current path, so a true cycle is
// cut while an object referenced twice (common in transaction events) is
// scrubbed twice rather than replaced by a placeholder string.
export function scrub<T>(value: T, ancestors: Set<object> = new Set()): T {
  if (typeof value === 'string') {
    return scrubString(value) as unknown as T;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const obj = value as object;
  if (ancestors.has(obj)) {
    return VALUE_PLACEHOLDER as unknown as T;
  }
  ancestors.add(obj);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => scrub(item, ancestors)) as unknown as T;
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = PASS_THROUGH_KEYS.has(key)
        ? val
        : isSensitiveKey(key)
          ? VALUE_PLACEHOLDER
          : scrub(val, ancestors);
    }
    return out as unknown as T;
  } finally {
    ancestors.delete(obj);
  }
}
