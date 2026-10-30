// _tests/walk-in-phone.test.ts
// normaliseWalkInPhone — how a walk-in stores the number the counter typed.
// Kept in step with the database's normalize_phone_cy: the E.164 key that
// function produces is always '+' followed by what this stores.

import { assertEquals } from 'std/assert/mod.ts';
import { normaliseWalkInPhone } from '../_shared/walk-in-phone.ts';

Deno.test('a bare Cypriot mobile gains its country code', () => {
  // The bug this exists for: stored bare, it rendered as "+99123456".
  assertEquals(normaliseWalkInPhone('99 123 456'), '35799123456');
  assertEquals(normaliseWalkInPhone('99123456'), '35799123456');
});

Deno.test('a bare Cypriot landline gains its country code', () => {
  assertEquals(normaliseWalkInPhone('22 123456'), '35722123456');
});

Deno.test('a number typed with its country code is kept as it was', () => {
  assertEquals(normaliseWalkInPhone('+357 99 123456'), '35799123456');
  assertEquals(normaliseWalkInPhone('0035799123456'), '35799123456');
  assertEquals(normaliseWalkInPhone('+30 691 234 5678'), '306912345678');
});

Deno.test('a number it cannot be sure of is left as typed, not guessed at', () => {
  // A bare 10-digit number — most likely Greek without +30. The database
  // does not guess either; both leave it alone.
  assertEquals(normaliseWalkInPhone('6912345678'), '6912345678');
  // 8 digits not starting 2 or 9 is not a Cypriot number.
  assertEquals(normaliseWalkInPhone('12345678'), '12345678');
});

Deno.test('nothing typed stores nothing', () => {
  assertEquals(normaliseWalkInPhone(undefined), null);
  assertEquals(normaliseWalkInPhone(''), null);
  assertEquals(normaliseWalkInPhone(' - '), null);
});
