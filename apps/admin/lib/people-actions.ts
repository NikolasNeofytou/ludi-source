'use server';

import { revalidatePath } from 'next/cache';

import { requireVenueAccess } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import { OwnerRevoke, type FormState } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

// Slice B of plans/venue-staff.md — the owner closes his own door.
//
// The founder-side twin lives in lib/owner-actions.ts and deletes the
// venue_owners row directly, because venue_owners_admin_write lets an
// admin session do that under plain RLS. An owner has no such policy and
// deliberately still does not: the delete goes through
// revoke_venue_person(), a SECURITY DEFINER function whose first
// statement is has_venue_role(venue, 'owner'). Same posture as every
// other owner write in this app (ADR-0019) — the server action is the
// affordance, the function is the gate.
//
// The function writes its own admin_actions row, unlike owner-actions.ts
// which writes one from here. It has to: admin_actions_owner_insert
// (20260828000002) allows owners only the venue/pitch/schedule
// vocabulary, and 'other' is not in it.
//
// Every message is in the account's language (ADR-0037) — an owner reads
// this page in Greek, and a refusal is exactly the moment to be plain.

export async function revokeVenuePerson(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale).access;

  const parsed = OwnerRevoke.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: t.malformed };
  }
  const { venue_id, user_id } = parsed.data;

  // Cheap local guard so a manager gets the honest sentence instead of a
  // raw 42501 from Postgres. Not the boundary — the function is.
  const mine = viewer.venues.find((v) => v.id === venue_id);
  if (mine?.role !== 'owner') {
    return { status: 'error', message: t.ownerOnly };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('revoke_venue_person', {
    p_venue_id: venue_id,
    p_user_id: user_id,
  });

  if (error) {
    // The three the function raises on purpose, in the owner's words.
    if (error.code === 'P0001') return { status: 'error', message: t.lastOwner };
    if (error.code === 'P0002') return { status: 'error', message: t.alreadyGone };
    if (error.code === '42501') return { status: 'error', message: t.ownerOnly };
    return { status: 'error', message: error.message };
  }

  revalidatePath('/access');
  return { status: 'success', message: t.removed };
}
