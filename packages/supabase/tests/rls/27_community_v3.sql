-- 27_community_v3.sql — the organiser & the thread (migration 20260902000003)
--
-- Objects under test:
--   my_fixtures_to_fill()          — the organiser lane; own fixtures only
--   v_open_fixtures.played_with_squad — the familiarity signal; SYMMETRIC
--   my_series()                    — the thread; floor of two completed
--
-- Bootstrap has f1 (a4, future, paid) and f2 (a1, future, paid). Every
-- past-tense fixture and the repeated slot are built here, inside this
-- file's own rolled-back transaction.
BEGIN;
SELECT plan(10);

-- ────────────────────────────────────────────────────────────────────
-- Setup, as superuser.
--   fb, fc — the repeated slot: same pitch, both Tuesdays, both 20:00
--            local, both played. Two is the floor my_series() enforces.
--   fd     — the next one in that same slot, still to come.
--   a5     — seated on fb only: one completed match, which makes them
--            BOTH the familiarity signal's positive case (they have
--            stood with a4) and my_series()'s negative case (one match
--            is not a thread).
-- ────────────────────────────────────────────────────────────────────
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents,
  platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000fb',
  'RLS-2030-0011',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1',
  (date '2025-01-07' + time '20:00') AT TIME ZONE 'Europe/Nicosia',
  (date '2025-01-07' + time '21:00') AT TIME ZONE 'Europe/Nicosia',
  'completed',
  4000, 0, 4000, 400, 'standard'
), (
  '00000000-0000-4000-8000-0000000000fc',
  'RLS-2030-0012',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1',
  (date '2025-01-14' + time '20:00') AT TIME ZONE 'Europe/Nicosia',
  (date '2025-01-14' + time '21:00') AT TIME ZONE 'Europe/Nicosia',
  'completed',
  4000, 0, 4000, 400, 'standard'
), (
  '00000000-0000-4000-8000-0000000000fd',
  'RLS-2030-0013',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1',
  (date '2030-01-08' + time '20:00') AT TIME ZONE 'Europe/Nicosia',
  (date '2030-01-08' + time '21:00') AT TIME ZONE 'Europe/Nicosia',
  'paid',
  4000, 0, 4000, 400, 'standard'
);

-- a5 stood on the first of the two played fixtures, and nothing else.
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status)
VALUES (
  '00000000-0000-4000-8000-0000000000fb',
  '00000000-0000-4000-8000-0000000000a5',
  'outfield', 'in'
);

-- f1 goes on the board so the familiarity signal has a row to ride on.
-- Superuser is a privileged writer, so the organiser column guard lets
-- this through.
UPDATE public.bookings
   SET is_open = TRUE
 WHERE id = '00000000-0000-4000-8000-0000000000f1';

-- ────────────────────────────────────────────────────────────────────
-- 1. The organiser lane
-- ────────────────────────────────────────────────────────────────────

-- 1 — a4 sees their own two future fixtures with seats left, in kickoff
-- order, and never a1's f2. fb/fc are past; the lane is forward-looking.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT results_eq(
  $$SELECT booking_id FROM public.my_fixtures_to_fill()$$,
  $$VALUES ('00000000-0000-4000-8000-0000000000f1'::uuid),
           ('00000000-0000-4000-8000-0000000000fd'::uuid)$$,
  'my_fixtures_to_fill: own future unfilled fixtures, kickoff order, no one else''s'
);

-- 2 — the lane carries the invite token, which is the whole point of it
SELECT isnt(
  (SELECT invite_token FROM public.my_fixtures_to_fill()
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  NULL,
  'my_fixtures_to_fill: the row carries the invite token for the share'
);

-- 3 — a player who organises nothing has an empty lane, not an error
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.my_fixtures_to_fill()),
  0,
  'my_fixtures_to_fill: a non-organiser sees nothing'
);

-- 4 — anon may not call it at all
SELECT public.set_test_anon();
SELECT throws_ok(
  $$SELECT * FROM public.my_fixtures_to_fill()$$,
  '42501',
  NULL,
  'my_fixtures_to_fill: no anon EXECUTE grant'
);

-- ────────────────────────────────────────────────────────────────────
-- 2. The familiarity signal
-- ────────────────────────────────────────────────────────────────────

-- 5 — a5 has played with a4 (on fb), and a4 holds the only seat on f1
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT played_with_squad FROM public.v_open_fixtures
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  1,
  'played_with_squad: counts the seated player the viewer has completed a match with'
);

-- 6 — a3 shares no completed fixture with anyone on that roster
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT is(
  (SELECT played_with_squad FROM public.v_open_fixtures
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  0,
  'played_with_squad: a viewer with no shared history reads zero'
);

-- 7 — the number is symmetric, so the viewer's own seat never inflates
-- it: a4 IS the roster of f1 and still reads zero.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT played_with_squad FROM public.v_open_fixtures
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  0,
  'played_with_squad: the viewer never counts themselves'
);

-- ────────────────────────────────────────────────────────────────────
-- 3. The thread
-- ────────────────────────────────────────────────────────────────────

-- 8 — a4's two played Tuesdays collapse into one series, on the local
-- clock (isodow 2, 20:00 Europe/Nicosia), and the Monday fixture with
-- nothing played in it does not qualify.
SELECT results_eq(
  $$SELECT weekday, kickoff_hour, played FROM public.my_series()$$,
  $$VALUES (2, 20, 2)$$,
  'my_series: the repeated slot is one row, on the local clock'
);

-- 9 — and it knows the next one
SELECT is(
  (SELECT next_booking_id FROM public.my_series()),
  '00000000-0000-4000-8000-0000000000fd'::uuid,
  'my_series: the series carries its next booked fixture'
);

-- 10 — a5 played once. One match is not a series.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.my_series()),
  0,
  'my_series: a single completed match is below the floor'
);

SELECT * FROM finish();
ROLLBACK;
