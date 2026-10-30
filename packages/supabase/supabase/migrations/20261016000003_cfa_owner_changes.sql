-- 20261016000003_cfa_owner_changes.sql
-- The owner changes a CFA match from the calendar, and everyone is told
-- (plans/cfa-in-the-app.md K5): move it (court, time), postpone it, cancel
-- it, put it back. Each writes a competition_match_changes row, so the
-- match's followers are told through the ledger (K4) without this file
-- knowing they exist. The TV shows a postponed match as such.
--
-- A postponed match keeps its court (the morning is the CFA's, nothing is
-- sold in it, and the TV can say "postponed" in its slot); a cancelled one
-- gives the court back. Away matches are the CFA's other venues' to change,
-- not the owner's.
--
-- Contents:
--   1. cfa_matches gains status (appended; the programme marks it)
--   2. move_cfa_match — a new court or time on the same day
--   3. set_cfa_match_status — postponed, cancelled, or back on
--   4. public_venue_schedule — each CFA item carries its status

-- ════════════════════════════════════════════════════════════════════
-- 1. The view says the status
-- ════════════════════════════════════════════════════════════════════
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
  m.created_at,
  m.status
FROM public.competition_matches AS m
INNER JOIN public.competitions AS c ON c.id = m.competition_id
INNER JOIN public.competition_teams AS h ON h.id = m.home_team_id
INNER JOIN public.competition_teams AS a ON a.id = m.away_team_id
WHERE
  c.kind = 'cfa_grassroots'
  AND m.elsewhere IS NULL
  AND m.status <> 'cancelled';

