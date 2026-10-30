-- 40_contact_picker.sql — the booking form carries the picked contact
-- (20260918000003, slice C of docs/plans/owner-contacts.md)
--
-- The typeahead hands a booking the id of the regular the counter picked.
-- The trigger from 20260918000002 already finds a contact from a PHONE;
-- these assertions are about the case only the id can handle — a regular
-- with no usable number — and the one thing the id must never do: reach
-- across venues.
--
-- Fixtures (_bootstrap): a2 owns venue_a (b1, pitch c1); venue_b (b2) is
-- owned by nobody.
BEGIN;
SELECT plan(6);

-- A regular with no number, and one belonging to another venue. As
-- superuser, before any set_test_user.
INSERT INTO public.venue_contacts (id, venue_id, display_name, phone, source)
VALUES
  ('00000000-0000-4000-8000-0000000000e7'::uuid,
   '00000000-0000-4000-8000-0000000000b1'::uuid,
   'Ακαδημία Κ12', NULL, 'manual'),
  ('00000000-0000-4000-8000-0000000000e8'::uuid,
   '00000000-0000-4000-8000-0000000000b2'::uuid,
   'Elsewhere', '99 000 222', 'manual');

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);

-- 1. a series picked from the list keeps that person, even with no
--    phone to find them by — the reason p_contact_id exists. The call is
--    its own statement: inside the WHERE of a query on booking_series it
--    would run under that query's snapshot and never see its own row.
SELECT public.create_booking_series(
  '00000000-0000-4000-8000-0000000000b1'::uuid, 'Ακαδημία Κ12', NULL,
  ARRAY['00000000-0000-4000-8000-0000000000c1'::uuid], ARRAY[1]::smallint[],
  '16:00', 60, '2033-01-03', '2033-02-28',
  '00000000-0000-4000-8000-0000000000e7'::uuid
);
SELECT is(
  (SELECT s.contact_id FROM public.booking_series AS s
   WHERE s.name = 'Ακαδημία Κ12' AND s.starts_on = '2033-01-03'),
  '00000000-0000-4000-8000-0000000000e7'::uuid,
  'create_booking_series: a picked contact with no phone is linked by its id'
);

-- 2. but never one of another venue's
SELECT throws_ok(
  $$SELECT public.create_booking_series(
      '00000000-0000-4000-8000-0000000000b1'::uuid, 'Elsewhere', '99 000 222',
      ARRAY['00000000-0000-4000-8000-0000000000c1'::uuid], ARRAY[2]::smallint[],
      '16:00', 60, '2033-01-04', '2033-02-28',
      '00000000-0000-4000-8000-0000000000e8'::uuid)$$,
  '23514',
  NULL,
  'create_booking_series: another venue''s contact is refused'
);

-- 3. the old nine-argument call still works — the /standing form and any
--    caller written before this migration — and still finds the contact
--    from the phone
SELECT public.create_booking_series(
  '00000000-0000-4000-8000-0000000000b1'::uuid, 'Νίκος', '99 444 555',
  ARRAY['00000000-0000-4000-8000-0000000000c1'::uuid], ARRAY[3]::smallint[],
  '16:00', 60, '2033-01-05', '2033-02-28'
);
SELECT is(
  (SELECT c.phone_e164 FROM public.booking_series AS s
   INNER JOIN public.venue_contacts AS c ON c.id = s.contact_id
   WHERE s.name = 'Νίκος' AND s.starts_on = '2033-01-05'),
  '+35799444555',
  'create_booking_series: without a contact id, the phone still finds one'
);

-- 4. only one signature exists — an overload beside it would leave
--    PostgREST unable to choose
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM pg_proc
   WHERE proname = 'create_booking_series' AND pronamespace = 'public'::regnamespace),
  1,
  'create_booking_series: exactly one signature'
);

-- 5. a one-off walk-in carrying the picked id keeps it, again with no
--    phone — create-walk-in-booking's path, which inserts as the service
--    role exactly as this does
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, origin,
  walk_in_name, walk_in_phone, contact_id,
  base_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000e9'::uuid, 'RLS-2033-P001',
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  '00000000-0000-4000-8000-0000000000c1'::uuid,
  '2033-03-01 18:00+00', '2033-03-01 19:00+00', 'confirmed', 'walk_in',
  'Ακαδημία Κ12', NULL, '00000000-0000-4000-8000-0000000000e7'::uuid,
  6000, 6000, 0, 'standard'
);
SELECT is(
  (SELECT b.contact_id FROM public.bookings AS b
   WHERE b.id = '00000000-0000-4000-8000-0000000000e9'::uuid),
  '00000000-0000-4000-8000-0000000000e7'::uuid,
  'walk-in: a picked contact with no phone is kept by its id'
);

-- 6. and a walk-in carrying another venue's id is refused, which is the
--    error create-walk-in-booking turns into "pick them again"
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state, origin,
      walk_in_name, contact_id,
      base_price_cents, total_cents, platform_fee_cents, cancellation_policy
    ) VALUES (
      'RLS-2033-P002', '00000000-0000-4000-8000-0000000000a2'::uuid,
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      '2033-03-08 18:00+00', '2033-03-08 19:00+00', 'confirmed', 'walk_in',
      'Elsewhere', '00000000-0000-4000-8000-0000000000e8'::uuid,
      6000, 6000, 0, 'standard')$$,
  '23514',
  NULL,
  'walk-in: another venue''s contact is refused'
);

SELECT * FROM finish();
ROLLBACK;
