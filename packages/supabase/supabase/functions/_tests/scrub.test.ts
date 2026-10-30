// _tests/scrub.test.ts
// Contract test for the Sentry PII scrubber (ADR-0010). This is the gate
// that catches a scrubber regression before it lets PII reach Sentry. Pure
// in/out — no DB, no Sentry, no network.

import { assertEquals } from 'std/assert/mod.ts';
import {
  EMAIL_PLACEHOLDER,
  PHONE_PLACEHOLDER,
  scrub,
  scrubString,
  VALUE_PLACEHOLDER,
} from '../_shared/scrub.ts';

// ── scrubString: pattern redaction ─────────────────────────────────────

Deno.test('scrubString redacts a Cyprus phone (+357, no spaces)', () => {
  assertEquals(
    scrubString('call +35799000000 now'),
    `call ${PHONE_PLACEHOLDER} now`,
  );
});

Deno.test('scrubString redacts a spaced/dashed international phone', () => {
  assertEquals(scrubString('ring +357 99-000 000'), `ring ${PHONE_PLACEHOLDER}`);
});

Deno.test('scrubString redacts an email', () => {
  assertEquals(
    scrubString('user nikiforialicht@gmail.com signed in'),
    `user ${EMAIL_PLACEHOLDER} signed in`,
  );
});

Deno.test('scrubString redacts email AND phone in one string', () => {
  assertEquals(
    scrubString('a@b.io / +35799123456'),
    `${EMAIL_PLACEHOLDER} / ${PHONE_PLACEHOLDER}`,
  );
});

Deno.test('scrubString leaves clean text and bare IDs untouched', () => {
  assertEquals(scrubString('booking BK-LCA-2026-0042 ok'), 'booking BK-LCA-2026-0042 ok');
  // A bare UUID-ish token must survive — it is not PII and is our log key.
  assertEquals(scrubString('user 4f9a1c2e'), 'user 4f9a1c2e');
});

// ── scrub: deep structure + key denylist ───────────────────────────────

Deno.test('scrub redacts values under sensitive keys regardless of content', () => {
  const out = scrub({
    phone: '99000000',
    email: 'plain text not matching regex',
    first_name: 'Nikolas',
    booking_id: 'BK-1',
  });
  assertEquals(out, {
    phone: VALUE_PLACEHOLDER,
    email: VALUE_PLACEHOLDER,
    first_name: VALUE_PLACEHOLDER,
    booking_id: 'BK-1',
  });
});

Deno.test('scrub is case-insensitive on key names', () => {
  assertEquals(scrub({ Email: 'x', PHONE: 'y', Authorization: 'Bearer z' }), {
    Email: VALUE_PLACEHOLDER,
    PHONE: VALUE_PLACEHOLDER,
    Authorization: VALUE_PLACEHOLDER,
  });
});

Deno.test('scrub walks nested objects and arrays', () => {
  const out = scrub({
    level: 'error',
    breadcrumbs: [
      { message: 'logged in as a@b.io' },
      { data: { token: 'secret', note: 'call +35799000000' } },
    ],
  });
  assertEquals(out, {
    level: 'error',
    breadcrumbs: [
      { message: `logged in as ${EMAIL_PLACEHOLDER}` },
      { data: { token: VALUE_PLACEHOLDER, note: `call ${PHONE_PLACEHOLDER}` } },
    ],
  });
});

Deno.test('scrub does not mutate its input', () => {
  const input = { email: 'a@b.io', nested: { phone: '+35799000000' } };
  const copy = structuredClone(input);
  scrub(input);
  assertEquals(input, copy);
});

Deno.test('scrub passes non-string primitives through', () => {
  assertEquals(scrub({ count: 3, ok: true, missing: null }), {
    count: 3,
    ok: true,
    missing: null,
  });
});

Deno.test('scrub handles cyclic references without throwing', () => {
  const a: Record<string, unknown> = { name: 'ok' };
  a.self = a;
  const out = scrub(a) as Record<string, unknown>;
  assertEquals(out.name, 'ok');
  assertEquals(out.self, VALUE_PLACEHOLDER);
});
