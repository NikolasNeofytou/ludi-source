// recording/index.ts
// POST /recording — watching, and deleting, the recording of a game
// (ADR-0042). The caller's JWT decides everything; the service role only
// signs the URL and removes the file.
//
//   { action: 'url', booking_id }              a player in on the booking
//       → 200 { recording_id, url, expires_in }    (an hour)
//   { action: 'staff_url', recording_id, reason }  Ludi staff, for support;
//       the read is written to recording_access → 200 { url, expires_in }
//   { action: 'delete', recording_id }         the organiser, after the
//       game → the file is removed → 200 { deleted, purged }
//
// Who may is decided in recording_for_viewer / recording_staff_read /
// recording_delete, called as the caller (createCallerClient), where
// pgtap sees it.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { getUserFromRequest } from '../_shared/auth.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/errors.ts';
import { createCallerClient, createServiceClient } from '../_shared/supabase.ts';
import { BUCKET, publicUrl, recError, RecordingInput, STAFF_TTL_S, VIEW_TTL_S } from '../_shared/recording.ts';

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);

  const user = await getUserFromRequest(req);
  if (!user) return errorResponse('UNAUTHORIZED', 'Missing or invalid token', 401);
  const jwt = req.headers.get('Authorization')!.slice(7).trim();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }
  const parsed = RecordingInput.safeParse(raw);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, { issues: parsed.error.issues });
  }

  const caller = createCallerClient(jwt);
  const supa = createServiceClient();
  const input = parsed.data;
  const refused = (message: string) => {
    const mapped = recError(message);
    if (mapped) return errorResponse(mapped.code, 'Refused', mapped.status);
    throw new Error(`recording: ${message}`);
  };
  const sign = async (key: string, ttl: number) => {
    const { data, error } = await supa.storage.from(BUCKET).createSignedUrl(key, ttl);
    if (error || !data) return null;
    return publicUrl(data.signedUrl, Deno.env.get('SUPABASE_URL')!, Deno.env.get('LUDI_PUBLIC_URL'));
  };

  if (input.action === 'url') {
    const { data, error } = await caller.rpc('recording_for_viewer', { p_booking_id: input.booking_id });
    if (error) return refused(error.message);
    const row = (data as Array<{ recording_id: string; storage_key: string }>)[0];
    const url = await sign(row.storage_key, VIEW_TTL_S);
    if (!url) return errorResponse('STORAGE_ERROR', 'Could not sign the recording', 502);
    return jsonResponse({ recording_id: row.recording_id, url, expires_in: VIEW_TTL_S }, 200);
  }

  if (input.action === 'staff_url') {
    const { data: key, error } = await caller.rpc('recording_staff_read', {
      p_recording_id: input.recording_id,
      p_reason: input.reason,
    });
    if (error) return refused(error.message);
    const url = await sign(key as string, STAFF_TTL_S);
    if (!url) return errorResponse('STORAGE_ERROR', 'Could not sign the recording', 502);
    return jsonResponse({ url, expires_in: STAFF_TTL_S }, 200);
  }

  const { data: key, error } = await caller.rpc('recording_delete', { p_recording_id: input.recording_id });
  if (error) return refused(error.message);
  let purged = false;
  if (key) {
    const { error: rmErr } = await supa.storage.from(BUCKET).remove([key as string]);
    if (!rmErr) {
      await supa.rpc('recording_purged', { p_recording_id: input.recording_id });
      purged = true;
    } else {
      // The row already says deleted; the daily sweep removes the file.
      console.error(JSON.stringify({ level: 'error', event: 'recording_remove_failed', message: rmErr.message }));
    }
  }
  return jsonResponse({ deleted: true, purged }, 200);
}));
