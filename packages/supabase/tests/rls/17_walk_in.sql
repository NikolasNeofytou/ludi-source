-- 17_walk_in.sql — M6 #41j: walk-in schema + the walk-in-aware views
-- Under test (20260829000001):
--   bookings.origin / walk_in_name / walk_in_phone constraints
--   payments.payment_method constraint
--   no fee on money taken at the venue (20260912000001, 20260917000003):
--     bookings_venue_collected_no_fee, bookings_prepaid_is_walk_in, payments_offline_no_fee
--   v_venue_booking_roster — walk-in name + un-windowed phone + origin
--   v_venue_earnings_daily — offline_gross_cents split (offline fee always 0)
--
-- Fixtures: a2 owns venue_a; pitch_a1 belongs to venue_a. The walk-in row
-- is inserted as postgres (the Edge Function writes as service role, which
-- also bypasses RLS — same trust level the test simulates).
BEGIN;
SELECT plan(13);

-- 1. app bookings cannot smuggle walk-in fields
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state,
      base_price_cents, total_cents, platform_fee_cents,
      cancellation_policy, walk_in_name
    ) VALUES (
      'RLS-2026-W001',
      '00000000-0000-4000-8000-0000000000a4'::uuid,
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      now() + interval '3 hours', now() + interval '4 hours', 'confirmed',
      4000, 4000, 400, 'standard', 'Smuggled Name'
    )$$,
  '23514',
  NULL,
  'bookings: walk_in_name rejected when origin is app'
);

-- 2. bogus origin rejected
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state, origin,
      base_price_cents, total_cents, platform_fee_cents, cancellation_policy
    ) VALUES (
      'RLS-2026-W002',
      '00000000-0000-4000-8000-0000000000a4'::uuid,
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      now() + interval '3 hours', now() + interval '4 hours', 'confirmed',
      'phone_call', 4000, 4000, 400, 'standard'
    )$$,
  '23514',
  NULL,
  'bookings: unknown origin rejected'
);

-- 3. bogus payment_method rejected
SELECT throws_ok(
  $$INSERT INTO public.payments (
      booking_id, stripe_payment_intent_id, amount_cents,
      application_fee_cents, status, payment_method
    ) VALUES (
      '00000000-0000-4000-8000-0000000000f1'::uuid,
      'pi_rls_bogus_method', 4000, 400, 'succeeded', 'cheque'
    )$$,
  '23514',
  NULL,
  'payments: unknown payment_method rejected'
);

-- 4. a walk-in paid at the venue cannot carry a Ludi fee
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state, origin,
      walk_in_name, base_price_cents, total_cents, platform_fee_cents,
      cancellation_policy
    ) VALUES (
      'RLS-2026-W003',
      '00000000-0000-4000-8000-0000000000a2'::uuid,
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      now() + interval '5 hours', now() + interval '6 hours', 'confirmed',
      'walk_in', 'Fee Walk-in', 4000, 4000, 400, 'standard'
    )$$,
  '23514',
  NULL,
  'bookings: a walk-in paid at the venue with a platform fee is rejected'
);

-- 5. an offline payment cannot carry a Ludi fee
SELECT throws_ok(
  $$INSERT INTO public.payments (
      booking_id, stripe_payment_intent_id, amount_cents,
      application_fee_cents, status, payment_method
    ) VALUES (
      '00000000-0000-4000-8000-0000000000f1'::uuid,
      'offline_rls_fee_rejected', 4000, 400, 'succeeded', 'offline'
    )$$,
  '23514',
  NULL,
  'payments: an offline payment with an application fee is rejected'
);

-- 5b. a prepaid walk-in (paid through Ludi, agreement 6.5) carries the fee
SELECT lives_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state, origin, prepaid,
      walk_in_name, base_price_cents, total_cents, platform_fee_cents,
      cancellation_policy
    ) VALUES (
      'RLS-2026-W004',
      '00000000-0000-4000-8000-0000000000a2'::uuid,
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      now() + interval '50 hours', now() + interval '51 hours', 'confirmed',
      'walk_in', true, 'Prepaid Walk-in', 4000, 4000, 400, 'standard'
    )$$,
  'bookings: a prepaid walk-in may carry the platform fee'
);

