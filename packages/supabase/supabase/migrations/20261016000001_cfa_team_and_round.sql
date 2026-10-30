-- 20261016000001_cfa_team_and_round.sql
-- The CFA team as the CFA means it, and a round that keeps its matches
-- (plans/cfa-in-the-app.md K1; ADR-0051; ADR-0050 amended 2026-10-15).
--
-- A parent follows a team (K3), and is told when its match moves (K4).
-- Neither works on the F1 model as it stood: a team was a club name per
-- venue and season, so ΟΜΟΝΟΙΑ U7 and ΟΜΟΝΟΙΑ U11 were one row; and a
-- re-load deleted the date's matches and made new ones, so every
-- Wednesday re-load read as a cancellation and nothing kept its id.
--
-- Contents:
--   1. competition_teams gains category and group_label; the unique key
--      follows (a venue league's teams leave both null, unchanged)
--   2. a CFA grassroots competition's scores are never public, and a CFA
--      match never carries a score (ADR-0050 amended)
--   3. competition_matches gains `elsewhere`: the CFA's venue name for an
--      away match of a team that plays here; it holds no court
--   4. competition_match_changes: every change to a match's kick-off,
--      court, venue or status — the owner's audit, and K4's cause
--   5. cfa_matches shows what it showed: the venue's own live matches
--   6. competition_team_id by name, category and group
--   7. load_cfa_round diffs instead of replacing
--
-- Prod held no CFA matches or teams when this was written (2026-10-15):
-- nothing to backfill.

-- ════════════════════════════════════════════════════════════════════
-- 1. The CFA team: an academy within an age group and a group
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.competition_teams
ADD COLUMN category text
CHECK (category IS NULL OR char_length(btrim(category)) BETWEEN 1 AND 40),
ADD COLUMN group_label text
CHECK (group_label IS NULL OR char_length(btrim(group_label)) BETWEEN 1 AND 40);

DROP INDEX public.competition_teams_name_key;
CREATE UNIQUE INDEX competition_teams_name_key
ON public.competition_teams (
  competition_id,
  lower(btrim(name)),
  lower(btrim(coalesce(category, ''))),
  lower(btrim(coalesce(group_label, '')))
);

COMMENT ON COLUMN public.competition_teams.category IS
'The CFA age group the team plays in (U9 Lions); NULL for a venue''s own '
'league. With name and group_label, the team''s key for the season '
'(ADR-0051).';
COMMENT ON COLUMN public.competition_teams.group_label IS
'The CFA group within the age group (Nicosia A); NULL when the file gives none.';

-- ════════════════════════════════════════════════════════════════════
-- 2. A CFA competition's scores are never public, nor recorded
-- ════════════════════════════════════════════════════════════════════
-- The CFA's 2026–27 announcement: «χωρίς να καταγράφονται αποτελέσματα ή
-- βαθμολογίες». The founder followed the organiser over the switch.
ALTER TABLE public.competitions
ADD CONSTRAINT competitions_no_cfa_scores
CHECK (NOT (kind = 'cfa_grassroots' AND scores_public));

CREATE OR REPLACE FUNCTION public.tg_competition_matches_no_cfa_score()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.home_score IS NOT NULL OR NEW.away_score IS NOT NULL) AND EXISTS (
    SELECT 1 FROM public.competitions AS c
    WHERE c.id = NEW.competition_id AND c.kind = 'cfa_grassroots'
  ) THEN
    RAISE EXCEPTION 'competition_matches: a CFA grassroots match carries no score (ADR-0050, amended)'
    USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER competition_matches_no_cfa_score
BEFORE INSERT OR UPDATE OF home_score, away_score ON public.competition_matches
FOR EACH ROW EXECUTE FUNCTION public.tg_competition_matches_no_cfa_score();

