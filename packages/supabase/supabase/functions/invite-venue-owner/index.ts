// invite-venue-owner/index.ts
// POST /invite-venue-owner — a venue gains a person.
//
// Two callers, since slice C of plans/venue-staff.md (2026-09-17):
//   * a platform admin, provisioning a venue OWNER (ADR-0024) — the
//     original reason this function exists;
//   * a venue's own owner, adding a MANAGER to that venue — his staff,
//     his business, no founder in the loop.
//
// "Only an owner grants, and an owner grants only a manager." An owner
// minting another owner is the one thing that is not his to do: an owner
// is the venue's signatory, reaches the venue's money surface
// (venue-connect-onboard / venue-express-login), and can revoke everyone
// else including whoever granted them. Handing a venue over stays a
// founder act with a human on the call.
//
// This function exists because of a specific consequence: closing signup on
// prod removed the step the old flow depended on. Owners used to create
// their own account by signing in once, and the founder then granted it.
// With signup closed that first step fails, so the account has to be created
// FOR them — which needs the service-role key the admin app deliberately does
// not hold (ADR-0019). Hence an Edge Function: the privileged act lives here,
// the admin app keeps only its own JWT.
//
// It does the whole provisioning step, not half of it: invite (or find) the
// account, and grant venue access, in one call. Two half-done states — an
// invited account nobody granted, a grant pointing at nothing — are exactly
// what a founder should never have to reason about mid-handover.
//
// Control flow:
//   CORS preflight
//   → JWT                                 (401)
//   → Zod-validate body                   (400)
//   → authorise against THAT venue        (403)
//       admin → any role
//       owner of this venue → 'manager' only, under a people cap and a
//       daily invite cap (429 RATE_LIMITED)
//       anyone else → NOT_AUTHORIZED
//   → venue exists                        (404 VENUE_NOT_FOUND)
//   → find account by email
//       exists    → skip the invite, grant only
//       new       → phone-only owner already on this venue and the caller
//                   did not set confirm_new_person? refuse
//                   (409 POSSIBLE_DUPLICATE) — email-inviting the same
//                   human who signed in by phone would mint a second
//                   account nothing can merge
//                 → auth.admin.inviteUserByEmail (sends the email)
//   → INSERT venue_owners                 (409 if already granted)
//       an owner's grant starts pending (accepted_at NULL): the venue
//       sees only the address it typed until the person opens the venue
//       in the dashboard (20261020000101)
//       fails after a fresh invite → delete the just-created account, so
//       the promise above ("no half-done states") survives the failure;
//       if even the delete fails, a retry self-heals — the lookup finds
//       the orphan account and takes the grant-only path
//   → audit row → 200

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { getUserFromRequest } from '../_shared/auth.ts';
import {
  errorResponse,
  jsonResponse,
  preflightResponse,
} from '../_shared/errors.ts';
import { InviteOwnerInput } from '../_shared/schemas/invite-owner.ts';
import { createCallerClient, createServiceClient } from '../_shared/supabase.ts';

const PG_UNIQUE_VIOLATION = '23505';

// How many people one venue's own owner may put on it. Not a product
// limit — a brake on the only thing this endpoint could be abused for.
// An owner can cause Ludi to email an arbitrary address and mint an
// account behind it; every real venue seen so far has one to four
// people, so a dozen is generous and a hundred is somebody else's spam
// run. An admin is not capped: handovers and multi-signatory venues are
// exactly the case a cap would get in the way of.
const OWNER_GRANT_CAP = 12;

// How many invites one owner may send in 24 hours. The people cap above
// counts current rows, so on its own it allows invite → remove → invite
// without end; this counts the audit log instead, which removal does not
// touch. A venue hiring a whole shift on one day still fits.
const OWNER_INVITES_PER_DAY = 5;

