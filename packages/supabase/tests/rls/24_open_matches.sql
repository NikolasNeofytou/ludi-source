-- 24_open_matches.sql — the community board (ADR-0028)
--
-- Objects under test (migrations 20260831000003 + 20260901000001):
--   bookings.is_open + bookings_update_open_self  — organiser-only flip
--   tg_bookings_block_columns_for_organiser       — the column-level half
--   v_open_fixtures                               — listed only while open,
--                                                   live, future, short a
--                                                   player; authenticated
--                                                   only; counts, never names
--   bookings.open_level                           — the listing's level tag,
--                                                   guard's second column
--
-- Bootstrap fixtures: booking f1 belongs to `other` (a4), starts in 2030,
-- 2 gk + 8 outfield, so it is open-able and short. f3 (a4's) already
-- kicked off; f4 (a4's) is cancelled.
BEGIN;
SELECT plan(22);

-- ────────────────────────────────────────────────────────────────────
-- Extra fixtures, created as the test superuser: a FULL fixture (1+1,
-- both seats taken) and an unpaid 'pending' one, both pre-opened so the
-- board predicate — not the flip path — is what excludes them.
-- ────────────────────────────────────────────────────────────────────
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  gk_slots, outfield_slots, is_open,
  base_price_cents, addons_price_cents, total_cents,
  platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000f5',
  'RLS-2030-0005',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1',
  now() + interval '5 days',
  now() + interval '5 days' + interval '1 hour',
  'confirmed',
  1, 1, TRUE,
  4000, 0, 4000, 400, 'standard'
), (
  '00000000-0000-4000-8000-0000000000f6',
  'RLS-2030-0006',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1',
  now() + interval '6 days',
  now() + interval '6 days' + interval '1 hour',
  'pending',
  2, 8, TRUE,
  4000, 0, 4000, 400, 'standard'
);

-- Fill f5's remaining seat (the organiser was auto-seated outfield).
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status)
VALUES (
  '00000000-0000-4000-8000-0000000000f5',
  '00000000-0000-4000-8000-0000000000a5',
  'gk', 'in'
);

-- ────────────────────────────────────────────────────────────────────
-- The organiser's switch
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);

-- 1
SELECT lives_ok(
  $$UPDATE public.bookings SET is_open = TRUE
     WHERE id = '00000000-0000-4000-8000-0000000000f1'$$,
  'bookings_update_open_self: the organiser can open their own fixture'
);

-- 2
SELECT is(
  (SELECT is_open FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  TRUE,
  'the flip persisted'
);

-- 3 — the column-level half: same row, any other column
SELECT throws_ok(
  $$UPDATE public.bookings SET total_cents = 1
     WHERE id = '00000000-0000-4000-8000-0000000000f1'$$,
  '42501',
  'an organiser may open or close their fixture, nothing else',
  'tg_bookings_block_columns_for_organiser: money columns are frozen'
);

-- 4 — a legitimate flip does not smuggle a second change through
SELECT throws_ok(
  $$UPDATE public.bookings SET is_open = FALSE, state = 'cancelled'
     WHERE id = '00000000-0000-4000-8000-0000000000f1'$$,
  '42501',
  'an organiser may open or close their fixture, nothing else',
  'tg_bookings_block_columns_for_organiser: is_open cannot carry passengers'
);

-- ────────────────────────────────────────────────────────────────────
-- A stranger cannot touch the listing, but can read the board
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);

-- 5 — the policy's USING filters their UPDATE to zero rows, silently
SELECT lives_ok(
  $$UPDATE public.bookings SET is_open = FALSE
     WHERE id = '00000000-0000-4000-8000-0000000000f1'$$,
  'bookings_update_open_self: a stranger''s close is a no-op, not an error'
);

