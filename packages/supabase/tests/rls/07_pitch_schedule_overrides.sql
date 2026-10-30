-- 07_pitch_schedule_overrides.sql — RLS for public.pitch_schedule_overrides
-- Policies under test:
--   pitch_schedule_overrides_select_public
--   pitch_schedule_overrides_owner_write
BEGIN;
SELECT plan(5);

-- 1. anon SELECT
SELECT public.set_test_anon();
SELECT cmp_ok(
  (SELECT count(*)::int FROM public.pitch_schedule_overrides
   WHERE pitch_id = '00000000-0000-4000-8000-0000000000c1'::uuid),
  '>=',
  1,
  'pitch_schedule_overrides_select_public: anon reads overrides'
);

-- 2. owner INSERTs an override for own pitch
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT lives_ok(
  $$INSERT INTO public.pitch_schedule_overrides (pitch_id, override_date, is_closed, reason)
    VALUES ('00000000-0000-4000-8000-0000000000c1'::uuid, '2030-12-26', true, 'Boxing Day')$$,
  'pitch_schedule_overrides_owner_write: owner INSERT for own pitch'
);

-- 3. non-owner INSERT denied
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$INSERT INTO public.pitch_schedule_overrides (pitch_id, override_date, is_closed, reason)
    VALUES ('00000000-0000-4000-8000-0000000000c1'::uuid, '2030-12-27', true, 'rogue override')$$,
  '42501',
  NULL,
  'pitch_schedule_overrides_owner_write: non-owner INSERT denied'
);

-- 4. owner UPDATE own override
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
WITH upd AS (
  UPDATE public.pitch_schedule_overrides SET reason = 'Updated by owner'
  WHERE id = '00000000-0000-4000-8000-0000000000e1'::uuid
  RETURNING 1
)
SELECT is(count(*)::int, 1,
  'pitch_schedule_overrides_owner_write: owner UPDATEs own override')
FROM upd;

-- 5. non-owner UPDATE filtered out
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
WITH upd AS (
  UPDATE public.pitch_schedule_overrides SET reason = 'Hijack'
  WHERE id = '00000000-0000-4000-8000-0000000000e1'::uuid
  RETURNING 1
)
SELECT is(count(*)::int, 0,
  'pitch_schedule_overrides_owner_write: non-owner UPDATE filtered out')
FROM upd;

SELECT * FROM finish();
ROLLBACK;
