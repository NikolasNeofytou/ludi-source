-- tests/get_available_slots.sql
-- Smoke test for the availability RPC. Runs in CI after migrations + seed.
-- Uses plain PL/pgSQL asserts (RAISE EXCEPTION) — no pgtap dependency.
-- Full RLS + policy coverage lands in M1 #5 via pg_prove.
--
-- Strategy:
--   1. Insert a minimal fixture (auth user → profile → venue → pitch →
--      schedule → one booking that blocks a specific slot) inside a
--      transaction.
--   2. Call get_available_slots() over a 7-day window starting on a
--      known future Monday.
--   3. Assert expected cardinalities and specific slot availability.
--   4. ROLLBACK so the CI DB stays clean for subsequent steps.

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- Fixtures
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_city_id    uuid;
  v_user_id    uuid := '00000000-0000-4000-8000-000000000001';
  v_venue_id   uuid;
  v_pitch_id   uuid;
  -- 2030-01-07 is a Monday.
  v_monday     date := '2030-01-07';
BEGIN
  -- Reuse Larnaca seed row if it exists, otherwise create it.
  SELECT id INTO v_city_id FROM public.cities WHERE code = 'larnaca';
  IF v_city_id IS NULL THEN
    INSERT INTO public.cities (code, name_en, name_gr, is_enabled)
    VALUES ('larnaca', 'Larnaca', 'Λάρνακα', true)
    RETURNING id INTO v_city_id;
  END IF;

  -- auth.users stub row; the signup trigger then fires handle_new_user.
  -- But our CI stub has no trigger on auth.users (just the table), so we
  -- insert public.users manually.
  INSERT INTO auth.users (id) VALUES (v_user_id)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, first_name, last_name, city_id)
  VALUES (v_user_id, 'Test', 'User', v_city_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.venues (
    name, address, city_id, coords,
    stripe_account_id, stripe_account_status
  ) VALUES (
    'Fixture Venue', '1 Test St, Larnaca', v_city_id,
    ST_SetSRID(ST_MakePoint(33.632, 34.916), 4326)::geography,
    'acct_fixture_' || substr(md5(random()::text), 1, 8),
    'active'
  ) RETURNING id INTO v_venue_id;

  INSERT INTO public.pitches (
    venue_id, name, type, surface, price_per_hour_cents, is_verified
  ) VALUES (
    v_venue_id, 'Fixture Pitch 1', '5-a-side', 'turf', 4000, true
  ) RETURNING id INTO v_pitch_id;

  -- Mon 09:00–17:00, 60-min slots = 8 slots per Monday.
  INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at, slot_duration_minutes)
  VALUES (v_pitch_id, 1, '09:00', '17:00', 60);

  -- Block the 10:00 slot with a paid booking.
  INSERT INTO public.bookings (
    code, user_id, pitch_id, starts_at, ends_at, state,
    base_price_cents, addons_price_cents, total_cents,
    platform_fee_cents, cancellation_policy
  ) VALUES (
    'FIX-2030-0001', v_user_id, v_pitch_id,
    (v_monday + time '10:00') AT TIME ZONE 'Europe/Nicosia',
    (v_monday + time '11:00') AT TIME ZONE 'Europe/Nicosia',
    'paid', 4000, 0, 4000, 400, 'standard'
  );

  -- Stash pitch id for the assertions block via a temp table.
  CREATE TEMP TABLE _test_pitch AS SELECT v_pitch_id AS id, v_monday AS monday;
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- Assertions
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pitch_id  uuid;
  v_monday    date;
  v_total     int;
  v_available int;
  v_blocked   boolean;
  v_neighbor  boolean;
