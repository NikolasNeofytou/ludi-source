-- 20261015000003_competitions.sql
-- The competitions a venue hosts (plans/fixtures-and-scores.md F1,
-- ADR-0050): one model — a competition, its teams, its matches — for the
-- CFA grassroots Saturdays loaded since September and for the venue's own
-- leagues and tournaments to come. Two rules are written into it: a
-- competition's scores are public only when its owner says so, and a CFA
-- grassroots competition never has a table. Team-level only, always.
--
-- cfa_matches (20260917000002) becomes a view over the model with the same
-- columns, so the admin's programme, the TV and the wall keep their
-- contract; load_cfa_round is rewritten to write the model.
--
-- Contents:
--   1. competition_season — the August-to-July season label
--   2. competitions        — kind, season, scores_public, has_table
--   3. competition_teams   — a name per competition, no roster
--   4. competition_matches — round, category, two teams, kickoff, court
--                            booking, status and a score
--   5. RLS                 — the venue's owner and admin read; writes go
--                            through definer functions
--   6. the CFA rows move, and cfa_matches becomes a view
--   7. load_cfa_round      — the same contract, writing the model

-- ════════════════════════════════════════════════════════════════════
-- 1. The season
-- ════════════════════════════════════════════════════════════════════
-- Cypriot football runs August to July: a match on 17 October 2026 is in
-- 2026-27, one on 31 July 2027 still is, one on 1 August 2027 is 2027-28.
CREATE OR REPLACE FUNCTION public.competition_season(p_date date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN extract(MONTH FROM p_date) >= 8
      THEN extract(YEAR FROM p_date)::int::text || '-'
        || lpad(((extract(YEAR FROM p_date)::int + 1) % 100)::text, 2, '0')
    ELSE (extract(YEAR FROM p_date)::int - 1)::text || '-'
      || lpad((extract(YEAR FROM p_date)::int % 100)::text, 2, '0')
  END;
$$;

COMMENT ON FUNCTION public.competition_season(date) IS
'The season a date belongs to, August to July: 2026-10-17 -> 2026-27.';

-- ════════════════════════════════════════════════════════════════════
-- 2. Competitions
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE public.competitions (
  id uuid PRIMARY KEY DEFAULT public.uuid7(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('cfa_grassroots', 'league', 'tournament')),
  season text NOT NULL CHECK (season ~ '^[0-9]{4}-[0-9]{2}$'),
  -- No column defaults: tg_competitions_defaults fills both by kind when
  -- the creator leaves them out (NOT NULL is checked after it runs).
  scores_public boolean NOT NULL,
  has_table boolean NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished', 'archived')),
  created_by uuid DEFAULT auth.uid() REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ADR-0050: the CFA keeps no standings for grassroots ages, so neither
  -- does Ludi, whatever any switch says.
  CONSTRAINT competitions_no_cfa_table CHECK (NOT (kind = 'cfa_grassroots' AND has_table))
);

-- One CFA grassroots competition per venue and season: the loader finds it
-- or makes it.
CREATE UNIQUE INDEX competitions_cfa_season_key
ON public.competitions (venue_id, season)
WHERE kind = 'cfa_grassroots';

CREATE INDEX competitions_venue_idx ON public.competitions (venue_id);

CREATE OR REPLACE FUNCTION public.tg_competitions_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- A venue's own competition shows its scores; the CFA's does not until
  -- the owner says so (ADR-0050). A league has a table; a tournament and
  -- the CFA do not.
  NEW.scores_public := coalesce(NEW.scores_public, NEW.kind <> 'cfa_grassroots');
  NEW.has_table := coalesce(NEW.has_table, NEW.kind = 'league');
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_competitions_defaults
BEFORE INSERT ON public.competitions
FOR EACH ROW EXECUTE FUNCTION public.tg_competitions_defaults();

CREATE TRIGGER tg_competitions_updated_at
BEFORE UPDATE ON public.competitions
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE public.competitions IS
'A competition a venue hosts (ADR-0050): the CFA''s grassroots Saturdays '
'(one per venue and season, loaded by load_cfa_round) or the venue''s own '
'league or tournament. scores_public decides whether a result is shown '
'anywhere outside the dashboard; has_table is never true for '
'cfa_grassroots.';
COMMENT ON COLUMN public.competitions.scores_public IS
'Results are shown in the app, on the TV and on the venue''s page only '
'when true. Defaults off for cfa_grassroots, on otherwise (ADR-0050).';

-- ════════════════════════════════════════════════════════════════════
-- 3. Teams
-- ════════════════════════════════════════════════════════════════════
-- A name, nothing more: no roster, no children's names (ADR-0050).
CREATE TABLE public.competition_teams (
  id uuid PRIMARY KEY DEFAULT public.uuid7(),
  competition_id uuid NOT NULL REFERENCES public.competitions (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- the target of the matches' composite FKs: a match's teams belong to
  -- the match's competition
  CONSTRAINT competition_teams_competition_id_id_key UNIQUE (competition_id, id)
);

CREATE UNIQUE INDEX competition_teams_name_key
ON public.competition_teams (competition_id, lower(btrim(name)));

COMMENT ON TABLE public.competition_teams IS
'A team in a competition, by name only (ADR-0050). The CFA loader makes '
'them from the round''s strings; "ΑΠΟΕΛ" and "αποελ " are one team.';

-- ════════════════════════════════════════════════════════════════════
-- 4. Matches
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE public.competition_matches (
  id uuid PRIMARY KEY DEFAULT public.uuid7(),
  competition_id uuid NOT NULL REFERENCES public.competitions (id) ON DELETE CASCADE,
  -- the walk-in that holds the court, as cfa_matches had it
  booking_id uuid UNIQUE REFERENCES public.bookings (id) ON DELETE SET NULL,
  round_label text NOT NULL CHECK (char_length(btrim(round_label)) BETWEEN 1 AND 40),
  category text CHECK (category IS NULL OR char_length(btrim(category)) BETWEEN 1 AND 40),
  home_team_id uuid NOT NULL,
  away_team_id uuid NOT NULL,
  kickoff_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
  CHECK (status IN ('scheduled', 'played', 'postponed', 'cancelled')),
  home_score smallint CHECK (home_score BETWEEN 0 AND 99),
  away_score smallint CHECK (away_score BETWEEN 0 AND 99),
  result_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  result_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competition_matches_home_team_fkey
  FOREIGN KEY (competition_id, home_team_id)
  REFERENCES public.competition_teams (competition_id, id) ON DELETE RESTRICT,
  CONSTRAINT competition_matches_away_team_fkey
  FOREIGN KEY (competition_id, away_team_id)
  REFERENCES public.competition_teams (competition_id, id) ON DELETE RESTRICT,
  CONSTRAINT competition_matches_two_teams CHECK (home_team_id <> away_team_id),
  -- a score is both halves or neither, and only on a played match
  CONSTRAINT competition_matches_score_pair CHECK ((home_score IS NULL) = (away_score IS NULL)),
  CONSTRAINT competition_matches_score_played CHECK (home_score IS NULL OR status = 'played'),
  CONSTRAINT competition_matches_result_pair CHECK ((home_score IS NULL) = (result_at IS NULL))
);

CREATE INDEX competition_matches_competition_idx
ON public.competition_matches (competition_id, kickoff_at);
CREATE INDEX competition_matches_kickoff_idx ON public.competition_matches (kickoff_at);

COMMENT ON TABLE public.competition_matches IS
'A match in a competition (ADR-0050): two teams of that competition, a '
'kickoff, the walk-in booking that holds its court, and — once played — a '
'score. Shown outside the dashboard only where the competition''s '
'scores_public allows. Written through definer functions only.';

-- ════════════════════════════════════════════════════════════════════
-- 5. Who reads
-- ════════════════════════════════════════════════════════════════════
-- The venue's owner (and manager, through is_venue_owner_of_venue) and the
-- admin read their venue's competitions; nobody writes from a client. The
-- app, the TV and the venue's page will read through definer functions
-- that apply scores_public (F4, F6).
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY competitions_owner_or_admin_select ON public.competitions
FOR SELECT TO authenticated
USING (public.is_venue_owner_of_venue(venue_id) OR public.is_admin());

CREATE POLICY competition_teams_owner_or_admin_select ON public.competition_teams
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.competitions AS c
  WHERE
    c.id = competition_teams.competition_id
    AND (public.is_venue_owner_of_venue(c.venue_id) OR public.is_admin())
));

