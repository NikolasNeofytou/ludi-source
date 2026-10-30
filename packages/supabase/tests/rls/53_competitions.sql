-- 53_competitions.sql — the competitions a venue hosts
-- (20261015000003, ADR-0050, plans/fixtures-and-scores.md F1)
-- Under test:
--   competition_season: August to July
--   competitions: scores_public and has_table default by kind; a CFA
--     grassroots competition can never have a table
--   competition_teams: one per name, case- and space-insensitive
--   competition_matches: two different teams of the same competition; a
--     score is both halves, 0-99, only on a played match
--   load_cfa_round on the model: one CFA competition per venue and season,
--     private and tableless; teams deduplicated across loads; a re-load of a
--     date replaces its matches and keeps the competition and the teams
--   cfa_matches: the old table's shape, read from the model
--   RLS: the venue's owner reads, a stranger reads nothing, nobody writes
--
-- 20261016000001 (plans/cfa-in-the-app.md K1) changed two things read here:
-- a team's key is now name + category + group, so the "αποελ " row plays
-- in the same age as ΑΠΟΕΛ to stay one team; and a re-load cancels the
-- matches it drops instead of deleting them, so the listing reads the live
-- ones. 54_cfa_in_the_app.sql tests the new behaviour itself.
--
-- Fixtures: venue_a (b1) owned by a2, courts c1 and c2; venue_b (b2); a5 a
-- stranger.
BEGIN;
SELECT plan(23);

CREATE TEMP TABLE t_ctx AS
SELECT
  (current_date + ((6 - extract(DOW FROM current_date)::int + 7) % 7) + 21)::date AS sat,
  (current_date + ((6 - extract(DOW FROM current_date)::int + 7) % 7) + 28)::date AS sat2;
GRANT SELECT ON t_ctx TO anon, authenticated;

-- ── the season ─────────────────────────────────────────────────────
SELECT is(public.competition_season('2026-10-17'), '2026-27', 'season: October is the season that began in August');
SELECT is(public.competition_season('2027-07-31'), '2026-27', 'season: July closes it');
SELECT is(public.competition_season('2027-08-01'), '2027-28', 'season: August opens the next');
SELECT is(public.competition_season('2009-09-01'), '2009-10', 'season: the short year keeps its zero');

-- ── defaults and the CFA rule ──────────────────────────────────────
INSERT INTO public.competitions (id, venue_id, name, kind, season) VALUES
('00000000-0000-4000-8000-00000000f101', '00000000-0000-4000-8000-0000000000b1', 'Winter League', 'league', '2026-27'),
('00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000000000b1', 'Christmas Cup', 'tournament', '2026-27');
SELECT is(
  (SELECT string_agg(kind || ':' || scores_public::text || '/' || has_table::text, ' ' ORDER BY kind)
   FROM public.competitions WHERE id IN ('00000000-0000-4000-8000-00000000f101', '00000000-0000-4000-8000-00000000f102')),
  'league:true/true tournament:true/false',
  'competitions: a venue''s own competition is public; a league has a table, a cup does not'
);
SELECT throws_ok(
  $$INSERT INTO public.competitions (venue_id, name, kind, season, has_table)
    VALUES ('00000000-0000-4000-8000-0000000000b1', 'ΚΟΠ', 'cfa_grassroots', '2025-26', TRUE)$$,
  '23514', NULL,
  'competitions: a CFA grassroots competition can never have a table'
);

