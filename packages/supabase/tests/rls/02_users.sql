-- 02_users.sql — RLS for public.users
-- Policies under test:
--   users_select_self_or_admin
--   users_insert_self
--   users_update_self_or_admin
--   users_admin_delete
--   tg_users_block_role_change (column-level RLS via trigger)
--   player-card substrate columns (ADR-0012): height_cm / age_band /
--     play_frequency — self-updatable on own row, not on others', CHECK-guarded
BEGIN;
SELECT plan(10);

-- Fixture aliases (kept inline for readability)
-- a1=admin a2=owner a3=manager a4=other

-- 1. self SELECT returns own row
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.users WHERE id = '00000000-0000-4000-8000-0000000000a4'::uuid),
  1,
  'users_select_self_or_admin: self SELECT returns own row'
);

-- 2. SELECT another user's row → empty (RLS filters)
SELECT is(
  (SELECT count(*)::int FROM public.users WHERE id = '00000000-0000-4000-8000-0000000000a2'::uuid),
  0,
  'users_select_self_or_admin: cannot read other user'
);

-- 3. admin SELECT-all sees every test user
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT cmp_ok(
  (SELECT count(*)::int FROM public.users
   WHERE id IN (
     '00000000-0000-4000-8000-0000000000a1'::uuid,
     '00000000-0000-4000-8000-0000000000a2'::uuid,
     '00000000-0000-4000-8000-0000000000a3'::uuid,
     '00000000-0000-4000-8000-0000000000a4'::uuid
   )),
  '=',
  4,
  'users_select_self_or_admin: admin sees all profiles'
);

-- 4. self UPDATE of safe column succeeds
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
WITH upd AS (
  UPDATE public.users SET first_name = 'Renamed'
  WHERE id = '00000000-0000-4000-8000-0000000000a4'::uuid
  RETURNING 1
)
SELECT is(count(*)::int, 1,
  'users_update_self_or_admin: self UPDATE of name affects own row')
FROM upd;

-- 5. UPDATE another user → 0 rows (USING filters)
WITH upd AS (
  UPDATE public.users SET first_name = 'Hijack'
  WHERE id = '00000000-0000-4000-8000-0000000000a2'::uuid
  RETURNING 1
)
SELECT is(count(*)::int, 0,
  'users_update_self_or_admin: cannot UPDATE other user')
FROM upd;

-- 6. self UPDATE OF role → blocked by trigger (insufficient_privilege)
SELECT throws_ok(
  $$UPDATE public.users SET role = 'admin' WHERE id = '00000000-0000-4000-8000-0000000000a4'::uuid$$,
  '42501',
  NULL,
  'tg_users_block_role_change: non-admin cannot self-promote'
);

-- 7. self UPDATE of the player-card substrate columns succeeds on own row
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
WITH upd AS (
  UPDATE public.users
  SET height_cm = 178, age_band = '26_35', play_frequency = 'weekly'
  WHERE id = '00000000-0000-4000-8000-0000000000a4'::uuid
  RETURNING height_cm, age_band, play_frequency
)
SELECT is(
  (SELECT height_cm || '/' || age_band || '/' || play_frequency FROM upd),
  '178/26_35/weekly',
  'users_update_self_or_admin: self UPDATE of player-card columns persists'
);

-- 8. UPDATE another user's player-card columns → 0 rows (USING filters)
WITH upd AS (
  UPDATE public.users SET play_frequency = 'often'
  WHERE id = '00000000-0000-4000-8000-0000000000a2'::uuid
  RETURNING 1
)
SELECT is(count(*)::int, 0,
  'users_update_self_or_admin: cannot UPDATE other user player-card columns')
FROM upd;

-- 9. invalid age_band rejected by CHECK constraint (ADR-0012 bucket guard)
SELECT throws_ok(
  $$UPDATE public.users SET age_band = '99_plus' WHERE id = '00000000-0000-4000-8000-0000000000a4'::uuid$$,
  '23514',
  NULL,
  'users.age_band CHECK rejects an out-of-set bucket'
);

-- 10. is_admin() must stay SECURITY DEFINER (migration 20260810000001).
--
-- users_select_self_or_admin calls is_admin(), which reads public.users. As
-- SECURITY INVOKER that read re-enters this same policy and recurses until
-- 54001 stack depth exceeded. SECURITY DEFINER breaks the cycle.
--
-- This is asserted structurally rather than behaviourally on purpose. Whether
-- the recursion actually fires depends on the query plan: `id = auth.uid()`
-- and `id IN (…)` are leakproof, so when the planner can push an id filter
-- below the policy qual the policy only ever sees the caller's own row and
-- short-circuits on the first OR branch. A behavioural test here passes
-- against the broken definition too — verified by hand, which is exactly why
-- it isn't the test. The failure surfaces on unfiltered scans through
-- PostgREST (the admin bookings list, any `users` embed), a plan this suite
-- cannot reproduce because it never goes through PostgREST at all.
SELECT is(
  (SELECT prosecdef FROM pg_proc
   WHERE proname = 'is_admin' AND pronamespace = 'public'::regnamespace),
  TRUE,
  'is_admin() is SECURITY DEFINER — else the users policy recurses into it'
);

SELECT * FROM finish();
ROLLBACK;
