-- 01_cities.sql — RLS for public.cities
-- Policies under test:
--   cities_select_public      — anon + authenticated read
--   cities_admin_write        — admin-only ALL
BEGIN;
SELECT plan(4);

-- 1. anon can SELECT cities
SELECT public.set_test_anon();
SELECT cmp_ok(
  (SELECT count(*) FROM public.cities)::int,
  '>',
  0,
  'cities_select_public: anon reads cities'
);

-- 2. authenticated player can SELECT cities
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT cmp_ok(
  (SELECT count(*) FROM public.cities)::int,
  '>',
  0,
  'cities_select_public: authenticated player reads cities'
);

-- 3. non-admin INSERT is denied by WITH CHECK
SELECT throws_ok(
  $$INSERT INTO public.cities (code, name_en, name_gr) VALUES ('rls_test_x', 'X', 'Χ')$$,
  '42501',
  NULL,
  'cities_admin_write: non-admin INSERT denied'
);

-- 4. admin INSERT succeeds
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT lives_ok(
  $$INSERT INTO public.cities (code, name_en, name_gr) VALUES ('rls_test_admin', 'X', 'Χ')$$,
  'cities_admin_write: admin INSERT permitted'
);

SELECT * FROM finish();
ROLLBACK;
