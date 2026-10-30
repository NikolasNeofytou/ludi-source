// recordings-sweep/index.ts
// POST /recordings-sweep — the thirty-day rule (ADR-0042).
//
// Invoked daily by pg_cron + pg_net (ludi-recordings-sweep), authenticated
// by a shared secret header, not a Supabase JWT — the expire-collecting
// precedent. recordings_to_purge fails recordings stuck short of ready six
// hours after their game, then lists what goes: past thirty days, or
// deleted by the organiser but not yet removed. Each file is removed, then
// its row stamped purged; a file that will not go is retried tomorrow.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/errors.ts';
import { secretMatches } from '../_shared/secrets.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { BUCKET } from '../_shared/recording.ts';

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);

  const secret = Deno.env.get('RECORDINGS_SWEEP_SECRET');
  if (!secret) {
    console.error('RECORDINGS_SWEEP_SECRET is not set');
    return errorResponse('INTERNAL_ERROR', 'Sweep is not configured', 500);
  }
  if (!secretMatches(req.headers.get('x-sweep-secret'), secret)) {
    return errorResponse('UNAUTHORIZED', 'Bad sweep secret', 401);
  }

  const supa = createServiceClient();
  const { data, error } = await supa.rpc('recordings_to_purge');
  if (error) throw new Error(`recordings_to_purge failed: ${error.message}`);

  const counts = { purged: 0, errors: 0 };
  for (const row of (data ?? []) as Array<{ recording_id: string; storage_key: string | null }>) {
    if (row.storage_key) {
      const { error: rmErr } = await supa.storage.from(BUCKET).remove([row.storage_key]);
      if (rmErr) {
        console.error(JSON.stringify({ level: 'error', event: 'sweep_remove_failed', id: row.recording_id }));
        counts.errors++;
        continue;
      }
    }
    const { error: markErr } = await supa.rpc('recording_purged', { p_recording_id: row.recording_id });
    if (markErr) counts.errors++;
    else counts.purged++;
  }
  return jsonResponse(counts, 200);
}));
