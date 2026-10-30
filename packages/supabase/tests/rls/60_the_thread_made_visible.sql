-- 60_the_thread_made_visible.sql — Wave 1 of the Strava build
-- (20261021000001, plans/strava-build.md)
-- Under test:
--   fixture_series: a weekly run at one venue counts its weeks (the courts
--     may change), names its start and last week's game; a missed week
--     starts again; a walk-in is no series
--   v_open_fixtures.series_weeks / series_since: shown from week 4, NULL
--     at week 3
--   fixture_turnout: played and returning, counts only
--   mint_series_turnouts: one notice to the organiser for 10:00 the next
--     morning; none when the group already booked; the games switch
--     applies; nobody else is told; walk-ins tell nobody; a second run
--     adds nothing
--   claim_player_notifications: the sender gets the numbers in context
--   show_name_on_screens: the player may write it; off, the lobby screen
--     shows no name
--
-- Fixtures: venue_a (b1), courts c1 and c2; players a1, a3, a4, a5; a2 is
-- the owner. Days are Cyprus days: d0 today, d0-1 yesterday, and so on.
--   A  a5, 19:00: completed d-15 (c1), d-8 (c2), d-1 (c1); listed d+6 → week 4
--   F  a1, 18:00: completed d-8, d-1; listed d+6 → week 3, below the floor
--   B  a4, 21:00: completed d-8 and d-1 with rosters → the morning after
--   G  a4, 15:00: completed d-15 and d-1, nothing on d-8 → the run restarts
--   S  a3, 17:00: completed d-1, a3's games switch off
--   W  a2, 16:00: a walk-in completed d-1
--   T  a5, 22:00 today on c2: the lobby screen's name
BEGIN;
SELECT plan(17);

CREATE TEMP TABLE t_ctx AS
SELECT (now() AT TIME ZONE 'Europe/Nicosia')::date AS d0;
GRANT SELECT ON t_ctx TO anon, authenticated;

RESET ROLE;
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT public.register_push_token('ExponentPushToken[rls-thread-a4-0001]', 'ios');
RESET ROLE;

INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  gk_slots, outfield_slots, is_open,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, origin
)
SELECT v.id::uuid, v.code, v.who::uuid, v.pitch::uuid,
  ((d0 + v.days) + v.at) AT TIME ZONE 'Europe/Nicosia',
  ((d0 + v.days) + v.at + interval '1 hour') AT TIME ZONE 'Europe/Nicosia',
  v.state, 1, 4, v.open, 6000, 0, 6000, 600, 'standard', 'app'
