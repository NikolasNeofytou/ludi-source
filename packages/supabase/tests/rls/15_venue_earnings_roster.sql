-- 15_venue_earnings_roster.sql — the M6 #41g views + the v_gmv_daily fix
-- Under test (20260828000001):
--   v_venue_earnings_daily  — definer view, owner-or-admin predicate
--   v_venue_booking_roster  — definer view, ADR-0023 phone window
--   v_gmv_daily             — security_invoker=on regression (the leak)
--
-- Fixture recap (_bootstrap.sql): a2 owns venue_a, a3 manages it, a4 has
-- paid booking f1 on pitch_a1 (2030-01-07) with one succeeded payment of
-- 4000/400, a5 is a stranger. venue_b is owned by nobody.
BEGIN;
SELECT plan(12);

-- ── v_venue_earnings_daily ──────────────────────────────────────────

-- 1. owner sees exactly their venue's rollup, nothing else
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_earnings_daily),
  1,
  'v_venue_earnings_daily: owner sees exactly one rollup row (their venue)'
);

-- 2. and the money columns are honest: gross 4000, fee 400, floor 3600
SELECT is(
  (SELECT (gross_cents, fee_cents, net_cents, venue_net_cents)::text
     FROM public.v_venue_earnings_daily
    WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  '(4000,400,4000,3600)',
  'v_venue_earnings_daily: gross/fee/net/venue_net computed correctly'
);

-- 3. a manager sees NOTHING here. Expectation inverted by ADR-0041
--    (20260917000006): this assertion used to read "a manager counts as
--    venue staff (is_venue_owner_of_venue covers both)", which was true
--    because that helper ignores venue_owners.role — a default, not a
--    decision. A manager runs the day; what the day earned, and above all
--    what Ludi took, is the owner's. 37_manager_boundary covers the
--    whole line.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_earnings_daily),
  0,
  'v_venue_earnings_daily: a manager sees no earnings (ADR-0041)'
);

-- 4. a stranger sees no earnings at all
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_earnings_daily),
  0,
  'v_venue_earnings_daily: stranger sees nothing'
);

-- 5. anon has no grant on the earnings view at all (20261020000002)
SELECT public.set_test_anon();
SELECT throws_ok(
  $$SELECT count(*) FROM public.v_venue_earnings_daily$$,
  '42501',
  NULL,
  'v_venue_earnings_daily: anon has no grant'
);

-- ── v_gmv_daily leak regression ─────────────────────────────────────
-- Before 20260828000001 a definer-owned v_gmv_daily bypassed payments
-- RLS and handed any authenticated user the platform rollup.

-- 6. stranger sees no platform rollup
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_gmv_daily),
  0,
  'v_gmv_daily: security_invoker=on — stranger no longer sees the rollup'
);

-- 7. admin still sees it
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT cmp_ok(
  (SELECT count(*)::int FROM public.v_gmv_daily),
  '>=',
  1,
  'v_gmv_daily: admin still reads the platform rollup'
);

-- ── v_venue_booking_roster ──────────────────────────────────────────

-- Give the fixture player a phone (auth-side, as postgres) so the window
-- tests below exercise the CASE, then add an in-window booking: kickoff
-- in one hour, paid.
RESET ROLE;
UPDATE auth.users SET phone = '35799111222'
 WHERE id = '00000000-0000-4000-8000-0000000000a4'::uuid;
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents,
  platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000f9'::uuid,
  'RLS-2026-0999',
  '00000000-0000-4000-8000-0000000000a4'::uuid,
  '00000000-0000-4000-8000-0000000000c1'::uuid,
  now() + interval '1 hour',
  now() + interval '2 hours',
  'paid',
  4000, 0, 4000, 400, 'standard'
);

-- 8. owner reads the booking sheet: organiser name + code on their pitch
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT (first_name, last_name, code)::text
     FROM public.v_venue_booking_roster
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  '(Other,User,RLS-2030-0001)',
  'v_venue_booking_roster: owner sees organiser name + booking code'
);

-- 9. phone is NULL outside the window (that booking is in 2030)
SELECT is(
  (SELECT organiser_phone
     FROM public.v_venue_booking_roster
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  NULL,
  'v_venue_booking_roster: phone withheld outside the 24h window'
);

-- 10. phone is exposed inside the window (paid, kickoff in an hour)
SELECT is(
  (SELECT organiser_phone
     FROM public.v_venue_booking_roster
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f9'::uuid),
  '35799111222',
  'v_venue_booking_roster: phone exposed within 24h of kickoff'
);

-- 11. the player who booked owns no venue — the roster is not for them
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_booking_roster),
  0,
  'v_venue_booking_roster: a booking player sees no roster rows'
);

-- 12. stranger sees nothing
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_booking_roster),
  0,
  'v_venue_booking_roster: stranger sees nothing'
);

SELECT * FROM finish();
ROLLBACK;
