// admin-toggle-pitch/index.ts
// POST /admin-toggle-pitch — staff verify / activate / deactivate of a pitch.
//
// Contract: docs/api-contract.md §7.2.
//
// Why an Edge Function rather than a direct supabase.update + client-side
// admin_actions insert: pitches RLS already lets admins update directly, but
// a client-driven flow can skip the audit row (network failure between the
// two requests, or a hostile client refusing to write the audit). Wrapping
// both in one server flow makes the audit log a guarantee, not a courtesy —
// same reasoning as admin-refund-booking.
//
// Idempotency-Key is OPTIONAL (unlike admin-refund-booking which makes it
// required). Toggling a pitch is a state-converging boolean: a duplicate
// "verify" on an already-verified pitch returns 409 INVALID_PITCH_TRANSITION
// rather than a second audit row, so the duplicate-click failure mode is
// "loud noop" rather than "double charge". The header is still honored when
// supplied — useful for the admin UI to dedupe the same modal submit across
// retries — but a missing header doesn't get rejected.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { getUserFromRequest } from '../_shared/auth.ts';
import { corsHeaders, errorResponse, jsonResponse, preflightResponse } from '../_shared/errors.ts';
import {
  canonicalJson,
  IdempotencyMismatch,
  lookupIdempotentResponse,
  readIdempotencyKey,
  sha256Hex,
  storeIdempotentResponse,
} from '../_shared/idempotency.ts';
import {
  AdminTogglePitchInput,
  type PitchToggleAction,
} from '../_shared/schemas/admin-toggle-pitch.ts';
import { createServiceClient } from '../_shared/supabase.ts';

const ACTION_TO_TYPE: Record<PitchToggleAction, string> = {
  verify: 'verify_pitch',
  activate: 'activate_pitch',
  deactivate: 'deactivate_pitch',
};

