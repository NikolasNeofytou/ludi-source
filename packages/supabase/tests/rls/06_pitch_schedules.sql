-- 06_pitch_schedules.sql — RLS for public.pitch_schedules
-- Policies under test:
--   pitch_schedules_select_public  — public read
--   pitch_schedules_owner_write    — FOR ALL, owner-of-pitch + admin
BEGIN;
SELECT plan(5);

-- 1. anon can SELECT schedules (rendering availability needs them)
SELECT public.set_test_anon();
SELECT cmp_ok(
  (SELECT count(*)::int FROM public.pitch_schedules
   WHERE pitch_id = '00000000-0000-4000-8000-0000000000c1'::uuid),
  '>=',
  1,
  'pitch_schedules_select_public: anon reads schedules'
);

-- 2. owner INSERTs a schedule for own pitch
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT lives_ok(
  $$INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at)
    VALUES ('00000000-0000-4000-8000-0000000000c1'::uuid, 2, '09:00', '17:00')$$,
  'pitch_schedules_owner_write: owner INSERT for own pitch'
);

-- 3. non-owner INSERT is denied
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at)
    VALUES ('00000000-0000-4000-8000-0000000000c1'::uuid, 3, '09:00', '17:00')$$,
  '42501',
  NULL,
  'pitch_schedules_owner_write: non-owner INSERT denied'
);

-- 4. owner UPDATEs own schedule
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
WITH upd AS (
  UPDATE public.pitch_schedules SET closes_at = '18:00'
  WHERE pitch_id = '00000000-0000-4000-8000-0000000000c1'::uuid AND day_of_week = 1
  RETURNING 1
)
SELECT is(count(*)::int, 1,
  'pitch_schedules_owner_write: owner UPDATEs own schedule')
FROM upd;

-- 5. non-owner UPDATE has zero effect
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
WITH upd AS (
  UPDATE public.pitch_schedules SET closes_at = '18:00'
  WHERE pitch_id = '00000000-0000-4000-8000-0000000000c1'::uuid AND day_of_week = 1
  RETURNING 1
)
SELECT is(count(*)::int, 0,
  'pitch_schedules_owner_write: non-owner UPDATE filtered out')
FROM upd;

SELECT * FROM finish();
ROLLBACK;