-- ════════════════════════════════════════════════════════════════════
-- 3. An away match of one of our teams
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.competition_matches
ADD COLUMN elsewhere text
CHECK (elsewhere IS NULL OR char_length(btrim(elsewhere)) BETWEEN 1 AND 120),
ADD CONSTRAINT competition_matches_court_or_elsewhere
CHECK (booking_id IS NULL OR elsewhere IS NULL);

COMMENT ON COLUMN public.competition_matches.elsewhere IS
'The CFA''s venue name when the match is not at this venue: the away match '
'of a team that plays here, kept so a parent following it sees every '
'Saturday (plans/cfa-in-the-app.md). Holds no court; never on the TV.';

-- ════════════════════════════════════════════════════════════════════
-- 4. What changed, when, by whom
-- ════════════════════════════════════════════════════════════════════
-- old_value / new_value are what a person reads: a kick-off as HH:MM in
-- Cyprus time, a court or venue by name, a status word. K4 mints a
-- follower's notice from each row.
CREATE TABLE public.competition_match_changes (
  id uuid PRIMARY KEY DEFAULT public.uuid7(),
  match_id uuid NOT NULL REFERENCES public.competition_matches (id) ON DELETE CASCADE,
  what text NOT NULL CHECK (what IN ('kickoff', 'court', 'venue', 'status')),
  old_value text CHECK (old_value IS NULL OR char_length(old_value) <= 120),
  new_value text CHECK (new_value IS NULL OR char_length(new_value) <= 120),
  changed_by uuid DEFAULT auth.uid() REFERENCES public.users (id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX competition_match_changes_match_idx
ON public.competition_match_changes (match_id, changed_at);

COMMENT ON TABLE public.competition_match_changes IS
'A change to a competition match''s kick-off, court, venue or status '
'(plans/cfa-in-the-app.md K1): the owner''s audit, and the cause a '
'follower is told from (K4). Written by definer functions only.';

ALTER TABLE public.competition_match_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY competition_match_changes_owner_or_admin_select ON public.competition_match_changes
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.competition_matches AS m
  INNER JOIN public.competitions AS c ON c.id = m.competition_id
  WHERE
    m.id = competition_match_changes.match_id
    AND (public.is_venue_owner_of_venue(c.venue_id) OR public.is_admin())
));

REVOKE ALL ON public.competition_match_changes FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.competition_match_changes FROM authenticated;
GRANT SELECT ON public.competition_match_changes TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. cfa_matches: the venue's own live matches, as before
-- ════════════════════════════════════════════════════════════════════
-- A cancelled match now stays as a row (it keeps its id), and an away
-- match holds no court: neither is what the programme, the calendar count
-- or the TV meant by "the CFA matches here".
CREATE OR REPLACE VIEW public.cfa_matches
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
WHERE
  c.kind = 'cfa_grassroots'
  AND m.elsewhere IS NULL
  AND m.status <> 'cancelled';

-- ════════════════════════════════════════════════════════════════════
-- 6. A team by its key
-- ════════════════════════════════════════════════════════════════════
DROP FUNCTION public.competition_team_id(uuid, text);

