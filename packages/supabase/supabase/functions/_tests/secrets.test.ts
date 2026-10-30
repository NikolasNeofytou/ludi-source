// _tests/secrets.test.ts
// The constant-time compare behind every cron secret and the WhatsApp
// verify token, and the log-safe summary of a Postgres error.

import { assertEquals } from 'std/assert/mod.ts';
import { secretMatches, timingSafeEqual } from '../_shared/secrets.ts';
import { pgErrorSummary } from '../_shared/errors.ts';

Deno.test('timingSafeEqual: equal strings match', () => {
  assertEquals(timingSafeEqual('s3cret-value', 's3cret-value'), true);
  assertEquals(timingSafeEqual('', ''), true);
});

Deno.test('timingSafeEqual: any difference fails, prefixes included', () => {
  assertEquals(timingSafeEqual('s3cret-value', 's3cret-valuf'), false);
  assertEquals(timingSafeEqual('s3cret-value', 's3cret'), false);
  assertEquals(timingSafeEqual('s3cret', 's3cret-value'), false);
  assertEquals(timingSafeEqual('abc', ''), false);
  // Multi-byte characters compare by their bytes.
  assertEquals(timingSafeEqual('κλειδί', 'κλειδί'), true);
  assertEquals(timingSafeEqual('κλειδί', 'κλειδι'), false);
});

Deno.test('secretMatches: a missing header never matches', () => {
  assertEquals(secretMatches(null, 'x'), false);
  assertEquals(secretMatches('x', 'x'), true);
});

Deno.test('pgErrorSummary: code and constraint, never the row', () => {
  const err = {
    code: '23514',
    message: 'new row for relation "bookings" violates check constraint "bookings_walk_in_phone"',
    details: 'Failing row contains (…, Andreas Georgiou, 35799123456, …).',
  };
  assertEquals(pgErrorSummary(err), { code: '23514', constraint: 'bookings_walk_in_phone' });
  assertEquals(pgErrorSummary({ code: 'PGRST116', message: 'no rows' }), { code: 'PGRST116' });
  assertEquals(pgErrorSummary(null), {});
});