CREATE POLICY competition_matches_owner_or_admin_select ON public.competition_matches
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.competitions AS c
  WHERE
    c.id = competition_matches.competition_id
    AND (public.is_venue_owner_of_venue(c.venue_id) OR public.is_admin())
));

REVOKE ALL ON public.competitions, public.competition_teams, public.competition_matches FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.competitions, public.competition_teams, public.competition_matches
FROM authenticated;
GRANT SELECT ON public.competitions, public.competition_teams, public.competition_matches TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. The CFA rows move; cfa_matches becomes a view
-- ════════════════════════════════════════════════════════════════════
-- Prod held no cfa_matches rows when this was written (2026-10-15), but
-- the move is written for any: one cfa_grassroots competition per venue
-- and season, its teams from the strings, its matches with their
-- bookings.
INSERT INTO public.competitions (venue_id, name, kind, season, scores_public, has_table, created_by)
SELECT DISTINCT ON (m.venue_id, public.competition_season(m.match_date))
  m.venue_id,
  'ΚΟΠ Grassroots ' || public.competition_season(m.match_date),
  'cfa_grassroots',
  public.competition_season(m.match_date),
  FALSE,
  FALSE,
  m.created_by
FROM public.cfa_matches AS m
ORDER BY m.venue_id, public.competition_season(m.match_date), m.created_at;

