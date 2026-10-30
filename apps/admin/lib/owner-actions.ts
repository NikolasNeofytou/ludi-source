'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth';
import { OwnerGrant, OwnerRevoke, type FormState } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

// Granting and revoking venue-owner access — the founder-side half of the
// promise /locked makes ("get in touch and we'll add you").
//
// Same rule as lib/actions.ts: these run under the CALLER's cookies, so the
// writes land through `venue_owners_admin_write` RLS, not around it. The
// only privileged step is the read — resolving a phone number to an
// account — which goes through admin_lookup_user_by_phone, a SECURITY
// DEFINER function whose entire body is gated on is_admin(). No
// service-role key, per ADR-0019.
//
// There is deliberately no "create the account here" path — that would
// mean holding the service-role key this app must not have. Since
// ADR-0024 closed signup (disable_signup + shouldCreateUser: false),
// typing a number into /login no longer creates anything either: the
// phone grant only works for accounts that already exist. New people are
// onboarded through the email invite (invite-venue-owner), and the grant
// form points there when the number is unknown.

type LookupRow = {
  user_id: string;
  first_name: string;
  last_name: string;
  phone: string;
};

function displayName(row: LookupRow): string {
  const name = `${row.first_name} ${row.last_name}`.trim();
  return name || `+${row.phone}`;
}

export async function grantOwnerAccess(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireAdmin();

  const parsed = OwnerGrant.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }
  const { venue_id, phone, owner_role } = parsed.data;

  const supabase = await createClient();
  const { data: matches, error: lookupError } = await supabase.rpc(
    'admin_lookup_user_by_phone',
    { p_phone: phone },
  );
  if (lookupError) {
    return { status: 'error', message: lookupError.message };
  }

  const account = (matches as LookupRow[] | null)?.[0];
  if (!account) {
    return {
      status: 'error',
      message:
        `No Ludi account uses ${phone}. Sign-up is closed, so entering a ` +
        'number cannot create one any more — use “Invite by email” above ' +
        'instead; it creates the account and grants access in one step.',
      fieldErrors: { phone: ['No account with this number'] },
    };
  }

  const { error } = await supabase.from('venue_owners').insert({
    venue_id,
    user_id: account.user_id,
    role: owner_role,
  });
  if (error) {
    if (error.code === '23505') {
      return {
        status: 'error',
        message: `${displayName(account)} already has access to this venue.`,
      };
    }
    return { status: 'error', message: error.message };
  }

  // Audit row. action_type 'other' because the CHECK list predates this
  // surface; the payload carries the specifics. Failure here should not
  // roll back a grant that already happened — log and move on.
  const { error: auditError } = await supabase.from('admin_actions').insert({
    admin_user_id: viewer.user.id,
    action_type: 'other',
    target_type: 'venue',
    target_id: venue_id,
    reason: `grant venue access (${owner_role}) to +${account.phone}`,
    payload: { kind: 'grant_owner_access', user_id: account.user_id, owner_role },
  });
  if (auditError) {
    console.error('grantOwnerAccess: audit insert failed:', auditError.message);
  }

  revalidatePath(`/venues/${venue_id}/edit`);
  return {
    status: 'success',
    message: `${displayName(account)} can now manage this venue.`,
  };
}

export async function revokeOwnerAccess(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireAdmin();

  const parsed = OwnerRevoke.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: 'Malformed revoke request.' };
  }
  const { venue_id, user_id } = parsed.data;

  const supabase = await createClient();
  // .select() so a delete RLS filtered down to nothing is visible as
  // "nothing was removed" instead of a silent success.
  const { data, error } = await supabase
    .from('venue_owners')
    .delete()
    .eq('venue_id', venue_id)
    .eq('user_id', user_id)
    .select('user_id');
  if (error) {
    return { status: 'error', message: error.message };
  }
  if (!data?.length) {
    return { status: 'error', message: 'That access grant no longer exists.' };
  }

  const { error: auditError } = await supabase.from('admin_actions').insert({
    admin_user_id: viewer.user.id,
    action_type: 'other',
    target_type: 'venue',
    target_id: venue_id,
    reason: 'revoke venue access',
    payload: { kind: 'revoke_owner_access', user_id },
  });
  if (auditError) {
    console.error('revokeOwnerAccess: audit insert failed:', auditError.message);
  }

  revalidatePath(`/venues/${venue_id}/edit`);
  return { status: 'success', message: 'Access removed.' };
}
