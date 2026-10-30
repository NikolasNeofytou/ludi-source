-- 04_venue_owners.sql — RLS for public.venue_owners
-- Policies under test:
--   venue_owners_select_self_or_admin
--   venue_owners_admin_write   (FOR ALL, admin-only USING + WITH CHECK)
BEGIN;
SELECT plan(5);

-- 1. self (owner) SELECT returns own membership row
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.venue_owners
   WHERE user_id = '00000000-0000-4000-8000-0000000000a2'::uuid),
  1,
  'venue_owners_select_self_or_admin: self sees own row'
);

-- 2. unrelated user sees no venue_owners rows
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.venue_owners),
  0,
  'venue_owners_select_self_or_admin: non-member sees nothing'
);

-- 3. admin sees all venue_owners rows (owner + manager fixtures)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT cmp_ok(
  (SELECT count(*)::int FROM public.venue_owners
   WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  '>=',
  2,
  'venue_owners_select_self_or_admin: admin sees all'
);

-- 4. non-admin INSERT denied (admin_write WITH CHECK)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$INSERT INTO public.venue_owners (venue_id, user_id, role)
    VALUES ('00000000-0000-4000-8000-0000000000b1'::uuid,
            '00000000-0000-4000-8000-0000000000a4'::uuid,
            'manager')$$,
  '42501',
  NULL,
  'venue_owners_admin_write: non-admin INSERT denied'
);

-- 5. admin INSERT succeeds
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT lives_ok(
  $$INSERT INTO public.venue_owners (venue_id, user_id, role)
    VALUES ('00000000-0000-4000-8000-0000000000b2'::uuid,
            '00000000-0000-4000-8000-0000000000a4'::uuid,
            'manager')$$,
  'venue_owners_admin_write: admin INSERT permitted'
);

SELECT * FROM finish();
ROLLBACK;
