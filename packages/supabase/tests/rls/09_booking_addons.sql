-- 09_booking_addons.sql — RLS for public.booking_addons
-- Policy under test:
--   booking_addons_select_inherits — visibility follows the parent booking
-- Plus deliberate write absence — service role only.
BEGIN;
SELECT plan(6);

-- 1. booking owner sees the addon row
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.booking_addons
   WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  1,
  'booking_addons_select_inherits: booking owner sees addon'
);

-- 2. venue owner sees the addon (via booking visibility)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.booking_addons
   WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  1,
  'booking_addons_select_inherits: venue owner sees addon'
);

-- 3. admin sees the addon
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.booking_addons
   WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  1,
  'booking_addons_select_inherits: admin sees addon'
);

-- 4. truly unrelated user (v_stranger: no venue_owners row, no bookings)
--    does NOT see the addon. v_manager would NOT work here — they are
--    a venue_owners row for venue_a, so is_venue_owner_of_pitch()
--    grants them addon visibility per the inheritance policy.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.booking_addons),
  0,
  'booking_addons_select_inherits: unrelated user sees no addons'
);

-- 5. anon does NOT see addons (no anon policy)
SELECT public.set_test_anon();
SELECT is(
  (SELECT count(*)::int FROM public.booking_addons),
  0,
  'booking_addons_select_inherits: anon sees no addons'
);

-- 6. authenticated INSERT denied (no INSERT policy)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$INSERT INTO public.booking_addons (booking_id, addon_code, quantity, unit_price_cents)
    VALUES ('00000000-0000-4000-8000-0000000000f1'::uuid, 'ball_rental', 1, 300)$$,
  '42501',
  NULL,
  'booking_addons: client INSERT denied (no policy)'
);

SELECT * FROM finish();
ROLLBACK;
