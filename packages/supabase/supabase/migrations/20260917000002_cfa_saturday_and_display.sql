-- 20260917000002_cfa_saturday_and_display.sql
-- (plans/cfa-grassroots-saturday.md)
--
-- 1. CFA grassroots matches. The CFA publishes each Saturday's round with
--    the venue, not the court; the host puts each match on a court. A match
--    is an ordinary walk-in (the calendar, guards, composites and Earnings
--    already understand those) plus a cfa_matches row carrying what the
--    programme prints: kick-off, category, home, away. Loading a Saturday
--    releases the standing "hold" instances it lands on and replaces any
--    earlier load of the same date, so a Monday draft then a Wednesday final
--    never doubles up.
--
-- 2. A public display of a venue's day, for the TV in the lobby and anyone's
--    phone: a secret link per venue (venue_displays, owner-readable only) and
--    one definer function that answers by that link. CFA matches show in full
--    (the CFA publishes them); every other booking shows only as booked, no
--    name — a screen in a lobby is not the operational window ADR-0023 opens.

-- ── 1. CFA matches ───────────────────────────────────────────────────

CREATE TABLE public.cfa_matches (
  id           uuid PRIMARY KEY DEFAULT public.uuid7(),
  venue_id     uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  booking_id   uuid UNIQUE REFERENCES public.bookings (id) ON DELETE SET NULL,
  match_date   date NOT NULL,
  round_label  text NOT NULL CHECK (char_length(btrim(round_label)) BETWEEN 1 AND 40),
  kickoff      time NOT NULL,
  category     text NOT NULL CHECK (char_length(btrim(category)) BETWEEN 1 AND 40),
  home_team    text NOT NULL CHECK (char_length(btrim(home_team)) BETWEEN 1 AND 120),
  away_team    text NOT NULL CHECK (char_length(btrim(away_team)) BETWEEN 1 AND 120),
  created_by   uuid DEFAULT auth.uid() REFERENCES public.users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cfa_matches_venue_date_idx ON public.cfa_matches (venue_id, match_date);

COMMENT ON TABLE public.cfa_matches IS
  'A CFA grassroots match hosted by a venue: the programme row (kick-off, '
  'category, teams) for the walk-in booking that holds its court.';

ALTER TABLE public.cfa_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY cfa_matches_owner_or_admin_select ON public.cfa_matches
  FOR SELECT TO authenticated
  USING (public.is_venue_owner_of_venue(venue_id) OR public.is_admin());

GRANT SELECT ON public.cfa_matches TO authenticated;
REVOKE ALL ON public.cfa_matches FROM anon;

-- load_cfa_round(venue, date, round, matches)
-- p_matches: [{pitch_id, kickoff 'HH:MM', minutes, category, home, away,
--              price_cents}, …]
-- Returns {placed, released, replaced, skipped: [{index, reason}]}.
CREATE OR REPLACE FUNCTION public.load_cfa_round(
  p_venue_id uuid,
  p_date     date,
  p_round    text,
  p_matches  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy    text;
  v_prefix    text;
  v_match     jsonb;
  v_idx       int := -1;
  v_pitch     uuid;
  v_minutes   int;
  v_price     int;
  v_starts    timestamptz;
  v_ends      timestamptz;
  v_name      text;
  v_code      text;
  v_booking   uuid;
  v_placed    int := 0;
  v_released  int := 0;
  v_replaced  int := 0;
  v_n         int;
  v_skipped   jsonb := '[]'::jsonb;
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

  -- Replace an earlier load of this Saturday: its bookings and payments go,
  -- its rows go.
  WITH old AS (
    DELETE FROM public.cfa_matches AS m
    WHERE m.venue_id = p_venue_id AND m.match_date = p_date
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
       OR coalesce(btrim(v_match ->> 'away'), '') = '' THEN
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
      v_code := public.generate_booking_code(v_prefix, EXTRACT(YEAR FROM v_starts)::int);
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

      INSERT INTO public.cfa_matches (
        venue_id, booking_id, match_date, round_label, kickoff, category, home_team, away_team
      ) VALUES (
        p_venue_id, v_booking, p_date, btrim(p_round), (v_match ->> 'kickoff')::time,
        left(btrim(v_match ->> 'category'), 40), left(btrim(v_match ->> 'home'), 120),
        left(btrim(v_match ->> 'away'), 120)
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
  'Owner/admin: put a CFA grassroots round on courts for one date. Replaces an '
  'earlier load of that date, releases standing holds under each match, skips '
  '(does not fail on) a court already taken.';

GRANT EXECUTE ON FUNCTION public.load_cfa_round(uuid, date, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.load_cfa_round(uuid, date, text, jsonb) FROM anon;

-- ── 2. The public display ────────────────────────────────────────────

CREATE TABLE public.venue_displays (
  venue_id    uuid PRIMARY KEY REFERENCES public.venues (id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE CHECK (char_length(token) >= 32),
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.venue_displays IS
  'The secret link of a venue''s public schedule screen. Owner-readable only; '
  'the public page answers through public_venue_schedule(token).';

ALTER TABLE public.venue_displays ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_displays_owner_or_admin_select ON public.venue_displays
  FOR SELECT TO authenticated
  USING (public.is_venue_owner_of_venue(venue_id) OR public.is_admin());

GRANT SELECT ON public.venue_displays TO authenticated;
REVOKE ALL ON public.venue_displays FROM anon;

-- Get (or, with p_rotate, replace) the venue's display link.
CREATE OR REPLACE FUNCTION public.venue_display_token(p_venue_id uuid, p_rotate boolean DEFAULT FALSE)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF NOT (public.is_admin() OR public.is_venue_owner_of_venue(p_venue_id)) THEN
    RAISE EXCEPTION 'venue_display_token: not your venue' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.venue_displays (venue_id, token) VALUES (p_venue_id, v_token)
  ON CONFLICT (venue_id) DO UPDATE
    SET token = CASE WHEN p_rotate THEN excluded.token ELSE public.venue_displays.token END,
        created_at = CASE WHEN p_rotate THEN now() ELSE public.venue_displays.created_at END
  RETURNING token INTO v_token;
  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.venue_display_token(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.venue_display_token(uuid, boolean) FROM anon;

-- The screen's data, by link. NULL for an unknown link or an inactive venue.
-- Dates from yesterday to a month ahead (a coach checks next Saturday early).
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
          -- a joined court lists its halves, so a screen can show the
          -- physical courts and put a 7v7 booking on both
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
          'round', m.round_label
        ) ORDER BY b.starts_at, b.pitch_id
      )
      FROM public.bookings AS b
      INNER JOIN public.pitches AS p ON p.id = b.pitch_id
      LEFT JOIN public.cfa_matches AS m ON m.booking_id = b.id
      WHERE p.venue_id = v_venue.id
        AND p.is_active
        AND b.state IN ('pending', 'collecting', 'paid', 'confirmed', 'completed')
        AND (b.starts_at AT TIME ZONE 'Europe/Nicosia')::date = v_date
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.public_venue_schedule(text, date) IS
  'Public schedule screen of a venue, by its display link. CFA matches in full; '
  'every other booking as booked only — no names, no phones.';

GRANT EXECUTE ON FUNCTION public.public_venue_schedule(text, date) TO anon, authenticated;
