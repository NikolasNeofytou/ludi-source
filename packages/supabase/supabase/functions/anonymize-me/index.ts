// anonymize-me/index.ts
// POST /anonymize-me — self-service GDPR account erasure.
//
// Contract: docs/api-contract.md §1.5. Model: ADR-0018 (anonymise-and-keep).
//
// The caller erases THEMSELVES (user-authed, no body). We do NOT hard-delete
// the auth row: public.users.id → auth.users ON DELETE CASCADE, and the child
// FKs (bookings/venue_owners/admin_actions) are ON DELETE RESTRICT, so a hard
// delete would be blocked for anyone who has booked. Instead:
//
//   1. Null the profile PII in public.users, switch the account off (no
//      public card, out of the keeper pool, no notices) and set anonymized_at
//      (service role — the RLS update path forbids writing anonymized_at).
//      Atomic claim on `anonymized_at IS NULL` so concurrent double-submits
//      transition once.
//   2. Delete the rows that are only the person's own (_shared/anonymize.ts
//      ERASED_ROWS: push tokens, team follows, the notice ledger, keeper
//      feedback about them, wallet tickets, cached responses). After the
//      claim, so nothing new is minted for them in between.
//   3. On first transition only: write the admin_actions audit row
//      (admin_user_id = the user themselves; the row is kept, so the
//      NOT NULL/RESTRICT FK is satisfied).
//   4. Soft-delete the auth identity (deleteUser(id, true)) — GoTrue obfuscates
//      email + phone, clears metadata, and blocks login WITHOUT deleting the
//      row (so the cascade never fires). Verified + idempotent: see
//      docs/spikes/anonymize-me-auth-scrub.md.
//   5. Report the bookings they organised that are still to come. Erasure
//      keeps them (financial records) and does not cancel them (a cancel
//      refunds, which is the player's call), so the response says what stays
//      booked: `upcoming_bookings`, NULL when the lookup failed. What is kept
//      and why is written down at the top of _shared/anonymize.ts.
//
// Idempotency: the deletes and the soft-delete run on every call (no-ops the
// second time), so a retry after a partial failure self-heals; the audit row
// is written only on the first transition, so retries never duplicate it.
//
// Sign in with Apple (App Review 5.1.1(v)): an Apple account's client sends a
// fresh `apple_authorization_code` from re-confirming with Apple. Before
// anything is erased we exchange it and revoke the Apple token
// (_shared/apple-siwa.ts), so Ludi drops off the user's Apple ID. A code
// for a DIFFERENT Apple ID aborts with 400 before any change. Any other Apple
// failure (not configured, expired code, Apple down) is logged and recorded
// in the audit row, but never blocks the GDPR erasure itself.

import { serve } from 'std/http/server.ts';
import { z } from 'zod';
import { withSentry } from '../_shared/sentry.ts';
import { getUserFromRequest } from '../_shared/auth.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/errors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import {
  anonymizedProfilePatch,
  ERASED_ROWS,
  UPCOMING_BOOKING_STATES,
  upcomingBookingsFrom,
} from '../_shared/anonymize.ts';
import {
  appleSiwaConfigFromEnv,
  appleSubOf,
  revokeWithAuthorizationCode,
} from '../_shared/apple-siwa.ts';

