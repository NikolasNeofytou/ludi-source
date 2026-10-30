// _shared/scrub.ts
// Source-level PII scrubber for Sentry. Per ADR-0010, no phone number,
// email, or other sensitive field may leave the client inside a Sentry
// event — scrubbing here is the primary control; Sentry's DPA is only a
// backstop. This module is PURE (no Sentry, no Deno-only APIs) so it is
// trivially testable and can be mirrored verbatim on the mobile + admin
// surfaces until a shared JS test runner exists.
//
// Two layers:
//   1. Value redaction — regex over every string, replacing anything that
//      looks like an email or a phone number with a stable placeholder.
//   2. Key redaction — any object key in SENSITIVE_KEYS has its whole value
//      replaced, regardless of what the value looks like.

// Object keys whose values are always sensitive. Compared case-insensitively.
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

// Email: local@domain.tld. Conservative — must have a dot in the domain.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// International phone: a leading + then 7–18 digits with optional spaces,
// dashes, dots, or parens between them. Catches Cyprus +35799000000 and
// +357 99 000000 alike. Bare local numbers are intentionally NOT matched
// here (too collision-prone with IDs) — they are caught via SENSITIVE_KEYS.
const PHONE_RE = /\+\d[\d\s().-]{6,17}\d/g;

export const EMAIL_PLACEHOLDER = '[redacted-email]';
export const PHONE_PLACEHOLDER = '[redacted-phone]';
export const VALUE_PLACEHOLDER = '[redacted]';

/** Redact email + phone patterns inside a single string. */
export function scrubString(input: string): string {
  return input
    .replace(EMAIL_RE, EMAIL_PLACEHOLDER)
    .replace(PHONE_RE, PHONE_PLACEHOLDER);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.includes(key.toLowerCase());
}

/**
 * Deep-scrub an arbitrary value. Returns a new structure; never mutates the
 * input. Strings are pattern-redacted; values under a sensitive key are fully
 * replaced; objects and arrays are walked recursively. Non-string primitives
 * pass through. Guards against cycles.
 */
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
