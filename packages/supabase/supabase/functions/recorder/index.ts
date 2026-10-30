// recorder/index.ts
// POST /recorder — the court recorder on site talks to Ludi (ADR-0042).
//
// Authenticated by the camera's device token (x-camera-token), not a
// Supabase JWT: the box at the venue is not a user. The token's SHA-256 is
// what the database knows; camera_register showed the token once.
//
//   { action: 'sync' }  → the heartbeat; arms consented bookings starting
//                         within two hours; 200 { recordings: [...] }
//   { action: 'mark', recording_id, state, bytes?, duration_s?, failure? }
//       recording   the booking has started and the camera is running
//       processing  the game is over; 200 also carries a signed upload
//                   for the file (path + token; the recorder PUTs to its
//                   own base URL)
//       ready       the file is uploaded
//       failed      anything short of ready
//
// The rules (never outside the booking, never without consent, the state
// machine) live in recorder_sync / recorder_mark, where pgtap sees them.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/errors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { BUCKET, hashToken, RecorderInput, recError } from '../_shared/recording.ts';

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);

  const token = req.headers.get('x-camera-token')?.trim();
  if (!token) return errorResponse('UNAUTHORIZED', 'Missing camera token', 401);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }
  const parsed = RecorderInput.safeParse(raw);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, { issues: parsed.error.issues });
  }

  const supa = createServiceClient();
  const tokenHash = await hashToken(token);
  const input = parsed.data;

  if (input.action === 'sync') {
    const { data, error } = await supa.rpc('recorder_sync', { p_token_hash: tokenHash });
    if (error) {
      const mapped = recError(error.message);
      if (mapped) return errorResponse(mapped.code, 'Refused', mapped.status);
      throw new Error(`recorder_sync failed: ${error.message}`);
    }
    return jsonResponse({ now: new Date().toISOString(), recordings: data ?? [] }, 200);
  }

  const { data: key, error } = await supa.rpc('recorder_mark', {
    p_token_hash: tokenHash,
    p_recording_id: input.recording_id,
    p_state: input.state,
    p_bytes: input.bytes ?? null,
    p_duration_s: input.duration_s ?? null,
    p_failure: input.failure ?? null,
  });
  if (error) {
    const mapped = recError(error.message);
    if (mapped) return errorResponse(mapped.code, 'Refused', mapped.status);
    throw new Error(`recorder_mark failed: ${error.message}`);
  }

  if (input.state !== 'processing') return jsonResponse({ state: input.state }, 200);

  const { data: upload, error: upErr } = await supa.storage
    .from(BUCKET)
    .createSignedUploadUrl(key as string, { upsert: true });
  if (upErr || !upload) {
    console.error(JSON.stringify({ level: 'error', event: 'recorder_upload_url_failed', message: upErr?.message }));
    return errorResponse('STORAGE_ERROR', 'Could not prepare the upload', 502);
  }
  return jsonResponse({
    state: 'processing',
    storage_key: key,
    upload: { bucket: BUCKET, path: upload.path, token: upload.token },
  }, 200);
}));
