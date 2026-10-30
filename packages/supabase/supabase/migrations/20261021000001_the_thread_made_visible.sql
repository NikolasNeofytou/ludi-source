-- 20261021000001_the_thread_made_visible.sql
-- Wave 1 of the Strava build (plans/strava-build.md, from plans/strava-study.md).
--
--   1. fixture_series(): a group's weekly run — one organiser, one venue,
--      one local weekday and kickoff hour, consecutive weeks.
--   2. The morning after (B1): the organiser of a completed game hears how
--      it went the next morning — how many played, how many came back from
--      last week — and the tap opens the game, where "Book again" already
--      is. A notice about the player's own game, so the games switch.
--   3. Every Thursday since September (B2): the board row says so from
--      the fourth week of a run.
--   4. The screen-name switch (R4a, ADR-0054's follow-up): a player can
--      keep their first name off the lobby screen.
--
-- Counts, never names, everywhere (ADR-0012 / ADR-0021; CONVENTIONS
-- § Public numbers and names). Numbered after 20261020000002 on purpose:
-- that migration (PR #335) narrows users' UPDATE grant to listed columns,
-- and a table-level REVOKE also revokes column grants, so the grant below
-- must land after it.

-- ════════════════════════════════════════════════════════════════════
-- 1. The slot series
-- ════════════════════════════════════════════════════════════════════
-- my_series() (community v3) groups a player's games by slot and does not
-- walk rebooked_from; this follows the same grouping for one booking. A run
-- is the organiser's app bookings (not walk-ins, not the owner's standing
-- series) at the same venue — any court — on the same Cyprus weekday and
-- kickoff hour, each completed, exactly 7 local days apart. A missed week
-- ends the run. Local dates, so a DST change does not break a series.
--
-- `weeks` counts the given booking too: a Thursday with three completed
-- Thursdays behind it is week 4. `since` is the run's first kickoff;
-- `previous_booking_id` is last week's game, NULL when there was none.
-- No row at all when the booking is a walk-in or part of a standing series.
CREATE OR REPLACE FUNCTION public.fixture_series(p_booking_id uuid)
RETURNS TABLE (weeks int, since timestamptz, previous_booking_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE base AS (
    SELECT
      b.id,
      b.user_id,
      p.venue_id,
      b.starts_at,
      b.starts_at AT TIME ZONE 'Europe/Nicosia' AS local_start
    FROM public.bookings AS b
    INNER JOIN public.pitches AS p ON p.id = b.pitch_id
    WHERE b.id = p_booking_id
      AND b.origin = 'app'
      AND b.series_id IS NULL
  ),
  run (step, booking_id, starts_at, local_start) AS (
    SELECT 0, base.id, base.starts_at, base.local_start
    FROM base
    UNION ALL
    SELECT run.step + 1, prev.id, prev.starts_at, prev.local_start
    FROM run
    CROSS JOIN base
    CROSS JOIN LATERAL (
      SELECT
        b2.id,
        b2.starts_at,
        b2.starts_at AT TIME ZONE 'Europe/Nicosia' AS local_start
      FROM public.bookings AS b2
      INNER JOIN public.pitches AS p2 ON p2.id = b2.pitch_id
      WHERE b2.user_id = base.user_id
        AND p2.venue_id = base.venue_id
        AND b2.origin = 'app'
        AND b2.series_id IS NULL
        AND b2.state = 'completed'
        AND (b2.starts_at AT TIME ZONE 'Europe/Nicosia')::date = run.local_start::date - 7
        AND extract(hour FROM b2.starts_at AT TIME ZONE 'Europe/Nicosia')
          = extract(hour FROM base.local_start)
      ORDER BY b2.starts_at
      LIMIT 1
    ) AS prev
    WHERE run.step < 104
  )
  SELECT
    (max(run.step) + 1)::int AS weeks,
    min(run.starts_at) AS since,
    (SELECT r.booking_id FROM run AS r WHERE r.step = 1) AS previous_booking_id
  FROM run
  HAVING count(*) > 0;
$$;

COMMENT ON FUNCTION public.fixture_series(uuid) IS
  'A booking''s weekly run (plans/strava-build.md S1): the organiser''s '
  'completed app bookings at the same venue, Cyprus weekday and kickoff '
  'hour, 7 days apart. weeks counts the booking itself. Internal: read by '
  'open_fixture_series (the board) and the morning-after notice, never by '
  'a client.';

REVOKE ALL ON FUNCTION public.fixture_series(uuid) FROM public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2. The morning after
-- ════════════════════════════════════════════════════════════════════
-- Widened from the live list (20261016000002), never retyped.
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_kind_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_kind_check CHECK (
  kind IN (
    'booking_confirmed', 'reminder', 'fixture_cancelled',
    'keeper_wanted', 'keeper_found', 'seat_offered', 'seat_taken', 'game_full',
    'team_programme', 'team_changed', 'team_reminder', 'parents_game',
    'series_turnout'
  )
);

-- What the notice says: how many stood in the game, and of them how many
-- also stood in last week's. Counts only. `returning` is absent when there
-- was no game last week, so the copy can drop the clause.
CREATE OR REPLACE FUNCTION public.fixture_turnout(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'played', (
      SELECT count(*)::int FROM public.booking_participants AS x
      WHERE x.booking_id = p_booking_id AND x.status = 'in'
    ),
    'returning', CASE WHEN s.previous_booking_id IS NOT NULL THEN (
      SELECT count(*)::int
      FROM public.booking_participants AS x
      WHERE x.booking_id = p_booking_id
        AND x.status = 'in'
        AND EXISTS (
          SELECT 1 FROM public.booking_participants AS y
          WHERE y.booking_id = s.previous_booking_id
            AND y.user_id = x.user_id
            AND y.status = 'in'
        )
    ) END,
    'weeks', s.weeks
  ))
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL public.fixture_series(p_booking_id) AS s ON TRUE;
$$;

COMMENT ON FUNCTION public.fixture_turnout(uuid) IS
  'The morning-after numbers for one booking: played (seats in), returning '
  '(of them, in last week''s game of the same series) and weeks. Counts '
  'only. Read by claim_player_notifications for series_turnout.';

REVOKE ALL ON FUNCTION public.fixture_turnout(uuid) FROM public, anon, authenticated;

-- One notice per completed game, to its organiser, for 10:00 Cyprus time
-- the next morning ("the morning" of a game that ends after midnight is
-- the one after that evening). Not when the organiser already holds a
-- booking at the same venue within the next 8 days: a group that has
-- rebooked needs no nudge. Walk-ins and standing series are not series.
-- mint_player_notice applies the games switch, the erased account and the
-- missing token; the ledger's UNIQUE key makes a second run a no-op.
CREATE OR REPLACE FUNCTION public.mint_series_turnouts(p_now timestamptz DEFAULT now())
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_total int := 0;
BEGIN
  FOR r IN
    SELECT
      b.id,
      b.user_id,
      (
        ((b.ends_at - interval '6 hours') AT TIME ZONE 'Europe/Nicosia')::date + 1
        + time '10:00'
      ) AT TIME ZONE 'Europe/Nicosia' AS morning
    FROM public.bookings AS b
    INNER JOIN public.pitches AS p ON p.id = b.pitch_id
    WHERE b.state = 'completed'
      AND b.origin = 'app'
      AND b.series_id IS NULL
      AND b.ends_at <= p_now
      AND b.ends_at > p_now - interval '30 hours'
      AND NOT EXISTS (
        SELECT 1
        FROM public.bookings AS n
        INNER JOIN public.pitches AS np ON np.id = n.pitch_id
        WHERE n.user_id = b.user_id
          AND np.venue_id = p.venue_id
          AND n.id <> b.id
          AND n.state IN ('collecting', 'paid', 'confirmed')
          AND n.starts_at > b.starts_at
          AND n.starts_at <= b.starts_at + interval '8 days'
      )
  LOOP
    v_total := v_total + public.mint_player_notice(r.user_id, 'series_turnout', r.id, NULL, r.morning);
  END LOOP;
  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.mint_series_turnouts(timestamptz) IS
  'The morning after (plans/strava-build.md B1): one series_turnout notice '
  'per completed app game in the last 30 hours, to its organiser, for 10:00 '
  'Cyprus time next morning, unless they already booked the same venue '
  'within 8 days. Cron-only.';

REVOKE ALL ON FUNCTION public.mint_series_turnouts(timestamptz) FROM public, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not available; skipping the series-turnout schedule.';
    RAISE NOTICE '  Expected in CI. On Supabase this registers the hourly mint.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- Hourly at :15 — ten minutes after the completion flip at :05.
  PERFORM cron.schedule(
    'ludi-mint-series-turnouts',
    '15 * * * *',
    $cmd$SELECT public.mint_series_turnouts();$cmd$
  );
END;
$$;

-- The sender reads the numbers in `context.turnout`. Everything else is
-- 20261016000002 verbatim.
CREATE OR REPLACE FUNCTION public.claim_player_notifications(p_limit int DEFAULT 100)
RETURNS TABLE (
  id uuid,
  kind text,
  channel text,
  user_id uuid,
  attempts int,
  locale text,
  first_name text,
  email text,
  tokens text [],
  booking_id uuid,
  code text,
  starts_at timestamptz,
  invite_token text,
  pitch_name text,
  venue_name text,
  context jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();

  UPDATE public.player_notifications AS n
  SET status = 'pending', claimed_at = NULL
  WHERE n.status = 'sending' AND n.claimed_at < now() - interval '10 minutes';

  RETURN QUERY
  WITH claimed AS (
    UPDATE public.player_notifications AS n
    SET status = 'sending', claimed_at = now(), attempts = n.attempts + 1
    WHERE n.id IN (
      SELECT p.id FROM public.player_notifications AS p
      WHERE p.status = 'pending' AND p.send_after <= now()
      ORDER BY p.send_after
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING n.id, n.kind, n.channel, n.user_id, n.attempts, n.booking_id, n.ref_id, n.created_at
  )

  SELECT
    c.id,
    c.kind,
    c.channel,
    c.user_id,
    c.attempts,
    coalesce(u.preferred_locale, 'en') AS locale,
    u.first_name,
    au.email::text,
    array(
      SELECT t.token FROM public.push_tokens AS t
      WHERE t.user_id = c.user_id AND t.disabled_at IS NULL
    ) AS tokens,
    c.booking_id,
    b.code,
    coalesce(b.starts_at, m.kickoff_at, c.created_at) AS starts_at,
    b.invite_token,
    coalesce(p.name, CASE WHEN mb.state = 'confirmed' THEN mp.name END) AS pitch_name,
    coalesce(v.name, m.elsewhere, mv.name) AS venue_name,
    jsonb_strip_nulls(jsonb_build_object(
      'shape', gk.shape,
      'keeper_name', ku.first_name,
      'slot_kind', bp.slot_kind,
      'turnout', CASE WHEN c.kind = 'series_turnout' THEN public.fixture_turnout(c.booking_id) END,
      'match', CASE WHEN m.id IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
        'venue_id', CASE WHEN m.elsewhere IS NULL THEN mc.venue_id END,
        'date', to_char(m.kickoff_at AT TIME ZONE 'Europe/Nicosia', 'YYYY-MM-DD'),
        'category', m.category,
        'home', mh.name,
        'away', ma.name,
        'status', m.status,
        'what', x.what,
        'old', x.old_value,
        'new', x.new_value
      )) END
    )) AS context
  FROM claimed AS c
  INNER JOIN public.users AS u ON u.id = c.user_id
  LEFT JOIN auth.users AS au ON au.id = c.user_id
  LEFT JOIN public.bookings AS b ON b.id = c.booking_id
  LEFT JOIN public.pitches AS p ON p.id = b.pitch_id
  LEFT JOIN public.venues AS v ON v.id = p.venue_id
  LEFT JOIN public.gk_requests AS gk ON gk.id = c.ref_id
  LEFT JOIN public.users AS ku ON ku.id = gk.claimed_by
  LEFT JOIN public.booking_participants AS bp ON bp.id = c.ref_id
  LEFT JOIN public.competition_match_changes AS x
    ON c.kind = 'team_changed' AND x.id = c.ref_id
  LEFT JOIN public.competition_matches AS m
    ON m.id = CASE
      WHEN c.kind = 'team_changed' THEN x.match_id
      WHEN c.kind IN ('team_programme', 'team_reminder') THEN c.ref_id
    END
  LEFT JOIN public.competitions AS mc ON mc.id = m.competition_id
  LEFT JOIN public.venues AS mv ON mv.id = mc.venue_id
  LEFT JOIN public.bookings AS mb ON mb.id = m.booking_id
  LEFT JOIN public.pitches AS mp ON mp.id = mb.pitch_id
  LEFT JOIN public.competition_teams AS mh ON mh.id = m.home_team_id
  LEFT JOIN public.competition_teams AS ma ON ma.id = m.away_team_id;
END;
$$;


-- ════════════════════════════════════════════════════════════════════
-- 3. Every Thursday since September
-- ════════════════════════════════════════════════════════════════════
-- The board's share of a run: weeks and since, from week 4, for a listed
-- game only. A view checks EXECUTE on the functions it calls as the
-- player reading it, even with security_invoker off, so the board cannot
-- call fixture_series() — internal, since it names last week's game.
-- This one says nothing the board row does not.
CREATE OR REPLACE FUNCTION public.open_fixture_series(p_booking_id uuid)
RETURNS TABLE (weeks int, since timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.weeks, s.since
  FROM public.bookings AS b
  CROSS JOIN LATERAL public.fixture_series(b.id) AS s
  WHERE b.id = p_booking_id
    AND b.is_open
    AND b.state IN ('collecting', 'paid', 'confirmed')
    AND b.starts_at > now()
    AND s.weeks >= 4;
$$;

COMMENT ON FUNCTION public.open_fixture_series(uuid) IS
  'A listed fixture''s weekly run as the board shows it (plans/strava-build.md '
  'B2): weeks and since, from week 4. Read by v_open_fixtures.';

REVOKE ALL ON FUNCTION public.open_fixture_series(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.open_fixture_series(uuid) TO authenticated;

-- Two columns appended (never reordered; the grants survive). Floored at
-- four weeks in open_fixture_series() — below that both are NULL and the
-- row says nothing. Everything else is 20261014000002 verbatim.
CREATE OR REPLACE VIEW public.v_open_fixtures
WITH (security_invoker = off) AS
SELECT
  f.booking_id,
  f.starts_at,
  f.ends_at,
  f.pitch_type,
  f.pitch_name,
  f.venue_name,
  f.city_name_en,
  f.city_name_gr,
  f.gk_open,
  f.outfield_open,
  f.is_split,
  f.share_amount_cents,
  f.invite_token,
  f.total_cents,
  f.gk_slots,
  f.outfield_slots,
  f.open_level,
  f.played_with_squad,
  f.venue_id,
  f.lat,
  f.lng,
  f.series_weeks,
  f.series_since
FROM (
  SELECT
    b.id AS booking_id,
    b.starts_at,
    b.ends_at,
    p.type AS pitch_type,
    p.name AS pitch_name,
    v.name AS venue_name,
    c.name_en AS city_name_en,
    c.name_gr AS city_name_gr,
    b.gk_slots - (
      SELECT count(*) FROM public.booking_participants AS x
      WHERE x.booking_id = b.id AND x.status = 'in'
        AND x.slot_kind = 'gk' AND x.replacing_since IS NULL
    )::int AS gk_open,
    b.outfield_slots - (
      SELECT count(*) FROM public.booking_participants AS x
      WHERE x.booking_id = b.id AND x.status = 'in'
        AND x.slot_kind = 'outfield' AND x.replacing_since IS NULL
    )::int AS outfield_open,
    b.is_split,
    b.share_amount_cents,
    b.invite_token,
    b.total_cents,
    b.gk_slots,
    b.outfield_slots,
    b.open_level,
    (
      SELECT count(DISTINCT seat.user_id)::int
      FROM public.booking_participants AS seat
      WHERE seat.booking_id = b.id
        AND seat.status = 'in'
        AND seat.user_id <> auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.booking_participants AS mine
          INNER JOIN public.booking_participants AS theirs
            ON mine.booking_id = theirs.booking_id
            AND theirs.user_id = seat.user_id
            AND theirs.status = 'in'
          INNER JOIN public.bookings AS shared
            ON mine.booking_id = shared.id
            AND shared.state = 'completed'
          WHERE mine.user_id = auth.uid()
            AND mine.status = 'in'
        )
    ) AS played_with_squad,
    v.id AS venue_id,
    v.lat,
    v.lng,
    -- appended 20261021000001: the slot series, floored at four weeks
    s.weeks AS series_weeks,
    s.since AS series_since
  FROM public.bookings AS b
  INNER JOIN public.pitches AS p ON b.pitch_id = p.id
  INNER JOIN public.venues AS v ON p.venue_id = v.id
  INNER JOIN public.cities AS c ON v.city_id = c.id
  LEFT JOIN LATERAL public.open_fixture_series(b.id) AS s ON TRUE
  WHERE b.is_open
    AND b.state IN ('collecting', 'paid', 'confirmed')
    AND b.starts_at > now()
) AS f
WHERE f.gk_open > 0 OR f.outfield_open > 0;


-- ════════════════════════════════════════════════════════════════════
-- 4. The screen-name switch
-- ════════════════════════════════════════════════════════════════════
-- ADR-0054 put the booker's first name on the lobby screen for today and
-- listed one follow-up: a player's way to keep it off. Default on, as the
-- ADR decided — a momentary fact that forgets at midnight (CONVENTIONS
-- § Public numbers and names, rule 3). Walk-in names are the venue's own
-- record and are not touched.
ALTER TABLE public.users
  ADD COLUMN show_name_on_screens boolean NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.users.show_name_on_screens IS
  'FALSE keeps the player''s first name off venue lobby screens '
  '(public_venue_schedule.who). Set by the player in Settings (ADR-0054 '
  'follow-up, plans/strava-build.md R4a).';

-- The player writes it from Settings. 20261020000002 (PR #335) narrows
-- users' UPDATE grant to listed columns; this adds the new one.
GRANT UPDATE (show_name_on_screens) ON public.users TO authenticated;

-- One condition added to `who`; everything else is 20261016000006 verbatim.
CREATE OR REPLACE FUNCTION public.public_venue_schedule(p_token text, p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today  date := (now() AT TIME ZONE 'Europe/Nicosia')::date;
  v_date   date := coalesce(p_date, v_today);
  v_venue  record;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 32 THEN
    RETURN NULL;
  END IF;
  SELECT v.id, v.name, v.slug INTO v_venue
  FROM public.venue_displays AS d
  INNER JOIN public.venues AS v ON v.id = d.venue_id
  WHERE d.token = p_token AND v.is_active;
  IF v_venue.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_date NOT BETWEEN v_today - 1 AND v_today + 31 THEN
    v_date := v_today;
  END IF;

  RETURN jsonb_build_object(
    'venue', v_venue.name,
    'slug', v_venue.slug,
    'date', v_date,
    'courts', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'type', p.type,
          'parts', coalesce((
            SELECT jsonb_agg(c.child_pitch_id)
            FROM public.pitch_components AS c
            WHERE c.parent_pitch_id = p.id
          ), '[]'::jsonb)
        ) ORDER BY p.name
      )
      FROM public.pitches AS p
      WHERE p.venue_id = v_venue.id AND p.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'pitch_id', b.pitch_id,
          'starts_at', b.starts_at,
          'ends_at', b.ends_at,
          'kind', CASE WHEN m.id IS NULL THEN 'booked' ELSE 'cfa' END,
          'category', m.category,
          'home', m.home_team,
          'away', m.away_team,
          'round', m.round_label,
          'status', m.status,
          'open_gk', CASE WHEN w.listed THEN w.gk_open END,
          'open_outfield', CASE WHEN w.listed THEN w.outfield_open END,
          'share_cents', CASE WHEN w.listed AND b.is_split THEN b.share_amount_cents END,
          'join', CASE WHEN w.listed THEN b.invite_token END,
          'who', CASE
            WHEN m.id IS NOT NULL OR v_date <> v_today THEN NULL
            WHEN b.origin = 'walk_in' THEN left(nullif(split_part(regexp_replace(btrim(b.walk_in_name), '\s+', ' ', 'g'), ' ', 1), ''), 24)
            WHEN u.anonymized_at IS NULL AND u.show_name_on_screens THEN left(nullif(split_part(regexp_replace(btrim(u.first_name), '\s+', ' ', 'g'), ' ', 1), ''), 24)
          END
        ) ORDER BY b.starts_at, b.pitch_id
      )
      FROM public.bookings AS b
      INNER JOIN public.pitches AS p ON p.id = b.pitch_id
      LEFT JOIN public.cfa_matches AS m ON m.booking_id = b.id
      LEFT JOIN public.users AS u ON u.id = b.user_id AND b.origin <> 'walk_in'
      CROSS JOIN LATERAL (
        SELECT
          s.gk_open,
          s.outfield_open,
          (
            b.is_open
            AND b.state IN ('collecting', 'paid', 'confirmed')
            AND b.starts_at > now()
            AND (s.gk_open > 0 OR s.outfield_open > 0)
          ) AS listed
        FROM (
          SELECT
            coalesce(b.gk_slots, 0)
            - count(*) FILTER (WHERE x.slot_kind = 'gk' AND x.replacing_since IS NULL)::int AS gk_open,
            coalesce(b.outfield_slots, 0)
            - count(*) FILTER (WHERE x.slot_kind = 'outfield' AND x.replacing_since IS NULL)::int AS outfield_open
          FROM public.booking_participants AS x
          WHERE x.booking_id = b.id AND x.status = 'in'
        ) AS s
      ) AS w
      WHERE p.venue_id = v_venue.id
        AND p.is_active
        AND b.state IN ('pending', 'collecting', 'paid', 'confirmed', 'completed')
        AND (b.starts_at AT TIME ZONE 'Europe/Nicosia')::date = v_date
    ), '[]'::jsonb)
  );
END;
$$;
