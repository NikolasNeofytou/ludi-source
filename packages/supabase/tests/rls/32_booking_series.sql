-- 32_booking_series.sql — standing bookings (20260915000002, ADR-0033)
-- Dates are Cyprus dates: materialise_booking_series starts from
-- (now() AT TIME ZONE 'Europe/Nicosia')::date, and between midnight and
-- 03:00 in Cyprus that is a day ahead of current_date on a UTC server
-- (CI). Found 2026-10-15 01:32 EEST when the suite failed 3/19 on an
-- unrelated PR.
-- Under test:
--   create_booking_series: owner of the venue may; other venue / stranger may not
--   materialise_booking_series: instances are plain walk-ins carrying series_id,
--     one per (court, matching day) to the horizon; re-running adds nothing;
--     an un-booked instance is not re-created; a collision becomes a skip row
--     and the rest of the run still happens; the composite guard holds
--   end_booking_series: cancels future instances (and their offline payments)
--     past the end date, keeps earlier ones
--   RLS: owner reads own series, stranger reads none
--
-- Fixtures: a2 owns venue_a; c1 (Mon 09–17) and a fresh leaf c4 belong to
-- venue_a; b1 belongs to venue_b. Dates are anchored on the real "today"
-- because the materialiser is; the horizon is kept short (14 days).
BEGIN;
SELECT plan(19);

INSERT INTO public.pitches (id, venue_id, name, type, surface, price_per_hour_cents, is_verified, is_active)
VALUES ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000b1', 'Pitch A3 (leaf)', '5-a-side', 'turf', 4000, TRUE, TRUE);

-- 1. a stranger cannot create a series at venue_a
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT throws_ok(
  $$SELECT public.create_booking_series(
      '00000000-0000-4000-8000-0000000000b1', 'Academy', NULL,
      ARRAY['00000000-0000-4000-8000-0000000000c1']::uuid[], ARRAY[1,2,3,4,5]::smallint[],
      '16:00', 120, (now() AT TIME ZONE 'Europe/Nicosia')::date, NULL)$$,
  '42501', NULL,
  'create_booking_series: stranger refused'
);

-- 2. the owner cannot cover another venue's court
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$SELECT public.create_booking_series(
      '00000000-0000-4000-8000-0000000000b1', 'Academy', NULL,
      ARRAY['00000000-0000-4000-8000-0000000000c3']::uuid[], ARRAY[1]::smallint[],
      '16:00', 60, (now() AT TIME ZONE 'Europe/Nicosia')::date, NULL)$$,
  '23514', NULL,
  'create_booking_series: court at another venue refused'
);

-- 3. the owner creates: every weekday, two courts, 16:00 for 2 h, 14 days
--    (the horizon is 56 by default; materialise is re-run below with 14 for
--    a countable number, but creation itself already fills 56 days)
SELECT lives_ok(
  $$SELECT public.create_booking_series(
      '00000000-0000-4000-8000-0000000000b1', 'Academy U12', '99123456',
      ARRAY['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c4']::uuid[],
      ARRAY[0,1,2,3,4,5,6]::smallint[],
      '16:00', 120, (now() AT TIME ZONE 'Europe/Nicosia')::date, (now() AT TIME ZONE 'Europe/Nicosia')::date + 13)$$,
  'create_booking_series: owner creates a 14-day, 2-court, every-day series'
);

-- 4. it made 2 courts × 14 days = 28 instances, all walk-ins with no fee
SELECT is(
  (SELECT count(*) FROM public.bookings b
   JOIN public.booking_series s ON s.id = b.series_id
   WHERE s.name = 'Academy U12' AND b.origin = 'walk_in' AND b.platform_fee_cents = 0 AND b.state = 'confirmed'),
  28::bigint,
  'materialise: 28 confirmed walk-in instances'
);

-- 5. each carries the venue's price for two hours (4000 × 2)
SELECT is(
  (SELECT min(total_cents) || '-' || max(total_cents) FROM public.bookings b
   JOIN public.booking_series s ON s.id = b.series_id WHERE s.name = 'Academy U12'),
  '8000-8000',
  'materialise: instance price is the court rate × duration'
);

-- 6. each has an offline payments row, no fee
SELECT is(
  (SELECT count(*) FROM public.payments p
   JOIN public.bookings b ON b.id = p.booking_id
   JOIN public.booking_series s ON s.id = b.series_id
   WHERE s.name = 'Academy U12' AND p.payment_method = 'offline' AND p.application_fee_cents = 0 AND p.status = 'succeeded'),
  28::bigint,
  'materialise: one offline payment per instance'
);

-- 7. the owner reads the series; the stranger does not
SELECT is(
  (SELECT count(*) FROM public.booking_series WHERE name = 'Academy U12'),
  1::bigint,
  'booking_series: owner reads own series'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*) FROM public.booking_series WHERE name = 'Academy U12'),
  0::bigint,
  'booking_series: stranger reads nothing'
);
RESET ROLE;

-- 9. the audit row
SELECT is(
  (SELECT count(*) FROM public.admin_actions WHERE action_type = 'series_created' AND reason LIKE 'standing booking "Academy U12"%'),
  1::bigint,
  'audit: series_created written'
);

