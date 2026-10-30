-- 20260827000001_admin_owner_access.sql
-- Read-side helpers for granting venue-owner access from the admin UI.
--
-- ────────────────────────────────────────────────────────────────────
-- The gap
-- ────────────────────────────────────────────────────────────────────
-- ADR-0019's posture is "access is granted, not requested": a venue owner
-- gets a dashboard because the founder inserts a `venue_owners` row. Until
-- now that insert was raw SQL against the hosted database — there was no
-- surface for it, and /locked has been telling owners "get in touch and
-- we'll add you" with nothing on our side of that promise.
--
-- The write path needs nothing new: `venue_owners_admin_write` already
-- lets an admin session INSERT/DELETE, and the server action does exactly
-- that under the caller's own JWT. What the UI cannot do is *find* the
-- account to grant: sign-in is phone-OTP, the phone number is the only
-- identifier the founder and the owner share, and it lives ONLY in
-- `auth.users` — which PostgREST does not expose, and `public.users` does
-- not copy. (A fresh phone-OTP profile has first_name = '' — see
-- handle_new_user — so names identify nobody either.)
--
-- Hence two SECURITY DEFINER lookups, both hard-gated on is_admin() and
-- both read-only. This is the same boundary admin API access to auth would
-- give, minus the service-role key the admin app is forbidden from holding
-- (see apps/admin/lib/actions.ts).
--
-- Session: 2026-08-27, owner-account provisioning.

-- ────────────────────────────────────────────────────────────────────
-- Find the account behind a phone number.
-- ────────────────────────────────────────────────────────────────────
-- GoTrue stores phones as bare digits ('35799123456' — no '+'), while
-- humans type '+357 99 123456' or '0035799123456'. Normalise to digits and
-- drop an international '00' prefix so all three spellings match. Returns
-- zero rows for an unknown number; the action turns that into "ask them to
-- sign in once first", because an account that has never signed in does
-- not exist to be granted anything.
CREATE OR REPLACE FUNCTION public.admin_lookup_user_by_phone(p_phone text)
RETURNS TABLE (
  user_id    uuid,
  first_name text,
  last_name  text,
  phone      text,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_digits text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_lookup_user_by_phone: admin only'
      USING ERRCODE = '42501';
  END IF;

  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_digits := regexp_replace(v_digits, '^00', '');
  IF length(v_digits) < 8 THEN
    RETURN; -- too short to be a real number; don't scan on garbage
  END IF;

  RETURN QUERY
  SELECT au.id, pu.first_name, pu.last_name, au.phone::text, au.created_at
  FROM auth.users au
  JOIN public.users pu ON pu.id = au.id
  WHERE au.phone = v_digits;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- Who currently has access to a venue, with the phone that proves it.
-- ────────────────────────────────────────────────────────────────────
-- An admin session can already read `venue_owners` and `users` under RLS;
-- this exists solely because the phone column cannot be joined from
-- PostgREST. LEFT JOIN on auth.users so a row never vanishes from the
-- audit view just because the auth account was deleted out from under it.
CREATE OR REPLACE FUNCTION public.admin_list_venue_owners(p_venue_id uuid)
RETURNS TABLE (
  user_id    uuid,
  first_name text,
  last_name  text,
  phone      text,
  owner_role text,
  granted_at timestamptz
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
  SELECT vo.user_id, pu.first_name, pu.last_name, au.phone::text,
         vo.role, vo.created_at
  FROM public.venue_owners vo
  JOIN public.users pu ON pu.id = vo.user_id
  LEFT JOIN auth.users au ON au.id = vo.user_id
  WHERE vo.venue_id = p_venue_id
  ORDER BY vo.created_at ASC;
END;
$$;

-- DEFINER functions default to PUBLIC-executable — close that before the
-- authenticated grant. The is_admin() check inside is the real gate; the
-- grants just keep anon from even reaching it.
REVOKE ALL ON FUNCTION public.admin_lookup_user_by_phone(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_list_venue_owners(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_lookup_user_by_phone(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_venue_owners(uuid)    TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_lookup_user_by_phone(text) IS
  'Admin-only: resolve a phone number (any human spelling) to the auth account behind it, for granting venue_owners access. DEFINER because phone lives only in auth.users.';
COMMENT ON FUNCTION public.admin_list_venue_owners(uuid) IS
  'Admin-only: venue_owners rows for a venue with each account''s phone. DEFINER for the auth.users join only; the write path stays plain RLS.';
