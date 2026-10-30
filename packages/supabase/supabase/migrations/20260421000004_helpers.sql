-- 20260421000004_helpers.sql
-- Helpers used by RLS policies and Edge Functions.
-- All functions are STABLE (not VOLATILE) so Postgres can cache within a query,
-- which is critical for RLS performance on hot paths.

-- ────────────────────────────────────────────────────────────────────
-- is_admin() - true if the current auth.uid() has users.role = 'admin'.
-- Used by every admin-only RLS branch.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'True if the current authenticated user has admin role. STABLE so PG caches within query.';

-- ────────────────────────────────────────────────────────────────────
-- is_venue_owner_of_venue(venue_uuid) - owner OR manager of that venue.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_venue_owner_of_venue(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.venue_owners
    WHERE venue_id = p_venue_id
      AND user_id  = auth.uid()
  );
$$;

-- ────────────────────────────────────────────────────────────────────
-- is_venue_owner_of_pitch(pitch_uuid) - convenience wrapper: owner of the
-- pitch's venue.  Used by pitch/schedule/booking policies.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_venue_owner_of_pitch(p_pitch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pitches p
    JOIN public.venue_owners vo ON vo.venue_id = p.venue_id
    WHERE p.id = p_pitch_id
      AND vo.user_id = auth.uid()
  );
$$;

-- ────────────────────────────────────────────────────────────────────
-- is_pitch_bookable(pitch_uuid) - public-readable condition.
-- Used by pitch SELECT policy and schedule-derivation logic.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_pitch_bookable(p_pitch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pitches p
    JOIN public.venues  v ON v.id = p.venue_id
    WHERE p.id = p_pitch_id
      AND p.is_verified
      AND p.is_active
      AND v.is_active
      AND v.stripe_account_status = 'active'
  );
$$;
