import type { SupabaseClient } from '@supabase/supabase-js';

import type { Viewer } from '@/lib/auth';

// Audit rows for the write actions (M6 #41i).
//
// Inserts run under the CALLER's JWT, so RLS decides who may audit what:
// admins pass admin_actions_admin_insert for any action_type, owners pass
// admin_actions_owner_insert only for the owner vocabulary below and only
// on venues/pitches they own. The action has already validated ownership
// before it writes, so a 42501 here is a bug, not a user error.
//
// Audit failure is logged, never surfaced: the user's write has already
// succeeded, and un-saving it because the log hiccuped would be worse than
// a gap in the trail. (Same posture as owner-actions.ts.)

type AuditRow = {
  action_type:
    | 'create_venue'
    | 'update_venue'
    | 'create_pitch'
    | 'update_pitch'
    | 'schedule_change'
    | 'override_change'
    // admin only — the owner-insert policy's list does not carry it
    | 'enable_city';
  target_type: 'venue' | 'pitch' | 'city';
  target_id: string;
  reason: string;
  payload?: Record<string, unknown>;
};

export async function audit(
  supabase: SupabaseClient,
  viewer: Viewer,
  row: AuditRow,
): Promise<void> {
  const { error } = await supabase.from('admin_actions').insert({
    admin_user_id: viewer.user.id,
    action_type: row.action_type,
    target_type: row.target_type,
    target_id: row.target_id,
    reason: row.reason,
    payload: row.payload ?? {},
  });
  if (error) {
    console.error(`audit insert failed (${row.action_type}):`, error.message);
  }
}
