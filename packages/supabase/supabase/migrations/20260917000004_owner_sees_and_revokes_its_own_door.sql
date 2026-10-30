-- ────────────────────────────────────────────────────────────────────
-- The owner sees, and closes, his own door
-- ────────────────────────────────────────────────────────────────────
-- Slices A and B of docs/plans/venue-staff.md.
--
-- Until now, access to a venue was entirely the founder's to hold:
--   * venue_owners_admin_write      — only an admin may INSERT/DELETE
--   * invite-venue-owner            — 403 to any non-admin caller
--   * admin_list_venue_owners()     — 42501 to any non-admin caller
--   * venue_owners_select_self_or_admin — an owner reads his OWN row and
--                                    nothing else
--
-- So an owner could not see who else could sign into his venue, and
-- could not remove anyone when they stopped working there. That was the
-- right shape while every venue was enrolled by hand (data-model.md:
-- "RLS: select/insert/delete only to admins in MVP"); it stopped being
-- right when the second venue went live with staff behind the counter.
--
-- This migration gives back exactly two of the four: SEE and REVOKE.
-- GRANT stays admin-only — it is slice C, it needs the "only an owner
-- grants" rule decided in the open, and revoking is the half that is
-- urgent, because a worker who leaves keeps a live session until
-- somebody removes them.
--
-- Both new functions are owner-only, not owner-or-manager. A manager
-- runs the venue's day (data-model.md: "everything an owner does except
-- the venue's money"); who may open the door is not part of a day, and
-- slice D revisits the boundary as a whole rather than widening it here
-- by accident.
--
-- Nothing is widened by RLS. venue_owners_select_self_or_admin and
-- venue_owners_admin_write are untouched: the reads and the delete go
-- through SECURITY DEFINER functions whose first statement is the gate,
-- exactly as admin_list_venue_owners does. A table policy would have
-- had to expose other people's rows to decide what to show.

-- ────────────────────────────────────────────────────────────────────
-- 1. has_venue_role(venue, role) — the role-aware sibling of
--    is_venue_owner_of_venue()
-- ────────────────────────────────────────────────────────────────────
-- is_venue_owner_of_venue() (20260421000004) matches on user_id alone
-- and never reads venue_owners.role, which is why a manager is an owner
-- at every RLS boundary today. That is a documented default, not a bug,
-- and this migration does not change it — but the two functions below
-- need to ask the question, and slice D will need to ask it in a dozen
-- more places. One helper now, rather than twelve copies of the same
-- EXISTS later.
--
-- SECURITY INVOKER and filtered on auth.uid(), like its sibling: the row
-- it reads is the caller's own, which venue_owners_select_self_or_admin
-- already allows.
CREATE OR REPLACE FUNCTION public.has_venue_role(p_venue_id uuid, p_role text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.venue_owners
    WHERE venue_id = p_venue_id
      AND user_id = auth.uid()
      AND role = p_role
  );
$$;

COMMENT ON FUNCTION public.has_venue_role(uuid, text) IS
  'True if the caller holds exactly this venue_owners.role at this venue. '
  'The role-aware counterpart of is_venue_owner_of_venue(), which ignores '
  'role on purpose. Use it where owner and manager must differ.';

-- ────────────────────────────────────────────────────────────────────
-- 2. venue_people(venue) — slice A: who can sign into my venue
-- ────────────────────────────────────────────────────────────────────
-- Deliberately the same row shape as admin_list_venue_owners, so the
-- owner's page and the founder's card render from one component. The
-- contact columns come from auth.users, which is why this is DEFINER —
-- the join, not the authorisation, is the reason. The gate is the first
-- statement.
--
-- An owner sees his people's email and phone because he is the one who
-- has to ring them; last_sign_in_at because "invited" and "signed in"
-- look identical without it, and the difference is whether a door is
-- actually open.
CREATE OR REPLACE FUNCTION public.venue_people(p_venue_id uuid)
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
  IF NOT public.has_venue_role(p_venue_id, 'owner') THEN
    RAISE EXCEPTION 'venue_people: owner of this venue only'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT vo.user_id, pu.first_name, pu.last_name,
         au.phone::text, au.email::text,
         vo.role, vo.created_at,
         au.invited_at, au.last_sign_in_at
  FROM public.venue_owners AS vo
  INNER JOIN public.users AS pu ON pu.id = vo.user_id
  LEFT JOIN auth.users AS au ON au.id = vo.user_id
  WHERE vo.venue_id = p_venue_id
  ORDER BY vo.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.venue_people(uuid) IS
  'Owner-only: who can sign into this venue, with contact and sign-in '
  'state. Same row shape as admin_list_venue_owners. DEFINER for the '
  'auth.users join; the gate is has_venue_role(venue, ''owner'').';

