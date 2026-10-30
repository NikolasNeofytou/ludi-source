-- 56_venue_open_games.sql — the venue's page lists its open games (20261020000001, ADR-0056)
-- Under test:
--   venue_open_games: signed out, an opened, live, future, short fixture at
--     this venue comes back with its counts and invite; a closed one, a full
--     one, an unpaid 'pending' one, one already played and one at another
--     venue do not; it agrees with v_open_fixtures; no column names a
--     player; an inactive venue and an unknown slug return nothing
--
-- Fixtures: a2 owns venue_a (b1) with c1 and c2; venue_b (b2, inactive in
-- the bootstrap, switched on here) with c3; a4 and a5 are players.
-- Dates: the Cyprus today + 3, and yesterday.
BEGIN;
SELECT plan(10);

CREATE TEMP TABLE t_ctx AS
SELECT ((now() AT TIME ZONE 'Europe/Nicosia')::date + 3) AS d,
       ((now() AT TIME ZONE 'Europe/Nicosia')::date - 1) AS y;
GRANT SELECT ON t_ctx TO anon, authenticated;

RESET ROLE;
UPDATE public.venues SET slug = 'rls-venue' WHERE id = '00000000-0000-4000-8000-0000000000b1';
UPDATE public.venues SET slug = 'rls-b', is_active = TRUE WHERE id = '00000000-0000-4000-8000-0000000000b2';

INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  gk_slots, outfield_slots, is_open,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
)
SELECT v.id::uuid, v.code, '00000000-0000-4000-8000-0000000000a4', v.pitch::uuid,
  (v.day + v.at) AT TIME ZONE 'Europe/Nicosia', (v.day + v.at + interval '1 hour') AT TIME ZONE 'Europe/Nicosia',
  v.state, v.gk, v.outf, v.open, 4000, 0, 4000, 400, 'standard'
FROM t_ctx, LATERAL (VALUES
  -- g1: opened, confirmed, short → listed
  ('00000000-0000-4000-8000-00000000e601', 'RLS-2030-5601', '00000000-0000-4000-8000-0000000000c1', d, time '20:00', 'confirmed', 1, 4, TRUE),
  -- g2: not opened
  ('00000000-0000-4000-8000-00000000e602', 'RLS-2030-5602', '00000000-0000-4000-8000-0000000000c1', d, time '21:00', 'confirmed', 1, 4, FALSE),
  -- g3: opened but full (1 + 1, both seats taken below)
  ('00000000-0000-4000-8000-00000000e603', 'RLS-2030-5603', '00000000-0000-4000-8000-0000000000c2', d, time '20:00', 'confirmed', 1, 1, TRUE),
  -- g4: opened but an unpaid checkout
  ('00000000-0000-4000-8000-00000000e604', 'RLS-2030-5604', '00000000-0000-4000-8000-0000000000c2', d, time '21:00', 'pending', 1, 4, TRUE),
  -- g5: opened, short, but played yesterday
  ('00000000-0000-4000-8000-00000000e605', 'RLS-2030-5605', '00000000-0000-4000-8000-0000000000c1', y, time '20:00', 'confirmed', 1, 4, TRUE),
  -- g6: opened and short, at the other venue
  ('00000000-0000-4000-8000-00000000e606', 'RLS-2030-5606', '00000000-0000-4000-8000-0000000000c3', d, time '20:00', 'confirmed', 1, 4, TRUE)
) AS v (id, code, pitch, day, at, state, gk, outf, open);

CREATE TEMP TABLE t_g1 AS
SELECT invite_token AS tok FROM public.bookings WHERE id = '00000000-0000-4000-8000-00000000e601';
GRANT SELECT ON t_g1 TO anon, authenticated;

-- g3's keeper seat (the organiser sat himself outfield on insert)
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status)
VALUES ('00000000-0000-4000-8000-00000000e603', '00000000-0000-4000-8000-0000000000a5', 'gk', 'in');

SELECT public.set_test_anon();

-- 1. the opened, short fixture, signed out
SELECT is(
  (SELECT array_agg(invite_token) FROM public.venue_open_games('rls-venue')),
  ARRAY[(SELECT tok FROM t_g1)],
  'venue_open_games: only the opened, live, future, short game at this venue'
);

-- 2–3. its counts
SELECT is(
  (SELECT gk_open FROM public.venue_open_games('rls-venue')),
  1,
  'venue_open_games: the keeper seat counts as open'
);
SELECT is(
  (SELECT outfield_open FROM public.venue_open_games('rls-venue')),
  3,
  'venue_open_games: the organiser''s own seat is not counted open'
);

-- 4. its time and format
SELECT is(
  (SELECT pitch_type || ' ' || to_char(starts_at AT TIME ZONE 'Europe/Nicosia', 'HH24:MI') FROM public.venue_open_games('rls-venue')),
  '5-a-side 20:00',
  'venue_open_games: when and the format'
);

-- 5. the other venue's game is its own
SELECT is(
  (SELECT count(*) FROM public.venue_open_games('rls-b')),
  1::bigint,
  'venue_open_games: another venue lists only its own game'
);

-- 6. the same set as the board, venue by venue
RESET ROLE;
SELECT set_eq(
  $$SELECT invite_token FROM public.venue_open_games('rls-venue')$$,
  $$SELECT invite_token FROM public.v_open_fixtures WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'$$,
  'venue_open_games: agrees with v_open_fixtures'
);

-- 7. no column can carry a name, a user or a price
SELECT is(
  (SELECT array_agg(p ORDER BY p)
   FROM unnest((SELECT proargnames FROM pg_proc WHERE proname = 'venue_open_games')) AS p
   WHERE p <> 'p_slug'),
  ARRAY['ends_at', 'gk_open', 'invite_token', 'outfield_open', 'pitch_type', 'starts_at']::text[],
  'venue_open_games: the lobby screen''s fields and nothing else'
);

-- 8. an inactive venue lists nothing
UPDATE public.venues SET is_active = FALSE WHERE id = '00000000-0000-4000-8000-0000000000b2';
SELECT public.set_test_anon();
SELECT is(
  (SELECT count(*) FROM public.venue_open_games('rls-b')),
  0::bigint,
  'venue_open_games: an inactive venue lists nothing'
);

-- 9. an unknown slug lists nothing
SELECT is(
  (SELECT count(*) FROM public.venue_open_games('no-such-venue')),
  0::bigint,
  'venue_open_games: an unknown slug lists nothing'
);

-- 10. closing the fixture takes it off the page
RESET ROLE;
UPDATE public.bookings SET is_open = FALSE WHERE id = '00000000-0000-4000-8000-00000000e601';
SELECT public.set_test_anon();
SELECT is(
  (SELECT count(*) FROM public.venue_open_games('rls-venue')),
  0::bigint,
  'venue_open_games: closing the fixture takes it off the page'
);

SELECT * FROM finish();
ROLLBACK;
