// Sign in with Apple revocation helpers (_shared/apple-siwa.ts).
// No network: the client_secret is verified with a locally generated key,
// and Apple's endpoints are a fake fetch.

import { assert, assertEquals } from 'std/assert/mod.ts';
import {
  APPLE_AUDIENCE,
  appleSubOf,
  buildClientSecret,
  decodeJwtPayload,
  revokeWithAuthorizationCode,
  type AppleSiwaConfig,
} from '../_shared/apple-siwa.ts';

function b64urlDecode(part: string): Uint8Array<ArrayBuffer> {
  const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function testConfig(): Promise<{ config: AppleSiwaConfig; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;
  return {
    config: { teamId: 'TEAM123456', keyId: 'KEY1234567', clientId: 'com.nikolasneofytou.ludi', privateKeyPem: pem },
    publicKey: pair.publicKey,
  };
}

const fakeIdToken = (sub: string) => `${b64urlJson({ alg: 'RS256' })}.${b64urlJson({ sub })}.sig`;

Deno.test('buildClientSecret: ES256 JWT Apple accepts — header, claims, valid signature', async () => {
  const { config, publicKey } = await testConfig();
  const jwt = await buildClientSecret(config, 1_800_000_000);
  const [h, p, s] = jwt.split('.');
  assertEquals(JSON.parse(new TextDecoder().decode(b64urlDecode(h))), {
    alg: 'ES256',
    kid: 'KEY1234567',
    typ: 'JWT',
  });
  assertEquals(JSON.parse(new TextDecoder().decode(b64urlDecode(p))), {
    iss: 'TEAM123456',
    iat: 1_800_000_000,
    exp: 1_800_000_300,
    aud: APPLE_AUDIENCE,
    sub: 'com.nikolasneofytou.ludi',
  });
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    b64urlDecode(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  assert(ok, 'signature must verify with the matching public key');
});

Deno.test('decodeJwtPayload: reads the payload; null on garbage', () => {
  assertEquals(decodeJwtPayload(fakeIdToken('001234.abc.0987'))?.sub, '001234.abc.0987');
  assertEquals(decodeJwtPayload('not-a-jwt'), null);
  assertEquals(decodeJwtPayload('a.%%%.c'), null);
});

Deno.test('appleSubOf: Apple identity sub, else null', () => {
  assertEquals(appleSubOf(undefined), null);
  assertEquals(appleSubOf([{ provider: 'phone', id: '357990' }]), null);
  assertEquals(
    appleSubOf([{ provider: 'phone', id: 'x' }, { provider: 'apple', id: 'p', identity_data: { sub: 'apple-sub' } }]),
    'apple-sub',
  );
  assertEquals(appleSubOf([{ provider: 'apple', id: 'apple-provider-id' }]), 'apple-provider-id');
});

type Call = { url: string; body: URLSearchParams };

function fakeApple(responses: Array<{ status: number; json?: unknown; text?: string }>) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, body: new URLSearchParams(String(init?.body)) });
    const r = responses[calls.length - 1];
    return Promise.resolve(
      new Response(r.json !== undefined ? JSON.stringify(r.json) : (r.text ?? ''), { status: r.status }),
    );
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

Deno.test('revoke: exchanges the code, checks the Apple ID, revokes the refresh token', async () => {
  const { config } = await testConfig();
  const apple = fakeApple([
    { status: 200, json: { refresh_token: 'r-tok', access_token: 'a-tok', id_token: fakeIdToken('sub-1') } },
    { status: 200, text: '' },
  ]);
  const outcome = await revokeWithAuthorizationCode(config, 'code-1', 'sub-1', apple.fetchImpl);
  assertEquals(outcome, { status: 'revoked' });
  assertEquals(apple.calls.length, 2);
  assertEquals(apple.calls[0].url, 'https://appleid.apple.com/auth/token');
  assertEquals(apple.calls[0].body.get('grant_type'), 'authorization_code');
  assertEquals(apple.calls[0].body.get('code'), 'code-1');
  assertEquals(apple.calls[0].body.get('client_id'), 'com.nikolasneofytou.ludi');
  assertEquals(apple.calls[1].url, 'https://appleid.apple.com/auth/revoke');
  assertEquals(apple.calls[1].body.get('token'), 'r-tok');
  assertEquals(apple.calls[1].body.get('token_type_hint'), 'refresh_token');
  assert(apple.calls[1].body.get('client_secret')?.split('.').length === 3);
});

Deno.test('revoke: a different Apple ID is a mismatch and is never revoked', async () => {
  const { config } = await testConfig();
  const apple = fakeApple([
    { status: 200, json: { refresh_token: 'r-tok', id_token: fakeIdToken('someone-else') } },
  ]);
  const outcome = await revokeWithAuthorizationCode(config, 'code-1', 'sub-1', apple.fetchImpl);
  assertEquals(outcome, { status: 'mismatch' });
  assertEquals(apple.calls.length, 1);
});

Deno.test('revoke: Apple refusing the code (expired / reused) is a failed exchange', async () => {
  const { config } = await testConfig();
  const apple = fakeApple([{ status: 400, text: '{"error":"invalid_grant"}' }]);
  const outcome = await revokeWithAuthorizationCode(config, 'old', 'sub-1', apple.fetchImpl);
  assertEquals(outcome.status, 'failed');
  if (outcome.status === 'failed') {
    assertEquals(outcome.step, 'exchange');
    assert(outcome.detail.includes('invalid_grant'));
  }
});

Deno.test('revoke: a failing revoke call is reported as such', async () => {
  const { config } = await testConfig();
  const apple = fakeApple([
    { status: 200, json: { refresh_token: 'r-tok', id_token: fakeIdToken('sub-1') } },
    { status: 503, text: 'unavailable' },
  ]);
  const outcome = await revokeWithAuthorizationCode(config, 'code-1', 'sub-1', apple.fetchImpl);
  assertEquals(outcome.status, 'failed');
  if (outcome.status === 'failed') assertEquals(outcome.step, 'revoke');
});