interface PitchRow {
  id: string;
  is_verified: boolean;
  is_active: boolean;
  venue_id: string;
  venue: { stripe_account_status: string };
}

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
  }

  // 1. Auth.
  const user = await getUserFromRequest(req);
  if (!user) return errorResponse('UNAUTHORIZED', 'Missing or invalid token', 401);

  const supa = createServiceClient();

  const { data: callerRow, error: callerErr } = await supa
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (callerErr) {
    console.error('admin role lookup failed', callerErr);
    return errorResponse('DB_ERROR', 'Failed to verify role', 500);
  }
  if (callerRow?.role !== 'admin') {
    return errorResponse('NOT_AUTHORIZED', 'Admin role required', 403);
  }

  // 2. Parse + validate body.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }
  const parsed = AdminTogglePitchInput.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, {
      issues: parsed.error.issues,
    });
  }
  const input = parsed.data;

  // 3. Idempotency — optional. See file header for rationale.
  let idempotencyKey: string | null;
  try {
    idempotencyKey = readIdempotencyKey(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid Idempotency-Key';
    return errorResponse('VALIDATION_FAILED', message, 400);
  }
  const requestHash = idempotencyKey ? await sha256Hex(canonicalJson(input)) : null;

  if (idempotencyKey && requestHash) {
    try {
      const cached = await lookupIdempotentResponse(
        supa,
        idempotencyKey,
        user.id,
        requestHash,
      );
      if (cached) {
        return new Response(JSON.stringify(cached.body), {
          status: cached.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    } catch (err) {
      if (err instanceof IdempotencyMismatch) {
        return errorResponse('IDEMPOTENCY_MISMATCH', err.message, 409);
      }
      console.error('idempotency lookup error', err);
      return errorResponse('INTERNAL_ERROR', 'Idempotency lookup failed', 500);
    }
  }

  // 4. Load pitch + parent venue stripe status.
  const { data: pitchRaw, error: pitchErr } = await supa
    .from('pitches')
    .select('id, is_verified, is_active, venue_id, venue:venues!inner ( stripe_account_status )')
    .eq('id', input.pitch_id)
    .maybeSingle();
  if (pitchErr) {
    console.error('pitch lookup failed', pitchErr);
    return errorResponse('DB_ERROR', 'Failed to load pitch', 500);
  }
  if (!pitchRaw) return errorResponse('PITCH_NOT_FOUND', 'Pitch not found', 404);
  const pitch = pitchRaw as unknown as PitchRow;

  // 5. Transition guard. Each action is allowed only when the requested
  //    flag would actually change state. Verifying additionally requires
  //    the parent venue's Stripe account to be active — without this,
  //    tg_pitches_verify_guard would silently flip is_verified back to
  //    false and the operator would think it worked.
  let updatePatch: { is_verified?: boolean; is_active?: boolean };
  let priorCol: 'is_verified' | 'is_active';
  let priorValue: boolean;
  switch (input.action) {
    case 'verify':
      if (pitch.is_verified) {
        return errorResponse(
          'INVALID_PITCH_TRANSITION',
          'Pitch is already verified',
          409,
        );
      }
      if (pitch.venue.stripe_account_status !== 'active') {
        return errorResponse(
          'VENUE_NOT_ACTIVE_FOR_VERIFY',
          "Pitch's venue must have stripe_account_status='active' before verification",
          409,
        );
      }
      updatePatch = { is_verified: true };
      priorCol = 'is_verified';
      priorValue = false;
      break;
    case 'activate':
      if (pitch.is_active) {
        return errorResponse(
          'INVALID_PITCH_TRANSITION',
          'Pitch is already active',
          409,
        );
      }
      updatePatch = { is_active: true };
      priorCol = 'is_active';
      priorValue = false;
      break;
    case 'deactivate':
      if (!pitch.is_active) {
        return errorResponse(
          'INVALID_PITCH_TRANSITION',
          'Pitch is already inactive',
          409,
        );
      }
      updatePatch = { is_active: false };
      priorCol = 'is_active';
      priorValue = true;
      break;
  }

  // 6. Apply update. Scoping by the prior boolean turns a concurrent toggle
  //    into a no-op (zero rows updated) instead of two audit rows for the
  //    same final state.
  const { data: updated, error: uErr } = await supa
    .from('pitches')
    .update(updatePatch)
    .eq('id', pitch.id)
    .eq(priorCol, priorValue)
    .select('id, is_verified, is_active')
    .maybeSingle();
  if (uErr) {
    console.error('pitch update failed', uErr);
    return errorResponse('DB_ERROR', 'Failed to update pitch', 500);
  }
  if (!updated) {
    return errorResponse(
      'INVALID_PITCH_TRANSITION',
      'Pitch state changed concurrently; reload and try again',
      409,
    );
  }

  // 7. Audit row. The state change already landed — if this insert fails
  //    we still return 200 (the user-visible action succeeded) but log loud
  //    so manual reconciliation is possible from server logs.
  const auditPayload = {
    prior_is_verified: pitch.is_verified,
    prior_is_active: pitch.is_active,
    new_is_verified: updated.is_verified,
    new_is_active: updated.is_active,
    action: input.action,
    idempotency_key: idempotencyKey,
  };
  const { data: audit, error: auditErr } = await supa
    .from('admin_actions')
    .insert({
      admin_user_id: user.id,
      action_type: ACTION_TO_TYPE[input.action],
      target_type: 'pitch',
      target_id: pitch.id,
      reason: input.reason,
      payload: auditPayload,
    })
    .select('id')
    .single();
  if (auditErr || !audit) {
    console.error('admin_actions insert failed — manual reconciliation required', {
      pitch_id: pitch.id,
      admin_user_id: user.id,
      action: input.action,
      err: auditErr,
    });
  }

  const responseBody = {
    pitch: {
      id: updated.id,
      is_verified: updated.is_verified,
      is_active: updated.is_active,
    },
    admin_action_id: audit?.id ?? null,
  };
  if (idempotencyKey && requestHash) {
    await storeIdempotentResponse(
      supa,
      idempotencyKey,
      user.id,
      requestHash,
      200,
      responseBody,
    );
  }
  return jsonResponse(responseBody, 200);
}));