-- 10. re-running as the scheduler adds nothing
SELECT is(
  public.materialise_booking_series(NULL, 56),
  0,
  'materialise: re-run is idempotent'
);

-- 11. un-book one instance, re-run: it is not re-created
UPDATE public.bookings SET state = 'cancelled', cancelled_at = now()
WHERE id = (SELECT b.id FROM public.bookings b JOIN public.booking_series s ON s.id = b.series_id
            WHERE s.name = 'Academy U12' ORDER BY b.starts_at LIMIT 1);
SELECT is(
  public.materialise_booking_series(NULL, 56),
  0,
  'materialise: an un-booked week stays un-booked'
);

-- 12–13. a collision skips one instance and records it; the rest still land.
--   An app booking already sits on c4 at 16:00 in 20 days (past the current
--   series end, so it collides with a second series only).
INSERT INTO public.bookings (
  code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES (
  'RLS-2026-S001', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c4',
  (((now() AT TIME ZONE 'Europe/Nicosia')::date + 20) + time '16:00') AT TIME ZONE 'Europe/Nicosia',
  (((now() AT TIME ZONE 'Europe/Nicosia')::date + 20) + time '17:00') AT TIME ZONE 'Europe/Nicosia',
  'paid', 4000, 0, 4000, 400, 'standard'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT lives_ok(
  $$SELECT public.create_booking_series(
      '00000000-0000-4000-8000-0000000000b1', 'Academy U16', NULL,
      ARRAY['00000000-0000-4000-8000-0000000000c4']::uuid[],
      ARRAY[0,1,2,3,4,5,6]::smallint[],
      '16:00', 60, (now() AT TIME ZONE 'Europe/Nicosia')::date + 20, (now() AT TIME ZONE 'Europe/Nicosia')::date + 22)$$,
  'create_booking_series: a series over an existing booking still creates'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.bookings b JOIN public.booking_series s ON s.id = b.series_id WHERE s.name = 'Academy U16'),
  2::bigint,
  'materialise: the two free days landed'
);
SELECT is(
  (SELECT reason FROM public.booking_series_skips k JOIN public.booking_series s ON s.id = k.series_id
   WHERE s.name = 'Academy U16' AND k.on_date = (now() AT TIME ZONE 'Europe/Nicosia')::date + 20),
  'already booked',
  'materialise: the taken day is a skip row, not a failure'
);

-- 15. the composite guard: a 7v7 over c1 + c4 cannot be booked while an
--     instance holds c4
INSERT INTO public.pitches (id, venue_id, name, type, surface, price_per_hour_cents, is_verified, is_active)
VALUES ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-0000000000b1', 'Pitch A7', '7-a-side', 'turf', 7000, TRUE, TRUE);
INSERT INTO public.pitch_components (parent_pitch_id, child_pitch_id) VALUES
  ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-0000000000c4');
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state,
      base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
    ) VALUES (
      'RLS-2026-S002', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c7',
      (((now() AT TIME ZONE 'Europe/Nicosia')::date + 21) + time '16:00') AT TIME ZONE 'Europe/Nicosia',
      (((now() AT TIME ZONE 'Europe/Nicosia')::date + 21) + time '17:00') AT TIME ZONE 'Europe/Nicosia',
      'paid', 7000, 0, 7000, 700, 'standard'
    )$$,
  '23P01', NULL,
  'composite guard: the 7v7 is blocked while an instance holds a half'
);

-- 16–18. ending: instances after the end date are cancelled with their
--        payments; earlier ones stay
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
-- 7 days (today+7 … today+13) × 2 courts; the un-booked instance was the
-- earliest, so it is not among them. (Compared to a literal: a subquery in
-- the same SELECT would be planned as an initplan and run BEFORE the call.)
SELECT is(
  public.end_booking_series(
    (SELECT id FROM public.booking_series WHERE name = 'Academy U12'),
    (now() AT TIME ZONE 'Europe/Nicosia')::date + 6
  ),
  14,
  'end_booking_series: cancels exactly the instances past the end date'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.bookings b JOIN public.booking_series s ON s.id = b.series_id
   WHERE s.name = 'Academy U12' AND b.state = 'confirmed'
     AND (b.starts_at AT TIME ZONE 'Europe/Nicosia')::date <= (now() AT TIME ZONE 'Europe/Nicosia')::date + 6),
  13::bigint,
  'end_booking_series: the 7 days × 2 courts before the end stay (minus the one un-booked)'
);
-- Only the instances the end cancelled: the one un-booked by hand above
-- kept its payment row, exactly as a raw UPDATE would (the walk-in cancel
-- function is what cancels payments on that path).
SELECT is(
  (SELECT count(*) FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id
   JOIN public.booking_series s ON s.id = b.series_id
   WHERE s.name = 'Academy U12' AND b.state = 'cancelled'
     AND (b.starts_at AT TIME ZONE 'Europe/Nicosia')::date > (now() AT TIME ZONE 'Europe/Nicosia')::date + 6
     AND p.status <> 'cancelled'),
  0::bigint,
  'end_booking_series: cancelled instances have cancelled payments'
);

-- 19. after ending, the scheduler makes nothing new for it
SELECT is(
  public.materialise_booking_series(NULL, 56),
  0,
  'materialise: an ended series stays ended'
);

SELECT * FROM finish();
ROLLBACK;
