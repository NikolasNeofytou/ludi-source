// _shared/apple-siwa.ts
// Sign in with Apple token revocation for account deletion.
//
// App Review guideline 5.1.1(v): an app that offers Sign in with Apple must
// revoke the user's Apple tokens when they delete their account, so the
// Apple ID's "Sign in with Apple" list no longer shows the app.
//
// Ludi signs in natively (signInWithIdToken), so it never holds an Apple
// refresh token. At deletion time the app asks the user to confirm with
// Apple once more; that yields a fresh single-use authorization code (valid
// ~5 minutes), which we exchange for tokens and immediately revoke. No Apple
// token is ever stored — and this works for every existing Apple user, who
// has nothing stored to revoke anyway.
//
// Apple's endpoints need a client_secret: an ES256 JWT signed with a Sign in
// with Apple private key (.p8). WebCrypto's ECDSA signature is already the
// raw r||s form JWS ES256 wants, so no JWT library is needed.
//
// Everything here is pure or takes `fetch` as a parameter, so the unit
// tests exercise every branch without calling Apple.

export const APPLE_AUDIENCE = 'https://appleid.apple.com';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

export interface AppleSiwaConfig {
  teamId: string;
  keyId: string;
  /** The Services ID or bundle id the tokens were issued to. */
  clientId: string;
  /** The .p8 key's PEM (PKCS#8, "-----BEGIN PRIVATE KEY-----"). */
  privateKeyPem: string;
}

/** Reads the config from function secrets; null when any piece is unset. */
export function appleSiwaConfigFromEnv(): AppleSiwaConfig | null {
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const keyId = Deno.env.get('APPLE_SIWA_KEY_ID');
  const privateKeyPem = Deno.env.get('APPLE_SIWA_PRIVATE_KEY');
  const clientId = Deno.env.get('APPLE_SIWA_CLIENT_ID') ?? 'com.nikolasneofytou.ludi';
  if (!teamId || !keyId || !privateKeyPem) return null;
  return { teamId, keyId, clientId, privateKeyPem: privateKeyPem.replace(/\\n/g, '\n') };
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new ArrayBuffer(bin.length);
  const view = new Uint8Array(out);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return out;
}

/** The ES256 client_secret JWT Apple's token + revoke endpoints require. */
export async function buildClientSecret(
  config: AppleSiwaConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(config.privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = base64urlJson({ alg: 'ES256', kid: config.keyId, typ: 'JWT' });
  const payload = base64urlJson({
    iss: config.teamId,
    iat: nowSeconds,
    exp: nowSeconds + 300,
    aud: APPLE_AUDIENCE,
    sub: config.clientId,
  });
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

/**
 * Reads a JWT's payload WITHOUT verifying it. Only used on the id_token that
 * Apple's token endpoint returned to us directly over TLS, in exchange for
 * our signed client_secret — the channel is the authentication.
 */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/**
 * The Apple user id (`sub`) linked to an auth user, or null when the account
 * never signed in with Apple. GoTrue keeps it as the identity's provider id.
 */
export function appleSubOf(
  identities: ReadonlyArray<{ provider: string; id?: string; identity_data?: Record<string, unknown> }> | undefined,
): string | null {
  const apple = identities?.find((i) => i.provider === 'apple');
  if (!apple) return null;
  const sub = apple.identity_data?.sub ?? apple.id;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}

export type AppleRevokeOutcome =
  | { status: 'revoked' }
  /** The code belongs to a different Apple ID than the one on the account. */
  | { status: 'mismatch' }
  /** Apple refused the code (expired, reused) or the call failed. */
  | { status: 'failed'; step: 'exchange' | 'revoke'; detail: string };

/**
 * Exchanges a fresh authorization code for tokens, checks the Apple ID is the
 * account's own (`expectedSub`), and revokes the refresh token — which ends
 * the app's Sign in with Apple link for that Apple ID.
 */
export async function revokeWithAuthorizationCode(
  config: AppleSiwaConfig,
  authorizationCode: string,
  expectedSub: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AppleRevokeOutcome> {
  const clientSecret = await buildClientSecret(config);

  const tokenRes = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    return { status: 'failed', step: 'exchange', detail: `${tokenRes.status} ${await tokenRes.text()}` };
  }
  const tokens = (await tokenRes.json()) as {
    refresh_token?: string;
    access_token?: string;
    id_token?: string;
  };

  const sub = tokens.id_token ? decodeJwtPayload(tokens.id_token)?.sub : undefined;
  if (sub !== expectedSub) return { status: 'mismatch' };

  const token = tokens.refresh_token ?? tokens.access_token;
  if (!token) return { status: 'failed', step: 'exchange', detail: 'no token in response' };

  const revokeRes = await fetchImpl(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
    }),
  });
  if (!revokeRes.ok) {
    return { status: 'failed', step: 'revoke', detail: `${revokeRes.status} ${await revokeRes.text()}` };
  }
  return { status: 'revoked' };
}
