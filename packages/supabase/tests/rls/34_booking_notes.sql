-- 34_booking_notes.sql — owner comments on bookings (20260917000001)
-- Under test:
--   the venue's owner and manager write, read, change and clear a note on a
--     booking at their venue; the admin reads it
--   the player who made the booking cannot read it; a stranger cannot read
--     or write it; an empty note is refused
--
-- Fixtures: a2 owns and a3 manages venue_a; f1 is a4's booking on c1 at
-- venue_a; a5 is a stranger; a1 is the admin.
BEGIN;
SELECT plan(9);

-- 1. the owner writes a note
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT lives_ok(
  $$INSERT INTO public.booking_notes (booking_id, note)
    VALUES ('00000000-0000-4000-8000-0000000000f1', 'Pays cash at the desk')$$,
  'booking_notes: owner writes a note on a booking at their venue'
);

-- 2. and it carries who wrote it
SELECT is(
  (SELECT updated_by FROM public.booking_notes WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'),
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  'booking_notes: updated_by defaults to the writer'
);

-- 3. the manager changes it
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
UPDATE public.booking_notes SET note = 'Pays cash — bringing own ball'
WHERE booking_id = '00000000-0000-4000-8000-0000000000f1';
SELECT is(
  (SELECT note FROM public.booking_notes WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'),
  'Pays cash — bringing own ball',
  'booking_notes: manager updates the note'
);

-- 4. the player who booked cannot see it
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT count(*) FROM public.booking_notes),
  0::bigint,
  'booking_notes: the booking''s own player reads nothing'
);

-- 5. a stranger cannot see it
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*) FROM public.booking_notes),
  0::bigint,
  'booking_notes: stranger reads nothing'
);

-- 6. nor write one on someone else's venue
SELECT throws_ok(
  $$INSERT INTO public.booking_notes (booking_id, note)
    VALUES ('00000000-0000-4000-8000-0000000000f2', 'not mine')$$,
  '42501', NULL,
  'booking_notes: stranger cannot write'
);

-- 7. the admin reads it
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*) FROM public.booking_notes WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'),
  1::bigint,
  'booking_notes: admin reads the note'
);

-- 8. an empty note is refused
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$UPDATE public.booking_notes SET note = '   '
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'$$,
  '23514', NULL,
  'booking_notes: a blank note is refused'
);

-- 9. the owner clears it
DELETE FROM public.booking_notes WHERE booking_id = '00000000-0000-4000-8000-0000000000f1';
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*) FROM public.booking_notes WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'),
  0::bigint,
  'booking_notes: owner clears the note'
);

SELECT * FROM finish();
ROLLBACK;
