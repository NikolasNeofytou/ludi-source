-- 54_cfa_in_the_app.sql — the CFA Saturday inside Ludi
-- (20261016000001, plans/cfa-in-the-app.md, ADR-0051, ADR-0050 amended)
-- Under test — K1, the CFA team and the stable round:
--   competition_teams: a team is name + category + group — a club's ages
--     no longer merge, the group is kept
--   load_cfa_round diffs: an identical re-load changes nothing and keeps
--     every id and booking; a swap of courts moves both without colliding;
--     a new kick-off moves the booking and says so; a match the file no
--     longer has is cancelled, not deleted, and leaves cfa_matches; it
--     comes back with its id; the owner's postponement survives a re-load
--     at the same time
--   away rows: kept for a team that plays here (no court, not on
--     cfa_matches), ignored for teams that never do; a moved away match is
--     a change too
--   ADR-0050 amended: a CFA competition's scores are never public, and a
--     CFA match carries no score
--   RLS: the owner reads the changes, a stranger nothing
-- K2–K4, K6, K7 (20261016000002), the follow and what it tells:
--   follow_team: signed in, CFA teams only; a follow is readable by its
--     player alone — not the venue's owner, not a stranger
--   my_team_fixtures: the followed team's matches here and away, the
--     postponed one marked; venue_fixtures: the venue's day with who the
--     caller follows, never a CFA score, a fortnight at most
--   notices: a match loaded tells its followers the programme once (an
--     identical re-load tells nobody), a change is told per change, the
--     games switch off is a skip with the reason, the hour before comes
--     from the R5 sweep, the same team at a second venue reaches the
--     same follower; quiet hours hold the programme at night, never the
--     reminder; the sender's claim renders a notice with no booking
--   ask_parents: the organiser only; only the parents who play; once
--   cfa_today_nearby: signed in only
--   public_venue_schedule (20261016000005) carries the venue's slug;
--   my_follows (20261016000004): the parent's own follows, named;
--     venue_hosts_cfa: a yes or no
-- K5 (20261016000003), the owner changes a match:
--   move_cfa_match: the owner only; a new court and time move the booking
--     and write both changes; a taken court fails the whole call
--   set_cfa_match_status: postponed keeps the court and the TV says so;
--     cancelled gives it back and leaves the programme; back on takes the
--     old slot again
--
-- Fixtures: a2 owns venue_a (b1), courts c1 ('Pitch A1 (verified)') and c2
-- ('Pitch A2 (unverified)'); a5 a stranger. Dates on the Cyprus clock.
BEGIN;
SELECT plan(60);

-- Three Saturdays a week apart, the first at least a week out, all in one
-- CFA season (a follow reaches the same team only within a season): when
-- the three would straddle 1 August, they start on its first Saturday.
CREATE TEMP TABLE t_ctx AS
WITH b AS (
  SELECT d + 7 + ((6 - extract(DOW FROM d + 7)::int + 7) % 7) AS s
  FROM (SELECT (now() AT TIME ZONE 'Europe/Nicosia')::date AS d) AS x
),
c AS (
  SELECT CASE
    WHEN public.competition_season(s) = public.competition_season(s + 14) THEN s
    ELSE make_date(extract(YEAR FROM s + 14)::int, 8, 1)
      + ((6 - extract(DOW FROM make_date(extract(YEAR FROM s + 14)::int, 8, 1))::int + 7) % 7)
  END AS s
  FROM b
)
SELECT s AS sat, s + 7 AS sat2, s + 14 AS sat3 FROM c;
GRANT SELECT ON t_ctx TO anon, authenticated;

CREATE TEMP TABLE t_res (step text PRIMARY KEY, r jsonb);
GRANT ALL ON t_res TO authenticated;

-- the counts a load reports, as one string: placed/moved/unchanged/cancelled/replaced
CREATE FUNCTION pg_temp.counts(p_step text) RETURNS text LANGUAGE sql AS $$
  SELECT (r ->> 'placed') || '/' || (r ->> 'moved') || '/' || (r ->> 'unchanged') || '/'
    || (r ->> 'cancelled') || '/' || (r ->> 'replaced')
  FROM t_res WHERE step = p_step
$$;

-- the match for a category on a date, as the owner's competition holds it
CREATE FUNCTION pg_temp.m(p_category text, p_date date) RETURNS uuid LANGUAGE sql AS $$
  SELECT m.id FROM public.competition_matches AS m
  INNER JOIN public.competitions AS c ON c.id = m.competition_id
  WHERE c.venue_id = '00000000-0000-4000-8000-0000000000b1' AND c.kind = 'cfa_grassroots'
    AND m.category = p_category AND (m.kickoff_at AT TIME ZONE 'Europe/Nicosia')::date = p_date
