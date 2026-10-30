// Account client (M5 #32). Wraps the anonymize-me Edge Function — the
// user-facing half of GDPR self-service erasure.
//
// Edge Function: packages/supabase/supabase/functions/anonymize-me/index.ts
// Model: docs/adr/0018-account-erasure-anonymize-and-keep.md
//
// No body, no Idempotency-Key header: the server's anonymized_at guard is the
// idempotency mechanism (re-call self-heals / no-ops), so there is nothing for
// the client to dedupe. The caller's own JWT identifies whose account to erase.

import { supabase } from './supabase';

export type DeleteAccountErrorCode =
  | 'UNAUTHORIZED'
  | 'DB_ERROR'
  | 'INTERNAL_ERROR'
  | 'APPLE_ACCOUNT_MISMATCH'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export class DeleteAccountError extends Error {
  readonly code: DeleteAccountErrorCode;
  constructor(code: DeleteAccountErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'DeleteAccountError';
  }
}

export interface DeleteAccountResult {
  anonymized: boolean;
  already_anonymized: boolean;
}

/**
 * `appleAuthorizationCode`: a fresh code from re-confirming with Apple, sent
 * by Sign in with Apple accounts so the server can revoke Ludi's Apple token
 * before erasing (App Review 5.1.1(v)). Omitted for every other account.
 */
export async function deleteAccount(
  opts: { appleAuthorizationCode?: string } = {},
): Promise<DeleteAccountResult> {
  let response;
  try {
    response = await supabase.functions.invoke<DeleteAccountResult>('anonymize-me', {
      body: opts.appleAuthorizationCode
        ? { apple_authorization_code: opts.appleAuthorizationCode }
        : {},
    });
  } catch (err) {
    throw new DeleteAccountError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Network request failed',
    );
  }

  if (response.error) {
    throw await extractError(response.error);
  }
  if (!response.data) {
    throw new DeleteAccountError('UNKNOWN', 'Empty response from anonymize-me');
  }
  return response.data;
}

const KNOWN_CODES = ['UNAUTHORIZED', 'DB_ERROR', 'INTERNAL_ERROR', 'APPLE_ACCOUNT_MISMATCH'] as const;

function isKnownCode(code: unknown): code is (typeof KNOWN_CODES)[number] {
  return typeof code === 'string' && (KNOWN_CODES as readonly string[]).includes(code);
}

// errors.ts ships `{ error: "<CODE>", message }` (the code is a string, not a
// nested object), so read `body.error` directly.
interface EdgeErrorBody {
  error?: string;
  message?: string;
}

async function extractError(err: unknown): Promise<DeleteAccountError> {
  // FunctionsHttpError exposes the original Response on `.context`.
  const ctx = (err as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as EdgeErrorBody;
      const rawCode = body?.error;
      const message = body?.message ?? 'Account deletion failed';
      if (isKnownCode(rawCode)) {
        return new DeleteAccountError(rawCode, message);
      }
      if (ctx.status === 401) return new DeleteAccountError('UNAUTHORIZED', message);
      return new DeleteAccountError('UNKNOWN', message);
    } catch {
      // Body wasn't JSON — fall through.
    }
  }
  return new DeleteAccountError(
    'UNKNOWN',
    err instanceof Error ? err.message : 'Account deletion failed',
  );
}
