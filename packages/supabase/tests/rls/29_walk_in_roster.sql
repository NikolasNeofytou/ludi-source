-- 29_walk_in_roster.sql — a walk-in is the owner's bookkeeping, not a
-- fixture the owner plays in (migration 20260913000003).
--
-- Walk-ins carry the ACTING owner as bookings.user_id. Before this
-- migration the seat-organiser trigger made that owner an 'in' player on
-- every walk-in: it counted in their match record, listed in their player
-- app, and let them open the walk-in onto the public board.
--
-- Fixture recap (_bootstrap.sql): a2 owns venue_a (pitch c1) and has no
-- bookings of their own; a4 is a player.
BEGIN;
SELECT plan(5);

-- A walk-in owner a2 logged for "Kostas" and that has since been played.
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, origin,
  walk_in_name, walk_in_phone,
  base_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000ed'::uuid,
  'RLS-2026-W200',
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  '00000000-0000-4000-8000-0000000000c1'::uuid,
  '2026-01-10 18:00+00', '2026-01-10 19:00+00', 'completed',
  'walk_in', 'Kostas', '35799555666',
  4000, 4000, 0, 'standard'
);

-- 1 — nobody is seated on a walk-in
SELECT is(
  (SELECT count(*)::int FROM public.booking_participants
    WHERE booking_id = '00000000-0000-4000-8000-0000000000ed'::uuid),
  0,
  'walk-in roster: the acting owner is not seated as a player'
);

-- 2 — app bookings still seat their organiser (the invariant stands)
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents,
  cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000ee'::uuid,
  'RLS-2031-0013',
  '00000000-0000-4000-8000-0000000000a4'::uuid,
  '00000000-0000-4000-8000-0000000000c1'::uuid,
  '2031-09-06 18:00+00', '2031-09-06 19:00+00', 'confirmed',
  4000, 0, 4000, 400,
  'standard'
);
SELECT is(
  (SELECT (user_id, status)::text FROM public.booking_participants
    WHERE booking_id = '00000000-0000-4000-8000-0000000000ee'::uuid),
  '(00000000-0000-4000-8000-0000000000a4,in)',
  'walk-in roster: an app booking still seats its organiser'
);

-- 3 — the walk-in is not a match the owner played
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT matches_played FROM public.my_record()),
  0,
  'walk-in roster: a played walk-in is not in the owner''s record'
);

-- 4 — nor a fixture in the owner's player app (Bookings, Next match)
SELECT is(
  (SELECT count(*)::int FROM public.v_fixture
    WHERE booking_id = '00000000-0000-4000-8000-0000000000ed'::uuid),
  0,
  'walk-in roster: v_fixture does not list the walk-in to its owner'
);

-- 5 — and the owner cannot put it on the open-matches board
SELECT throws_ok(
  $$UPDATE public.bookings SET is_open = TRUE
     WHERE id = '00000000-0000-4000-8000-0000000000ed'::uuid$$,
  '23514',
  NULL,
  'walk-in roster: a walk-in can never be an open match'
);

SELECT * FROM finish();
ROLLBACK;