-- ── teams and matches ──────────────────────────────────────────────
INSERT INTO public.competition_teams (id, competition_id, name) VALUES
('00000000-0000-4000-8000-00000000f201', '00000000-0000-4000-8000-00000000f101', 'Larnaca Lions'),
('00000000-0000-4000-8000-00000000f202', '00000000-0000-4000-8000-00000000f101', 'Old Boys'),
('00000000-0000-4000-8000-00000000f203', '00000000-0000-4000-8000-00000000f102', 'Cup Side');
SELECT throws_ok(
  $$INSERT INTO public.competition_teams (competition_id, name)
    VALUES ('00000000-0000-4000-8000-00000000f101', '  larnaca LIONS ')$$,
  '23505', NULL,
  'teams: one per name, whatever the case and spaces'
);
SELECT throws_ok(
  $$INSERT INTO public.competition_matches (competition_id, round_label, home_team_id, away_team_id, kickoff_at)
    VALUES ('00000000-0000-4000-8000-00000000f101', 'R1', '00000000-0000-4000-8000-00000000f201',
            '00000000-0000-4000-8000-00000000f203', now() + interval '3 days')$$,
  '23503', NULL,
  'matches: a team from another competition is refused'
);
SELECT throws_ok(
  $$INSERT INTO public.competition_matches (competition_id, round_label, home_team_id, away_team_id, kickoff_at)
    VALUES ('00000000-0000-4000-8000-00000000f101', 'R1', '00000000-0000-4000-8000-00000000f201',
            '00000000-0000-4000-8000-00000000f201', now() + interval '3 days')$$,
  '23514', NULL,
  'matches: a team cannot play itself'
);
INSERT INTO public.competition_matches (id, competition_id, round_label, home_team_id, away_team_id, kickoff_at)
VALUES (
  '00000000-0000-4000-8000-00000000f301', '00000000-0000-4000-8000-00000000f101', 'R1',
  '00000000-0000-4000-8000-00000000f201', '00000000-0000-4000-8000-00000000f202', now() + interval '3 days'
);
SELECT throws_ok(
  $$UPDATE public.competition_matches SET home_score = 2, away_score = 1, result_at = now()
    WHERE id = '00000000-0000-4000-8000-00000000f301'$$,
  '23514', NULL,
  'matches: no score on a match not played'
);
SELECT throws_ok(
  $$UPDATE public.competition_matches SET status = 'played', home_score = 2, result_at = now()
    WHERE id = '00000000-0000-4000-8000-00000000f301'$$,
  '23514', NULL,
  'matches: a score is both halves'
);
SELECT throws_ok(
  $$UPDATE public.competition_matches SET status = 'played', home_score = 100, away_score = 0, result_at = now()
    WHERE id = '00000000-0000-4000-8000-00000000f301'$$,
  '23514', NULL,
  'matches: a score is 0 to 99'
);
SELECT lives_ok(
  $$UPDATE public.competition_matches SET status = 'played', home_score = 3, away_score = 3, result_at = now()
    WHERE id = '00000000-0000-4000-8000-00000000f301'$$,
  'matches: a played match takes a score'
);

-- ── the loader on the model ────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat FROM t_ctx), 'Αγωνιστική 4',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"09:00","minutes":60,"category":"U9 Lions","home":"ΑΠΟΕΛ","away":"ΟΜΟΝΟΙΑ","price_cents":3000},
    {"pitch_id":"00000000-0000-4000-8000-0000000000c2","kickoff":"09:00","minutes":60,"category":"U9 Lions","home":"αποελ ","away":"ΑΕΛ","price_cents":3000},
    {"pitch_id":"00000000-0000-4000-8000-0000000000c2","kickoff":"10:00","minutes":60,"category":"U8 Eagles","home":"ΑΕΛ","away":"ΑΕΛ","price_cents":3000}]'::jsonb);
RESET ROLE;
SELECT is(
  (SELECT kind || ':' || season || ':' || scores_public::text || '/' || has_table::text FROM public.competitions
   WHERE venue_id = '00000000-0000-4000-8000-0000000000b1' AND kind = 'cfa_grassroots'),
  'cfa_grassroots:' || public.competition_season((SELECT sat FROM t_ctx)) || ':false/false',
  'loader: the venue''s CFA competition for the season, private and tableless'
);
SELECT is(
  (SELECT string_agg(t.name, ' ' ORDER BY t.name) FROM public.competition_teams AS t
   INNER JOIN public.competitions AS c ON c.id = t.competition_id
   WHERE c.venue_id = '00000000-0000-4000-8000-0000000000b1' AND c.kind = 'cfa_grassroots'),
  'ΑΕΛ ΑΠΟΕΛ ΟΜΟΝΟΙΑ',
  'loader: teams made once each, "αποελ " is ΑΠΟΕΛ; a team against itself is skipped'
);
SELECT is(
  (SELECT count(*)::int FROM public.competition_matches AS m
   INNER JOIN public.competitions AS c ON c.id = m.competition_id
   WHERE c.venue_id = '00000000-0000-4000-8000-0000000000b1' AND c.kind = 'cfa_grassroots'),
  2,
  'loader: one match per placed row'
);