INSERT INTO public.competition_teams (competition_id, name)
SELECT DISTINCT ON (c.id, lower(btrim(t.name))) c.id, btrim(t.name)
FROM public.cfa_matches AS m
INNER JOIN public.competitions AS c
  ON c.venue_id = m.venue_id AND c.kind = 'cfa_grassroots'
  AND c.season = public.competition_season(m.match_date)
CROSS JOIN LATERAL (VALUES (m.home_team), (m.away_team)) AS t (name)
ORDER BY c.id, lower(btrim(t.name));

INSERT INTO public.competition_matches (
  id, competition_id, booking_id, round_label, category, home_team_id, away_team_id,
  kickoff_at, created_by, created_at
)
SELECT
  m.id,
  c.id,
  m.booking_id,
  m.round_label,
  m.category,
  h.id,
  a.id,
  (m.match_date + m.kickoff) AT TIME ZONE 'Europe/Nicosia',
  m.created_by,
  m.created_at
FROM public.cfa_matches AS m
INNER JOIN public.competitions AS c
  ON c.venue_id = m.venue_id AND c.kind = 'cfa_grassroots'
  AND c.season = public.competition_season(m.match_date)
INNER JOIN public.competition_teams AS h
  ON h.competition_id = c.id AND lower(btrim(h.name)) = lower(btrim(m.home_team))
INNER JOIN public.competition_teams AS a
  ON a.competition_id = c.id AND lower(btrim(a.name)) = lower(btrim(m.away_team))
WHERE lower(btrim(m.home_team)) <> lower(btrim(m.away_team));

DROP TABLE public.cfa_matches;

-- The old table's columns, in its order, read from the model. The admin's
-- programme embeds bookings through booking_id, which PostgREST follows
-- through the view to competition_matches' FK. security_invoker: the
-- caller's RLS on the model applies, as it did on the table; the definer
-- functions that read it (the TV, the wall, the cameras) run as its owner.
CREATE VIEW public.cfa_matches
WITH (security_invoker = on) AS
SELECT
  m.id,
  c.venue_id,
  m.booking_id,
  (m.kickoff_at AT TIME ZONE 'Europe/Nicosia')::date AS match_date,
  m.round_label,
  (m.kickoff_at AT TIME ZONE 'Europe/Nicosia')::time AS kickoff,
  m.category,
  h.name AS home_team,
  a.name AS away_team,
  m.created_by,
  m.created_at
FROM public.competition_matches AS m
INNER JOIN public.competitions AS c ON c.id = m.competition_id
INNER JOIN public.competition_teams AS h ON h.id = m.home_team_id
INNER JOIN public.competition_teams AS a ON a.id = m.away_team_id
WHERE c.kind = 'cfa_grassroots';

COMMENT ON VIEW public.cfa_matches IS
'Transitional (ADR-0050): the CFA grassroots matches in the shape of the '
'20260917000002 table, read from competitions / competition_teams / '
'competition_matches. Dropped once the admin reads the model directly.';

