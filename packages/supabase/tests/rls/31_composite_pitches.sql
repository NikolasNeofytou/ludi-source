-- 31_composite_pitches.sql — composite pitches (20260915000001, ADR-0032)
-- Under test:
--   pitch_components RLS (read with the parent; written by its venue)
--   tg_pitch_components_guard (same venue, one level)
--   tg_bookings_composite_guard (a booking on the composite blocks its
--     members and vice versa; siblings stay independent)
--   get_available_slots / bookings_on_date read through pitch_blockers
--   is_pitch_bookable with an inactive member
--
-- Fixtures: pitch_a1 (c1) is the bootstrap's verified leaf with Monday
-- 09:00–17:00 hours and bookings at 10:00 (v_other) and 12:00 (v_admin)
-- on 2030-01-07. This file adds a second leaf a3 (c4) and a 7-a-side a7
-- (c7) made of a1 + a3, both with the same Monday hours.
BEGIN;
SELECT plan(21);

-- Fixtures as postgres (the Edge Functions write as service role).
INSERT INTO public.pitches (id, venue_id, name, type, surface, price_per_hour_cents, is_verified, is_active)
VALUES
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000b1', 'Pitch A3 (leaf)', '5-a-side', 'turf', 4000, TRUE, TRUE),
  ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-0000000000b1', 'Pitch A7 (a1+a3)', '7-a-side', 'turf', 7000, TRUE, TRUE);

INSERT INTO public.pitch_components (parent_pitch_id, child_pitch_id) VALUES
  ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-0000000000c4');

INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at, slot_duration_minutes) VALUES
  ('00000000-0000-4000-8000-0000000000c4', 1, '09:00', '17:00', 60),
  ('00000000-0000-4000-8000-0000000000c7', 1, '09:00', '17:00', 60);

-- 1. anon reads the make-up of a bookable composite
SELECT public.set_test_anon();
SELECT is(
  (SELECT count(*) FROM public.pitch_components WHERE parent_pitch_id = '00000000-0000-4000-8000-0000000000c7'),
  2::bigint,
  'pitch_components: anon sees the members of a verified composite'
);

-- 2. a stranger cannot compose someone else's pitches
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT throws_ok(
  $$INSERT INTO public.pitch_components (parent_pitch_id, child_pitch_id)
    VALUES ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c4')$$,
  '42501',
  NULL,
  'pitch_components: stranger insert refused by RLS'
);

-- 3. the owner cannot reach across venues
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$INSERT INTO public.pitch_components (parent_pitch_id, child_pitch_id)
    VALUES ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c3')$$,
  '23514',
  NULL,
  'pitch_components: member at another venue refused'
);

-- 4. a composite cannot be a member
SELECT throws_ok(
  $$INSERT INTO public.pitch_components (parent_pitch_id, child_pitch_id)
    VALUES ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c7')$$,
  '23514',
  NULL,
  'pitch_components: composite as member refused (no nesting)'
);

-- 5. a member cannot itself be made of others
SELECT throws_ok(
  $$INSERT INTO public.pitch_components (parent_pitch_id, child_pitch_id)
    VALUES ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c4')$$,
  '23514',
  NULL,
  'pitch_components: member as parent refused (no nesting)'
);

RESET ROLE;

-- 6. booking the composite at 13:00
SELECT lives_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state,
      base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
    ) VALUES (
      'RLS-2030-C701', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c7',
      (date '2030-01-07' + time '13:00') AT TIME ZONE 'Europe/Nicosia',
      (date '2030-01-07' + time '14:00') AT TIME ZONE 'Europe/Nicosia',
      'paid', 7000, 0, 7000, 700, 'standard'
    )$$,
  'bookings: the composite books normally'
);

-- 7 + 8. its halves are taken for that hour
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state,
      base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
    ) VALUES (
      'RLS-2030-C702', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c1',
      (date '2030-01-07' + time '13:00') AT TIME ZONE 'Europe/Nicosia',
      (date '2030-01-07' + time '14:00') AT TIME ZONE 'Europe/Nicosia',
      'paid', 4000, 0, 4000, 400, 'standard'
    )$$,
  '23P01',
  NULL,
  'bookings: a member is blocked while the composite is booked (a1)'
);
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state,
      base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
    ) VALUES (
      'RLS-2030-C703', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c4',
      (date '2030-01-07' + time '13:30') AT TIME ZONE 'Europe/Nicosia',
      (date '2030-01-07' + time '14:30') AT TIME ZONE 'Europe/Nicosia',
      'pending', 4000, 0, 4000, 400, 'standard'
    )$$,
  '23P01',
  NULL,
  'bookings: a member is blocked on a partial overlap too (a3, pending)'
);