CREATE FUNCTION public.competition_team_id(
  p_competition_id uuid,
  p_name text,
  p_category text DEFAULT NULL,
  p_group text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_category text := nullif(left(btrim(coalesce(p_category, '')), 40), '');
  v_group text := nullif(left(btrim(coalesce(p_group, '')), 40), '');
BEGIN
  INSERT INTO public.competition_teams (competition_id, name, category, group_label)
  VALUES (p_competition_id, left(btrim(p_name), 120), v_category, v_group)
  ON CONFLICT (
    competition_id,
    lower(btrim(name)),
    lower(btrim(coalesce(category, ''))),
    lower(btrim(coalesce(group_label, '')))
  ) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT t.id INTO v_id FROM public.competition_teams AS t
    WHERE
      t.competition_id = p_competition_id
      AND lower(btrim(t.name)) = lower(btrim(p_name))
      AND lower(btrim(coalesce(t.category, ''))) = lower(coalesce(v_category, ''))
      AND lower(btrim(coalesce(t.group_label, ''))) = lower(coalesce(v_group, ''));
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.competition_team_id(uuid, text, text, text) FROM public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 7. The loader keeps what has not changed
-- ════════════════════════════════════════════════════════════════════
-- Same signature. A row is one match of the day: a match here (pitch_id,
-- minutes, price_cents) or, with `elsewhere`, an away match. A match's
-- identity on the date is its two teams (name + category + group):
--   unchanged       → untouched: same id, same booking
--   kick-off/court  → its booking is replaced, the match row keeps its id,
--                     a change row says what moved
--   not in the file → status cancelled, booking cancelled, a change row
--   new             → placed as before
-- The owner's postponement stands when the file still has the match at
-- the same time. An away row is kept only when one of its teams has a
-- match at this venue this season — the venue's teams, not the district.
--
-- Two passes, so a match moving onto a court another match is leaving
-- does not collide with it: the first resolves every row and releases the
-- courts of what changed or went; the second places.
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
  v_venue_name text;
  v_season text;
  v_comp uuid;
  v_hosts int;
  v_match jsonb;
  v_idx int;
  v_todo jsonb := '[]'::jsonb;
  v_item jsonb;
  v_elsewhere text;
  v_pitch uuid;
  v_minutes int;
  v_price int;
  v_starts timestamptz;
  v_ends timestamptz;
  v_category text;
  v_hname text;
  v_aname text;
  v_hcat text;
  v_acat text;
  v_hgrp text;
  v_agrp text;
  v_home uuid;
  v_away uuid;
  v_old record;
  v_found boolean;
  v_has_old boolean;
  v_seen uuid[] := '{}';
  v_gone record;
  v_name text;
  v_code text;
  v_booking uuid;
  v_restore uuid;
  v_n int;
  v_placed int := 0;
  v_moved int := 0;
  v_unchanged int := 0;
  v_cancelled int := 0;
  v_replaced int := 0;
  v_released int := 0;
  v_kept_away int := 0;
  v_ignored int := 0;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.is_admin() OR public.is_venue_owner_of_venue(p_venue_id)) THEN
    RAISE EXCEPTION 'load_cfa_round: not your venue' USING ERRCODE = '42501';
  END IF;
  IF p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array'
    OR jsonb_array_length(p_matches) NOT BETWEEN 1 AND 480 THEN
    RAISE EXCEPTION 'load_cfa_round: between 1 and 480 rows' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_hosts
  FROM jsonb_array_elements(p_matches) AS e (value)
  WHERE coalesce(btrim(e.value ->> 'elsewhere'), '') = '';
  IF v_hosts > 80 THEN
    RAISE EXCEPTION 'load_cfa_round: at most 80 matches here' USING ERRCODE = '23514';
  END IF;
  IF p_round IS NULL OR char_length(btrim(p_round)) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'load_cfa_round: name the round' USING ERRCODE = '23514';
  END IF;

  SELECT v.cancellation_policy, upper(left(c.code, 3)), v.name
  INTO v_policy, v_prefix, v_venue_name
  FROM public.venues AS v
  INNER JOIN public.cities AS c ON c.id = v.city_id
  WHERE v.id = p_venue_id;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'load_cfa_round: no such venue' USING ERRCODE = 'P0002';
  END IF;

  v_season := public.competition_season(p_date);
  INSERT INTO public.competitions (venue_id, name, kind, season, scores_public, has_table)
  VALUES (p_venue_id, 'ΚΟΠ Grassroots ' || v_season, 'cfa_grassroots', v_season, FALSE, FALSE)
  ON CONFLICT (venue_id, season) WHERE kind = 'cfa_grassroots' DO NOTHING;
  SELECT c.id INTO v_comp FROM public.competitions AS c
  WHERE c.venue_id = p_venue_id AND c.kind = 'cfa_grassroots' AND c.season = v_season;

  -- ── pass 1: read every row, find the match it already is ─────────
  FOR v_match, v_idx IN
    SELECT e.value, (e.ordinality - 1)::int
    FROM jsonb_array_elements(p_matches) WITH ORDINALITY AS e (value, ordinality)
    ORDER BY e.ordinality
  LOOP
    v_elsewhere := nullif(left(btrim(coalesce(v_match ->> 'elsewhere', '')), 120), '');
    v_category := left(btrim(coalesce(v_match ->> 'category', '')), 40);
    v_hname := btrim(coalesce(v_match ->> 'home', ''));
    v_aname := btrim(coalesce(v_match ->> 'away', ''));
    v_hcat := coalesce(nullif(btrim(v_match ->> 'home_category'), ''), v_category);
    v_acat := coalesce(nullif(btrim(v_match ->> 'away_category'), ''), v_category);
    v_hgrp := nullif(btrim(coalesce(v_match ->> 'home_group', '')), '');
    v_agrp := nullif(btrim(coalesce(v_match ->> 'away_group', '')), '');

    IF v_category = '' OR v_hname = '' OR v_aname = ''
      OR (
        lower(v_hname) = lower(v_aname) AND lower(v_hcat) = lower(v_acat)
        AND lower(coalesce(v_hgrp, '')) = lower(coalesce(v_agrp, ''))
      ) THEN
      v_skipped := v_skipped || jsonb_build_object('index', v_idx, 'reason', 'invalid');
      CONTINUE;
    END IF;
    BEGIN
      v_starts := (p_date + (v_match ->> 'kickoff')::time) AT TIME ZONE 'Europe/Nicosia';
    EXCEPTION WHEN others THEN
      v_skipped := v_skipped || jsonb_build_object('index', v_idx, 'reason', 'invalid');
      CONTINUE;
    END;

    IF v_elsewhere IS NULL THEN
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
      IF v_minutes NOT BETWEEN 20 AND 180 OR v_price NOT BETWEEN 1 AND 500000 THEN
        v_skipped := v_skipped || jsonb_build_object('index', v_idx, 'reason', 'invalid');
        CONTINUE;
      END IF;
      v_ends := v_starts + make_interval(mins => v_minutes);
      v_home := public.competition_team_id(v_comp, v_hname, v_hcat, v_hgrp);
      v_away := public.competition_team_id(v_comp, v_aname, v_acat, v_agrp);
    ELSE
      -- an away row: kept only if one of its teams plays here this season
      v_pitch := NULL;
      v_ends := NULL;
      SELECT t.id INTO v_home FROM public.competition_teams AS t
      WHERE
        t.competition_id = v_comp AND lower(btrim(t.name)) = lower(v_hname)
        AND lower(btrim(coalesce(t.category, ''))) = lower(v_hcat)
        AND lower(btrim(coalesce(t.group_label, ''))) = lower(coalesce(v_hgrp, ''));
      SELECT t.id INTO v_away FROM public.competition_teams AS t
      WHERE
        t.competition_id = v_comp AND lower(btrim(t.name)) = lower(v_aname)
        AND lower(btrim(coalesce(t.category, ''))) = lower(v_acat)
        AND lower(btrim(coalesce(t.group_label, ''))) = lower(coalesce(v_agrp, ''));
      IF NOT EXISTS (
        SELECT 1 FROM public.competition_matches AS m
        WHERE
          m.competition_id = v_comp AND m.elsewhere IS NULL
          AND (m.home_team_id IN (v_home, v_away) OR m.away_team_id IN (v_home, v_away))
      ) THEN
        v_ignored := v_ignored + 1;
        CONTINUE;
      END IF;
      v_home := coalesce(v_home, public.competition_team_id(v_comp, v_hname, v_hcat, v_hgrp));
      v_away := coalesce(v_away, public.competition_team_id(v_comp, v_aname, v_acat, v_agrp));
    END IF;

    SELECT
      m.id, m.booking_id, m.elsewhere, m.status, m.kickoff_at,
      b.pitch_id, b.starts_at, b.ends_at, b.state, p.name AS pitch_name
    INTO v_old
    FROM public.competition_matches AS m
    LEFT JOIN public.bookings AS b ON b.id = m.booking_id
    LEFT JOIN public.pitches AS p ON p.id = b.pitch_id
    WHERE
      m.competition_id = v_comp
      AND m.home_team_id = v_home AND m.away_team_id = v_away
      AND (m.kickoff_at AT TIME ZONE 'Europe/Nicosia')::date = p_date
      AND NOT (m.id = ANY(v_seen))
    ORDER BY m.created_at
    LIMIT 1;
    v_found := FOUND;

    IF v_found THEN
      v_seen := v_seen || v_old.id;
      IF v_old.status = 'postponed' AND v_old.kickoff_at = v_starts
        AND ((v_elsewhere IS NULL AND v_old.elsewhere IS NULL) OR lower(v_old.elsewhere) = lower(v_elsewhere)) THEN
        -- the owner postponed it; the file has not moved it
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;
      IF v_old.status = 'scheduled' AND v_elsewhere IS NULL AND v_old.elsewhere IS NULL
        AND v_old.state = 'confirmed' AND v_old.pitch_id = v_pitch
        AND v_old.starts_at = v_starts AND v_old.ends_at = v_ends THEN
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;
      IF v_old.status = 'scheduled' AND v_elsewhere IS NOT NULL
        AND lower(coalesce(v_old.elsewhere, '')) = lower(v_elsewhere) AND v_old.kickoff_at = v_starts THEN
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;
      -- it changed: its court goes now, so pass 2 can place onto it
      IF v_old.state = 'confirmed' THEN
        UPDATE public.bookings SET state = 'cancelled', cancelled_at = now(), updated_at = now()
        WHERE id = v_old.booking_id;
        UPDATE public.payments SET status = 'cancelled', updated_at = now()
        WHERE booking_id = v_old.booking_id AND payment_method = 'offline';
        v_replaced := v_replaced + 1;
      END IF;
    END IF;

    v_todo := v_todo || jsonb_build_object(
      'idx', v_idx,
      'elsewhere', v_elsewhere,
      'pitch', v_pitch,
      'minutes', v_minutes,
      'price', v_price,
      'starts', v_starts,
      'ends', v_ends,
      'category', v_category,
      'home', v_home,
      'away', v_away,
      'label', left(v_category || ' · ' || v_hname || ' – ' || v_aname, 120),
      'old', CASE WHEN v_found THEN jsonb_build_object(
        'id', v_old.id,
        'live', v_old.state = 'confirmed' AND v_old.status IN ('scheduled', 'postponed'),
        'elsewhere', v_old.elsewhere,
        'status', v_old.status,
        'kickoff', v_old.kickoff_at,
        'pitch', v_old.pitch_id,
        'pitch_name', v_old.pitch_name,
        'starts', v_old.starts_at,
        'ends', v_old.ends_at
      ) END
    );
  END LOOP;

  -- ── what the file no longer has is cancelled ─────────────────────
  FOR v_gone IN
    SELECT m.id, m.booking_id, m.status, b.state
    FROM public.competition_matches AS m
    LEFT JOIN public.bookings AS b ON b.id = m.booking_id
    WHERE
      m.competition_id = v_comp
      AND (m.kickoff_at AT TIME ZONE 'Europe/Nicosia')::date = p_date
      AND m.status IN ('scheduled', 'postponed')
      AND NOT (m.id = ANY(v_seen))
  LOOP
    UPDATE public.competition_matches SET status = 'cancelled' WHERE id = v_gone.id;
    INSERT INTO public.competition_match_changes (match_id, what, old_value, new_value)
    VALUES (v_gone.id, 'status', v_gone.status, 'cancelled');
    IF v_gone.state = 'confirmed' THEN
      UPDATE public.bookings SET state = 'cancelled', cancelled_at = now(), updated_at = now()
      WHERE id = v_gone.booking_id;
      UPDATE public.payments SET status = 'cancelled', updated_at = now()
      WHERE booking_id = v_gone.booking_id AND payment_method = 'offline';
      v_replaced := v_replaced + 1;
    END IF;
    v_cancelled := v_cancelled + 1;
  END LOOP;

  -- ── pass 2: place what is new or moved ───────────────────────────
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_todo)
  LOOP
    v_elsewhere := v_item ->> 'elsewhere';
    v_starts := (v_item ->> 'starts')::timestamptz;
    v_booking := NULL;
    v_has_old := jsonb_typeof(v_item -> 'old') = 'object';

    IF v_elsewhere IS NULL THEN
      v_pitch := (v_item ->> 'pitch')::uuid;
      v_ends := (v_item ->> 'ends')::timestamptz;
      v_price := (v_item ->> 'price')::int;

      WITH held AS (
        UPDATE public.bookings AS b
        SET state = 'cancelled', cancelled_at = now(), updated_at = now()
        WHERE
          b.series_id IS NOT NULL
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

      BEGIN
        v_code := public.generate_booking_code(v_prefix, extract(YEAR FROM v_starts)::int);
        INSERT INTO public.bookings (
          code, user_id, pitch_id, starts_at, ends_at, state, origin,
          walk_in_name, base_price_cents, addons_price_cents, total_cents,
          platform_fee_cents, cancellation_policy
        ) VALUES (
          v_code, auth.uid(), v_pitch, v_starts, v_ends, 'confirmed', 'walk_in',
          v_item ->> 'label', v_price, 0, v_price, 0, v_policy
        )
        RETURNING id INTO v_booking;
        INSERT INTO public.payments (
          booking_id, stripe_payment_intent_id, amount_cents, application_fee_cents,
          status, payment_method
        ) VALUES (v_booking, 'offline_' || v_booking::text, v_price, 0, 'succeeded', 'offline');
      EXCEPTION
        WHEN exclusion_violation THEN
          v_skipped := v_skipped || jsonb_build_object('index', (v_item ->> 'idx')::int, 'reason', 'taken');
          v_booking := NULL;
      END;

      IF v_booking IS NULL THEN
        -- the court asked for is taken: a match that had a court gets it
        -- back if it can, otherwise it waits without one
        IF v_has_old AND (v_item -> 'old' ->> 'live')::boolean
          AND v_item -> 'old' ->> 'pitch' IS NOT NULL AND v_item -> 'old' ->> 'elsewhere' IS NULL THEN
          BEGIN
            v_code := public.generate_booking_code(v_prefix, extract(YEAR FROM v_starts)::int);
            INSERT INTO public.bookings (
              code, user_id, pitch_id, starts_at, ends_at, state, origin,
              walk_in_name, base_price_cents, addons_price_cents, total_cents,
              platform_fee_cents, cancellation_policy
            ) VALUES (
              v_code, auth.uid(), (v_item -> 'old' ->> 'pitch')::uuid,
              (v_item -> 'old' ->> 'starts')::timestamptz, (v_item -> 'old' ->> 'ends')::timestamptz,
              'confirmed', 'walk_in', v_item ->> 'label', v_price, 0, v_price, 0, v_policy
            )
            RETURNING id INTO v_restore;
            INSERT INTO public.payments (
              booking_id, stripe_payment_intent_id, amount_cents, application_fee_cents,
              status, payment_method
            ) VALUES (v_restore, 'offline_' || v_restore::text, v_price, 0, 'succeeded', 'offline');
            UPDATE public.competition_matches SET booking_id = v_restore WHERE id = (v_item -> 'old' ->> 'id')::uuid;
            v_replaced := v_replaced - 1;
          EXCEPTION WHEN exclusion_violation THEN
            UPDATE public.competition_matches SET booking_id = NULL WHERE id = (v_item -> 'old' ->> 'id')::uuid;
          END;
        END IF;
        CONTINUE;
      END IF;
    END IF;

    IF NOT v_has_old THEN
      INSERT INTO public.competition_matches (
        competition_id, booking_id, round_label, category, home_team_id, away_team_id, kickoff_at, elsewhere
      ) VALUES (
        v_comp, v_booking, btrim(p_round), v_item ->> 'category',
        (v_item ->> 'home')::uuid, (v_item ->> 'away')::uuid, v_starts, v_elsewhere
      );
      IF v_elsewhere IS NULL THEN
        v_placed := v_placed + 1;
      ELSE
        v_kept_away := v_kept_away + 1;
      END IF;
      CONTINUE;
    END IF;

    UPDATE public.competition_matches
    SET
      booking_id = v_booking,
      elsewhere = v_elsewhere,
      kickoff_at = v_starts,
      status = 'scheduled',
      round_label = btrim(p_round),
      category = v_item ->> 'category'
    WHERE id = (v_item -> 'old' ->> 'id')::uuid;

    IF (v_item -> 'old' ->> 'kickoff')::timestamptz <> v_starts THEN
      INSERT INTO public.competition_match_changes (match_id, what, old_value, new_value)
      VALUES (
        (v_item -> 'old' ->> 'id')::uuid, 'kickoff',
        to_char((v_item -> 'old' ->> 'kickoff')::timestamptz AT TIME ZONE 'Europe/Nicosia', 'HH24:MI'),
        to_char(v_starts AT TIME ZONE 'Europe/Nicosia', 'HH24:MI')
      );
    END IF;
    IF lower(coalesce(v_item -> 'old' ->> 'elsewhere', '')) <> lower(coalesce(v_elsewhere, '')) THEN
      INSERT INTO public.competition_match_changes (match_id, what, old_value, new_value)
      VALUES (
        (v_item -> 'old' ->> 'id')::uuid, 'venue',
        left(coalesce(v_item -> 'old' ->> 'elsewhere', v_venue_name), 120),
        left(coalesce(v_elsewhere, v_venue_name), 120)
      );
    ELSIF v_elsewhere IS NULL AND (v_item -> 'old' ->> 'pitch') IS DISTINCT FROM v_pitch::text THEN
      INSERT INTO public.competition_match_changes (match_id, what, old_value, new_value)
      VALUES (
        (v_item -> 'old' ->> 'id')::uuid, 'court',
        v_item -> 'old' ->> 'pitch_name',
        (SELECT p.name FROM public.pitches AS p WHERE p.id = v_pitch)
      );
    END IF;
    IF v_item -> 'old' ->> 'status' <> 'scheduled' THEN
      INSERT INTO public.competition_match_changes (match_id, what, old_value, new_value)
      VALUES ((v_item -> 'old' ->> 'id')::uuid, 'status', v_item -> 'old' ->> 'status', 'scheduled');
    END IF;
    v_moved := v_moved + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'placed', v_placed,
    'moved', v_moved,
    'unchanged', v_unchanged,
    'cancelled', v_cancelled,
    'away', v_kept_away,
    'ignored', v_ignored,
    'released', v_released,
    'replaced', v_replaced,
    'skipped', v_skipped
  );
END;
$$;

COMMENT ON FUNCTION public.load_cfa_round(uuid, date, text, jsonb) IS
'Owner/admin: one date of a CFA grassroots round for a venue '
'(plans/cfa-in-the-app.md K1). Rows here go on courts as walk-ins; rows '
'with `elsewhere` are the away matches of teams that play here, kept '
'without a court; other away rows are ignored. Diffs against the date''s '
'matches: unchanged keeps its id and booking, a change moves the booking '
'and writes competition_match_changes, a missing match is cancelled. '
'replaced counts the earlier bookings that went.';

GRANT EXECUTE ON FUNCTION public.load_cfa_round(uuid, date, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.load_cfa_round(uuid, date, text, jsonb) FROM anon;
