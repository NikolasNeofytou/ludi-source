-- 20260915000002_booking_series.sql
-- Standing bookings: the academy's hours, every week (ADR-0033,
-- docs/plans/standing-bookings.md). A series is the owner's recurring
-- walk-in — courts × weekdays × a kick-off and a duration, from a date,
-- until a date. Its INSTANCES are ordinary walk-in bookings carrying
-- `series_id`, materialised eight weeks ahead by a nightly job and on
-- creation, so nothing downstream learns anything: availability, the
-- exclusion constraint, the composite guard, the calendar, the day sheet,
-- the schedule guards and Earnings all see plain walk-ins.
--
-- Skipping a week is un-booking that instance — the cancelled row stays,
-- and a (series, pitch, day) that already has a row in ANY state is never
-- re-created. A collision (an app booking taken before the series existed,
-- a walk-in, a composite's half) skips that one instance and records why in
-- booking_series_skips, so the run never fails and the owner sees the gap.

-- ────────────────────────────────────────────────────────────────────
-- booking_series and the courts it covers
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.booking_series (
  id               uuid        PRIMARY KEY DEFAULT public.uuid7(),
  venue_id         uuid        NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  name             text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  phone            text        CHECK (phone IS NULL OR char_length(phone) <= 30),
  weekdays         smallint[]  NOT NULL CHECK (
    cardinality(weekdays) BETWEEN 1 AND 7
    AND weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  starts_time      time        NOT NULL,
  duration_minutes int         NOT NULL CHECK (duration_minutes BETWEEN 30 AND 480 AND duration_minutes % 30 = 0),
  starts_on        date        NOT NULL,
  ends_on          date        CHECK (ends_on IS NULL OR ends_on >= starts_on),
  created_by       uuid        NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX booking_series_venue_idx ON public.booking_series (venue_id);

COMMENT ON TABLE public.booking_series IS
  'A standing booking: the owner''s recurring walk-in (courts × weekdays × time), '
  'materialised as ordinary walk-in bookings carrying series_id. See ADR-0033.';

CREATE TABLE public.booking_series_pitches (
  series_id uuid NOT NULL REFERENCES public.booking_series (id) ON DELETE CASCADE,
  pitch_id  uuid NOT NULL REFERENCES public.pitches (id) ON DELETE CASCADE,
  PRIMARY KEY (series_id, pitch_id)
);

-- A series' courts belong to its venue.
CREATE OR REPLACE FUNCTION public.tg_booking_series_pitches_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.booking_series AS s
    INNER JOIN public.pitches AS p ON p.venue_id = s.venue_id
    WHERE s.id = NEW.series_id AND p.id = NEW.pitch_id
  ) THEN
    RAISE EXCEPTION 'SERIES_PITCH_VENUE_MISMATCH: a standing booking covers courts at its own venue only'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_booking_series_pitches_guard
  BEFORE INSERT OR UPDATE ON public.booking_series_pitches
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_series_pitches_guard();

-- Where the materialiser could not place an instance, and why.
CREATE TABLE public.booking_series_skips (
  series_id  uuid        NOT NULL REFERENCES public.booking_series (id) ON DELETE CASCADE,
  pitch_id   uuid        NOT NULL REFERENCES public.pitches (id) ON DELETE CASCADE,
  on_date    date        NOT NULL,
  reason     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (series_id, pitch_id, on_date)
);

-- ────────────────────────────────────────────────────────────────────
-- bookings.series_id — an instance is a walk-in that knows its series
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN series_id uuid REFERENCES public.booking_series (id) ON DELETE SET NULL;

CREATE INDEX bookings_series_idx ON public.bookings (series_id) WHERE series_id IS NOT NULL;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_series_is_walk_in CHECK (series_id IS NULL OR origin = 'walk_in');

COMMENT ON COLUMN public.bookings.series_id IS
  'Set on instances of a standing booking (booking_series). Always a walk-in.';

-- The audit vocabulary grows two words. Written by the definer RPCs below.
--
-- Widened from the constraint AS IT IS, not from a re-typed list: the list
-- has been re-stated by four migrations, and a fifth copy that missed one
-- word ('invite_owner', added 2026-08-29) failed on prod against rows the CI
-- database never has. Reading pg_get_constraintdef keeps every word prod
-- already accepts; only the two new ones are added.
DO $$
DECLARE
  v_def  text;
  v_list text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
  INTO v_def
  FROM pg_constraint AS c
  WHERE c.conname = 'admin_actions_action_type_check'
    AND c.conrelid = 'public.admin_actions'::regclass;

  -- CHECK ((action_type = ANY (ARRAY['a'::text, 'b'::text, …])))
  v_list := substring(v_def FROM 'ARRAY\[(.*)\]');
  IF v_list IS NULL THEN
    RAISE EXCEPTION 'admin_actions_action_type_check: unexpected definition %', v_def;
  END IF;

  EXECUTE 'ALTER TABLE public.admin_actions DROP CONSTRAINT admin_actions_action_type_check';
  EXECUTE format(
    'ALTER TABLE public.admin_actions ADD CONSTRAINT admin_actions_action_type_check '
    'CHECK (action_type = ANY (ARRAY[%s, %L::text, %L::text]))',
    v_list, 'series_created', 'series_ended'
  );
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- The materialiser
-- ────────────────────────────────────────────────────────────────────
-- For one series (owner or admin, gated) or for every live series (the
-- nightly job, postgres): every (pitch, date) from today to the horizon
-- that has no row yet — in any state, so an un-booked week stays
-- un-booked — gets an ordinary walk-in booking plus its offline payments
-- row, exactly as create-walk-in-booking writes them. 23P01 on one
-- instance (the exclusion constraint or the composite guard) becomes a
-- booking_series_skips row, never a failed run.
CREATE OR REPLACE FUNCTION public.materialise_booking_series(
  p_series_id    uuid DEFAULT NULL,
  p_horizon_days int  DEFAULT 56
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today    date := (now() AT TIME ZONE 'Europe/Nicosia')::date;
  v_series   record;
  v_pitch    record;
  v_date     date;
  v_from     date;
  v_to       date;
  v_starts   timestamptz;
  v_ends     timestamptz;
  v_code     text;
  v_booking  uuid;
  v_made     int := 0;
BEGIN
  IF p_series_id IS NULL THEN
    IF NOT public.is_privileged_writer() THEN
      RAISE EXCEPTION 'materialise_booking_series: all-series run is for the scheduler'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.booking_series AS s
        WHERE s.id = p_series_id AND public.is_venue_owner_of_venue(s.venue_id)
      )
      OR public.is_privileged_writer()
    ) THEN
      RAISE EXCEPTION 'materialise_booking_series: not your series'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_series IN
    SELECT
      s.id, s.venue_id, s.name, s.phone, s.weekdays, s.starts_time,
      s.duration_minutes, s.starts_on, s.ends_on, s.created_by,
      v.cancellation_policy,
      upper(left(c.code, 3)) AS city_prefix
    FROM public.booking_series AS s
    INNER JOIN public.venues AS v ON v.id = s.venue_id
    INNER JOIN public.cities AS c ON c.id = v.city_id
    WHERE (p_series_id IS NULL OR s.id = p_series_id)
      AND (s.ends_on IS NULL OR s.ends_on >= v_today)
  LOOP
    v_from := greatest(v_series.starts_on, v_today);
    v_to   := least(coalesce(v_series.ends_on, v_today + p_horizon_days), v_today + p_horizon_days);

    FOR v_pitch IN
      SELECT p.id, p.price_per_hour_cents
      FROM public.booking_series_pitches AS sp
      INNER JOIN public.pitches AS p ON p.id = sp.pitch_id
      WHERE sp.series_id = v_series.id AND p.is_active
    LOOP
      v_date := v_from;
      WHILE v_date <= v_to LOOP
        IF EXTRACT(DOW FROM v_date)::smallint = ANY (v_series.weekdays) THEN
          v_starts := (v_date + v_series.starts_time) AT TIME ZONE 'Europe/Nicosia';
          v_ends   := v_starts + make_interval(mins => v_series.duration_minutes);

          IF NOT EXISTS (
            SELECT 1 FROM public.bookings AS b
            WHERE b.series_id = v_series.id
              AND b.pitch_id = v_pitch.id
              AND (b.starts_at AT TIME ZONE 'Europe/Nicosia')::date = v_date
          ) AND NOT EXISTS (
            SELECT 1 FROM public.booking_series_skips AS k
            WHERE k.series_id = v_series.id AND k.pitch_id = v_pitch.id AND k.on_date = v_date
          ) THEN
            BEGIN
              v_code := public.generate_booking_code(v_series.city_prefix, EXTRACT(YEAR FROM v_starts)::int);
              INSERT INTO public.bookings (
                code, user_id, pitch_id, starts_at, ends_at, state, origin,
                walk_in_name, walk_in_phone,
                base_price_cents, addons_price_cents, total_cents, platform_fee_cents,
                cancellation_policy, series_id
              ) VALUES (
                v_code, v_series.created_by, v_pitch.id, v_starts, v_ends, 'confirmed', 'walk_in',
                v_series.name, v_series.phone,
                greatest(1, round(v_pitch.price_per_hour_cents * v_series.duration_minutes / 60.0)::int),
                0,
                greatest(1, round(v_pitch.price_per_hour_cents * v_series.duration_minutes / 60.0)::int),
                0,
                v_series.cancellation_policy, v_series.id
              )
              RETURNING id INTO v_booking;

              INSERT INTO public.payments (
                booking_id, stripe_payment_intent_id, amount_cents, application_fee_cents,
                status, payment_method
              ) VALUES (
                v_booking, 'offline_' || v_booking::text,
                greatest(1, round(v_pitch.price_per_hour_cents * v_series.duration_minutes / 60.0)::int),
                0, 'succeeded', 'offline'
              );

              v_made := v_made + 1;
            EXCEPTION
              WHEN exclusion_violation THEN
                INSERT INTO public.booking_series_skips (series_id, pitch_id, on_date, reason)
                VALUES (v_series.id, v_pitch.id, v_date, 'already booked')
                ON CONFLICT DO NOTHING;
            END;
          END IF;
        END IF;
        v_date := v_date + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN v_made;
END;
$$;

COMMENT ON FUNCTION public.materialise_booking_series(uuid, int) IS
  'Creates the missing walk-in instances of a standing booking up to the horizon. '
  'No id = every live series (scheduler only). A collision skips one instance and '
  'records it in booking_series_skips.';

-- ────────────────────────────────────────────────────────────────────
-- Create and end, as the owner
-- ────────────────────────────────────────────────────────────────────
-- Owners cannot insert bookings directly (all writes via service role), so
-- creation and ending are definer RPCs gated on venue ownership. They write
-- the audit rows themselves.
CREATE OR REPLACE FUNCTION public.create_booking_series(
  p_venue_id         uuid,
  p_name             text,
  p_phone            text,
  p_pitch_ids        uuid[],
  p_weekdays         smallint[],
  p_starts_time      time,
  p_duration_minutes int,
  p_starts_on        date,
  p_ends_on          date
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id   uuid;
  v_made int;
BEGIN
  IF NOT (public.is_admin() OR public.is_venue_owner_of_venue(p_venue_id)) THEN
    RAISE EXCEPTION 'create_booking_series: not your venue' USING ERRCODE = '42501';
  END IF;
  IF p_pitch_ids IS NULL OR cardinality(p_pitch_ids) = 0 THEN
    RAISE EXCEPTION 'create_booking_series: pick at least one court' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.booking_series (
    venue_id, name, phone, weekdays, starts_time, duration_minutes, starts_on, ends_on, created_by
  ) VALUES (
    p_venue_id, p_name, p_phone, p_weekdays, p_starts_time, p_duration_minutes, p_starts_on, p_ends_on, auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.booking_series_pitches (series_id, pitch_id)
  SELECT v_id, unnest(p_pitch_ids);

  v_made := public.materialise_booking_series(v_id);

  INSERT INTO public.admin_actions (admin_user_id, action_type, target_type, target_id, reason, payload)
  VALUES (
    auth.uid(), 'series_created', 'venue', p_venue_id,
    format('standing booking "%s" created (%s instances)', p_name, v_made),
    jsonb_build_object('series_id', v_id, 'instances', v_made, 'pitch_ids', p_pitch_ids, 'weekdays', p_weekdays)
  );

  RETURN v_id;
END;
$$;

-- Ending: the series stops on p_ends_on (today by default); instances after
-- it that still hold a slot are cancelled, with their offline payments
-- rows, the way the walk-in cancel does it. Past instances stay as history.
CREATE OR REPLACE FUNCTION public.end_booking_series(
  p_series_id uuid,
  p_ends_on   date DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue     uuid;
  v_name      text;
  v_ends_on   date := coalesce(p_ends_on, (now() AT TIME ZONE 'Europe/Nicosia')::date);
  v_cancelled int;
BEGIN
  SELECT venue_id, name INTO v_venue, v_name FROM public.booking_series WHERE id = p_series_id;
  IF v_venue IS NULL THEN
    RAISE EXCEPTION 'end_booking_series: no such series' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_admin() OR public.is_venue_owner_of_venue(v_venue)) THEN
    RAISE EXCEPTION 'end_booking_series: not your series' USING ERRCODE = '42501';
  END IF;

  UPDATE public.booking_series
  SET ends_on = least(coalesce(ends_on, v_ends_on), v_ends_on), updated_at = now()
  WHERE id = p_series_id;

  WITH gone AS (
    UPDATE public.bookings AS b
    SET state = 'cancelled', cancelled_at = now(), updated_at = now()
    WHERE b.series_id = p_series_id
      AND b.state = 'confirmed'
      AND (b.starts_at AT TIME ZONE 'Europe/Nicosia')::date > v_ends_on
    RETURNING b.id
  ),
  paid AS (
    UPDATE public.payments AS p
    SET status = 'cancelled', updated_at = now()
    FROM gone
    WHERE p.booking_id = gone.id AND p.payment_method = 'offline'
    RETURNING p.id
  )
  SELECT count(*) INTO v_cancelled FROM gone;

  INSERT INTO public.admin_actions (admin_user_id, action_type, target_type, target_id, reason, payload)
  VALUES (
    coalesce(auth.uid(), (SELECT created_by FROM public.booking_series WHERE id = p_series_id)),
    'series_ended', 'venue', v_venue,
    format('standing booking "%s" ends %s (%s future instances cancelled)', v_name, v_ends_on, v_cancelled),
    jsonb_build_object('series_id', p_series_id, 'ends_on', v_ends_on, 'cancelled', v_cancelled)
  );

  RETURN v_cancelled;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- RLS — the owner's book
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.booking_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_series_pitches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_series_skips ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_series_owner_or_admin_select ON public.booking_series
  FOR SELECT TO authenticated
  USING (public.is_venue_owner_of_venue(venue_id) OR public.is_admin());

CREATE POLICY booking_series_pitches_with_series ON public.booking_series_pitches
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.booking_series AS s WHERE s.id = series_id));

CREATE POLICY booking_series_skips_with_series ON public.booking_series_skips
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.booking_series AS s WHERE s.id = series_id));

-- Writes go through the two RPCs above; no insert/update/delete policies.

GRANT SELECT ON public.booking_series, public.booking_series_pitches, public.booking_series_skips TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_series(uuid, text, text, uuid[], smallint[], time, int, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_booking_series(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.materialise_booking_series(uuid, int) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.materialise_booking_series(uuid, int) FROM anon;
REVOKE ALL ON FUNCTION public.create_booking_series(uuid, text, text, uuid[], smallint[], time, int, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.end_booking_series(uuid, date) FROM anon;

-- ────────────────────────────────────────────────────────────────────
-- The nightly job
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not available; skipping ludi-materialise-booking-series (expected in CI).';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- 03:30 UTC daily (after the Stripe-events cleanup): roll every live
  -- standing booking forward to eight weeks ahead.
  PERFORM cron.schedule(
    'ludi-materialise-booking-series',
    '30 3 * * *',
    $cmd$SELECT public.materialise_booking_series();$cmd$
  );

  RAISE NOTICE 'Scheduled ludi-materialise-booking-series.';
END
$$;