$$;

-- ── load 1: two matches, one club in two ages ──────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
INSERT INTO t_res SELECT 'l1', public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat FROM t_ctx), 'Αγωνιστική 1',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"09:00","minutes":60,"category":"U9 Lions","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","home_group":"Nicosia A","away":"ΠΑΕΕΚ","away_group":"Nicosia A","price_cents":3000},
    {"pitch_id":"00000000-0000-4000-8000-0000000000c2","kickoff":"09:00","minutes":60,"category":"U11 Eagles","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","away":"CITY F.C.","price_cents":3000}]'::jsonb);
RESET ROLE;

SELECT is(pg_temp.counts('l1'), '2/0/0/0/0', 'load: two placed');
SELECT is(
  (SELECT string_agg(coalesce(category, '-') || '|' || coalesce(group_label, '-'), ' ' ORDER BY category)
   FROM public.competition_teams WHERE name = 'ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ'),
  'U11 Eagles|- U9 Lions|Nicosia A',
  'teams: one club in two ages is two teams, and the group is kept'
);

CREATE TEMP TABLE t_first AS
SELECT m.category, m.id, m.booking_id FROM public.competition_matches AS m
WHERE m.id IN (pg_temp.m('U9 Lions', (SELECT sat FROM t_ctx)), pg_temp.m('U11 Eagles', (SELECT sat FROM t_ctx)));

-- ── load 2: the same file again ────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
INSERT INTO t_res SELECT 'l2', public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat FROM t_ctx), 'Αγωνιστική 1',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"09:00","minutes":60,"category":"U9 Lions","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","home_group":"Nicosia A","away":"ΠΑΕΕΚ","away_group":"Nicosia A","price_cents":3000},
    {"pitch_id":"00000000-0000-4000-8000-0000000000c2","kickoff":"09:00","minutes":60,"category":"U11 Eagles","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","away":"CITY F.C.","price_cents":3000}]'::jsonb);
RESET ROLE;

SELECT is(pg_temp.counts('l2'), '0/0/2/0/0', 're-load: the same file changes nothing');
SELECT is(
  (SELECT count(*)::int FROM t_first AS f
   INNER JOIN public.competition_matches AS m ON m.id = f.id AND m.booking_id = f.booking_id
   INNER JOIN public.bookings AS b ON b.id = m.booking_id AND b.state = 'confirmed'),
  2,
  're-load: each match keeps its id and its booking'
);

-- ── load 3: the two swap courts ────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
INSERT INTO t_res SELECT 'l3', public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat FROM t_ctx), 'Αγωνιστική 1',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c2","kickoff":"09:00","minutes":60,"category":"U9 Lions","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","home_group":"Nicosia A","away":"ΠΑΕΕΚ","away_group":"Nicosia A","price_cents":3000},
    {"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"09:00","minutes":60,"category":"U11 Eagles","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","away":"CITY F.C.","price_cents":3000}]'::jsonb);
RESET ROLE;

SELECT is(
  pg_temp.counts('l3') || ' ' || jsonb_array_length((SELECT r -> 'skipped' FROM t_res WHERE step = 'l3')),
  '0/2/0/0/2 0',
  'swap: both move, neither collides with the court the other is leaving'
);
SELECT is(
  (SELECT string_agg(f.category || ':' || (m.id = f.id)::text || '/' || p.name, ' ' ORDER BY f.category)
   FROM t_first AS f
   INNER JOIN public.competition_matches AS m ON m.id = f.id
   INNER JOIN public.bookings AS b ON b.id = m.booking_id AND b.state = 'confirmed'
   INNER JOIN public.pitches AS p ON p.id = b.pitch_id),
  'U11 Eagles:true/Pitch A1 (verified) U9 Lions:true/Pitch A2 (unverified)',
  'swap: same matches, each on the other''s court'
);
SELECT is(
  (SELECT string_agg(x.what || ' ' || x.old_value || ' → ' || x.new_value, ', ' ORDER BY x.old_value)
   FROM public.competition_match_changes AS x
   WHERE x.match_id = pg_temp.m('U9 Lions', (SELECT sat FROM t_ctx))),
  'court Pitch A1 (verified) → Pitch A2 (unverified)',
  'swap: the change says which court it left and which it is on'
);
SELECT is(
  (SELECT count(*)::int FROM public.bookings WHERE id IN (SELECT booking_id FROM t_first) AND state = 'cancelled'),
  2,
  'swap: the old bookings are cancelled'
);

-- ── load 4: the U9 kicks off later; the U11 is dropped ─────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
INSERT INTO t_res SELECT 'l4', public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat FROM t_ctx), 'Αγωνιστική 1',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c2","kickoff":"10:30","minutes":60,"category":"U9 Lions","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","home_group":"Nicosia A","away":"ΠΑΕΕΚ","away_group":"Nicosia A","price_cents":3000}]'::jsonb);

