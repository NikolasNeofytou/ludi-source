-- ────────────────────────────────────────────────────────────────────
-- The owner hands out a key
-- ────────────────────────────────────────────────────────────────────
-- Slice C of docs/plans/venue-staff.md, the half that slices A and B
-- (20260917000004) deliberately left with the founder.
--
-- A and B gave the owner sight and revocation. This one gives him the
-- grant: he invites his own staff instead of phoning us. The rule the
-- plan wanted decided in the open, decided:
--
--   **Only an owner grants, and an owner grants only a manager.**
--
-- An owner minting another `owner` is the one thing that is not his to
-- do — an owner is the venue's signatory (data-model.md), can take the
-- venue's money surface, and can revoke everyone else including the
-- person who granted them. Handing the venue over stays a founder act,
-- with a human on the call. Everything else about hiring a person who
-- stands at a counter is now the venue's own business.
--
-- The whole grant lives in the `invite-venue-owner` Edge Function,
-- because creating an auth account needs the service-role key that
-- apps/admin must not hold (ADR-0019, ADR-0024). This migration adds the
-- single piece that function cannot do without: the email lookup, in a
-- shape an owner is allowed to call.
--
-- venue_owners_admin_write is still not widened. The insert continues to
-- happen inside the Edge Function with the service key; an owner has no
-- direct write on venue_owners and still cannot get one.

-- ────────────────────────────────────────────────────────────────────
-- venue_invite_lookup(venue, email) — does this address already have an
-- account?
-- ────────────────────────────────────────────────────────────────────
-- The owner-callable counterpart of admin_lookup_user_by_email
-- (20260829000002), and the reason it is a separate function rather than
-- a widened gate on that one:
--
-- admin_lookup_user_by_email answers "is there a Ludi account at this
-- address" for ANY address, which for a platform admin is their job and
-- for anybody else is an account-enumeration oracle over the whole user
-- base. Adding `OR is_venue_owner_of_venue(...)` to it is impossible
-- anyway — it takes no venue — and adding `OR <caller owns some venue>`
-- would hand every owner the unbounded version.
--
-- So the owner's lookup takes the venue as its first argument and is
-- gated on owning THAT venue. The oracle still exists — one address per
-- call, audited downstream by the invite it leads to — but it is bounded
-- by a relationship instead of by nothing, which is the most that can be
-- true while the invite flow needs to tell "new person" from "already
-- has an account".
--
-- Same row shape as admin_lookup_user_by_email so the Edge Function's
-- two paths differ by one line rather than by a branch.
CREATE OR REPLACE FUNCTION public.venue_invite_lookup(
  p_venue_id uuid,
  p_email text
)
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
  IF NOT public.has_venue_role(p_venue_id, 'owner') THEN
    RAISE EXCEPTION 'venue_invite_lookup: owner of this venue only'
      USING ERRCODE = '42501';
  END IF;

  v_email := lower(trim(coalesce(p_email, '')));
  IF v_email = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT au.id, pu.first_name, pu.last_name, au.email::text, au.created_at
  FROM auth.users AS au
  LEFT JOIN public.users AS pu ON pu.id = au.id
  WHERE lower(au.email::text) = v_email
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.venue_invite_lookup(uuid, text) IS
  'Owner-only, venue-scoped: resolve an email to the account behind it so '
  'the invite flow can tell "new person" from "already has an account". '
  'The venue-scoped twin of admin_lookup_user_by_email, which stays '
  'admin-only because it is unbounded. DEFINER for the auth.users read; '
  'the gate is has_venue_role(venue, ''owner'').';

-- ────────────────────────────────────────────────────────────────────
-- Grants
-- ────────────────────────────────────────────────────────────────────
-- DEFINER functions are PUBLIC-executable by default; close that before
-- the authenticated grant, as 20260827000001 and 20260917000004 do. The
-- check inside the body is the real gate.
REVOKE ALL ON FUNCTION public.venue_invite_lookup(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.venue_invite_lookup(uuid, text) TO authenticated, service_role;