-- ────────────────────────────────────────────────────────────────────
-- 3. revoke_venue_person(venue, user) — slice B: closing the door
-- ────────────────────────────────────────────────────────────────────
-- One rule, and it is the only one: a venue always keeps at least one
-- owner. That single guard covers both ways this goes wrong —
-- orphaning a venue nobody can administer, and an owner who is his
-- venue's only owner locking himself out with a mis-click. An owner who
-- has handed over to a second owner may still remove himself, which is
-- what a sale looks like.
--
-- The audit row is written here rather than by the caller because
-- admin_actions_owner_insert (20260828000002) allows owners only the
-- venue/pitch/schedule vocabulary — 'other' is not in it, and widening
-- that list to name a third kind of act would be a bigger change than
-- this one. action_type 'other' with a payload kind is the same shape
-- lib/owner-actions.ts already uses for the admin-side grant and revoke,
-- so one query still finds every access change.
CREATE OR REPLACE FUNCTION public.revoke_venue_person(
  p_venue_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_role        text;
  v_owners_left int;
BEGIN
  IF NOT public.has_venue_role(p_venue_id, 'owner') THEN
    RAISE EXCEPTION 'revoke_venue_person: owner of this venue only'
      USING ERRCODE = '42501';
  END IF;

  SELECT vo.role INTO v_role
  FROM public.venue_owners AS vo
  WHERE vo.venue_id = p_venue_id AND vo.user_id = p_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'revoke_venue_person: no such grant'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_role = 'owner' THEN
    SELECT count(*) INTO v_owners_left
    FROM public.venue_owners AS vo
    WHERE vo.venue_id = p_venue_id
      AND vo.role = 'owner'
      AND vo.user_id <> p_user_id;

    IF v_owners_left = 0 THEN
      RAISE EXCEPTION 'revoke_venue_person: a venue keeps at least one owner'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  DELETE FROM public.venue_owners AS vo
  WHERE vo.venue_id = p_venue_id AND vo.user_id = p_user_id;

  INSERT INTO public.admin_actions (
    admin_user_id, action_type, target_type, target_id, reason, payload
  )
  VALUES (
    v_actor, 'other', 'venue', p_venue_id,
    format('owner removed venue access (%s)', v_role),
    jsonb_build_object(
      'kind', 'revoke_owner_access',
      'user_id', p_user_id,
      'owner_role', v_role,
      'by', 'owner'
    )
  );
END;
$$;

COMMENT ON FUNCTION public.revoke_venue_person(uuid, uuid) IS
  'Owner-only: remove someone''s access to this venue. Refuses to remove '
  'the venue''s last owner (P0001) or a grant that is not there (P0002). '
  'Writes its own admin_actions row — kind = revoke_owner_access, '
  'by = owner.';

-- ────────────────────────────────────────────────────────────────────
-- 4. Grants
-- ────────────────────────────────────────────────────────────────────
-- DEFINER functions are PUBLIC-executable by default; close that before
-- the authenticated grant, exactly as 20260827000001 does. The check
-- inside each body is the real gate — these grants only keep anon from
-- reaching it.
REVOKE ALL ON FUNCTION public.venue_people(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.revoke_venue_person(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_venue_role(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.venue_people(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_venue_person(uuid, uuid) TO authenticated, service_role;