SELECT is(pg_temp.counts('l4'), '0/1/0/1/2', 'a later kick-off moves; a match the file no longer has is cancelled');
SELECT is(
  (SELECT string_agg(match_date::text || ' ' || kickoff::text || ' ' || category, ', ') FROM public.cfa_matches),
  (SELECT sat::text FROM t_ctx) || ' 10:30:00 U9 Lions',
  'cfa_matches: the cancelled match leaves the programme, the moved one shows its new time'
);
RESET ROLE;
SELECT is(
  (SELECT x.old_value || ' → ' || x.new_value FROM public.competition_match_changes AS x
   WHERE x.match_id = pg_temp.m('U9 Lions', (SELECT sat FROM t_ctx)) AND x.what = 'kickoff'),
  '09:00 → 10:30',
  'kick-off: the change carries both times, in Cyprus time'
);
SELECT is(
  (SELECT m.status || ' ' || b.state || ' ' || x.old_value || '→' || x.new_value
   FROM public.competition_matches AS m
   INNER JOIN public.bookings AS b ON b.id = m.booking_id
   INNER JOIN public.competition_match_changes AS x ON x.match_id = m.id AND x.what = 'status'
   WHERE m.id = (SELECT id FROM t_first WHERE category = 'U11 Eagles')),
  'cancelled cancelled scheduled→cancelled',
  'dropped: the match row stays, cancelled with its booking, and the change is written'
);

-- ── the owner postpones the U9; the same file again ────────────────
UPDATE public.competition_matches SET status = 'postponed'
WHERE id = pg_temp.m('U9 Lions', (SELECT sat FROM t_ctx));
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
INSERT INTO t_res SELECT 'l5', public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat FROM t_ctx), 'Αγωνιστική 1',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c2","kickoff":"10:30","minutes":60,"category":"U9 Lions","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","home_group":"Nicosia A","away":"ΠΑΕΕΚ","away_group":"Nicosia A","price_cents":3000}]'::jsonb);
RESET ROLE;
SELECT is(
  pg_temp.counts('l5') || ' ' || (SELECT status FROM public.competition_matches WHERE id = pg_temp.m('U9 Lions', (SELECT sat FROM t_ctx))),
  '0/0/1/0/0 postponed',
  'postponed: a re-load at the same time leaves the owner''s postponement standing'
);

-- ── load 6: the U11 is back ────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
INSERT INTO t_res SELECT 'l6', public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat FROM t_ctx), 'Αγωνιστική 1',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c2","kickoff":"10:30","minutes":60,"category":"U9 Lions","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","home_group":"Nicosia A","away":"ΠΑΕΕΚ","away_group":"Nicosia A","price_cents":3000},
    {"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"09:00","minutes":60,"category":"U11 Eagles","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","away":"CITY F.C.","price_cents":3000}]'::jsonb);
RESET ROLE;
SELECT is(
  pg_temp.counts('l6') || ' '
  || (SELECT m.status || '/' || b.state FROM public.competition_matches AS m
      INNER JOIN public.bookings AS b ON b.id = m.booking_id
      WHERE m.id = (SELECT id FROM t_first WHERE category = 'U11 Eagles'))
  || ' ' || (SELECT count(*) FROM public.competition_match_changes AS x
             WHERE x.match_id = (SELECT id FROM t_first WHERE category = 'U11 Eagles')
               AND x.what = 'status' AND x.new_value = 'scheduled'),
  '0/1/1/0/0 scheduled/confirmed 1',
  'back: the cancelled match returns with its id, a court and a change saying so'
);

-- ── load 7: the next Saturday, with the district's away rows ───────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
INSERT INTO t_res SELECT 'l7', public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat2 FROM t_ctx), 'Αγωνιστική 2',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"09:00","minutes":60,"category":"U9 Lions","home":"ΕΛΛΗΝΙΣΜΟΣ ΑΚΑΚΙΟΥ","home_group":"Nicosia B","away":"GALAXY ACADEMY","away_group":"Nicosia B","price_cents":3000},
    {"elsewhere":"CENTRAL PARK","kickoff":"10:15","category":"U9 Lions","home":"DRAGAO FC","home_group":"Nicosia A","away":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","away_group":"Nicosia A"},
    {"elsewhere":"SPAZZIO","kickoff":"09:15","category":"U7 Lions","home":"XD PANTHERS FA","away":"STRIPES FA"}]'::jsonb);