REVOKE ALL ON public.cfa_matches FROM anon;
GRANT SELECT ON public.cfa_matches TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 7. The loader, writing the model
-- ════════════════════════════════════════════════════════════════════
-- A team by name in a competition: found case- and space-insensitively, or
-- made.
CREATE OR REPLACE FUNCTION public.competition_team_id(p_competition_id uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.competition_teams (competition_id, name)
  VALUES (p_competition_id, left(btrim(p_name), 120))
  ON CONFLICT (competition_id, lower(btrim(name))) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT t.id INTO v_id FROM public.competition_teams AS t
    WHERE t.competition_id = p_competition_id AND lower(btrim(t.name)) = lower(btrim(p_name));
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.competition_team_id(uuid, text) FROM public, anon, authenticated;

-- Same signature, same answer, same rules as 20260917000002: replace an
-- earlier load of the date, release the standing holds under each match,
-- skip (do not fail on) a court already taken. What changed is where the
-- programme row goes: the venue's CFA competition for that season (made
-- on first use, scores private, no table), its teams by name, a match.
CREATE OR REPLACE FUNCTION public.load_cfa_round(
  p_venue_id uuid,
  p_date date,
  p_round text,
  p_matches jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy text;
  v_prefix text;
  v_season text;
  v_comp uuid;
  v_match jsonb;
  v_idx int := -1;
  v_pitch uuid;
  v_minutes int;
  v_price int;
  v_starts timestamptz;
  v_ends timestamptz;
  v_name text;
  v_code text;
  v_booking uuid;
  v_home uuid;
  v_away uuid;
  v_placed int := 0;
  v_released int := 0;
  v_replaced int := 0;
  v_n int;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.is_admin() OR public.is_venue_owner_of_venue(p_venue_id)) THEN
    RAISE EXCEPTION 'load_cfa_round: not your venue' USING ERRCODE = '42501';
  END IF;
  IF p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array'
    OR jsonb_array_length(p_matches) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'load_cfa_round: between 1 and 80 matches' USING ERRCODE = '23514';
  END IF;
  IF p_round IS NULL OR char_length(btrim(p_round)) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'load_cfa_round: name the round' USING ERRCODE = '23514';
  END IF;

  SELECT v.cancellation_policy, upper(left(c.code, 3))
  INTO v_policy, v_prefix
  FROM public.venues AS v
  INNER JOIN public.cities AS c ON c.id = v.city_id
  WHERE v.id = p_venue_id;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'load_cfa_round: no such venue' USING ERRCODE = 'P0002';
  END IF;

  -- The venue's CFA competition for this season: found, or made private
  -- and tableless (ADR-0050).
  v_season := public.competition_season(p_date);
  INSERT INTO public.competitions (venue_id, name, kind, season, scores_public, has_table)
  VALUES (p_venue_id, 'ΚΟΠ Grassroots ' || v_season, 'cfa_grassroots', v_season, FALSE, FALSE)
  ON CONFLICT (venue_id, season) WHERE kind = 'cfa_grassroots' DO NOTHING;
  SELECT c.id INTO v_comp FROM public.competitions AS c
  WHERE c.venue_id = p_venue_id AND c.kind = 'cfa_grassroots' AND c.season = v_season;

  -- Replace an earlier load of this date: its bookings and payments go, its
  -- matches go; the competition and its teams stay.
  WITH old AS (
    DELETE FROM public.competition_matches AS m
    WHERE m.competition_id = v_comp
      AND (m.kickoff_at AT TIME ZONE 'Europe/Nicosia')::date = p_date
    RETURNING m.booking_id
  ),

  gone AS (
    UPDATE public.bookings AS b
    SET state = 'cancelled', cancelled_at = now(), updated_at = now()
    FROM old
    WHERE b.id = old.booking_id AND b.state = 'confirmed'
    RETURNING b.id
  ),

  paid AS (
    UPDATE public.payments AS p
    SET status = 'cancelled', updated_at = now()
    FROM gone
    WHERE p.booking_id = gone.id AND p.payment_method = 'offline'
    RETURNING p.id
  )

  SELECT count(*) INTO v_replaced FROM gone;

  FOR v_match IN SELECT value FROM jsonb_array_elements(p_matches)
  LOOP
    v_idx := v_idx + 1;
    v_pitch := nullif(v_match ->> 'pitch_id', '')::uuid;
    v_minutes := coalesce((v_match ->> 'minutes')::int, 60);
    v_price := coalesce((v_match ->> 'price_cents')::int, 0);

    IF v_pitch IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.pitches AS p
      WHERE p.id = v_pitch AND p.venue_id = p_venue_id AND p.is_active
    ) THEN
      v_skipped := v_skipped || jsonb_build_object('index', v_idx, 'reason', 'court');
      CONTINUE;
    END IF;
    IF v_minutes NOT BETWEEN 20 AND 180 OR v_price NOT BETWEEN 1 AND 500000
      OR coalesce(btrim(v_match ->> 'category'), '') = ''
      OR coalesce(btrim(v_match ->> 'home'), '') = ''
      OR coalesce(btrim(v_match ->> 'away'), '') = ''
      OR lower(btrim(v_match ->> 'home')) = lower(btrim(v_match ->> 'away')) THEN
      v_skipped := v_skipped || jsonb_build_object('index', v_idx, 'reason', 'invalid');
      CONTINUE;
    END IF;

    BEGIN
      v_starts := (p_date + (v_match ->> 'kickoff')::time) AT TIME ZONE 'Europe/Nicosia';
    EXCEPTION WHEN others THEN
      v_skipped := v_skipped || jsonb_build_object('index', v_idx, 'reason', 'invalid');
      CONTINUE;
    END;
    v_ends := v_starts + make_interval(mins => v_minutes);

    -- Release the standing holds this match lands on: instances of any
    -- series on this court or a court sharing its surface.
    WITH held AS (
      UPDATE public.bookings AS b
      SET state = 'cancelled', cancelled_at = now(), updated_at = now()
      WHERE b.series_id IS NOT NULL
        AND b.state = 'confirmed'
        AND b.pitch_id IN (SELECT public.pitch_blockers(v_pitch))
        AND b.time_range && tstzrange(v_starts, v_ends, '[)')
      RETURNING b.id
    ),

    paid AS (
      UPDATE public.payments AS p
      SET status = 'cancelled', updated_at = now()
      FROM held
      WHERE p.booking_id = held.id AND p.payment_method = 'offline'
      RETURNING p.id
    )

    SELECT count(*) INTO v_n FROM held;
    v_released := v_released + v_n;

    v_name := left(
      btrim(v_match ->> 'category') || ' · ' || btrim(v_match ->> 'home') || ' – ' || btrim(v_match ->> 'away'),
      120
    );

    BEGIN
      v_code := public.generate_booking_code(v_prefix, extract(YEAR FROM v_starts)::int);
      INSERT INTO public.bookings (
        code, user_id, pitch_id, starts_at, ends_at, state, origin,
        walk_in_name, base_price_cents, addons_price_cents, total_cents,
        platform_fee_cents, cancellation_policy
      ) VALUES (
        v_code, auth.uid(), v_pitch, v_starts, v_ends, 'confirmed', 'walk_in',
        v_name, v_price, 0, v_price, 0, v_policy
      )
      RETURNING id INTO v_booking;

      INSERT INTO public.payments (
        booking_id, stripe_payment_intent_id, amount_cents, application_fee_cents,
        status, payment_method
      ) VALUES (v_booking, 'offline_' || v_booking::text, v_price, 0, 'succeeded', 'offline');

      v_home := public.competition_team_id(v_comp, v_match ->> 'home');
      v_away := public.competition_team_id(v_comp, v_match ->> 'away');
      INSERT INTO public.competition_matches (
        competition_id, booking_id, round_label, category, home_team_id, away_team_id, kickoff_at
      ) VALUES (
        v_comp, v_booking, btrim(p_round), left(btrim(v_match ->> 'category'), 40),
        v_home, v_away, v_starts
      );
      v_placed := v_placed + 1;
    EXCEPTION
      WHEN exclusion_violation THEN
        v_skipped := v_skipped || jsonb_build_object('index', v_idx, 'reason', 'taken');
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'placed', v_placed, 'released', v_released, 'replaced', v_replaced, 'skipped', v_skipped
  );
END;
$$;

COMMENT ON FUNCTION public.load_cfa_round(uuid, date, text, jsonb) IS
'Owner/admin: put a CFA grassroots round on courts for one date. Writes the '
'venue''s CFA competition for the season (made on first use, scores '
'private, no table), its teams by name and a match per placed row '
'(ADR-0050). Replaces an earlier load of that date, releases standing holds '
'under each match, skips (does not fail on) a court already taken.';

GRANT EXECUTE ON FUNCTION public.load_cfa_round(uuid, date, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.load_cfa_round(uuid, date, text, jsonb) FROM anon;
