-- 33_counter_follow_through.sql — enable a city from Review (20260916000001)
-- Under test:
--   cities: an owner's UPDATE touches no row (cities_admin_write is
--     admin-only); an admin's flips is_enabled
--   admin_actions: the admin may audit enable_city on target city; the
--     owner may not (the owner vocabulary is its own list); every word the
--     list held before is still there after the widening
--
-- Fixtures: a1 is the admin, a2 owns venue_a; cities come from the seed
-- (the bootstrap reads 'larnaca' for venue_a's city_id).
BEGIN;
SELECT plan(5);

-- a city that is off, to flip
INSERT INTO public.cities (code, name_en, name_gr, is_enabled, display_order)
VALUES ('test_city', 'Test City', 'Τεστ', FALSE, 99)
ON CONFLICT (code) DO UPDATE SET is_enabled = FALSE;

-- 1. the owner's UPDATE is silently zero rows
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
UPDATE public.cities SET is_enabled = TRUE WHERE code = 'test_city';
SELECT is(
  (SELECT is_enabled FROM public.cities WHERE code = 'test_city'),
  FALSE,
  'cities: owner cannot enable a city'
);

-- 2. the owner cannot write the audit word either
SELECT throws_ok(
  $$INSERT INTO public.admin_actions (admin_user_id, action_type, target_type, target_id, reason)
    VALUES ('00000000-0000-4000-8000-0000000000a2', 'enable_city', 'city',
            (SELECT id FROM public.cities WHERE code = 'test_city'), 'owner tries')$$,
  '42501', NULL,
  'admin_actions: owner cannot audit enable_city'
);

-- 3. the admin flips it
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
UPDATE public.cities SET is_enabled = TRUE WHERE code = 'test_city' AND NOT is_enabled;
SELECT is(
  (SELECT is_enabled FROM public.cities WHERE code = 'test_city'),
  TRUE,
  'cities: admin enables a city'
);

-- 4. and audits it with the new word on the new target
SELECT lives_ok(
  $$INSERT INTO public.admin_actions (admin_user_id, action_type, target_type, target_id, reason, payload)
    VALUES ('00000000-0000-4000-8000-0000000000a1', 'enable_city', 'city',
            (SELECT id FROM public.cities WHERE code = 'test_city'),
            'enabled Test City for players (enrolment review)', '{"code":"test_city"}')$$,
  'admin_actions: admin audits enable_city on a city'
);

-- 5. the widening kept every earlier word (the retyped-list failure mode)
SELECT ok(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'admin_actions_action_type_check'
      AND conrelid = 'public.admin_actions'::regclass)
  LIKE ALL (ARRAY['%refund_booking%', '%verify_pitch%', '%walk_in_created%',
                  '%series_created%', '%series_ended%', '%enable_city%'])
  AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'admin_actions_target_type_check'
      AND conrelid = 'public.admin_actions'::regclass)
  LIKE ALL (ARRAY['%booking%', '%pitch%', '%venue%', '%user%', '%payment%', '%city%']),
  'admin_actions: both CHECKs kept every earlier word and gained the new one'
);

SELECT * FROM finish();
ROLLBACK;