-- 5c. only a walk-in can be marked prepaid
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state, prepaid,
      base_price_cents, total_cents, platform_fee_cents, cancellation_policy
    ) VALUES (
      'RLS-2026-W005',
      '00000000-0000-4000-8000-0000000000a4'::uuid,
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      now() + interval '53 hours', now() + interval '54 hours', 'confirmed',
      true, 4000, 4000, 400, 'standard'
    )$$,
  '23514',
  NULL,
  'bookings: an app booking cannot be marked prepaid'
);

-- The fixture walk-in: owner a2 took a booking at the desk for "Kostas",
-- kickoff in 30 hours (comfortably OUTSIDE the ADR-0023 window, which
-- must not matter for walk-ins), €40 taken at the desk, no Ludi fee.
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, origin,
  walk_in_name, walk_in_phone,
  base_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000fa'::uuid,
  'RLS-2026-W100',
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  '00000000-0000-4000-8000-0000000000c1'::uuid,
  now() + interval '30 hours', now() + interval '31 hours', 'confirmed',
  'walk_in', 'Kostas', '35799555666',
  4000, 4000, 0, 'standard'
);
-- created_at pinned 3 days back so the walk-in lands on its own earnings
-- bucket — the bootstrap's Stripe payment owns today's bucket, which
-- test 10 needs to be stripe-only.
INSERT INTO public.payments (
  booking_id, stripe_payment_intent_id, amount_cents,
  application_fee_cents, status, payment_method, created_at
) VALUES (
  '00000000-0000-4000-8000-0000000000fa'::uuid,
  'offline_00000000-0000-4000-8000-0000000000fa',
  4000, 0, 'succeeded', 'offline', now() - interval '3 days'
);

-- 6. roster: the owner sees the CUSTOMER's name, not their own
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT (first_name, last_name, origin)::text
     FROM public.v_venue_booking_roster
    WHERE booking_id = '00000000-0000-4000-8000-0000000000fa'::uuid),
  '(Kostas,,walk_in)',
  'v_venue_booking_roster: walk-in shows customer name and origin'
);

-- 7. roster: walk-in phone is NOT windowed (kickoff is 30h away)
SELECT is(
  (SELECT organiser_phone
     FROM public.v_venue_booking_roster
    WHERE booking_id = '00000000-0000-4000-8000-0000000000fa'::uuid),
  '35799555666',
  'v_venue_booking_roster: owner-entered walk-in phone is un-windowed'
);

-- 8. roster: app bookings still carry origin ''app'' and the window intact
SELECT is(
  (SELECT (origin, organiser_phone)::text
     FROM public.v_venue_booking_roster
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  '(app,)',
  'v_venue_booking_roster: app booking keeps origin + windowed phone'
);

-- 9. earnings: the walk-in's bucket (3 days back) is all-offline — the
--    split equals the gross, and carries no fee
SELECT is(
  (SELECT (gross_cents, offline_gross_cents, offline_fee_cents)::text
     FROM public.v_venue_earnings_daily
    WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid
      AND day = ((now() - interval '3 days') AT TIME ZONE 'Europe/Nicosia')::date),
  '(4000,4000,0)',
  'v_venue_earnings_daily: offline split shows the walk-in gross, fee 0'
);

-- 10. earnings: today's bucket (the bootstrap Stripe payment) reports a
--    zero offline split, not NULL
SELECT is(
  (SELECT (offline_gross_cents, offline_fee_cents)::text
     FROM public.v_venue_earnings_daily
    WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid
      AND day = (now() AT TIME ZONE 'Europe/Nicosia')::date),
  '(0,0)',
  'v_venue_earnings_daily: stripe-only day has zero (not NULL) offline split'
);

-- 11. stranger still sees no trace of any of it
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_booking_roster
    WHERE booking_id = '00000000-0000-4000-8000-0000000000fa'::uuid)
  + (SELECT count(*)::int FROM public.v_venue_earnings_daily),
  0,
  'walk-in data invisible to strangers through both views'
);

SELECT * FROM finish();
ROLLBACK;