RESET ROLE;
SELECT is(
  (SELECT (r ->> 'placed') || '/' || (r ->> 'away') || '/' || (r ->> 'ignored') FROM t_res WHERE step = 'l7'),
  '1/1/1',
  'away rows: one here placed, our team''s away match kept, two strangers ignored'
);
SELECT is(
  (SELECT m.elsewhere || ' ' || (m.booking_id IS NULL)::text || ' ' || h.name || '-' || a.name
   FROM public.competition_matches AS m
   INNER JOIN public.competition_teams AS h ON h.id = m.home_team_id
   INNER JOIN public.competition_teams AS a ON a.id = m.away_team_id
   WHERE m.elsewhere IS NOT NULL),
  'CENTRAL PARK true DRAGAO FC-ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ',
  'away: kept at the CFA''s venue name, holding no court'
);
SELECT is(
  (SELECT count(*)::int FROM public.competition_teams WHERE name IN ('XD PANTHERS FA', 'STRIPES FA')),
  0,
  'away: teams that never play here are not made'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT string_agg(home_team, ' ') FROM public.cfa_matches WHERE match_date = (SELECT sat2 FROM t_ctx)),
  'ΕΛΛΗΝΙΣΜΟΣ ΑΚΑΚΙΟΥ',
  'cfa_matches: the away match is not the venue''s programme'
);

-- ── load 8: the away match moves to 11:15 ──────────────────────────
INSERT INTO t_res SELECT 'l8', public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat2 FROM t_ctx), 'Αγωνιστική 2',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"09:00","minutes":60,"category":"U9 Lions","home":"ΕΛΛΗΝΙΣΜΟΣ ΑΚΑΚΙΟΥ","home_group":"Nicosia B","away":"GALAXY ACADEMY","away_group":"Nicosia B","price_cents":3000},
    {"elsewhere":"CENTRAL PARK","kickoff":"11:15","category":"U9 Lions","home":"DRAGAO FC","home_group":"Nicosia A","away":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","away_group":"Nicosia A"}]'::jsonb);
RESET ROLE;
SELECT is(
  pg_temp.counts('l8') || ' '
  || (SELECT x.old_value || '→' || x.new_value FROM public.competition_match_changes AS x
      INNER JOIN public.competition_matches AS m ON m.id = x.match_id
      WHERE m.elsewhere IS NOT NULL AND x.what = 'kickoff'),
  '0/1/1/0/0 10:15→11:15',
  'away: a new time is a move and a change, like a match here'
);

-- ── ADR-0050 amended ───────────────────────────────────────────────
SELECT throws_ok(
  $$UPDATE public.competitions SET scores_public = TRUE
    WHERE venue_id = '00000000-0000-4000-8000-0000000000b1' AND kind = 'cfa_grassroots'$$,
  '23514', NULL,
  'scores: a CFA competition''s scores can never be public'
);
SELECT throws_ok(
  format(
    $$UPDATE public.competition_matches SET status = 'played', home_score = 1, away_score = 0, result_at = now()
      WHERE id = %L$$,
    (SELECT id FROM t_first WHERE category = 'U11 Eagles')
  ),
  '23514', NULL,
  'scores: a CFA match carries no score, played or not'
);

-- ── who reads the changes ──────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT ok(
  (SELECT count(*) FROM public.competition_match_changes) >= 6,
  'rls: the owner reads the venue''s changes'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.competition_match_changes),
  0,
  'rls: a stranger reads none'
);
RESET ROLE;


-- ════════════════════════════════════════════════════════════════════
-- K2–K4, K6: the follow and what it tells
-- ════════════════════════════════════════════════════════════════════
-- a4 and a3 each have a phone; a league next to the CFA competition
INSERT INTO public.push_tokens (user_id, token, platform) VALUES
('00000000-0000-4000-8000-0000000000a4', 'ExponentPushToken[cfaTestTokenA4]', 'ios'),
('00000000-0000-4000-8000-0000000000a3', 'ExponentPushToken[cfaTestTokenA3]', 'ios');
INSERT INTO public.competitions (id, venue_id, name, kind, season)
VALUES ('00000000-0000-4000-8000-00000000f501', '00000000-0000-4000-8000-0000000000b1', 'Winter League', 'league',
        public.competition_season((SELECT sat FROM t_ctx)));