-- ════════════════════════════════════════════════════════════════════
-- 2. Move a match
-- ════════════════════════════════════════════════════════════════════
-- The same day, a court of this venue, a kick-off; the match keeps its
-- length, its price and its booking — the booking itself moves (same code,
-- and the owner's panel stays open on it). A standing hold under the new
-- slot is released, as the loader does; a court already taken fails the
-- whole call, so nothing half-moves. A postponed match that moves is back
-- on.
CREATE OR REPLACE FUNCTION public.move_cfa_match(p_match_id uuid, p_pitch_id uuid, p_kickoff time)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_m record;
  v_starts timestamptz;
  v_ends timestamptz;
BEGIN
  SELECT
    m.id, m.status, m.kickoff_at, m.booking_id, c.venue_id, c.kind,
    b.pitch_id, b.starts_at, b.ends_at, b.state, b.walk_in_name, b.base_price_cents,
    p.name AS pitch_name
  INTO v_m
  FROM public.competition_matches AS m
  INNER JOIN public.competitions AS c ON c.id = m.competition_id
  LEFT JOIN public.bookings AS b ON b.id = m.booking_id
  LEFT JOIN public.pitches AS p ON p.id = b.pitch_id
  WHERE m.id = p_match_id AND m.elsewhere IS NULL;
  IF NOT FOUND OR v_m.kind <> 'cfa_grassroots' THEN
    RAISE EXCEPTION 'move_cfa_match: no such match here' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_admin() OR public.is_venue_owner_of_venue(v_m.venue_id)) THEN
    RAISE EXCEPTION 'move_cfa_match: not your venue' USING ERRCODE = '42501';
  END IF;
  IF v_m.status NOT IN ('scheduled', 'postponed') OR v_m.state IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'move_cfa_match: only a match on a court moves' USING ERRCODE = '22023';
  END IF;
  IF p_kickoff IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pitches AS p
    WHERE p.id = p_pitch_id AND p.venue_id = v_m.venue_id AND p.is_active
  ) THEN
    RAISE EXCEPTION 'move_cfa_match: a court here and a time' USING ERRCODE = '22023';
  END IF;

  v_starts := ((v_m.kickoff_at AT TIME ZONE 'Europe/Nicosia')::date + p_kickoff) AT TIME ZONE 'Europe/Nicosia';
  v_ends := v_starts + (v_m.ends_at - v_m.starts_at);
  IF v_starts = v_m.starts_at AND p_pitch_id = v_m.pitch_id AND v_m.status = 'scheduled' THEN
    RETURN;
  END IF;

  WITH held AS (
    UPDATE public.bookings AS b
    SET state = 'cancelled', cancelled_at = now(), updated_at = now()
    WHERE
      b.series_id IS NOT NULL
      AND b.state = 'confirmed'
      AND b.pitch_id IN (SELECT public.pitch_blockers(p_pitch_id))
      AND b.time_range && tstzrange(v_starts, v_ends, '[)')
    RETURNING b.id
  )

  UPDATE public.payments AS p
  SET status = 'cancelled', updated_at = now()
  FROM held
  WHERE p.booking_id = held.id AND p.payment_method = 'offline';

  BEGIN
    UPDATE public.bookings
    SET pitch_id = p_pitch_id, starts_at = v_starts, ends_at = v_ends, updated_at = now()
    WHERE id = v_m.booking_id;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'move_cfa_match: that court is taken then' USING ERRCODE = '23P01';
  END;

  UPDATE public.competition_matches
  SET kickoff_at = v_starts, status = 'scheduled'
  WHERE id = v_m.id;

  IF v_starts <> v_m.starts_at THEN
    INSERT INTO public.competition_match_changes (match_id, what, old_value, new_value)
    VALUES (
      v_m.id, 'kickoff',
      to_char(v_m.starts_at AT TIME ZONE 'Europe/Nicosia', 'HH24:MI'),
      to_char(v_starts AT TIME ZONE 'Europe/Nicosia', 'HH24:MI')
    );
  END IF;
  IF p_pitch_id <> v_m.pitch_id THEN
    INSERT INTO public.competition_match_changes (match_id, what, old_value, new_value)
    VALUES (v_m.id, 'court', v_m.pitch_name, (SELECT p.name FROM public.pitches AS p WHERE p.id = p_pitch_id));
  END IF;
  IF v_m.status = 'postponed' THEN
    INSERT INTO public.competition_match_changes (match_id, what, old_value, new_value)
    VALUES (v_m.id, 'status', 'postponed', 'scheduled');
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 3. Postpone, cancel, put back
-- ════════════════════════════════════════════════════════════════════
-- postponed: from scheduled; the court stays held.
-- cancelled: from scheduled or postponed; the court is given back.
-- scheduled: from postponed or cancelled; a cancelled match gets its old
--   slot back if it is still free (otherwise the call fails, and the owner
--   moves it instead).
CREATE OR REPLACE FUNCTION public.set_cfa_match_status(p_match_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_m record;
  v_policy text;
  v_prefix text;
  v_booking uuid;
  v_code text;
BEGIN
  SELECT
    m.id, m.status, m.booking_id, c.venue_id, c.kind,
    b.pitch_id, b.starts_at, b.ends_at, b.state, b.walk_in_name, b.base_price_cents
  INTO v_m
  FROM public.competition_matches AS m
  INNER JOIN public.competitions AS c ON c.id = m.competition_id
  LEFT JOIN public.bookings AS b ON b.id = m.booking_id
  WHERE m.id = p_match_id AND m.elsewhere IS NULL;
  IF NOT FOUND OR v_m.kind <> 'cfa_grassroots' THEN
    RAISE EXCEPTION 'set_cfa_match_status: no such match here' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_admin() OR public.is_venue_owner_of_venue(v_m.venue_id)) THEN
    RAISE EXCEPTION 'set_cfa_match_status: not your venue' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('scheduled', 'postponed', 'cancelled') THEN
    RAISE EXCEPTION 'set_cfa_match_status: scheduled, postponed or cancelled' USING ERRCODE = '22023';
  END IF;
  IF p_status = v_m.status THEN
    RETURN;
  END IF;
  IF p_status = 'postponed' AND v_m.status <> 'scheduled' THEN
    RAISE EXCEPTION 'set_cfa_match_status: only a scheduled match is postponed' USING ERRCODE = '22023';
  END IF;
  IF v_m.status = 'played' THEN
    RAISE EXCEPTION 'set_cfa_match_status: the match was played' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'cancelled' AND v_m.state = 'confirmed' THEN
    UPDATE public.bookings SET state = 'cancelled', cancelled_at = now(), updated_at = now()
    WHERE id = v_m.booking_id;
    UPDATE public.payments SET status = 'cancelled', updated_at = now()
    WHERE booking_id = v_m.booking_id AND payment_method = 'offline';
  END IF;

  IF p_status = 'scheduled' AND v_m.state IS DISTINCT FROM 'confirmed' THEN
    IF v_m.pitch_id IS NULL THEN
      RAISE EXCEPTION 'set_cfa_match_status: no court to go back to — move it' USING ERRCODE = '22023';
    END IF;
    SELECT v.cancellation_policy, upper(left(ci.code, 3)) INTO v_policy, v_prefix
    FROM public.venues AS v
    INNER JOIN public.cities AS ci ON ci.id = v.city_id
    WHERE v.id = v_m.venue_id;
    BEGIN
      v_code := public.generate_booking_code(v_prefix, extract(YEAR FROM v_m.starts_at)::int);
      INSERT INTO public.bookings (
        code, user_id, pitch_id, starts_at, ends_at, state, origin,
        walk_in_name, base_price_cents, addons_price_cents, total_cents,
        platform_fee_cents, cancellation_policy
      ) VALUES (
        v_code, auth.uid(), v_m.pitch_id, v_m.starts_at, v_m.ends_at, 'confirmed', 'walk_in',
        v_m.walk_in_name, v_m.base_price_cents, 0, v_m.base_price_cents, 0, v_policy
      )
      RETURNING id INTO v_booking;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'set_cfa_match_status: its court is taken now — move it' USING ERRCODE = '23P01';
    END;
    INSERT INTO public.payments (
      booking_id, stripe_payment_intent_id, amount_cents, application_fee_cents, status, payment_method
    ) VALUES (v_booking, 'offline_' || v_booking::text, v_m.base_price_cents, 0, 'succeeded', 'offline');
    UPDATE public.competition_matches SET booking_id = v_booking WHERE id = v_m.id;
  END IF;

  UPDATE public.competition_matches SET status = p_status WHERE id = v_m.id;
  INSERT INTO public.competition_match_changes (match_id, what, old_value, new_value)
  VALUES (v_m.id, 'status', v_m.status, p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.move_cfa_match(uuid, uuid, time) FROM public, anon;
REVOKE ALL ON FUNCTION public.set_cfa_match_status(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.move_cfa_match(uuid, uuid, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_cfa_match_status(uuid, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. The TV says the status
-- ════════════════════════════════════════════════════════════════════
-- As 20261013000002 §7d, with one more field on each CFA item: its status
-- (scheduled or postponed — a cancelled match has no live booking).
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
  SELECT v.id, v.name INTO v_venue
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
          'join', CASE WHEN w.listed THEN b.invite_token END
        ) ORDER BY b.starts_at, b.pitch_id
      )
      FROM public.bookings AS b
      INNER JOIN public.pitches AS p ON p.id = b.pitch_id
      LEFT JOIN public.cfa_matches AS m ON m.booking_id = b.id
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
