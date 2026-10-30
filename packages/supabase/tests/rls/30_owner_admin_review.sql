-- 30_owner_admin_review.sql — owner web-app review (migration 20260913000005)
--
--   * venues' take rate, Stripe account id and contacts are not public;
--     owners/managers/admins read them through v_venue_private.
--   * v_gmv_daily counts money through Ludi only, not walk-in cash.
--   * The database refuses a schedule change that would strand a booking,
--     judging exceptions by the day's hours afterwards.
--
-- Fixture recap (_bootstrap.sql): a1 admin, a2 owner and a3 manager of
-- venue_a (b1), a4 player, a5 stranger. Pitch c1 opens Mon 09:00–17:00 and
-- holds two paid bookings on Mon 2030-01-07, 10:00 and 12:00 (Nicosia);
-- a closure override sits on 2030-12-25.
BEGIN;
SELECT plan(22);

-- ── 1. venues' private columns ─────────────────────────────────────

SELECT public.set_test_anon();
SELECT throws_ok(
  $$SELECT take_rate_bps FROM public.venues$$,
  '42501', NULL,
  'venues: anon cannot read take_rate_bps'
);
SELECT throws_ok(
  $$SELECT stripe_account_id FROM public.venues$$,
  '42501', NULL,
  'venues: anon cannot read stripe_account_id'
);
SELECT is(
  (SELECT name FROM public.venues
    WHERE id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  'RLS Fixture Venue A',
  'venues: anon still reads the public columns of an active venue'
);
SELECT is(
  (SELECT round(lat::numeric, 1) || ',' || round(lng::numeric, 1)
     FROM public.venues
    WHERE id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  '34.9,33.6',
  'venues: anon reads lat/lng (generated columns — no whole-row reference)'
);
SELECT throws_ok(
  $$SELECT * FROM public.v_venue_private$$,
  '42501', NULL,
  'v_venue_private: anon has no access'
);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$SELECT contact_phone FROM public.venues$$,
  '42501', NULL,
  'venues: a signed-in player cannot read contacts'
);
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_private),
  0,
  'v_venue_private: a player sees no rows'
);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT stripe_account_id || ':' || take_rate_bps FROM public.v_venue_private
    WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  'acct_rls_fixture_a:1000',
  'v_venue_private: the owner reads their own venue'
);
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_private
    WHERE venue_id = '00000000-0000-4000-8000-0000000000b2'::uuid),
  0,
  'v_venue_private: the owner does not read another venue'
);
SELECT throws_ok(
  $$DELETE FROM public.v_venue_private
     WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid$$,
  '42501', NULL,
  'v_venue_private: read-only — the owner cannot delete through it'
);
SELECT throws_ok(
  $$UPDATE public.v_venue_private SET contact_phone = '+35700000000'
     WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid$$,
  '42501', NULL,
  'v_venue_private: read-only — the owner cannot update through it'
);

-- Expectation inverted by ADR-0041 (20260917000006). This view carries
-- take_rate_bps outright, so withholding /earnings from a manager while
-- leaving this readable would have been theatre.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_private
    WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  0,
  'v_venue_private: a manager does not read the take rate (ADR-0041)'
);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_private
    WHERE venue_id IN (
      '00000000-0000-4000-8000-0000000000b1'::uuid,
      '00000000-0000-4000-8000-0000000000b2'::uuid
    )),
  2,
  'v_venue_private: an admin reads every venue'
);

-- ── 2. v_gmv_daily leaves walk-in cash out ──────────────────────────

RESET ROLE;
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, origin,
  walk_in_name, base_price_cents, total_cents, platform_fee_cents,
  cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000ed',
  'RLS-2031-W030',
  '00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000c2',
  '2031-02-03 16:00+00', '2031-02-03 17:00+00', 'confirmed', 'walk_in',
  'Counter Customer', 5000, 5000, 0, 'standard'
);
INSERT INTO public.payments (
  booking_id, stripe_payment_intent_id, amount_cents,
  application_fee_cents, status, payment_method, created_at
) VALUES (
  '00000000-0000-4000-8000-0000000000ed',
  'offline_00000000-0000-4000-8000-0000000000ed',
  5000, 0, 'succeeded', 'offline', '2031-02-03 10:00+00'
);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_gmv_daily WHERE day = '2031-02-03'),
  0,
  'v_gmv_daily: a walk-in is not money through Ludi'
);
SELECT is(
  (SELECT offline_gross_cents::int FROM public.v_venue_earnings_daily
    WHERE day = '2031-02-03'),
  5000,
  'v_venue_earnings_daily: the venue still sees its walk-in cash'
);

-- ── 3. the stranding rule, enforced by the database ─────────────────

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);

SELECT throws_ok(
  $$DELETE FROM public.pitch_schedules
     WHERE pitch_id = '00000000-0000-4000-8000-0000000000c1'::uuid
       AND day_of_week = 1$$,
  'P0001', NULL,
  'pitch_schedules: deleting a window with bookings in it is refused'
);

SELECT throws_ok(
  $$UPDATE public.pitch_schedules SET opens_at = '11:00'
     WHERE pitch_id = '00000000-0000-4000-8000-0000000000c1'::uuid
       AND day_of_week = 1$$,
  'P0001', NULL,
  'pitch_schedules: giving up the 10:00 booking''s hour is refused'
);

SELECT lives_ok(
  $$UPDATE public.pitch_schedules SET closes_at = '16:00'
     WHERE pitch_id = '00000000-0000-4000-8000-0000000000c1'::uuid
       AND day_of_week = 1$$,
  'pitch_schedules: giving up an empty evening hour is allowed'
);

SELECT throws_ok(
  $$INSERT INTO public.pitch_schedule_overrides (
      pitch_id, override_date, is_closed, reason
    ) VALUES (
      '00000000-0000-4000-8000-0000000000c1'::uuid, '2030-01-07', TRUE, 'x'
    )$$,
  'P0001', NULL,
  'overrides: closing a booked day is refused'
);

SELECT lives_ok(
  $$DELETE FROM public.pitch_schedule_overrides
     WHERE id = '00000000-0000-4000-8000-0000000000e1'::uuid$$,
  'overrides: removing a closure on an empty day is allowed'
);

-- Special hours that still cover both bookings replace Monday the 7th,
-- so the weekly Monday window no longer holds anything — its removal is
-- allowed (bookings_in_weekly_window skips dates an exception replaces),
-- and then removing the exception is what would strand them.
SELECT lives_ok(
  $$INSERT INTO public.pitch_schedule_overrides (
      pitch_id, override_date, is_closed, opens_at, closes_at, reason
    ) VALUES (
      '00000000-0000-4000-8000-0000000000c1'::uuid, '2030-01-07', FALSE,
      '08:00', '14:00', 'early start'
    );
    DELETE FROM public.pitch_schedules
     WHERE pitch_id = '00000000-0000-4000-8000-0000000000c1'::uuid
       AND day_of_week = 1$$,
  'weekly window: removable once an exception covers its only booked date'
);

SELECT throws_ok(
  $$DELETE FROM public.pitch_schedule_overrides
     WHERE pitch_id = '00000000-0000-4000-8000-0000000000c1'::uuid
       AND override_date = '2030-01-07'$$,
  'P0001', NULL,
  'overrides: removing the exception that now holds the bookings is refused'
);

SELECT * FROM finish();
ROLLBACK;