FROM t_ctx, LATERAL (VALUES
  -- A: a5 at 19:00, three completed weeks (the middle one on court c2), listed next week
  ('00000000-0000-4000-8000-00000000d601', 'RLS-2037-T601', '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000c1', -15, time '19:00', 'completed', FALSE),
  ('00000000-0000-4000-8000-00000000d602', 'RLS-2037-T602', '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000c2',  -8, time '19:00', 'completed', FALSE),
  ('00000000-0000-4000-8000-00000000d603', 'RLS-2037-T603', '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000c1',  -1, time '19:00', 'completed', FALSE),
  ('00000000-0000-4000-8000-00000000d604', 'RLS-2037-T604', '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000c1',   6, time '19:00', 'confirmed', TRUE),
  -- F: a1 at 18:00, two completed weeks, listed next week
  ('00000000-0000-4000-8000-00000000d611', 'RLS-2037-T611', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1',  -8, time '18:00', 'completed', FALSE),
  ('00000000-0000-4000-8000-00000000d612', 'RLS-2037-T612', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1',  -1, time '18:00', 'completed', FALSE),
  ('00000000-0000-4000-8000-00000000d613', 'RLS-2037-T613', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1',   6, time '18:00', 'confirmed', TRUE),
  -- B: a4 at 21:00, last week and yesterday
  ('00000000-0000-4000-8000-00000000d621', 'RLS-2037-T621', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c1',  -8, time '21:00', 'completed', FALSE),
  ('00000000-0000-4000-8000-00000000d622', 'RLS-2037-T622', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c1',  -1, time '21:00', 'completed', FALSE),
  -- G: a4 at 15:00, a gap on d-8
  ('00000000-0000-4000-8000-00000000d631', 'RLS-2037-T631', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c1', -15, time '15:00', 'completed', FALSE),
  ('00000000-0000-4000-8000-00000000d632', 'RLS-2037-T632', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c1',  -1, time '15:00', 'completed', FALSE),
  -- S: a3 at 17:00, yesterday
  ('00000000-0000-4000-8000-00000000d641', 'RLS-2037-T641', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000c1',  -1, time '17:00', 'completed', FALSE),
  -- T: a5 tonight on c2, for the lobby screen
  ('00000000-0000-4000-8000-00000000d661', 'RLS-2037-T661', '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000c2',   0, time '22:00', 'confirmed', FALSE)
) AS v (id, code, who, pitch, days, at, state, open);

-- W: a walk-in at the counter, completed yesterday
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy,
  origin, walk_in_name
)
SELECT '00000000-0000-4000-8000-00000000d651', 'RLS-2037-T651', '00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000c1',
  ((d0 - 1) + time '16:00') AT TIME ZONE 'Europe/Nicosia', ((d0 - 1) + time '17:00') AT TIME ZONE 'Europe/Nicosia',
  'completed', 6000, 0, 6000, 0, 'standard', 'walk_in', 'Σώζος'
FROM t_ctx;

-- B's rosters (a4 is seated by tg_bookings_seat_organiser):
--   last week a4 a1 a3 a5; yesterday a4 a1 a3 a2 → 4 played, 3 came back
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status)
VALUES
  ('00000000-0000-4000-8000-00000000d621', '00000000-0000-4000-8000-0000000000a1', 'outfield', 'in'),
  ('00000000-0000-4000-8000-00000000d621', '00000000-0000-4000-8000-0000000000a3', 'outfield', 'in'),
  ('00000000-0000-4000-8000-00000000d621', '00000000-0000-4000-8000-0000000000a5', 'gk', 'in'),
  ('00000000-0000-4000-8000-00000000d622', '00000000-0000-4000-8000-0000000000a1', 'outfield', 'in'),
  ('00000000-0000-4000-8000-00000000d622', '00000000-0000-4000-8000-0000000000a3', 'outfield', 'in'),
  ('00000000-0000-4000-8000-00000000d622', '00000000-0000-4000-8000-0000000000a2', 'gk', 'in');

-- ── fixture_series ─────────────────────────────────────────────────
-- 1. A's listed game is week 4: three completed Thursdays behind it, one on another court
SELECT is(
  (SELECT weeks FROM public.fixture_series('00000000-0000-4000-8000-00000000d604')),
  4,
  'series: three completed weeks behind a game make it week 4, courts may change'
);
-- 2. the run starts at its first game
SELECT is(
  (SELECT since FROM public.fixture_series('00000000-0000-4000-8000-00000000d604')),
  (SELECT ((d0 - 15) + time '19:00') AT TIME ZONE 'Europe/Nicosia' FROM t_ctx),
  'series: since is the first game of the run'
);
-- 3. last week's game is the one before
SELECT is(
  (SELECT previous_booking_id FROM public.fixture_series('00000000-0000-4000-8000-00000000d604')),
  '00000000-0000-4000-8000-00000000d603'::uuid,
  'series: previous_booking_id is last week''s game'
);
-- 4. a missed week starts the run again
SELECT is(
  (SELECT weeks::text || ':' || coalesce(previous_booking_id::text, '-')
   FROM public.fixture_series('00000000-0000-4000-8000-00000000d632')),
  '1:-',
  'series: a missed week starts the run again'
);
-- 5. a walk-in is no series
SELECT is(
  (SELECT count(*)::int FROM public.fixture_series('00000000-0000-4000-8000-00000000d651')),
  0,
  'series: a walk-in returns no row'
);

-- ── the board ──────────────────────────────────────────────────────
-- _bootstrap.sql grants EXECUTE on every function to the client roles;
-- put back the migration's REVOKE so the player reads the board with the
-- rights production gives them (fixture_series is internal).
REVOKE ALL ON FUNCTION public.fixture_series(uuid) FROM public, anon, authenticated;
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
-- 6. week 4 shows, with its start
SELECT is(
  (SELECT series_weeks::text || '@' || series_since::text FROM public.v_open_fixtures
   WHERE booking_id = '00000000-0000-4000-8000-00000000d604'),
  (SELECT '4@' || (((d0 - 15) + time '19:00') AT TIME ZONE 'Europe/Nicosia')::text FROM t_ctx),
  'board: week 4 carries series_weeks and series_since'
);
-- 7. week 3 is below the floor
SELECT is(
  (SELECT coalesce(series_weeks::text, 'null') || '/' || coalesce(series_since::text, 'null')
   FROM public.v_open_fixtures WHERE booking_id = '00000000-0000-4000-8000-00000000d613'),
  'null/null',
  'board: week 3 says nothing'
);
RESET ROLE;

-- ── the turnout ────────────────────────────────────────────────────
-- 8. four played, three of them last week too, week 2
SELECT is(
  public.fixture_turnout('00000000-0000-4000-8000-00000000d622'),
  '{"played": 4, "returning": 3, "weeks": 2}'::jsonb,
  'turnout: played, returning and weeks, counts only'
);

-- ── the mint ───────────────────────────────────────────────────────
-- A fixed "now" (08:00 today) so the 30-hour window holds every one of
-- yesterday's games whatever time the suite runs.
UPDATE public.users SET notify_games = FALSE WHERE id = '00000000-0000-4000-8000-0000000000a3';
SELECT public.mint_series_turnouts((SELECT (d0 + time '08:00') AT TIME ZONE 'Europe/Nicosia' FROM t_ctx));

-- 9. B: the organiser, by push, for 10:00 this morning
SELECT is(
  (SELECT string_agg(user_id::text || ':' || channel || ':' || status, ' ')
   FROM public.player_notifications
   WHERE kind = 'series_turnout' AND booking_id = '00000000-0000-4000-8000-00000000d622'),
  '00000000-0000-4000-8000-0000000000a4:push:pending',
  'mint: the organiser hears, once, by push'
);
SELECT is(
  (SELECT send_after FROM public.player_notifications
   WHERE kind = 'series_turnout' AND booking_id = '00000000-0000-4000-8000-00000000d622'),
  (SELECT (d0 + time '10:00') AT TIME ZONE 'Europe/Nicosia' FROM t_ctx),
  'mint: the morning after, at 10:00 Cyprus time'
);
-- 11. A and F already booked next week: no nudge
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications
   WHERE kind = 'series_turnout'
     AND booking_id IN ('00000000-0000-4000-8000-00000000d603', '00000000-0000-4000-8000-00000000d612')),
  0,
  'mint: a group that already booked next week is not nudged'
);
-- 12. S: the games switch is off
SELECT is(
  (SELECT status || ':' || error FROM public.player_notifications
   WHERE kind = 'series_turnout' AND booking_id = '00000000-0000-4000-8000-00000000d641'),
  'skipped:switched_off',
  'mint: the games switch applies'
);
-- 13. only organisers, and never a walk-in
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications AS n
   INNER JOIN public.bookings AS b ON b.id = n.booking_id
   WHERE n.kind = 'series_turnout'
     AND (n.user_id <> b.user_id OR b.origin = 'walk_in')),
  0,
  'mint: nobody but the organiser of an app game is told'
);
-- 14. a second run adds nothing
SELECT is(
  public.mint_series_turnouts((SELECT (d0 + time '08:00') AT TIME ZONE 'Europe/Nicosia' FROM t_ctx)),
  0,
  'mint: a second run adds nothing'
);

-- ── the sender ─────────────────────────────────────────────────────
UPDATE public.player_notifications SET send_after = now() - interval '1 minute'
WHERE kind = 'series_turnout' AND booking_id = '00000000-0000-4000-8000-00000000d622';
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
-- 15. the claim carries the numbers
SELECT is(
  (SELECT c.context -> 'turnout' FROM public.claim_player_notifications(50) AS c
   WHERE c.kind = 'series_turnout' AND c.booking_id = '00000000-0000-4000-8000-00000000d622'),
  '{"played": 4, "returning": 3, "weeks": 2}'::jsonb,
  'claim: context.turnout carries the numbers'
);
SELECT set_config('request.jwt.claims', '', TRUE);

-- ── the screen-name switch ─────────────────────────────────────────
-- 16. the player may write it (PR #335 narrows users' UPDATE to listed columns)
SELECT ok(
  has_column_privilege('authenticated', 'public.users', 'show_name_on_screens', 'UPDATE'),
  'screens: a player may write show_name_on_screens'
);
-- 17. off, the lobby screen shows no name for that player's game
UPDATE public.users SET show_name_on_screens = FALSE WHERE id = '00000000-0000-4000-8000-0000000000a5';
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
CREATE TEMP TABLE t_tok AS SELECT public.venue_display_token('00000000-0000-4000-8000-0000000000b1') AS tok;
GRANT SELECT ON t_tok TO anon, authenticated;
SELECT public.set_test_anon();
SELECT is(
  (SELECT i ->> 'who'
   FROM t_ctx, jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_tok), d0) -> 'items') AS i
   WHERE i ->> 'pitch_id' = '00000000-0000-4000-8000-0000000000c2'
     AND (i ->> 'starts_at')::timestamptz = (d0 + time '22:00') AT TIME ZONE 'Europe/Nicosia'),
  NULL,
  'screens: switched off, the lobby shows no name'
);

SELECT * FROM finish();
ROLLBACK;
