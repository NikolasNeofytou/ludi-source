-- 08_bookings.sql — RLS for public.bookings
-- Policy under test:
--   bookings_select_self_or_owner_or_admin
-- Plus deliberate write absence — clients can't INSERT/DELETE bookings, and
-- the one client UPDATE path (bookings_update_open_self + the ADR-0028
-- column guard, tested in 24_open_matches.sql) reaches is_open and nothing
-- else; only Edge Functions using the service role bypass RLS.
BEGIN;
SELECT plan(7);

-- Booking 0xf1 belongs to v_other on pitch_a1.
-- Booking 0xf2 belongs to v_admin on pitch_a1.

-- 1. user SELECTs own booking
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  1,
  'bookings_select_self_or_owner_or_admin: user SELECTs own booking'
);

-- 2. user does NOT see another user's booking
SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = '00000000-0000-4000-8000-0000000000f2'::uuid),
  0,
  'bookings_select_self_or_owner_or_admin: user cannot read other user booking'
);

-- 3. venue owner SELECTs all bookings on their pitch
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE pitch_id = '00000000-0000-4000-8000-0000000000c1'::uuid),
  2,
  'bookings_select_self_or_owner_or_admin: venue owner sees all bookings on own pitch'
);

-- 4. admin sees both bookings
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id IN (
     '00000000-0000-4000-8000-0000000000f1'::uuid,
     '00000000-0000-4000-8000-0000000000f2'::uuid
   )),
  2,
  'bookings_select_self_or_owner_or_admin: admin sees all'
);

-- 5. anon sees no bookings (no anon SELECT policy)
SELECT public.set_test_anon();
SELECT is(
  (SELECT count(*)::int FROM public.bookings),
  0,
  'bookings_select_self_or_owner_or_admin: anon sees nothing'
);

-- 6. authenticated INSERT denied — no INSERT policy
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state,
      base_price_cents, addons_price_cents, total_cents,
      platform_fee_cents, cancellation_policy
    ) VALUES (
      'RLS-CLIENT-INSERT', '00000000-0000-4000-8000-0000000000a4'::uuid,
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      '2030-02-03 09:00:00+02', '2030-02-03 10:00:00+02',
      'pending', 4000, 0, 4000, 400, 'standard'
    )$$,
  '42501',
  NULL,
  'bookings: client INSERT denied (no INSERT policy → service role only)'
);

-- 7. user UPDATE on own booking: since 20260831000003 (ADR-0028) the
-- organiser's own row IS reachable — bookings_update_open_self exists for
-- the is_open flip — so the defence against everything else moved from
-- "no policy, silent zero rows" to the column guard raising. Same
-- property (a client cannot rewrite their booking), louder failure mode.
SELECT throws_ok(
  $$UPDATE public.bookings SET notes = 'self-cancel attempt'
     WHERE id = '00000000-0000-4000-8000-0000000000f1'$$,
  '42501',
  'an organiser may open or close their fixture, nothing else',
  'bookings: client UPDATE on own booking hits the column guard'
);

SELECT * FROM finish();
ROLLBACK;
