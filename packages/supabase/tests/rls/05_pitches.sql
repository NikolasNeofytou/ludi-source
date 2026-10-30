-- 05_pitches.sql — RLS for public.pitches
-- Policies under test:
--   pitches_select_bookable_or_owner_or_admin
--   pitches_owner_or_admin_insert
--   pitches_owner_or_admin_update
--   pitches_admin_delete
BEGIN;
SELECT plan(6);

-- pitch_a1 (c1) verified+active, venue_a active   → public
-- pitch_a2 (c2) unverified, venue_a active        → owner+admin only
-- pitch_b1 (c3) inactive venue → verify-guard forces unverified → owner+admin

-- 1. anon sees only the publicly bookable pitch
SELECT public.set_test_anon();
SELECT is(
  (SELECT array_agg(id ORDER BY id) FROM public.pitches
   WHERE id IN (
     '00000000-0000-4000-8000-0000000000c1'::uuid,
     '00000000-0000-4000-8000-0000000000c2'::uuid,
     '00000000-0000-4000-8000-0000000000c3'::uuid
   )),
  ARRAY['00000000-0000-4000-8000-0000000000c1']::uuid[],
  'pitches_select: anon sees verified+active pitch only'
);

-- 2. owner sees own venue's verified+unverified pitches but not pitch in another venue
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT array_agg(id ORDER BY id) FROM public.pitches
   WHERE id IN (
     '00000000-0000-4000-8000-0000000000c1'::uuid,
     '00000000-0000-4000-8000-0000000000c2'::uuid,
     '00000000-0000-4000-8000-0000000000c3'::uuid
   )),
  ARRAY[
    '00000000-0000-4000-8000-0000000000c1',
    '00000000-0000-4000-8000-0000000000c2'
  ]::uuid[],
  'pitches_select: owner sees own verified + unverified, not other-venue pitch'
);

-- 3. admin sees all three test pitches
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.pitches
   WHERE id IN (
     '00000000-0000-4000-8000-0000000000c1'::uuid,
     '00000000-0000-4000-8000-0000000000c2'::uuid,
     '00000000-0000-4000-8000-0000000000c3'::uuid
   )),
  3,
  'pitches_select: admin sees all'
);

-- 4. owner INSERTs a new pitch into their own venue
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT lives_ok(
  $$INSERT INTO public.pitches (venue_id, name, type, surface, price_per_hour_cents)
    VALUES ('00000000-0000-4000-8000-0000000000b1'::uuid,
            'Owner-inserted pitch', '5-a-side', 'turf', 4000)$$,
  'pitches_owner_or_admin_insert: owner INSERT into own venue'
);

-- 5. owner cannot INSERT a pitch into another venue
SELECT throws_ok(
  $$INSERT INTO public.pitches (venue_id, name, type, surface, price_per_hour_cents)
    VALUES ('00000000-0000-4000-8000-0000000000b2'::uuid,
            'Cross-venue pitch', '5-a-side', 'turf', 4000)$$,
  '42501',
  NULL,
  'pitches_owner_or_admin_insert: owner cannot insert into venue they do not own'
);

-- 6. non-admin DELETE has zero effect (no DELETE policy applies)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
WITH del AS (
  DELETE FROM public.pitches
  WHERE id = '00000000-0000-4000-8000-0000000000c1'::uuid
  RETURNING 1
)
SELECT is(count(*)::int, 0,
  'pitches_admin_delete: non-admin DELETE removes 0 rows')
FROM del;

SELECT * FROM finish();
ROLLBACK;