-- 9 + 10. a member booked → the composite is blocked
SELECT lives_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state,
      base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
    ) VALUES (
      'RLS-2030-C704', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c1',
      (date '2030-01-07' + time '14:00') AT TIME ZONE 'Europe/Nicosia',
      (date '2030-01-07' + time '15:00') AT TIME ZONE 'Europe/Nicosia',
      'paid', 4000, 0, 4000, 400, 'standard'
    )$$,
  'bookings: a member books normally'
);
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state,
      base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
    ) VALUES (
      'RLS-2030-C705', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c7',
      (date '2030-01-07' + time '14:00') AT TIME ZONE 'Europe/Nicosia',
      (date '2030-01-07' + time '15:00') AT TIME ZONE 'Europe/Nicosia',
      'paid', 7000, 0, 7000, 700, 'standard'
    )$$,
  '23P01',
  NULL,
  'bookings: the composite is blocked while a member is booked'
);

-- 11. siblings stay independent
SELECT lives_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state,
      base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
    ) VALUES (
      'RLS-2030-C706', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c4',
      (date '2030-01-07' + time '14:00') AT TIME ZONE 'Europe/Nicosia',
      (date '2030-01-07' + time '15:00') AT TIME ZONE 'Europe/Nicosia',
      'paid', 4000, 0, 4000, 400, 'standard'
    )$$,
  'bookings: the other member is free at the same hour'
);

-- 12–15. availability of the composite: subtracts its own and both halves'
SELECT is(
  (SELECT s.is_available FROM public.get_available_slots('00000000-0000-4000-8000-0000000000c7', '2030-01-07', '2030-01-07') AS s
   WHERE s.starts_at = (date '2030-01-07' + time '15:00') AT TIME ZONE 'Europe/Nicosia'),
  TRUE,
  'slots: composite 15:00 free'
);
SELECT is(
  (SELECT s.is_available FROM public.get_available_slots('00000000-0000-4000-8000-0000000000c7', '2030-01-07', '2030-01-07') AS s
   WHERE s.starts_at = (date '2030-01-07' + time '10:00') AT TIME ZONE 'Europe/Nicosia'),
  FALSE,
  'slots: composite 10:00 taken by the bootstrap booking on a1'
);
SELECT is(
  (SELECT s.is_available FROM public.get_available_slots('00000000-0000-4000-8000-0000000000c7', '2030-01-07', '2030-01-07') AS s
   WHERE s.starts_at = (date '2030-01-07' + time '13:00') AT TIME ZONE 'Europe/Nicosia'),
  FALSE,
  'slots: composite 13:00 taken by its own booking'
);
SELECT is(
  (SELECT s.is_available FROM public.get_available_slots('00000000-0000-4000-8000-0000000000c7', '2030-01-07', '2030-01-07') AS s
   WHERE s.starts_at = (date '2030-01-07' + time '14:00') AT TIME ZONE 'Europe/Nicosia'),
  FALSE,
  'slots: composite 14:00 taken by bookings on both halves'
);

-- 16 + 17. availability of a member: subtracts the composite's booking
SELECT is(
  (SELECT s.is_available FROM public.get_available_slots('00000000-0000-4000-8000-0000000000c1', '2030-01-07', '2030-01-07') AS s
   WHERE s.starts_at = (date '2030-01-07' + time '13:00') AT TIME ZONE 'Europe/Nicosia'),
  FALSE,
  'slots: a1 13:00 taken by the composite'
);
SELECT is(
  (SELECT s.is_available FROM public.get_available_slots('00000000-0000-4000-8000-0000000000c4', '2030-01-07', '2030-01-07') AS s
   WHERE s.starts_at = (date '2030-01-07' + time '13:00') AT TIME ZONE 'Europe/Nicosia'),
  FALSE,
  'slots: a3 13:00 taken by the composite'
);

-- 18. the schedule guard on a member counts the composite's booking
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.bookings_on_date('00000000-0000-4000-8000-0000000000c1', '2030-01-07') AS b
    WHERE b.code = 'RLS-2030-C701'
  ),
  'bookings_on_date(a1): includes the booking on the composite'
);
RESET ROLE;

-- 19. cancelling the composite's booking frees the member
UPDATE public.bookings SET state = 'cancelled', cancelled_at = now() WHERE code = 'RLS-2030-C701';
SELECT is(
  (SELECT s.is_available FROM public.get_available_slots('00000000-0000-4000-8000-0000000000c1', '2030-01-07', '2030-01-07') AS s
   WHERE s.starts_at = (date '2030-01-07' + time '13:00') AT TIME ZONE 'Europe/Nicosia'),
  TRUE,
  'slots: a1 13:00 free once the composite booking is cancelled'
);

-- 20 + 21. a composite with an inactive member is not bookable
SELECT is(public.is_pitch_bookable('00000000-0000-4000-8000-0000000000c7'), TRUE, 'is_pitch_bookable: composite with active members');
UPDATE public.pitches SET is_active = FALSE WHERE id = '00000000-0000-4000-8000-0000000000c4';
SELECT is(public.is_pitch_bookable('00000000-0000-4000-8000-0000000000c7'), FALSE, 'is_pitch_bookable: false once a member is inactive');

SELECT * FROM finish();
ROLLBACK;
