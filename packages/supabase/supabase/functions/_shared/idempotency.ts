// _shared/idempotency.ts
// Client-supplied Idempotency-Key handling for money-moving Edge Functions.
//
// Contract:
//   - If no key header is present, the endpoint runs normally (and the caller
//     takes the risk of duplicates on retry).
//   - If a key is present on first call, we process and cache the response.
//   - If the same key comes in again with the same request body, we return
//     the cached response.
//   - If the same key comes in with a DIFFERENT request body, we return 409
//     IDEMPOTENCY_MISMATCH — the same key must mean the same request.
//
// Hash is SHA-256 of a deterministic JSON serialization (keys sorted).

import type { SupabaseClient } from '@supabase/supabase-js';

const KEY_HEADER = 'Idempotency-Key';
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 200;

export interface CachedResponse {
  status: number;
  body: unknown;
}

export function readIdempotencyKey(req: Request): string | null {
  const raw = req.headers.get(KEY_HEADER);
  if (!raw) return null;
  const key = raw.trim();
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
    throw new IdempotencyError(
      `Idempotency-Key length must be ${MIN_KEY_LENGTH}..${MAX_KEY_LENGTH} chars`,
    );
  }
  return key;
}

export class IdempotencyError extends Error {}
export class IdempotencyMismatch extends Error {}

/** Deterministic JSON: recursively sort object keys so hashes are stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) sorted[k] = sortDeep(obj[k]);
    return sorted;
  }
  return value;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Look up a prior response for (key, user). Returns:
 *   - the cached { status, body } if the request hash matches.
 *   - null if no row exists for this key.
 * Throws IdempotencyMismatch if the key exists but was used with a different body.
 */
export async function lookupIdempotentResponse(
  supa: SupabaseClient,
  key: string,
  userId: string,
  requestHash: string,
): Promise<CachedResponse | null> {
  const { data, error } = await supa
    .from('idempotency_keys')
    .select('user_id, request_hash, response_status, response_body, expires_at')
    .eq('key', key)
    .maybeSingle();

  if (error) throw new Error(`idempotency lookup failed: ${error.message}`);
  if (!data) return null;

  // Expired rows should be treated as absent — the cleanup cron will prune.
  if (new Date(data.expires_at).getTime() < Date.now()) return null;

  // Scoping: if the key was issued for a different user, refuse. This
  // guards against one user probing another's keys.
  if (data.user_id !== userId) {
    throw new IdempotencyMismatch('Idempotency-Key bound to a different user');
  }
  if (data.request_hash !== requestHash) {
    throw new IdempotencyMismatch('Idempotency-Key reused with a different request body');
  }
  return { status: data.response_status, body: data.response_body };
}

/** Store the response for future retries. Best-effort; caller should not rely
 *  on the store succeeding — the response is already computed. */
export async function storeIdempotentResponse(
  supa: SupabaseClient,
  key: string,
  userId: string,
  requestHash: string,
  status: number,
  body: unknown,
): Promise<void> {
  const { error } = await supa.from('idempotency_keys').insert({
    key,
    user_id: userId,
    request_hash: requestHash,
    response_status: status,
    response_body: body,
  });
  if (error && error.code !== '23505') {
    // 23505 = unique_violation — another concurrent request stored first,
    // which is fine. Anything else we log but don't surface.
    console.error('idempotency store failed', error);
  }
}