// Where the invite link lands. Deliberately NOT taken from the request:
// an attacker-supplied redirect in an email we send is an open-redirect with
// our name on it. Supabase also checks its own allowlist, but that is the
// second line, not the first.
function adminSiteUrl(): string | null {
  const raw = Deno.env.get('ADMIN_SITE_URL');
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
  }

  // 1. Auth — who is calling. WHAT they may do is decided in step 3,
  //    against the venue in the body, which is why the body is parsed
  //    first now. A caller with a valid token and a malformed body gets
  //    400 where they used to get 403; nothing else moved.
  const user = await getUserFromRequest(req);
  if (!user) return errorResponse('UNAUTHORIZED', 'Missing or invalid token', 401);

  // Kept for the caller-scoped lookups below. getUserFromRequest has already
  // proven this token is valid and whose it is.
  const accessToken = (req.headers.get('Authorization') ?? '').slice(7).trim();

  const supa = createServiceClient();

  // 2. Body.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }
  const parsed = InviteOwnerInput.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, {
      issues: parsed.error.issues,
    });
  }
  const input = parsed.data;

  // 3. Authorisation, against THIS venue.
  const { data: callerRow, error: callerErr } = await supa
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (callerErr) {
    console.error('caller role lookup failed', callerErr);
    return errorResponse('DB_ERROR', 'Failed to verify role', 500);
  }

  let mode: 'admin' | 'owner';
  if (callerRow?.role === 'admin') {
    mode = 'admin';
  } else {
    // Read with the service key, not through RLS: venue_owners is
    // self-read only, which would answer this question correctly today
    // but for the wrong reason. Ask the table what it says.
    const { data: membership, error: memberErr } = await supa
      .from('venue_owners')
      .select('role')
      .eq('venue_id', input.venue_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memberErr) {
      console.error('venue membership lookup failed', memberErr);
      return errorResponse('DB_ERROR', 'Failed to verify venue access', 500);
    }
    if (membership?.role !== 'owner') {
      return errorResponse(
        'NOT_AUTHORIZED',
        'Only this venue’s owner can add someone to it.',
        403,
      );
    }
    mode = 'owner';

    // An owner grants a manager, never another owner. See the header.
    if (input.owner_role !== 'manager') {
      return errorResponse(
        'OWNER_ROLE_NOT_YOURS',
        'You can add staff to your venue. Making someone an owner — who ' +
          'reaches the venue’s bank details and can remove you — stays with ' +
          'Ludi: email us and we’ll do it with you on the phone.',
        403,
      );
    }

    const { count, error: countErr } = await supa
      .from('venue_owners')
      .select('user_id', { count: 'exact', head: true })
      .eq('venue_id', input.venue_id);
    if (countErr) {
      console.error('venue people count failed', countErr);
      return errorResponse('DB_ERROR', 'Failed to count venue access', 500);
    }
    if ((count ?? 0) >= OWNER_GRANT_CAP) {
      return errorResponse(
        'GRANT_CAP_REACHED',
        `This venue already has ${count} people with access, which is as ` +
          'many as you can add yourself. Remove someone who has left, or ' +
          'email Ludi if you really need more.',
        409,
      );
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recent, error: recentErr } = await supa
      .from('admin_actions')
      .select('admin_user_id', { count: 'exact', head: true })
      .eq('admin_user_id', user.id)
      .eq('action_type', 'invite_owner')
      .gte('created_at', since);
    if (recentErr) {
      console.error('invite rate count failed', { code: recentErr.code });
      return errorResponse('DB_ERROR', 'Failed to check recent invites', 500);
    }
    if ((recent ?? 0) >= OWNER_INVITES_PER_DAY) {
      return errorResponse(
        'RATE_LIMITED',
        `You have added ${recent} people in the last day, which is as many ` +
          'as you can add yourself. Try again tomorrow, or email Ludi.',
        429,
      );
    }
  }

  const siteUrl = adminSiteUrl();
  if (!siteUrl) {
    // Fail loudly rather than sending an invite whose link goes nowhere —
    // a broken invite is worse than a refused one, because the founder
    // finds out from the owner, on the call.
    console.error('ADMIN_SITE_URL is not set');
    return errorResponse(
      'INTERNAL_ERROR',
      'Invite is not configured yet (ADMIN_SITE_URL missing). Tell Ludi.',
      500,
    );
  }

  // 4. The venue has to exist — a typo'd uuid should not send an email.
  const { data: venue, error: venueErr } = await supa
    .from('venues')
    .select('id, name')
    .eq('id', input.venue_id)
    .maybeSingle();
  if (venueErr) {
    console.error('venue lookup failed', venueErr);
    return errorResponse('DB_ERROR', 'Failed to load venue', 500);
  }
  if (!venue) return errorResponse('VENUE_NOT_FOUND', 'No such venue', 404);

  // 5. Does an account already exist for this address?
  //
  //    Re-inviting an existing user would either error or reset their
  //    state depending on GoTrue version; neither is what the founder
  //    means. "Add my second manager, who already has a Ludi account" and
  //    "invite someone new" are the same click, and this is where they
  //    diverge.
  //
  //    PostgREST does not expose the `auth` schema, so this goes through
  //    account_id_for_email (20261020000101): SECURITY DEFINER, answering
  //    service-role requests only, returning an id and nothing else. The
  //    authorisation is step 3 above; no client can ask it directly. It
  //    replaced the owner-callable venue_invite_lookup, which returned the
  //    account's name.
  const { data: existingId, error: findErr } = await supa.rpc('account_id_for_email', {
    p_email: input.email,
  });
  if (findErr) {
    console.error('auth user lookup failed', { code: findErr.code });
    return errorResponse('DB_ERROR', 'Failed to look up the account', 500);
  }

  let userId: string;
  let invited = false;

  if (typeof existingId === 'string' && existingId) {
    userId = existingId;
  } else {
    // 4b. No account under this email — but the venue may already have an
    //     owner who signs in by phone and never had an email attached (the
    //     pre-ADR-0024 pattern). If that person IS the invitee, sending
    //     this invite creates a second account for the same human: two
    //     grants, two member records, and no way to merge them later.
    //     Refuse until the founder asserts it's a different person.
    //     venue_people (20260917000004) is the owner's version of the
    //     same list, and returns the same columns for the same reason.
    //     Both are called as THE CALLER: their gates read auth.uid() from
    //     the JWT, which the service key does not carry.
    const caller = createCallerClient(accessToken);
    const { data: ownerRows, error: ownersErr } = mode === 'admin'
      ? await caller.rpc('admin_list_venue_owners', { p_venue_id: input.venue_id })
      : await caller.rpc('venue_people', { p_venue_id: input.venue_id });
    if (ownersErr) {
      console.error('venue owners lookup failed', ownersErr);
      return errorResponse('DB_ERROR', 'Failed to check existing owners', 500);
    }
    const phoneOnly = (
      (ownerRows as Array<{
        first_name: string;
        last_name: string;
        phone: string | null;
        email: string | null;
      }> | null) ?? []
    ).filter((o) => !o.email && o.phone);
    if (phoneOnly.length > 0 && !input.confirm_new_person) {
      const who = phoneOnly
        .map((o) => {
          const name = `${o.first_name} ${o.last_name}`.trim();
          return name ? `${name} (+${o.phone})` : `+${o.phone}`;
        })
        .join(', ');
      return errorResponse(
        'POSSIBLE_DUPLICATE',
        `${venue.name} already has an owner who signs in by phone: ${who}. ` +
          `If that is the same person, do not invite — emailing them mints a ` +
          `second, separate account. If this really is someone new, confirm ` +
          `and resend.`,
        409,
        { phone_only_owners: phoneOnly },
      );
    }

    const { data: invite, error: inviteErr } = await supa.auth.admin
      .inviteUserByEmail(input.email, {
        redirectTo: `${siteUrl}/auth/callback`,
        data: {
          first_name: input.first_name ?? '',
          last_name: input.last_name ?? '',
          preferred_locale: input.preferred_locale,
          // Carried so the invite email can name the venue. A stock
          // "you've been invited to create an account" reads as spam to
          // Gmail — and to a human. `{{ .Data.venue_name }}` in the
          // dashboard template is what makes it a real message.
          venue_name: venue.name,
        },
      });
    if (inviteErr || !invite?.user) {
      console.error('inviteUserByEmail failed', {
        status: inviteErr?.status,
        code: (inviteErr as { code?: string } | null)?.code,
      });
      // The overwhelmingly common cause here is SMTP: a project still on
      // Supabase's built-in mailer is rate-limited to a handful an hour.
      // The server log has the status; the caller gets a sentence.
      return errorResponse(
        'INTERNAL_ERROR',
        'Could not send the invite just now. Try again in a few minutes, ' +
          'or tell Ludi if it keeps failing.',
        502,
      );
    }
    userId = invite.user.id;
    invited = true;
  }

  // 6. Grant. The signup trigger has already created the public.users row
  //    by the time the invite returns, so the FK is satisfied.
  //
  //    An owner's grant starts pending: the venue sees the address it typed
  //    and the role, not the person's own details, until the person opens
  //    the venue in the dashboard (accept_venue_access). A founder's grant
  //    is made with the person on the call and is accepted on insert.
  const { error: grantErr } = await supa.from('venue_owners').insert({
    venue_id: input.venue_id,
    user_id: userId,
    role: input.owner_role,
    invited_email: input.email,
    ...(mode === 'owner' ? { accepted_at: null } : {}),
  });
  if (grantErr) {
    if (grantErr.code === PG_UNIQUE_VIOLATION) {
      return errorResponse(
        'ALREADY_GRANTED',
        `${input.email} already has access to ${venue.name}.`,
        409,
      );
    }
    console.error('venue_owners insert failed', { code: grantErr.code });
    // The header promises no half-done states, so a failed grant after a
    // fresh invite must take the account with it — otherwise the owner
    // holds a real sign-in link that lands on "No access yet". The email
    // is already sent either way; deleting the account voids its link, and
    // the founder's retry mints a fresh, working one.
    if (invited) {
      const { error: rollbackErr } = await supa.auth.admin.deleteUser(userId);
      if (rollbackErr) {
        // Worst case, and still recoverable: the orphan account survives,
        // and re-running the invite finds it by email and takes the
        // grant-only path. Say exactly that instead of a generic 500.
        console.error('invite rollback failed', rollbackErr);
        return errorResponse(
          'DB_ERROR',
          'Access grant failed and the invited account could not be ' +
            'removed. Re-run the invite: it will find the account and ' +
            'retry just the grant.',
          500,
        );
      }
      return errorResponse(
        'DB_ERROR',
        'Access grant failed; the invite was rolled back and nothing was ' +
          'created. Try again.',
        500,
      );
    }
    return errorResponse('DB_ERROR', 'Access grant failed', 500);
  }

  // 7. Audit. Service-role insert, so admin_actions_owner_insert's
  //    narrower vocabulary does not apply and 'invite_owner'
  //    (20260829000002) covers both callers. `by` says which one, the
  //    same way revoke_venue_person's payload does — one query over
  //    payload->>'by' answers "what did this venue do to its own access".
  const { error: auditErr } = await supa.from('admin_actions').insert({
    admin_user_id: user.id,
    action_type: 'invite_owner',
    target_type: 'venue',
    target_id: input.venue_id,
    reason: `${mode === 'owner' ? 'owner ' : ''}${invited ? 'invited' : 'granted'} ${input.email} as ${input.owner_role} of ${venue.name}`,
    payload: {
      email: input.email,
      user_id: userId,
      owner_role: input.owner_role,
      invited,
      by: mode,
    },
  });
  if (auditErr) console.error('invite audit insert failed', auditErr);

  return jsonResponse(
    {
      owner: { user_id: userId, email: input.email, owner_role: input.owner_role },
      // The caller renders two different sentences off this: a new person
      // needs to be told an email is coming, an existing one does not.
      invited,
    },
    200,
  );
}));