const AnonymizeInput = z.object({
  apple_authorization_code: z.string().min(1).max(4096).optional(),
});

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
  }

  // 1. Auth — the caller erases their own account.
  const user = await getUserFromRequest(req);
  if (!user) return errorResponse('UNAUTHORIZED', 'Missing or invalid token', 401);

  // Body is optional: older clients send `{}` or nothing.
  let rawBody: unknown = {};
  try {
    const text = await req.text();
    rawBody = text ? JSON.parse(text) : {};
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }
  const parsed = AnonymizeInput.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400);
  }
  const appleCode = parsed.data.apple_authorization_code;

  const supa = createServiceClient();
  const nowIso = new Date().toISOString();

  // 1b. Sign in with Apple revocation — before anything is erased, so an
  //     Apple ID mismatch can abort cleanly.
  const { data: authUser } = await supa.auth.admin.getUserById(user.id);
  const appleSub = appleSubOf(authUser?.user?.identities ?? undefined);
  let appleRevoke = 'not_apple';
  if (appleSub) {
    const config = appleSiwaConfigFromEnv();
    if (!appleCode) {
      appleRevoke = 'skipped_no_code';
    } else if (!config) {
      appleRevoke = 'skipped_not_configured';
      console.error('anonymize: Apple revoke skipped — APPLE_SIWA_* secrets unset', {
        user_id: user.id,
      });
    } else {
      const outcome = await revokeWithAuthorizationCode(config, appleCode, appleSub).catch(
        (err) => ({ status: 'failed' as const, step: 'exchange' as const, detail: String(err) }),
      );
      if (outcome.status === 'mismatch') {
        return errorResponse(
          'APPLE_ACCOUNT_MISMATCH',
          'That Apple ID is not the one this account uses',
          400,
        );
      }
      appleRevoke = outcome.status === 'revoked' ? 'revoked' : `failed_${outcome.step}`;
      if (outcome.status === 'failed') {
        console.error('anonymize: Apple revoke failed — erasure continues', {
          user_id: user.id,
          step: outcome.step,
          detail: outcome.detail,
        });
      }
    }
  }

  // 2. Atomic claim: null PII + stamp anonymized_at, but only if not already
  //    anonymized. A row in the result means WE performed the transition.
  const { data: claimed, error: claimErr } = await supa
    .from('users')
    .update(anonymizedProfilePatch(nowIso))
    .eq('id', user.id)
    .is('anonymized_at', null)
    .select('id');
  if (claimErr) {
    console.error('anonymize: profile update failed', { user_id: user.id, err: claimErr });
    return errorResponse('DB_ERROR', 'Failed to anonymize profile', 500);
  }
  const transitioned = (claimed?.length ?? 0) > 0;

  // 2b. The person's own rows. The users row is kept (anonymised), so the
  //     ON DELETE CASCADEs never fire — delete them here, on every call, best
  //     effort: one table failing is logged, and recorded as null in the
  //     audit row's `purged`, but never blocks the erasure itself. Any later
  //     call (a retry after step 4 fails) runs them again.
  const purged: Record<string, number | null> = {};
  for (const { table, column } of ERASED_ROWS) {
    const { count, error: purgeErr } = await supa
      .from(table)
      .delete({ count: 'exact' })
      .eq(column, user.id);
    purged[table] = purgeErr ? null : count ?? 0;
    if (purgeErr) {
      console.error('anonymize: delete failed — erasure continues', {
        user_id: user.id.slice(0, 8),
        table,
        code: purgeErr.code,
      });
    }
  }

  // 3. Audit row — first transition only, so retries never duplicate it. The
  //    PII is already nulled; if the audit insert fails we still proceed (the
  //    anonymized_at timestamp is the recoverable evidence) but log loud.
  if (transitioned) {
    const { error: auditErr } = await supa.from('admin_actions').insert({
      admin_user_id: user.id,
      action_type: 'anonymize_user',
      target_type: 'user',
      target_id: user.id,
      reason: 'Self-service account deletion (GDPR erasure)',
      payload: { method: 'self_service', anonymized_at: nowIso, apple_revoke: appleRevoke, purged },
    });
    if (auditErr) {
      console.error('anonymize: admin_actions insert failed — manual audit required', {
        user_id: user.id,
        err: auditErr,
      });
    }
  }

  // 4. Scrub the auth identity + block login (idempotent soft-delete). If this
  //    fails the profile is anonymized but auth PII (phone) remains — bounce
  //    500 so the client retries; the retry re-runs this step and heals.
  const { error: softDeleteErr } = await supa.auth.admin.deleteUser(user.id, true);
  if (softDeleteErr) {
    console.error('anonymize: auth soft-delete failed — retry to heal', {
      user_id: user.id,
      err: softDeleteErr.message,
    });
    return errorResponse('INTERNAL_ERROR', 'Failed to scrub auth identity', 500);
  }

  // 5. What stays booked. Only app bookings: a walk-in or a standing
  //    booking carries the owner's user_id but is the venue's, not theirs.
  const { data: upcomingRows, error: upcomingErr } = await supa
    .from('bookings')
    .select('id, code, starts_at, state, pitch:pitches(venue:venues(name))')
    .eq('user_id', user.id)
    .eq('origin', 'app')
    .in('state', [...UPCOMING_BOOKING_STATES])
    .gt('starts_at', nowIso)
    .order('starts_at')
    .limit(50);
  if (upcomingErr) {
    console.error('anonymize: upcoming bookings lookup failed', {
      user_id: user.id.slice(0, 8),
      code: upcomingErr.code,
    });
  }

  return jsonResponse(
    {
      anonymized: true,
      already_anonymized: !transitioned,
      apple_revoke: appleRevoke,
      upcoming_bookings: upcomingErr ? null : upcomingBookingsFrom(upcomingRows),
    },
    200,
  );
}));