INSERT INTO public.competition_teams (id, competition_id, name)
VALUES ('00000000-0000-4000-8000-00000000f502', '00000000-0000-4000-8000-00000000f501', 'Old Boys');
CREATE TEMP TABLE t_team AS
SELECT
  (SELECT t.id FROM public.competition_teams AS t
   WHERE t.name = 'ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ' AND t.category = 'U9 Lions' AND t.group_label = 'Nicosia A') AS omonoia,
  (SELECT t.id FROM public.competition_teams AS t
   WHERE t.name = 'ΕΛΛΗΝΙΣΜΟΣ ΑΚΑΚΙΟΥ' AND t.category = 'U9 Lions') AS akakiou,
  (SELECT t.id FROM public.competition_teams AS t WHERE t.name = 'GALAXY ACADEMY') AS galaxy;
GRANT SELECT ON t_team TO authenticated, anon;

SELECT public.set_test_anon();
SELECT throws_ok(
  format('SELECT public.follow_team(%L)', (SELECT omonoia FROM t_team)),
  '42501', NULL,
  'follow: signed in only'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$SELECT public.follow_team('00000000-0000-4000-8000-00000000f502')$$,
  'P0002', NULL,
  'follow: a CFA team only, not a venue league''s'
);
SELECT public.follow_team((SELECT omonoia FROM t_team));
SELECT is(
  (SELECT count(*)::int FROM public.team_follows WHERE team_id = (SELECT omonoia FROM t_team)),
  1,
  'follow: the parent reads their own follow'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.team_follows),
  0,
  'follow: the venue''s owner sees no follow'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is((SELECT count(*)::int FROM public.team_follows), 0, 'follow: a stranger sees no follow');

-- what the parent sees
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT string_agg(f.status || ' ' || f.venue_name || ' ' || coalesce(f.court, '-') || ' ' || f.home || '-' || f.away,
                     ' | ' ORDER BY f.kickoff_at)
   FROM public.my_team_fixtures() AS f),
  'postponed RLS Fixture Venue A Pitch A2 (unverified) ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ-ΠΑΕΕΚ | scheduled CENTRAL PARK - DRAGAO FC-ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ',
  'my teams: the match here, postponed and on its court, and the away match at the CFA''s venue name'
);
SELECT is(
  (SELECT string_agg(to_char(f.kickoff_at AT TIME ZONE 'Europe/Nicosia', 'HH24:MI') || ' ' || f.category || ' '
                     || f.status || ' ' || coalesce(f.court, '-') || ' ' || f.following_home::text || '/'
                     || f.following_away::text || ' ' || coalesce(f.home_score::text, '·'), ' | ' ORDER BY f.kickoff_at)
   FROM public.venue_fixtures('00000000-0000-4000-8000-0000000000b1', (SELECT sat FROM t_ctx), (SELECT sat FROM t_ctx)) AS f),
  '09:00 U11 Eagles scheduled Pitch A1 (verified) false/false · | 10:30 U9 Lions postponed Pitch A2 (unverified) true/false ·',
  'venue day: each match on its court, the followed team marked, no score'
);
SELECT throws_ok(
  format('SELECT * FROM public.venue_fixtures(%L, %L, %L)', '00000000-0000-4000-8000-0000000000b1',
         (SELECT sat FROM t_ctx), (SELECT sat + 15 FROM t_ctx)),
  '22023', NULL,
  'venue day: a fortnight at most'
);

