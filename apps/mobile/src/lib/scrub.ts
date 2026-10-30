// src/lib/scrub.ts
// Source-level PII scrubber for Sentry (ADR-0010). PII must never leave the
// device inside a Sentry event — scrubbing here is the primary control;
// Sentry's DPA is only a backstop. PURE module (no Sentry, no RN APIs).
//
// This is a verbatim mirror of the Deno copy at
// packages/supabase/supabase/functions/_shared/scrub.ts, which carries the
// contract test (the mobile workspace has no JS test runner yet — see the
// "no mobile test runner" note). Keep the two in sync until a shared,
// testable package exists.

export const SENSITIVE_KEYS: readonly string[] = [
  'phone',
  'phone_number',
  'email',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'apikey',
  'api_key',
  'first_name',
  'last_name',
  'full_name',
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\+\d[\d\s().-]{6,17}\d/g;

export const EMAIL_PLACEHOLDER = '[redacted-email]';
export const PHONE_PLACEHOLDER = '[redacted-phone]';
export const VALUE_PLACEHOLDER = '[redacted]';

export function scrubString(input: string): string {
  return input
    .replace(EMAIL_RE, EMAIL_PLACEHOLDER)
    .replace(PHONE_RE, PHONE_PLACEHOLDER);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.includes(key.toLowerCase());
}

export function scrub<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === 'string') {
    return scrubString(value) as unknown as T;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return VALUE_PLACEHOLDER as unknown as T;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, seen)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? VALUE_PLACEHOLDER : scrub(val, seen);
  }
  return out as unknown as T;
}
