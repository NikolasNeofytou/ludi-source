-- 20260829000002_owner_access_email.sql
-- ADR-0024, stage 2: the owner-access surface learns about email.
--
-- Sign-in moves to an email magic link and accounts become invitations
-- rather than self-signups, so the founder's Owner-access card has to
-- answer two questions it currently cannot:
--   * what address was this person invited at?
--   * have they actually signed in yet, or is the invite still sitting
--     unopened in an inbox?
-- The second one matters on the day of a handover call. "Invited" and
-- "signed in" look identical today, and the difference is the whole call.
--
-- Additive: one CHECK widening, one function signature extended.

-- ────────────────────────────────────────────────────────────────────
-- 1. Audit vocabulary for the invite
-- ────────────────────────────────────────────────────────────────────
-- The invite Edge Function writes as service role (RLS bypassed), so only
-- the CHECK needs widening; 41i's owner INSERT policy vocabulary is
-- deliberately untouched — inviting is a platform act, never an owner one.
ALTER TABLE public.admin_actions
  DROP CONSTRAINT admin_actions_action_type_check;

ALTER TABLE public.admin_actions
  ADD CONSTRAINT admin_actions_action_type_check CHECK (action_type IN (
    'refund_booking','verify_pitch','deactivate_pitch','activate_pitch',
    'create_venue','deactivate_venue','anonymize_user','other',
    'update_venue','create_pitch','update_pitch',
    'schedule_change','override_change',
    'walk_in_created','walk_in_cancelled',
    'invite_owner'
  ));

-- ────────────────────────────────────────────────────────────────────
-- 2. Resolve an email to the account behind it
-- ────────────────────────────────────────────────────────────────────
-- The sibling of admin_lookup_user_by_phone (20260827000001), and it
-- exists for the same reason: the address lives only in `auth.users`,
-- which PostgREST does not expose, so no amount of client-side querying
-- reaches it. The invite Edge Function needs it to tell "invite a new
-- person" from "grant someone who already has a Ludi account".
--
-- Gated on is_admin(), exactly like its phone sibling — and deliberately
-- NOT on is_privileged_writer(), which would be worse than useless here.
-- Inside a SECURITY DEFINER body `current_user` is the function's OWNER,
-- so `current_user IN ('postgres', …)` is true for every caller. Proven on
-- the local stack 2026-08-29: a plain player evaluated as privileged
-- inside a definer function while evaluating as unprivileged outside it.
-- is_privileged_writer() is sound in the INVOKER trigger bodies it was
-- written for (20260822000003) and unsound the moment it is moved into a
-- definer. The pgtap negative case in tests/rls/14 pins this down.
--
-- Consequence for callers: is_admin() reads auth.uid() from the JWT, and
-- the service-role key carries no auth.uid(). The invite Edge Function
-- therefore calls this with the ADMIN CALLER's token (createCallerClient),
-- not the service key, and uses the service client only for the writes
-- that genuinely need to bypass RLS.
--
-- Case-insensitive by design: GoTrue stores addresses lowercased, humans
-- type them however they like, and "Ioannis@" silently matching nothing
-- while "ioannis@" matches is a cruel way to learn that.
CREATE OR REPLACE FUNCTION public.admin_lookup_user_by_email(p_email text)
RETURNS TABLE (
  user_id    uuid,
  first_name text,
  last_name  text,
  email      text,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_lookup_user_by_email: admin only'
      USING ERRCODE = '42501';
  END IF;

  v_email := lower(trim(coalesce(p_email, '')));
  IF v_email = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT au.id, pu.first_name, pu.last_name, au.email::text, au.created_at
  FROM auth.users au
  LEFT JOIN public.users pu ON pu.id = au.id
  WHERE lower(au.email::text) = v_email
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_lookup_user_by_email(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_lookup_user_by_email(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_lookup_user_by_email(text) IS
  'Admin-only: resolve an email to the auth account behind it, for the '
  'invite flow (ADR-0024). DEFINER because email lives only in '
  'auth.users, so the is_admin() gate inside IS the boundary. Callers '
  'must pass a real admin JWT — the service-role key has no auth.uid() '
  'and is refused.';

-- ────────────────────────────────────────────────────────────────────
-- 3. admin_list_venue_owners — email + whether the invite has landed
-- ────────────────────────────────────────────────────────────────────
-- Adds three columns. `email` because it is now the identifier people are
-- invited at; `last_sign_in_at` because it is the honest answer to "have
-- they got in yet"; `invited_at` so a pending invite can say how long it
-- has been pending rather than just that it is.
--
-- Return type changes, so the function must be dropped first — Postgres
-- will not CREATE OR REPLACE across a different OUT signature.
DROP FUNCTION IF EXISTS public.admin_list_venue_owners(uuid);

CREATE FUNCTION public.admin_list_venue_owners(p_venue_id uuid)
RETURNS TABLE (
  user_id         uuid,
  first_name      text,
  last_name       text,
  phone           text,
  email           text,
  owner_role      text,
  granted_at      timestamptz,
  invited_at      timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_list_venue_owners: admin only'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT vo.user_id, pu.first_name, pu.last_name,
         au.phone::text, au.email::text,
         vo.role, vo.created_at,
         au.invited_at, au.last_sign_in_at
  FROM public.venue_owners vo
  JOIN public.users pu ON pu.id = vo.user_id
  LEFT JOIN auth.users au ON au.id = vo.user_id
  WHERE vo.venue_id = p_venue_id
  ORDER BY vo.created_at ASC;
END;
$$;

-- DEFINER functions default to PUBLIC-executable — close that before the
-- authenticated grant, exactly as 20260827000001 does. The is_admin()
-- check inside is the real gate; the grants keep anon from reaching it.
REVOKE ALL ON FUNCTION public.admin_list_venue_owners(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_venue_owners(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_list_venue_owners(uuid) IS
  'Admin-only: venue_owners rows for a venue with each account''s phone, '
  'email, and sign-in state. DEFINER for the auth.users join only; the '
  'write path stays plain RLS. last_sign_in_at NULL means the invite has '
  'not been opened yet (ADR-0024).';
