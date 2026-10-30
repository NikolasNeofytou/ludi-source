// _tests/idempotency.test.ts
// Tests for the canonical-JSON hasher + header reader. No DB required.

import { assert, assertEquals, assertThrows } from 'std/assert/mod.ts';
import {
  canonicalJson,
  IdempotencyError,
  readIdempotencyKey,
  sha256Hex,
} from '../_shared/idempotency.ts';

Deno.test('canonicalJson sorts object keys recursively', () => {
  const a = canonicalJson({ b: 2, a: 1, c: { y: 2, x: 1 } });
  const b = canonicalJson({ a: 1, c: { x: 1, y: 2 }, b: 2 });
  assertEquals(a, b);
  assertEquals(a, '{"a":1,"b":2,"c":{"x":1,"y":2}}');
});

Deno.test('canonicalJson preserves array order', () => {
  assertEquals(canonicalJson([3, 1, 2]), '[3,1,2]');
});

Deno.test('sha256Hex is deterministic', async () => {
  const a = await sha256Hex('hello');
  const b = await sha256Hex('hello');
  assertEquals(a, b);
  assertEquals(a.length, 64);
});

Deno.test('sha256Hex differs for different inputs', async () => {
  const a = await sha256Hex('hello');
  const b = await sha256Hex('world');
  assert(a !== b);
});

Deno.test('readIdempotencyKey returns null when header absent', () => {
  const req = new Request('http://localhost', { method: 'POST' });
  assertEquals(readIdempotencyKey(req), null);
});

Deno.test('readIdempotencyKey returns trimmed key when present', () => {
  const req = new Request('http://localhost', {
    method: 'POST',
    headers: { 'Idempotency-Key': '  abcd1234efgh  ' },
  });
  assertEquals(readIdempotencyKey(req), 'abcd1234efgh');
});

Deno.test('readIdempotencyKey rejects keys that are too short', () => {
  const req = new Request('http://localhost', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'short' },
  });
  assertThrows(() => readIdempotencyKey(req), IdempotencyError);
});

Deno.test('readIdempotencyKey rejects keys that are too long', () => {
  const req = new Request('http://localhost', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'x'.repeat(201) },
  });
  assertThrows(() => readIdempotencyKey(req), IdempotencyError);
});
