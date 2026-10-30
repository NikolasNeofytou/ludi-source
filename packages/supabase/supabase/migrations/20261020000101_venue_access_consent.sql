-- ────────────────────────────────────────────────────────────────────
-- A key the person has taken
-- ────────────────────────────────────────────────────────────────────
-- Follow-up to slice C of docs/plans/venue-staff.md (20260917000005),
-- from the 2026-10-19 pre-public review.
--
-- When an owner adds a manager whose email already has a Ludi account,
-- invite-venue-owner grants the access straight away: no email goes out
-- and nobody is asked. venue_people then showed the owner that person's
-- own phone, email, invite date and last sign-in, which the owner never
-- typed and the person never agreed to share with that venue. And
-- venue_invite_lookup, callable by any owner, answered "whose account is
-- this address" with a name.
--
-- Three changes:
--
--   1. venue_owners.accepted_at. A grant an owner makes is pending until
--      the person opens the venue in the dashboard (the admin app calls
--      accept_venue_access() when it loads their venues). Until then
--      venue_people shows the owner only what the owner typed — the
--      address the invite went to (invited_email) — and the role. Grants
--      the founder makes (admin app, admin-mode invite) are accepted on
--      insert: the column defaults to now(), and only the owner-mode
--      invite writes NULL.
--   2. venue_invite_lookup is dropped. The Edge Function resolves the
--      address itself through account_id_for_email(), which answers only
--      server-side requests (the service-role JWT) and returns only an id.
--   3. accept_venue_access(): the person's own rows, nobody else's.
--
-- Access itself is not withheld while pending. The grant gives the
-- grantee rights over the venue, not the venue rights over the grantee;
-- what needed consent was the venue seeing their details.

-- ────────────────────────────────────────────────────────────────────
-- 1. venue_owners.accepted_at, invited_email
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_owners
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN invited_email text;

-- Existing grants: accepted, except an owner's grant of an account that
-- already existed (the invite audit row says by = owner, invited = false)
-- whose holder has not signed in since. Those start pending like a new
-- one would.
UPDATE public.venue_owners AS vo
SET accepted_at = vo.created_at
WHERE
  NOT EXISTS (
    SELECT 1
    FROM public.admin_actions AS a
    WHERE
      a.action_type = 'invite_owner'
      AND a.target_id = vo.venue_id
      AND a.payload ->> 'user_id' = vo.user_id::text
      AND a.payload ->> 'by' = 'owner'
      AND a.payload ->> 'invited' = 'false'
  )
  OR EXISTS (
    SELECT 1
    FROM auth.users AS au
    WHERE
      au.id = vo.user_id
      AND au.last_sign_in_at >= vo.created_at
  );

ALTER TABLE public.venue_owners
  ALTER COLUMN accepted_at SET DEFAULT now();

COMMENT ON COLUMN public.venue_owners.accepted_at IS
  'When the person first opened this venue in the dashboard after being '
  'granted (accept_venue_access). NULL = pending: venue_people hides their '
  'own contact details from the venue. Defaults to now() — only the '
  'owner-mode invite in invite-venue-owner writes NULL.';
COMMENT ON COLUMN public.venue_owners.invited_email IS
  'The address the granting owner typed. Shown back to the venue while '
  'the grant is pending, in place of the account''s own details.';

-- ────────────────────────────────────────────────────────────────────
-- 2. account_id_for_email(email) — server-side only
-- ────────────────────────────────────────────────────────────────────
-- Replaces venue_invite_lookup. The Edge Function has already decided who
-- may add whom (admin, or the owner of THIS venue) and rate-limited it;
-- this only maps an address to an id, case- and space-insensitively.
--
-- The guard reads the JWT role claim, as settle_split_booking does, so it
-- holds even where a blanket GRANT re-opens EXECUTE.
CREATE FUNCTION public.account_id_for_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role  text;
  v_email text;
  v_id    uuid;
BEGIN
  BEGIN
    v_role := (current_setting('request.jwt.claims', true))::jsonb ->> 'role';
  EXCEPTION WHEN others THEN
    v_role := NULL;
  END;
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'account_id_for_email: server-side only'
      USING ERRCODE = '42501';
  END IF;

  v_email := lower(trim(coalesce(p_email, '')));
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  SELECT au.id INTO v_id
  FROM auth.users AS au
  WHERE lower(au.email::text) = v_email
  LIMIT 1;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.account_id_for_email(text) IS
  'Server-side only (service-role JWT): the auth account id behind an '
  'email, or NULL. Used by invite-venue-owner after its own authorisation '
  'and rate limit. Replaces the owner-callable venue_invite_lookup.';

REVOKE ALL ON FUNCTION public.account_id_for_email(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_id_for_email(text) TO service_role;

DROP FUNCTION public.venue_invite_lookup(uuid, text);

-- ────────────────────────────────────────────────────────────────────
-- 3. accept_venue_access() — the person takes the key
-- ────────────────────────────────────────────────────────────────────
-- Called by the admin app whenever it loads the caller's venues. Touches
-- only the caller's own pending rows; returns how many it accepted.
CREATE FUNCTION public.accept_venue_access()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.venue_owners AS vo
  SET accepted_at = now()
  WHERE
    vo.user_id = auth.uid()
    AND vo.accepted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.accept_venue_access() IS
  'The caller accepts every venue grant they hold that is still pending. '
  'Called by the admin app when it loads their venues; DEFINER because '
  'venue_owners is admin-write.';

REVOKE ALL ON FUNCTION public.accept_venue_access() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.accept_venue_access() TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 4. venue_people — a pending grant shows only what the owner typed
-- ────────────────────────────────────────────────────────────────────
-- Same signature, same row shape, same gate as 20260917000004. The only
-- change is the CASEs: a pending row returns the invited address and the
-- role, nothing from the person's own account. The caller's own row is
-- always open — he is looking at himself.
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
  SELECT
    vo.user_id,
    CASE WHEN k.is_open THEN pu.first_name END,
    CASE WHEN k.is_open THEN pu.last_name END,
    CASE WHEN k.is_open THEN au.phone::text END,
    CASE WHEN k.is_open THEN au.email::text ELSE vo.invited_email END,
    vo.role,
    vo.created_at,
    CASE WHEN k.is_open THEN au.invited_at END,
    CASE WHEN k.is_open THEN au.last_sign_in_at END
  FROM public.venue_owners AS vo
  INNER JOIN public.users AS pu ON pu.id = vo.user_id
  LEFT JOIN auth.users AS au ON au.id = vo.user_id
  CROSS JOIN LATERAL (
    SELECT (vo.accepted_at IS NOT NULL OR vo.user_id = auth.uid()) AS is_open
  ) AS k
  WHERE vo.venue_id = p_venue_id
  ORDER BY vo.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.venue_people(uuid) IS
  'Owner-only: who can sign into this venue, with contact and sign-in '
  'state. A grant still pending (accepted_at NULL) shows only the invited '
  'address and the role. Same row shape as admin_list_venue_owners. '
  'DEFINER for the auth.users join; the gate is has_venue_role(venue, ''owner'').';
