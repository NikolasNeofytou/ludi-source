-- tests/schedule_constraints.sql
-- M6 #41b — the overlap exclusion constraints on pitch_schedules and
-- pitch_schedule_overrides. Runs in CI after migrations + seed.
-- Plain PL/pgSQL asserts (RAISE EXCEPTION), matching
-- tests/get_available_slots.sql — no pgtap dependency.
--
-- What these protect: get_available_slots explodes each open window
-- independently, so two OVERLAPPING windows emit the shared hours twice
-- and two players can hold what looks like two slots for one hour on one
-- pitch. Split windows that merely abut are legal and must stay legal.
-- See docs/spikes/schedule-derivation-defects.md.

BEGIN;

DO $$
DECLARE
  v_city_id  uuid;
  v_venue_id uuid;
  v_pitch_id uuid;
BEGIN
  SELECT id INTO v_city_id FROM public.cities WHERE code = 'larnaca';
  IF v_city_id IS NULL THEN
    INSERT INTO public.cities (code, name_en, name_gr, is_enabled)
    VALUES ('larnaca', 'Larnaca', 'Λάρνακα', TRUE)
    RETURNING id INTO v_city_id;
  END IF;

  INSERT INTO public.venues (name, address, city_id, coords)
  VALUES (
    'Constraint Fixture Venue', '1 Test St, Larnaca', v_city_id,
    ST_SetSRID(ST_MakePoint(33.632, 34.916), 4326)::geography
  ) RETURNING id INTO v_venue_id;

  INSERT INTO public.pitches (
    venue_id, name, type, surface, price_per_hour_cents
  ) VALUES (
    v_venue_id, 'Constraint Fixture Pitch', '5-a-side', 'turf', 4000
  ) RETURNING id INTO v_pitch_id;

  CREATE TEMP TABLE _cx AS SELECT v_pitch_id AS id;
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- pitch_schedules
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pitch_id uuid;
BEGIN
  SELECT id INTO v_pitch_id FROM _cx;

  -- A single window is fine.
  INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at)
  VALUES (v_pitch_id, 3, '09:00', '13:00');

  -- A genuine split window on the same day must remain legal — this is
  -- the whole reason the UNIQUE on (pitch, dow) is relaxed.
  INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at)
  VALUES (v_pitch_id, 3, '17:00', '23:00');

  -- Abutting windows touch but do not overlap ('[)' bounds).
  INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at)
  VALUES (v_pitch_id, 3, '13:00', '17:00');

  -- Overlap must be refused.
  BEGIN
    INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at)
    VALUES (v_pitch_id, 3, '12:00', '18:00');
    RAISE EXCEPTION
      'pitch_schedules: overlapping window was accepted (12:00-18:00 vs 09:00-13:00)';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;

  -- A window identical in hours but on a different day must be fine.
  INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at)
  VALUES (v_pitch_id, 4, '09:00', '13:00');

  RAISE NOTICE 'pitch_schedules overlap constraint passed';
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- pitch_schedule_overrides
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pitch_id uuid;
  v_date     date := '2030-05-01';
BEGIN
  SELECT id INTO v_pitch_id FROM _cx;

  INSERT INTO public.pitch_schedule_overrides (
    pitch_id, override_date, is_closed, opens_at, closes_at
  ) VALUES (v_pitch_id, v_date, FALSE, '09:00', '12:00');

  -- A non-contiguous exception day: legal since #41b relaxed the UNIQUE.
  INSERT INTO public.pitch_schedule_overrides (
    pitch_id, override_date, is_closed, opens_at, closes_at
  ) VALUES (v_pitch_id, v_date, FALSE, '18:00', '21:00');

  -- Overlapping exception windows must be refused.
  BEGIN
    INSERT INTO public.pitch_schedule_overrides (
      pitch_id, override_date, is_closed, opens_at, closes_at
    ) VALUES (v_pitch_id, v_date, FALSE, '11:00', '19:00');
    RAISE EXCEPTION
      'pitch_schedule_overrides: overlapping exception window was accepted';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;

  -- A closure covers the whole day, so it cannot sit alongside an open
  -- window for the same date — the two would contradict each other.
  BEGIN
    INSERT INTO public.pitch_schedule_overrides (pitch_id, override_date, is_closed)
    VALUES (v_pitch_id, v_date, TRUE);
    RAISE EXCEPTION
      'pitch_schedule_overrides: closure accepted alongside open windows';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;

  -- With the open windows gone, a lone closure is fine...
  DELETE FROM public.pitch_schedule_overrides
  WHERE pitch_id = v_pitch_id AND override_date = v_date;

  INSERT INTO public.pitch_schedule_overrides (pitch_id, override_date, is_closed)
  VALUES (v_pitch_id, v_date, TRUE);

  -- ...but a second closure for the same date is not. This is the rule
  -- the dropped UNIQUE (pitch_id, override_date) used to carry.
  BEGIN
    INSERT INTO public.pitch_schedule_overrides (pitch_id, override_date, is_closed)
    VALUES (v_pitch_id, v_date, TRUE);
    RAISE EXCEPTION
      'pitch_schedule_overrides: duplicate closure accepted for one date';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;

  -- The same hours on a different date must be fine.
  INSERT INTO public.pitch_schedule_overrides (
    pitch_id, override_date, is_closed, opens_at, closes_at
  ) VALUES (v_pitch_id, v_date + 1, FALSE, '09:00', '12:00');

  RAISE NOTICE 'pitch_schedule_overrides overlap constraint passed';
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- The constraints exist under the expected names (a rename would make
-- the asserts above pass for the wrong reason).
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(expected, ', ') INTO v_missing
  FROM (VALUES
    ('pitch_schedules_no_overlap'),
    ('pitch_schedule_overrides_no_overlap')
  ) AS t(expected)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = t.expected AND contype = 'x'
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing exclusion constraint(s): %', v_missing;
  END IF;

  -- The old UNIQUE must be gone, or non-contiguous exception days are
  -- still impossible and #41a's data-model note is wrong.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pitch_schedule_overrides_pitch_id_override_date_key'
  ) THEN
    RAISE EXCEPTION
      'UNIQUE (pitch_id, override_date) still present; #41b did not drop it';
  END IF;

  RAISE NOTICE 'schedule constraint names verified';
END
$$;

ROLLBACK;