BEGIN
  SELECT id, monday INTO v_pitch_id, v_monday FROM _test_pitch;

  -- 1. Total slots on Monday should be (17-9) = 8.
  SELECT count(*) INTO v_total
  FROM public.get_available_slots(v_pitch_id, v_monday, v_monday);
  IF v_total <> 8 THEN
    RAISE EXCEPTION 'expected 8 slots on Monday, got %', v_total;
  END IF;

  -- 2. 7 slots should be available (one blocked by the seed booking).
  SELECT count(*) INTO v_available
  FROM public.get_available_slots(v_pitch_id, v_monday, v_monday)
  WHERE is_available;
  IF v_available <> 7 THEN
    RAISE EXCEPTION 'expected 7 available slots, got %', v_available;
  END IF;

  -- 3. The 10:00 slot specifically must be unavailable.
  SELECT is_available INTO v_blocked
  FROM public.get_available_slots(v_pitch_id, v_monday, v_monday)
  WHERE starts_at = (v_monday + time '10:00') AT TIME ZONE 'Europe/Nicosia';
  IF v_blocked IS NULL THEN
    RAISE EXCEPTION 'no slot found starting at 10:00 Nicosia';
  END IF;
  IF v_blocked THEN
    RAISE EXCEPTION '10:00 slot should be blocked by seeded booking';
  END IF;

  -- 4. The neighboring 11:00 slot must be available.
  SELECT is_available INTO v_neighbor
  FROM public.get_available_slots(v_pitch_id, v_monday, v_monday)
  WHERE starts_at = (v_monday + time '11:00') AT TIME ZONE 'Europe/Nicosia';
  IF NOT v_neighbor THEN
    RAISE EXCEPTION '11:00 slot should be available';
  END IF;

  -- 5. A non-Monday (Tuesday after our Monday) has no schedule row,
  --    so should return zero slots.
  SELECT count(*) INTO v_total
  FROM public.get_available_slots(v_pitch_id, v_monday + 1, v_monday + 1);
  IF v_total <> 0 THEN
    RAISE EXCEPTION 'expected 0 slots on Tuesday (no schedule), got %', v_total;
  END IF;

  RAISE NOTICE 'get_available_slots smoke test passed (% slots, % available)',
    8, v_available;
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- Argument validation
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pitch_id uuid;
  v_monday   date;
BEGIN
  SELECT id, monday INTO v_pitch_id, v_monday FROM _test_pitch;

  -- end < start must raise.
  BEGIN
    PERFORM public.get_available_slots(v_pitch_id, v_monday, v_monday - 1);
    RAISE EXCEPTION 'expected error for end < start, none raised';
  EXCEPTION WHEN raise_exception THEN
    -- expected
    NULL;
  END;

  -- range > 31 days must raise.
  BEGIN
    PERFORM public.get_available_slots(v_pitch_id, v_monday, v_monday + 32);
    RAISE EXCEPTION 'expected error for 32-day range, none raised';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;

  RAISE NOTICE 'get_available_slots argument validation passed';
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- M6 #41a regression — split windows + override precedence
--
-- These three cases all failed before 20260822000001. Reproduction and
-- rationale: docs/spikes/schedule-derivation-defects.md.
--
--   A. Split windows with no override must not duplicate.
--   B. Split windows WITH an override must yield the override's window
--      exactly once (previously: once per weekly row, i.e. twice).
--   C. An override on a day with no weekly row must open that day
--      (previously: silently returned nothing).
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_venue_id  uuid;
  v_pitch_id  uuid;
  -- 2030-01-12 is a Saturday (dow 6); 2030-01-13 is a Sunday (dow 0).
  v_saturday  date := '2030-01-12';
  v_sunday    date := '2030-01-13';
BEGIN
  SELECT p.venue_id INTO v_venue_id
  FROM public.pitches AS p
  INNER JOIN _test_pitch AS t ON t.id = p.id;

  INSERT INTO public.pitches (
    venue_id, name, type, surface, price_per_hour_cents, is_verified
  ) VALUES (
    v_venue_id, 'Fixture Pitch 2 (split)', '5-a-side', 'turf', 4000, TRUE
  ) RETURNING id INTO v_pitch_id;

  -- Split Saturday: 09:00-13:00 (4 slots) and 17:00-23:00 (6 slots).
  -- The relaxed UNIQUE on pitch_schedules exists precisely for this.
  INSERT INTO public.pitch_schedules (
    pitch_id, day_of_week, opens_at, closes_at, slot_duration_minutes
  ) VALUES
    (v_pitch_id, 6, '09:00', '13:00', 60),
    (v_pitch_id, 6, '17:00', '23:00', 60);

  CREATE TEMP TABLE _test_split AS
  SELECT v_pitch_id AS id, v_saturday AS saturday, v_sunday AS sunday;
END
$$;