-- the programme: a third Saturday with the followed team at home
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
INSERT INTO t_res SELECT 'p1', public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat3 FROM t_ctx), 'Αγωνιστική 3',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"09:00","minutes":60,"category":"U9 Lions","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","home_group":"Nicosia A","away":"GALAXY ACADEMY","away_group":"Nicosia A","price_cents":3000}]'::jsonb);
RESET ROLE;
SELECT is(
  (SELECT string_agg(n.status || ' ' || (n.booking_id IS NULL)::text || ' ' || (n.ref_id = pg_temp.m('U9 Lions', (SELECT sat3 FROM t_ctx)))::text, ',')
   FROM public.player_notifications AS n
   WHERE n.user_id = '00000000-0000-4000-8000-0000000000a4' AND n.kind = 'team_programme'),
  'pending true true',
  'programme: the follower is told the match, a notice about the match with no booking'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
INSERT INTO t_res SELECT 'p2', public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat3 FROM t_ctx), 'Αγωνιστική 3',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"09:00","minutes":60,"category":"U9 Lions","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","home_group":"Nicosia A","away":"GALAXY ACADEMY","away_group":"Nicosia A","price_cents":3000}]'::jsonb);
INSERT INTO t_res SELECT 'p3', public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat3 FROM t_ctx), 'Αγωνιστική 3',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"10:00","minutes":60,"category":"U9 Lions","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","home_group":"Nicosia A","away":"GALAXY ACADEMY","away_group":"Nicosia A","price_cents":3000}]'::jsonb);
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications
   WHERE user_id = '00000000-0000-4000-8000-0000000000a4' AND kind = 'team_programme'),
  1,
  'programme: an identical re-load tells nobody again'
);
SELECT is(
  (SELECT x.what || ' ' || x.old_value || '→' || x.new_value || ' ' || n.status
   FROM public.player_notifications AS n
   INNER JOIN public.competition_match_changes AS x ON x.id = n.ref_id
   WHERE n.user_id = '00000000-0000-4000-8000-0000000000a4' AND n.kind = 'team_changed'),
  'kickoff 09:00→10:00 pending',
  'change: the follower is told the new time, the notice pointing at the change'
);

-- the games switch off: a court change is a skip with the reason
UPDATE public.users SET notify_games = FALSE WHERE id = '00000000-0000-4000-8000-0000000000a4';
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
INSERT INTO t_res SELECT 'p4', public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat3 FROM t_ctx), 'Αγωνιστική 3',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c2","kickoff":"10:00","minutes":60,"category":"U9 Lions","home":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","home_group":"Nicosia A","away":"GALAXY ACADEMY","away_group":"Nicosia A","price_cents":3000}]'::jsonb);
RESET ROLE;
UPDATE public.users SET notify_games = TRUE WHERE id = '00000000-0000-4000-8000-0000000000a4';
SELECT is(
  (SELECT n.status || ' ' || n.error FROM public.player_notifications AS n
   INNER JOIN public.competition_match_changes AS x ON x.id = n.ref_id AND x.what = 'court'
   WHERE n.user_id = '00000000-0000-4000-8000-0000000000a4' AND n.kind = 'team_changed'),
  'skipped switched_off',
  'change: with the games switch off it is a skip, and the ledger says why'
);

-- quiet hours: the programme waits for morning, the hour before never does
SELECT is(
  to_char(public.notice_send_after('team_programme', '2026-11-07 09:00+02', '2026-11-01 00:30+02') AT TIME ZONE 'Asia/Nicosia', 'HH24:MI')
  || ' ' || to_char(public.notice_send_after('team_reminder', '2026-11-07 09:00+02', '2026-11-01 00:30+02') AT TIME ZONE 'Asia/Nicosia', 'HH24:MI'),
  '08:00 00:30',
  'quiet hours: a programme minted at 00:30 waits for 08:00; the hour-before reminder goes at once'
);

-- the hour before, from the R5 sweep
SELECT ok(
  public.mint_reminders(
    ((SELECT sat3 FROM t_ctx) + time '10:00') AT TIME ZONE 'Europe/Nicosia' - interval '55 minutes'
  ) >= 1,
  'reminder: the sweep finds the followed team''s match an hour out'
);
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications
   WHERE user_id = '00000000-0000-4000-8000-0000000000a4' AND kind = 'team_reminder'
     AND ref_id = pg_temp.m('U9 Lions', (SELECT sat3 FROM t_ctx))),
  1,
  'reminder: the follower gets one team_reminder for that match'
);

-- the same team at a second Ludi venue reaches the same follower
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
INSERT INTO t_res SELECT 'b2', public.load_cfa_round('00000000-0000-4000-8000-0000000000b2', (SELECT sat3 FROM t_ctx), 'Αγωνιστική 3',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c3","kickoff":"12:00","minutes":60,"category":"U9 Lions","home":"STRIPES FA","home_group":"Nicosia A","away":"ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ","away_group":"Nicosia A","price_cents":3000}]'::jsonb);
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications
   WHERE user_id = '00000000-0000-4000-8000-0000000000a4' AND kind = 'team_programme'),
  2,
  'follow: the same team at another Ludi venue is the same team'
);

