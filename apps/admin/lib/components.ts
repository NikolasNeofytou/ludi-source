import type { SupabaseClient } from '@supabase/supabase-js';

import type { FormState } from '@/lib/schemas';
import { toFormError } from '@/lib/form-errors';

// What a composite pitch is made of (pitch_components, ADR-0032). Replace,
// not merge: the form always posts the whole set, and a composite with a
// half-edited member list is worse than a refused save. Two statements —
// delete then insert — under the caller's RLS; the database guard refuses
// another venue's courts, nesting, and self-reference.
export async function syncComponents(
  supabase: SupabaseClient,
  parentId: string,
  childIds: string[],
): Promise<FormState | null> {
  const { error: delError } = await supabase
    .from('pitch_components')
    .delete()
    .eq('parent_pitch_id', parentId);
  if (delError) return toFormError(delError);
  if (childIds.length === 0) return null;

  const { error } = await supabase
    .from('pitch_components')
    .insert(childIds.map((child_pitch_id) => ({ parent_pitch_id: parentId, child_pitch_id })));
  if (error) {
    if (error.code === '23514') {
      return {
        status: 'error',
        message:
          'A pitch can only be made of courts at its own venue, and a court ' +
          'that is itself made of others cannot be a member.',
      };
    }
    return toFormError(error);
  }
  return null;
}

export type LeafOption = { id: string; name: string; type: string };

// The courts a pitch may be made of: leaves at the same venue — not itself,
// not a composite. A composite cannot be a member (one level, ADR-0032).
export async function loadLeafOptions(
  supabase: SupabaseClient,
  venueId: string,
  excludeId?: string,
): Promise<LeafOption[]> {
  const [{ data: pitches }, { data: parents }] = await Promise.all([
    supabase.from('pitches').select('id, name, type').eq('venue_id', venueId).order('name'),
    supabase.from('pitch_components').select('parent_pitch_id'),
  ]);
  const parentIds = new Set((parents ?? []).map((p) => p.parent_pitch_id as string));
  return ((pitches ?? []) as LeafOption[]).filter(
    (p) => p.id !== excludeId && !parentIds.has(p.id),
  );
}

export async function loadComponents(
  supabase: SupabaseClient,
  parentId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('pitch_components')
    .select('child_pitch_id')
    .eq('parent_pitch_id', parentId);
  return (data ?? []).map((r) => r.child_pitch_id as string);
}