DO $$
DECLARE
  v_pitch_id uuid;
  v_saturday date;
  v_sunday   date;
  v_total    int;
  v_dupes    int;
BEGIN
  SELECT id, saturday, sunday INTO v_pitch_id, v_saturday, v_sunday
  FROM _test_split;

  -- A. No override: 4 + 6 = 10 slots, every start distinct.
  SELECT count(*) INTO v_total
  FROM public.get_available_slots(v_pitch_id, v_saturday, v_saturday);
  IF v_total <> 10 THEN
    RAISE EXCEPTION 'split windows: expected 10 slots, got %', v_total;
  END IF;

  SELECT count(*) INTO v_dupes FROM (
    SELECT starts_at
    FROM public.get_available_slots(v_pitch_id, v_saturday, v_saturday)
    GROUP BY starts_at HAVING count(*) > 1
  ) AS d;
  IF v_dupes <> 0 THEN
    RAISE EXCEPTION 'split windows: % duplicated slot start(s)', v_dupes;
  END IF;

  -- B. Override replaces BOTH windows with a single 10:00-12:00 window.
  --    Before the fix this returned 2 slots twice over (4 rows).
  INSERT INTO public.pitch_schedule_overrides (
    pitch_id, override_date, is_closed, opens_at, closes_at, reason
  ) VALUES (
    v_pitch_id, v_saturday, FALSE, '10:00', '12:00', 'regression B'
  );

  SELECT count(*) INTO v_total
  FROM public.get_available_slots(v_pitch_id, v_saturday, v_saturday);
  IF v_total <> 2 THEN
    RAISE EXCEPTION
      'override on split day: expected 2 slots, got % (duplication regression)',
      v_total;
  END IF;

  SELECT count(*) INTO v_dupes FROM (
    SELECT starts_at
    FROM public.get_available_slots(v_pitch_id, v_saturday, v_saturday)
    GROUP BY starts_at HAVING count(*) > 1
  ) AS d;
  IF v_dupes <> 0 THEN
    RAISE EXCEPTION
      'override on split day: % duplicated slot start(s)', v_dupes;
  END IF;

  -- C. Sunday has no weekly row. An override must still open it.
  --    Before the fix the inner join dropped this and returned 0.
  SELECT count(*) INTO v_total
  FROM public.get_available_slots(v_pitch_id, v_sunday, v_sunday);
  IF v_total <> 0 THEN
    RAISE EXCEPTION
      'unscheduled Sunday: expected 0 slots before override, got %', v_total;
  END IF;

  INSERT INTO public.pitch_schedule_overrides (
    pitch_id, override_date, is_closed, opens_at, closes_at, reason
  ) VALUES (
    v_pitch_id, v_sunday, FALSE, '10:00', '14:00', 'regression C'
  );

  SELECT count(*) INTO v_total
  FROM public.get_available_slots(v_pitch_id, v_sunday, v_sunday);
  IF v_total <> 4 THEN
    RAISE EXCEPTION
      'off-schedule override: expected 4 slots on unscheduled Sunday, got %',
      v_total;
  END IF;

  -- D. A closure override shuts a split day completely.
  UPDATE public.pitch_schedule_overrides
  SET is_closed = TRUE, opens_at = NULL, closes_at = NULL
  WHERE pitch_id = v_pitch_id AND override_date = v_saturday;

  SELECT count(*) INTO v_total
  FROM public.get_available_slots(v_pitch_id, v_saturday, v_saturday);
  IF v_total <> 0 THEN
    RAISE EXCEPTION
      'closure override on split day: expected 0 slots, got %', v_total;
  END IF;

  -- E. The override carries its own slot size, since replacement means
  --    there may be no weekly row to borrow one from.
  UPDATE public.pitch_schedule_overrides
  SET slot_duration_minutes = 120
  WHERE pitch_id = v_pitch_id AND override_date = v_sunday;

  SELECT count(*) INTO v_total
  FROM public.get_available_slots(v_pitch_id, v_sunday, v_sunday);
  IF v_total <> 2 THEN
    RAISE EXCEPTION
      'override slot size: expected 2 120-min slots in 10:00-14:00, got %',
      v_total;
  END IF;

  RAISE NOTICE 'get_available_slots override-precedence regression passed';
END
$$;

ROLLBACK;