-- a second Saturday adds to the same competition and reuses its teams
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat2 FROM t_ctx), 'Αγωνιστική 5',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"09:00","minutes":60,"category":"U9 Lions","home":"ΟΜΟΝΟΙΑ","away":"ΑΠΟΕΛ","price_cents":3000}]'::jsonb);
RESET ROLE;
SELECT is(
  (SELECT count(DISTINCT c.id)::text || '/' || count(DISTINCT t.id)::text
   FROM public.competitions AS c
   INNER JOIN public.competition_teams AS t ON t.competition_id = c.id
   WHERE c.venue_id = '00000000-0000-4000-8000-0000000000b1' AND c.kind = 'cfa_grassroots'),
  '1/3',
  'loader: the next Saturday reuses the competition and the teams'
);

-- re-load the first Saturday with one match: its two go, the second
-- Saturday's stays, the teams stay
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
CREATE TEMP TABLE t_re AS
SELECT public.load_cfa_round('00000000-0000-4000-8000-0000000000b1', (SELECT sat FROM t_ctx), 'Αγωνιστική 4',
  '[{"pitch_id":"00000000-0000-4000-8000-0000000000c1","kickoff":"11:00","minutes":60,"category":"U10","home":"ΑΕΛ","away":"ΟΜΟΝΟΙΑ","price_cents":3000}]'::jsonb) AS r;
RESET ROLE;
SELECT is(
  (SELECT (r ->> 'replaced')::int FROM t_re),
  2,
  'loader: a re-load cancels the date''s earlier matches'
);
SELECT is(
  (SELECT string_agg(to_char(m.kickoff_at AT TIME ZONE 'Europe/Nicosia', 'HH24:MI') || ' ' || h.name || '-' || a.name, ', '
                     ORDER BY m.kickoff_at)
   FROM public.competition_matches AS m
   INNER JOIN public.competitions AS c ON c.id = m.competition_id
   INNER JOIN public.competition_teams AS h ON h.id = m.home_team_id
   INNER JOIN public.competition_teams AS a ON a.id = m.away_team_id
   WHERE c.venue_id = '00000000-0000-4000-8000-0000000000b1' AND c.kind = 'cfa_grassroots'
     AND m.status <> 'cancelled'),
  '11:00 ΑΕΛ-ΟΜΟΝΟΙΑ, 09:00 ΟΜΟΝΟΙΑ-ΑΠΟΕΛ',
  'loader: the re-loaded date has its one match, the other Saturday keeps its own'
);

-- ── cfa_matches, the old shape ─────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT string_agg(match_date::text || ' ' || kickoff::text || ' ' || category || ' ' || home_team || '-' || away_team
                     || ' ' || round_label || ' ' || (booking_id IS NOT NULL)::text || ' ' || (venue_id = '00000000-0000-4000-8000-0000000000b1')::text,
                     ' | ' ORDER BY match_date)
   FROM public.cfa_matches),
  (SELECT sat::text FROM t_ctx) || ' 11:00:00 U10 ΑΕΛ-ΟΜΟΝΟΙΑ Αγωνιστική 4 true true | '
  || (SELECT sat2::text FROM t_ctx) || ' 09:00:00 U9 Lions ΟΜΟΝΟΙΑ-ΑΠΟΕΛ Αγωνιστική 5 true true',
  'cfa_matches: the old columns, read from the model, for the owner'
);

-- ── who reads, who writes ──────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.competitions WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'),
  3,
  'rls: the owner reads the venue''s competitions'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.competitions)
  + (SELECT count(*)::int FROM public.competition_teams)
  + (SELECT count(*)::int FROM public.competition_matches)
  + (SELECT count(*)::int FROM public.cfa_matches),
  0,
  'rls: a stranger reads nothing'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$INSERT INTO public.competitions (venue_id, name, kind, season)
    VALUES ('00000000-0000-4000-8000-0000000000b1', 'Mine', 'league', '2026-27')$$,
  '42501', NULL,
  'rls: not even the owner writes from a client'
);

SELECT * FROM finish();
ROLLBACK;
