-- 48_maps.sql — maps (20261014000002, plans/maps.md)
-- Under test:
--   v_fixture, v_open_fixtures, v_keeper_requests and fixture_preview carry
--     the venue's point, so a fixture can give directions and the board can
--     be drawn
--   venue_pins: active venues with a page, signed out
--   my_grounds: the caller's completed games by venue, own data only
--
-- Fixtures: venue_a (b1, active, at 33.6 E 34.9 N) owned by a2, court c1
-- verified; venue_b (b2, inactive); a4 organises; a5 stranger. New: a
-- willing keeper K (c701, Larnaca).
BEGIN;
SELECT plan(9);

RESET ROLE;
UPDATE public.venues SET slug = 'rls-venue' WHERE id = '00000000-0000-4000-8000-0000000000b1';
UPDATE public.venues SET slug = 'rls-b' WHERE id = '00000000-0000-4000-8000-0000000000b2';

INSERT INTO auth.users (id) VALUES ('00000000-0000-4000-8000-00000000c701') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (id, first_name, last_name, city_id, role, goes_in_goal)
VALUES (
  '00000000-0000-4000-8000-00000000c701', 'Kostas', 'Keeper',
  (SELECT id FROM public.cities WHERE code = 'larnaca'), 'player', 'full'
)
ON CONFLICT (id) DO UPDATE SET city_id = excluded.city_id, goes_in_goal = excluded.goes_in_goal;

-- e801: open, three days out. e802 + e803: completed, a4 in. e804: future,
-- not completed, a4 in (must not count as a ground).
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, is_open
) VALUES
(
  '00000000-0000-4000-8000-00000000e801', 'RLS-2036-M001', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '3 days',
  date_trunc('hour', now()) + interval '3 days 1 hour', 'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard', TRUE
),
(
  '00000000-0000-4000-8000-00000000e802', 'RLS-2036-M002', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', now() - interval '3 days', now() - interval '3 days' + interval '1 hour',
  'completed', 1, 4, 5000, 0, 5000, 500, 'standard', FALSE
),
(
  '00000000-0000-4000-8000-00000000e803', 'RLS-2036-M003', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', now() - interval '10 days', now() - interval '10 days' + interval '1 hour',
  'completed', 1, 4, 5000, 0, 5000, 500, 'standard', FALSE
),
(
  '00000000-0000-4000-8000-00000000e804', 'RLS-2036-M004', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '5 days',
  date_trunc('hour', now()) + interval '5 days 1 hour', 'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard', FALSE
);
CREATE TEMP TABLE t_tok AS
SELECT invite_token FROM public.bookings WHERE id = '00000000-0000-4000-8000-00000000e801';
GRANT SELECT ON t_tok TO anon, authenticated;

-- 1. the organiser's fixture knows where it is
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT round(lat::numeric, 2)::text || '/' || round(lng::numeric, 2)::text || '/' || venue_address
   FROM public.v_fixture WHERE booking_id = '00000000-0000-4000-8000-00000000e801'),
  '34.90/33.60/1 Test St, Larnaca',
  'v_fixture: the venue''s point and address'
);

-- 2. the board carries the point
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT round(lat::numeric, 2)::text || '/' || round(lng::numeric, 2)::text || '/' || venue_id::text
   FROM public.v_open_fixtures WHERE booking_id = '00000000-0000-4000-8000-00000000e801'),
  '34.90/33.60/00000000-0000-4000-8000-0000000000b1',
  'v_open_fixtures: the venue''s point'
);

-- 3. the invite preview carries it, signed out
SELECT public.set_test_anon();
SELECT is(
  (SELECT round(lat::numeric, 2)::text || '/' || round(lng::numeric, 2)::text
   FROM public.fixture_preview((SELECT invite_token FROM t_tok))),
  '34.90/33.60',
  'fixture_preview: the venue''s point'
);

-- 4. the keeper list carries it
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT public.gk_post('00000000-0000-4000-8000-00000000e801');
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c701'::uuid);
SELECT is(
  (SELECT round(lat::numeric, 2)::text || '/' || round(lng::numeric, 2)::text
   FROM public.v_keeper_requests WHERE booking_id = '00000000-0000-4000-8000-00000000e801'),
  '34.90/33.60',
  'v_keeper_requests: the venue''s point'
);

-- 5–6. the island: active venues with a page, signed out
SELECT public.set_test_anon();
SELECT ok(
  'rls-venue' IN (SELECT slug FROM public.venue_pins())
  AND 'rls-b' NOT IN (SELECT slug FROM public.venue_pins()),
  'venue_pins: active venues only'
);
SELECT is(
  (SELECT courts::text || '/' || bookable::text FROM public.venue_pins() WHERE slug = 'rls-venue'),
  '1/true',
  'venue_pins: live courts and bookable'
);

-- 7–9. your grounds: completed games with a seat in, own data only
RESET ROLE;
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status, left_at) VALUES
('00000000-0000-4000-8000-00000000e802', '00000000-0000-4000-8000-0000000000a4', 'outfield', 'in', NULL),
('00000000-0000-4000-8000-00000000e803', '00000000-0000-4000-8000-0000000000a4', 'outfield', 'in', NULL),
('00000000-0000-4000-8000-00000000e804', '00000000-0000-4000-8000-0000000000a4', 'outfield', 'in', NULL)
ON CONFLICT (booking_id, user_id) DO NOTHING;
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT games FROM public.my_grounds() WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'),
  2,
  'my_grounds: completed games only, counted per venue'
);
SELECT is(
  (SELECT slug || '/' || round(lat::numeric, 2)::text FROM public.my_grounds() WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'),
  'rls-venue/34.90',
  'my_grounds: the ground''s page and point'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is((SELECT count(*) FROM public.my_grounds()), 0::bigint, 'my_grounds: nobody else''s games');

SELECT * FROM finish();
ROLLBACK;