-- the sender's claim renders a notice with no booking
UPDATE public.player_notifications SET send_after = now() - interval '1 minute'
WHERE user_id = '00000000-0000-4000-8000-0000000000a4' AND status = 'pending';
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
CREATE TEMP TABLE t_claim AS SELECT * FROM public.claim_player_notifications(50);
SELECT set_config('request.jwt.claims', '', TRUE);
SELECT is(
  (SELECT c.venue_name || ' ' || c.pitch_name || ' ' || (c.booking_id IS NULL)::text || ' ' || (c.context -> 'match' ->> 'category')
          || ' ' || (c.context -> 'match' ->> 'home') || '-' || (c.context -> 'match' ->> 'away')
          || ' ' || (c.context -> 'match' ->> 'date' = (SELECT sat3::text FROM t_ctx))::text
   FROM t_claim AS c
   WHERE c.kind = 'team_programme' AND c.context -> 'match' ->> 'venue_id' = '00000000-0000-4000-8000-0000000000b1'),
  'RLS Fixture Venue A Pitch A2 (unverified) true U9 Lions ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ-GALAXY ACADEMY true',
  'claim: a programme notice carries the venue, the court today, the teams and the date'
);
SELECT is(
  (SELECT (c.context -> 'match' ->> 'what') || ' ' || (c.context -> 'match' ->> 'old') || '→' || (c.context -> 'match' ->> 'new')
   FROM t_claim AS c WHERE c.kind = 'team_changed'),
  'kickoff 09:00→10:00',
  'claim: a change notice carries what changed, from and to'
);

-- the parents' game: a3 plays and follows a team here; a5 follows without playing
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT public.follow_team((SELECT akakiou FROM t_team), TRUE);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT public.follow_team((SELECT galaxy FROM t_team), FALSE);
RESET ROLE;
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, origin, is_open,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-00000000f601', 'RLS-2030-0541', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1',
  date_trunc('hour', now()) + interval '3 days 2 hours', date_trunc('hour', now()) + interval '3 days 3 hours',
  'confirmed', 'app', TRUE, 4000, 0, 4000, 400, 'standard'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT throws_ok(
  $$SELECT public.ask_parents('00000000-0000-4000-8000-00000000f601')$$,
  '42501', NULL,
  'parents: only the organiser asks'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  public.ask_parents('00000000-0000-4000-8000-00000000f601'),
  1,
  'parents: one parent who plays is asked'
);
RESET ROLE;
SELECT is(
  (SELECT string_agg(n.user_id::text || ' ' || n.status, ',') FROM public.player_notifications AS n
   WHERE n.kind = 'parents_game' AND n.booking_id = '00000000-0000-4000-8000-00000000f601'),
  '00000000-0000-4000-8000-0000000000a3 pending',
  'parents: the parent who said "I play too", not the one who did not, not the organiser'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  public.ask_parents('00000000-0000-4000-8000-00000000f601'),
  0,
  'parents: asking again asks nobody twice'
);