-- 6
SELECT is(
  (SELECT count(*)::int FROM public.v_open_fixtures
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  1,
  'v_open_fixtures: the listing survived the stranger''s attempt'
);

-- 7 — the board hands them the capability, which is the feature
SELECT ok(
  (SELECT invite_token FROM public.v_open_fixtures
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid)
  IS NOT NULL,
  'v_open_fixtures: the row carries the invite capability (ADR-0028)'
);

-- 8 — the predicate: started, cancelled and pending stay off the board
SELECT is(
  (SELECT count(*)::int FROM public.v_open_fixtures
    WHERE booking_id IN (
      '00000000-0000-4000-8000-0000000000f3',
      '00000000-0000-4000-8000-0000000000f4',
      '00000000-0000-4000-8000-0000000000f6')),
  0,
  'v_open_fixtures: kicked-off, cancelled and pending fixtures are not listed'
);

-- 9 — full fixtures are not a place to play
SELECT is(
  (SELECT count(*)::int FROM public.v_open_fixtures
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f5'::uuid),
  0,
  'v_open_fixtures: a full fixture is delisted even while is_open'
);

-- 10 — minimisation is structural, not editorial (fixture_preview posture)
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_open_fixtures'
      AND column_name IN ('code', 'user_id', 'first_name', 'handle',
                          'platform_fee_cents', 'notes')),
  0,
  'v_open_fixtures: no code, no identities, no commercial columns'
);

-- ────────────────────────────────────────────────────────────────────
-- Closing delists immediately
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);

-- 11
SELECT lives_ok(
  $$UPDATE public.bookings SET is_open = FALSE
     WHERE id = '00000000-0000-4000-8000-0000000000f1'$$,
  'bookings_update_open_self: the organiser can close their listing'
);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);

-- 12
SELECT is(
  (SELECT count(*)::int FROM public.v_open_fixtures
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  0,
  'v_open_fixtures: closing removes the row on the next read'
);

-- ────────────────────────────────────────────────────────────────────
-- The board is a signed-in surface
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_anon();

-- 13
SELECT throws_ok(
  $$SELECT count(*) FROM public.v_open_fixtures$$,
  '42501',
  NULL,
  'v_open_fixtures: anon has no grant (ADR-0028 — the anon funnel is /f/<token>)'
);

-- 14 — anon holds the blanket table grant (production parity), so with no
-- policy in reach their open attempt is a silent zero-row no-op, not an
-- error. Test 15 proves it changed nothing.
SELECT lives_ok(
  $$UPDATE public.bookings SET is_open = TRUE
     WHERE id = '00000000-0000-4000-8000-0000000000f1'$$,
  'bookings_update_open_self: anon''s open attempt reaches no rows'
);

-- ────────────────────────────────────────────────────────────────────
-- The server side keeps its keys
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
RESET ROLE;

-- 15 — anon's attempt above landed on nothing
SELECT is(
  (SELECT is_open FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  FALSE,
  'the fixture the organiser closed stayed closed'
);

-- 16 — privileged writers pass the column guard (settle, expiry, webhook)
SELECT lives_ok(
  $$UPDATE public.bookings SET state = 'completed'
     WHERE id = '00000000-0000-4000-8000-0000000000f3'$$,
  'tg_bookings_block_columns_for_organiser: privileged writers are exempt'
);

-- 17 — and the definer view still filters by liveness for everyone
SELECT is(
  (SELECT count(*)::int FROM public.v_open_fixtures
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f3'::uuid),
  0,
  'v_open_fixtures: a completed fixture stays off the board'
);

-- ────────────────────────────────────────────────────────────────────
-- The level tag (migration 20260901000001)
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);

-- 18 — the guard's second writable column
SELECT lives_ok(
  $$UPDATE public.bookings SET is_open = TRUE, open_level = 'casual'
     WHERE id = '00000000-0000-4000-8000-0000000000f1'$$,
  'open_level: the organiser can tag their listing''s level'
);

-- 19
SELECT is(
  (SELECT open_level FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  'casual',
  'the level persisted'
);

-- 20 — still no passengers
SELECT throws_ok(
  $$UPDATE public.bookings SET open_level = 'competitive', total_cents = 1
     WHERE id = '00000000-0000-4000-8000-0000000000f1'$$,
  '42501',
  'an organiser may open or close their fixture, nothing else',
  'open_level cannot smuggle other columns through the guard'
);

-- 21 — structured means structured
SELECT throws_ok(
  $$UPDATE public.bookings SET open_level = 'sweaty'
     WHERE id = '00000000-0000-4000-8000-0000000000f1'$$,
  '23514',
  NULL,
  'bookings_open_level_valid: only casual/competitive/NULL'
);

-- 22 — the board carries it to strangers
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT open_level FROM public.v_open_fixtures
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  'casual',
  'v_open_fixtures: the level tag rides the row'
);

SELECT * FROM finish();
ROLLBACK;
