-- 20260810000001_is_admin_security_definer.sql
-- Fixes unbounded recursion between public.is_admin() and the users RLS policy.
--
-- The cycle:
--   users_select_self_or_admin  USING (id = auth.uid() OR public.is_admin())
--     → is_admin() is SECURITY INVOKER, so its own SELECT on public.users
--       re-evaluates that same policy
--         → is_admin() → … until the stack runs out (SQLSTATE 54001).
--
-- Postgres cannot catch this. Its "infinite recursion detected in policy for
-- relation" guard only fires when a policy references its own table directly;
-- here the reference is laundered through a function, so the query dies on
-- max_stack_depth instead.
--
-- Why it stayed hidden until now:
--   `id = auth.uid()` and `id IN (…)` are leakproof, so when a query filters
--   users by id the planner applies that filter *below* the policy qual. The
--   policy then only ever evaluates against the caller's own row, where the
--   first OR branch is TRUE and is_admin() is never reached. Every read the
--   app did until now was id-filtered (self-profile) or ran against a table
--   holding a single user. An unfiltered scan — the admin bookings list, or
--   any PostgREST embed of `users` — has no such filter, evaluates the policy
--   per row, and recurses on the first row that is not the caller.
--
-- The fix: SECURITY DEFINER, so the membership lookup runs as the function
-- owner and does not re-enter RLS. This is the standard Supabase pattern for
-- policy helper predicates. It is safe here because the function takes no
-- arguments, reads exactly one row keyed by auth.uid(), and returns a boolean
-- — it cannot be steered into disclosing another user's data.
--
-- search_path is pinned per CVE-2018-1058: a SECURITY DEFINER function with a
-- mutable search_path can be hijacked by a same-named object in a schema the
-- caller controls.
--
-- The other three helpers in 20260421000004_helpers.sql stay SECURITY INVOKER.
-- They were only reachable into this cycle *through* is_admin(); with it
-- broken, each of them terminates:
--   is_venue_owner_of_venue → venue_owners policy short-circuits on
--     `user_id = auth.uid()` for every row its own filter can return;
--   is_venue_owner_of_pitch → pitches policy → is_venue_owner_of_venue → as
--     above, and nothing calls back into is_venue_owner_of_pitch;
--   is_pitch_bookable → no policy calls it (pitches inlines the same
--     is_verified AND is_active predicate).

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'True if the current authenticated user has admin role. SECURITY DEFINER so '
  'the lookup does not re-enter the users RLS policy that calls it (see '
  'migration 20260810000001). STABLE so PG caches within query.';
