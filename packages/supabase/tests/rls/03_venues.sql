-- 03_venues.sql — RLS for public.venues
-- Policies under test:
--   venues_select_public_or_owner_or_admin
--   venues_admin_insert
--   venues_owner_or_admin_update
--   venues_admin_delete
BEGIN;
SELECT plan(6);

-- venue_a (b1) is active+Stripe-active (publicly visible)
-- venue_b (b2) is inactive+pending Stripe (private)

-- 1. anon sees venue_a
SELECT public.set_test_anon();
SELECT is(
  (SELECT count(*)::int FROM public.venues WHERE id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  1,
  'venues_select: anon sees active+Stripe-active venue'
);

-- 2. anon does NOT see inactive venue_b
SELECT is(
  (SELECT count(*)::int FROM public.venues WHERE id = '00000000-0000-4000-8000-0000000000b2'::uuid),
  0,
  'venues_select: anon hidden from inactive venue'
);

-- 3. admin sees both venues (admin branch)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.venues
   WHERE id IN (
     '00000000-0000-4000-8000-0000000000b1'::uuid,
     '00000000-0000-4000-8000-0000000000b2'::uuid
   )),
  2,
  'venues_select: admin sees inactive venues'
);

-- 4. owner can UPDATE own venue's name
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
WITH upd AS (
  UPDATE public.venues SET name = 'A — Renamed by owner'
  WHERE id = '00000000-0000-4000-8000-0000000000b1'::uuid
  RETURNING 1
)
SELECT is(count(*)::int, 1,
  'venues_owner_or_admin_update: owner UPDATEs own venue')
FROM upd;

-- 5. non-owner cannot UPDATE another venue (USING filters)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
WITH upd AS (
  UPDATE public.venues SET name = 'Hijack'
  WHERE id = '00000000-0000-4000-8000-0000000000b1'::uuid
  RETURNING 1
)
SELECT is(count(*)::int, 0,
  'venues_owner_or_admin_update: non-owner cannot UPDATE')
FROM upd;

-- 6. non-admin INSERT is denied
SELECT throws_ok(
  $$INSERT INTO public.venues (name, address, city_id, coords)
    VALUES ('rogue', 'addr',
      (SELECT id FROM public.cities WHERE code='larnaca'),
      ST_SetSRID(ST_MakePoint(0,0),4326)::geography)$$,
  '42501',
  NULL,
  'venues_admin_insert: non-admin INSERT denied'
);

SELECT * FROM finish();
ROLLBACK;
