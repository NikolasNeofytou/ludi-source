-- 35_cfa_saturday_display.sql — CFA rounds + the public display (20260917000002)
-- Under test:
--   load_cfa_round: stranger refused; owner places matches as walk-ins with a
--     cfa_matches row; a standing hold under a match is released; a court
--     already taken by an app booking is skipped, not fatal; a re-load of the
--     same date replaces (no doubles, old bookings cancelled)
--   venue_display_token: owner gets a stable link, rotate changes it;
--     stranger refused
--   public_venue_schedule: anon reads by link — CFA matches in full, other
--     bookings with no name; a wrong link reads NULL
--   RLS: owner reads cfa_matches; stranger reads none
--
-- Fixtures: a2 owns venue_a (b1) with c1 and c2; a5 is a stranger; a4 a player.
-- The date is the Saturday two weeks out, so nothing in the bootstrap is on it.
BEGIN;
SELECT plan(15);

CREATE TEMP TABLE t_ctx AS
SELECT (current_date + ((6 - EXTRACT(DOW FROM current_date)::int + 7) % 7) + 14)::date AS sat;
GRANT SELECT ON t_ctx TO anon, authenticated;

-- a standing hold: c2, Saturdays 08:00–14:00
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT public.create_booking_series(
  '00000000-0000-4000-8000-0000000000b1', 'ΚΟΠ Grassroots', NULL,
  ARRAY['00000000-0000-4000-8000-0000000000c2']::uuid[], ARRAY[6]::smallint[],
  '08:00', 360, current_date, NULL);

-- an app booking on c1 at 10:00 that Saturday (inserted as the test superuser)
RESET ROLE;
INSERT INTO public.bookings (
  code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
) SELECT 'RLS-2030-0350', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c1',
  (sat + time '10:00') AT TIME ZONE 'Europe/Nicosia', (sat + time '11:00') AT TIME ZONE 'Europe/Nicosia',
  'confirmed', 4000, 0, 4000, 400, 'standard'
FROM t_ctx;

-- 1. a stranger cannot load a round
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT throws_ok(
  $$SELECT public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat FROM t_ctx), 'R1',
      '[{"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"09:00","minutes":60,"category":"U9 Lions","home":"A","away":"B","price_cents":3000}]'::jsonb)$$,
  '42501', NULL,
  'load_cfa_round: stranger refused'
);

-- 2–5. the owner loads three: c1 09:00 (free), c2 09:00 (on the hold), c1 10:00 (taken by the app booking)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
CREATE TEMP TABLE t_r1 AS
SELECT public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat FROM t_ctx), 'Αγωνιστική 3',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"09:00","minutes":60,"category":"U9 Lions","home":"ΑΠΟΕΛ","away":"ΟΜΟΝΟΙΑ","price_cents":3000},
    {"pitch_id":"00000000-0000-4000-8000-0000000000c2","kickoff":"09:00","minutes":60,"category":"U8 Eagles","home":"ΑΕΛ","away":"ΑΠΟΛΛΩΝ","price_cents":3000},
    {"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"10:00","minutes":60,"category":"U7 Eagles","home":"ΑΕΚ","away":"ΑΝΟΡΘΩΣΙΣ","price_cents":3000}]'::jsonb) AS r;
SELECT is((SELECT (r ->> 'placed')::int FROM t_r1), 2, 'load_cfa_round: two placed');
SELECT is((SELECT (r ->> 'released')::int FROM t_r1), 1, 'load_cfa_round: the hold under the c2 match released');
SELECT is((SELECT r -> 'skipped' -> 0 ->> 'reason' FROM t_r1), 'taken', 'load_cfa_round: the taken court is a skip, not a failure');
SELECT is(
  (SELECT count(*) FROM public.bookings b JOIN public.cfa_matches m ON m.booking_id = b.id
   WHERE b.origin = 'walk_in' AND b.state = 'confirmed' AND b.platform_fee_cents = 0
     AND b.walk_in_name = 'U9 Lions · ΑΠΟΕΛ – ΟΜΟΝΟΙΑ'),
  1::bigint,
  'load_cfa_round: a match is a confirmed walk-in named category · home – away'
);

-- 6–7. re-load the same Saturday with one match: replaces, no doubles
CREATE TEMP TABLE t_r2 AS
SELECT public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat FROM t_ctx), 'Αγωνιστική 3',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c2","kickoff":"11:00","minutes":60,"category":"U10 Lions","home":"ΝΕΑ ΣΑΛΑΜΙΝΑ","away":"ΔΟΞΑ","price_cents":3000}]'::jsonb) AS r;
SELECT is((SELECT (r ->> 'replaced')::int FROM t_r2), 2, 'load_cfa_round: re-load cancels the two earlier matches');
SELECT is(
  (SELECT count(*) FROM public.cfa_matches WHERE match_date = (SELECT sat FROM t_ctx)),
  1::bigint,
  'load_cfa_round: re-load leaves only the new match'
);

-- 8. owner reads the rows; 9. a stranger reads none
SELECT is((SELECT count(*) FROM public.cfa_matches), 1::bigint, 'cfa_matches: owner reads the venue''s matches');
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is((SELECT count(*) FROM public.cfa_matches), 0::bigint, 'cfa_matches: stranger reads nothing');

-- 10. a stranger cannot get the display link
SELECT throws_ok(
  $$SELECT public.venue_display_token('00000000-0000-4000-8000-0000000000b1')$$,
  '42501', NULL,
  'venue_display_token: stranger refused'
);

-- 11–12. the owner's link is stable; rotating changes it
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
CREATE TEMP TABLE t_tok AS SELECT public.venue_display_token('00000000-0000-4000-8000-0000000000b1') AS tok;
GRANT SELECT ON t_tok TO anon, authenticated;
SELECT is(
  public.venue_display_token('00000000-0000-4000-8000-0000000000b1'),
  (SELECT tok FROM t_tok),
  'venue_display_token: asking again returns the same link'
);
SELECT isnt(
  public.venue_display_token('00000000-0000-4000-8000-0000000000b1', TRUE),
  (SELECT tok FROM t_tok),
  'venue_display_token: rotate makes a new link'
);

-- 13–15. anon reads the screen by the current link
UPDATE t_tok SET tok = (SELECT token FROM public.venue_displays WHERE venue_id = '00000000-0000-4000-8000-0000000000b1');
SELECT public.set_test_anon();
SELECT is(
  (SELECT count(*) FROM jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_tok), (SELECT sat FROM t_ctx)) -> 'items') AS i
   WHERE i ->> 'kind' = 'cfa' AND i ->> 'home' = 'ΝΕΑ ΣΑΛΑΜΙΝΑ'),
  1::bigint,
  'public_venue_schedule: the CFA match shows in full'
);
SELECT is(
  (SELECT count(*) FROM jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_tok), (SELECT sat FROM t_ctx)) -> 'items') AS i
   WHERE i ->> 'kind' = 'booked' AND i ->> 'home' IS NULL AND i::text NOT LIKE '%a4%'),
  (SELECT count(*) FROM jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_tok), (SELECT sat FROM t_ctx)) -> 'items') AS i
   WHERE i ->> 'kind' = 'booked'),
  'public_venue_schedule: other bookings carry no name or user'
);
SELECT is(
  public.public_venue_schedule(repeat('0', 64), (SELECT sat FROM t_ctx)),
  NULL,
  'public_venue_schedule: a wrong link reads nothing'
);

SELECT * FROM finish();
ROLLBACK;