-- the parent's own list, named; another parent's list is their own
SELECT is(
  (SELECT string_agg(f.name || ' ' || f.category || ' ' || coalesce(f.group_label, '-') || ' ' || f.plays::text, ', ')
   FROM public.my_follows() AS f),
  'ΟΜΟΝΟΙΑ ΛΕΥΚΩΣΙΑΣ U9 Lions Nicosia A false',
  'my follows: the team named, with its age group and group'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT is(
  (SELECT string_agg(f.name || ' ' || f.plays::text, ', ') FROM public.my_follows() AS f),
  'ΕΛΛΗΝΙΣΜΟΣ ΑΚΑΚΙΟΥ true',
  'my follows: each parent sees only their own'
);
SELECT is(
  public.venue_hosts_cfa('00000000-0000-4000-8000-0000000000b1')::text || ' '
  || public.venue_hosts_cfa('00000000-0000-4000-8000-000000000100')::text,
  'true false',
  'hosts CFA: yes where the CFA plays this season, no elsewhere'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);

-- unfollow, and the Discover card's read
SELECT public.unfollow_team((SELECT omonoia FROM t_team));
SELECT is((SELECT count(*)::int FROM public.my_team_fixtures()), 0, 'unfollow: the team''s matches leave');
SELECT public.set_test_anon();
SELECT throws_ok(
  $$SELECT * FROM public.cfa_today_nearby('00000000-0000-4000-8000-000000000001')$$,
  '42501', NULL,
  'today nearby: signed in only'
);
RESET ROLE;


-- ════════════════════════════════════════════════════════════════════
-- K5: the owner changes a match
-- ════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE t_u11 AS SELECT pg_temp.m('U11 Eagles', (SELECT sat FROM t_ctx)) AS id;
GRANT SELECT ON t_u11 TO authenticated, anon;

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT throws_ok(
  format('SELECT public.move_cfa_match(%L, %L, %L)', (SELECT id FROM t_u11), '00000000-0000-4000-8000-0000000000c2', '11:30'),
  '42501', NULL,
  'move: the owner only'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT public.move_cfa_match((SELECT id FROM t_u11), '00000000-0000-4000-8000-0000000000c2', '11:30');
RESET ROLE;
SELECT is(
  (SELECT p.name || ' ' || to_char(b.starts_at AT TIME ZONE 'Europe/Nicosia', 'HH24:MI') || ' ' || b.state || ' ' || m.status
   FROM public.competition_matches AS m
   INNER JOIN public.bookings AS b ON b.id = m.booking_id
   INNER JOIN public.pitches AS p ON p.id = b.pitch_id
   WHERE m.id = (SELECT id FROM t_u11)),
  'Pitch A2 (unverified) 11:30 confirmed scheduled',
  'move: the same match on its new court at its new time'
);
SELECT is(
  (SELECT string_agg(x.what || ' ' || x.old_value || '→' || x.new_value, ', ' ORDER BY x.what)
   FROM public.competition_match_changes AS x
   WHERE x.match_id = (SELECT id FROM t_u11) AND x.what IN ('kickoff', 'court') AND x.new_value IN ('11:30', 'Pitch A2 (unverified)')),
  'court Pitch A1 (verified)→Pitch A2 (unverified), kickoff 09:00→11:30',
  'move: both changes are written, so its followers are told'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  format('SELECT public.move_cfa_match(%L, %L, %L)', (SELECT id FROM t_u11), '00000000-0000-4000-8000-0000000000c2', '10:30'),
  '23P01', NULL,
  'move: onto a court taken then, refused'
);
RESET ROLE;
SELECT is(
  (SELECT to_char(b.starts_at AT TIME ZONE 'Europe/Nicosia', 'HH24:MI') || ' ' || b.state
   FROM public.competition_matches AS m INNER JOIN public.bookings AS b ON b.id = m.booking_id
   WHERE m.id = (SELECT id FROM t_u11)),
  '11:30 confirmed',
  'move: a refused move leaves the match where it was'
);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT public.set_cfa_match_status((SELECT id FROM t_u11), 'postponed');
SELECT is(
  (SELECT c.status || ' ' || b.state FROM public.cfa_matches AS c
   INNER JOIN public.bookings AS b ON b.id = c.booking_id WHERE c.id = (SELECT id FROM t_u11)),
  'postponed confirmed',
  'postpone: the match keeps its court, and the programme says postponed'
);
CREATE TEMP TABLE t_tv AS SELECT public.venue_display_token('00000000-0000-4000-8000-0000000000b1', FALSE) AS token;
GRANT SELECT ON t_tv TO anon;
RESET ROLE;
UPDATE public.venues SET slug = 'rls-venue-a' WHERE id = '00000000-0000-4000-8000-0000000000b1';
SELECT public.set_test_anon();
SELECT is(
  public.public_venue_schedule((SELECT token FROM t_tv), (SELECT sat FROM t_ctx)) ->> 'slug',
  'rls-venue-a',
  'tv: the screen knows the venue''s link, for the follow QR (20261016000005)'
);
SELECT is(
  (SELECT i ->> 'status'
   FROM jsonb_array_elements(public.public_venue_schedule((SELECT token FROM t_tv), (SELECT sat FROM t_ctx)) -> 'items') AS i
   WHERE i ->> 'category' = 'U11 Eagles'),
  'postponed',
  'postpone: the TV carries the status'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT public.set_cfa_match_status((SELECT id FROM t_u11), 'cancelled');
SELECT is(
  (SELECT b.state || ' ' || (SELECT count(*) FROM public.cfa_matches WHERE id = (SELECT id FROM t_u11))
   FROM public.competition_matches AS m INNER JOIN public.bookings AS b ON b.id = m.booking_id
   WHERE m.id = (SELECT id FROM t_u11)),
  'cancelled 0',
  'cancel: the court is given back and the match leaves the programme'
);
SELECT public.set_cfa_match_status((SELECT id FROM t_u11), 'scheduled');
RESET ROLE;
SELECT is(
  (SELECT m.status || ' ' || b.state || ' ' || to_char(b.starts_at AT TIME ZONE 'Europe/Nicosia', 'HH24:MI')
   FROM public.competition_matches AS m INNER JOIN public.bookings AS b ON b.id = m.booking_id
   WHERE m.id = (SELECT id FROM t_u11)),
  'scheduled confirmed 11:30',
  'back on: the match takes its slot again'
);

SELECT * FROM finish();
ROLLBACK;
