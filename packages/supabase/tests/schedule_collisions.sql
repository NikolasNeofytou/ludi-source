-- tests/schedule_collisions.sql
-- The booking-collision lookups behind the M6 #41f schedule editor.
-- Runs in CI after migrations + seed. Plain PL/pgSQL asserts, matching
-- tests/get_available_slots.sql.
--
-- What these protect: an owner closing a Saturday must not silently strand
-- a paid booking. The editor refuses the change and lists what is in the
-- way; these functions are what it counts with. Gap 7 in
-- docs/plans/venue-owner-admin.md.

BEGIN;

DO $$
DECLARE
  v_city_id  uuid;
  v_user_id  uuid := '00000000-0000-4000-8000-00000000d001';
  v_venue_id uuid;
  v_pitch_id uuid;
  -- A Saturday comfortably in the future, so `ends_at > now()` holds
  -- whenever this suite runs.
  v_sat      date := '2030-01-12';
BEGIN
  SELECT id INTO v_city_id FROM public.cities WHERE code = 'larnaca';
  IF v_city_id IS NULL THEN
    INSERT INTO public.cities (code, name_en, name_gr, is_enabled)
    VALUES ('larnaca', 'Larnaca', 'Λάρνακα', TRUE) RETURNING id INTO v_city_id;
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user_id) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, first_name, last_name, city_id)
  VALUES (v_user_id, 'Collide', 'Tester', v_city_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.venues (name, address, city_id, coords)
  VALUES (
    'Collision Venue', '3 Test St', v_city_id,
    ST_SetSRID(ST_MakePoint(33.632, 34.916), 4326)::geography
  ) RETURNING id INTO v_venue_id;

  INSERT INTO public.pitches (venue_id, name, type, surface, price_per_hour_cents)
  VALUES (v_venue_id, 'Collision Pitch', '5-a-side', 'turf', 4000)
  RETURNING id INTO v_pitch_id;

  -- Saturday evening, 19:00–20:00 local.
  INSERT INTO public.bookings (
    code, user_id, pitch_id, starts_at, ends_at, state,
    base_price_cents, addons_price_cents, total_cents,
    platform_fee_cents, cancellation_policy
  ) VALUES (
    'COL-2030-0001', v_user_id, v_pitch_id,
    (v_sat + time '19:00') AT TIME ZONE 'Europe/Nicosia',
    (v_sat + time '20:00') AT TIME ZONE 'Europe/Nicosia',
    'paid', 4000, 0, 4000, 400, 'standard'
  );

  -- A cancelled booking in the same slot-hour on the following Saturday.
  -- It released its slot, so nothing should count it.
  INSERT INTO public.bookings (
    code, user_id, pitch_id, starts_at, ends_at, state,
    base_price_cents, addons_price_cents, total_cents,
    platform_fee_cents, cancellation_policy
  ) VALUES (
    'COL-2030-0002', v_user_id, v_pitch_id,
    (v_sat + 7 + time '19:00') AT TIME ZONE 'Europe/Nicosia',
    (v_sat + 7 + time '20:00') AT TIME ZONE 'Europe/Nicosia',
    'cancelled', 4000, 0, 4000, 400, 'standard'
  );

  CREATE TEMP TABLE _col AS
  SELECT v_pitch_id AS pitch_id, v_sat AS sat;
END
$$;

DO $$
DECLARE
  v_pitch_id uuid;
  v_sat      date;
  n          int;
BEGIN
  SELECT pitch_id, sat INTO v_pitch_id, v_sat FROM _col;

  -- 1. Closing that exact date strands the paid booking.
  SELECT count(*) INTO n FROM public.bookings_on_date(v_pitch_id, v_sat);
  IF n <> 1 THEN
    RAISE EXCEPTION 'bookings_on_date: expected 1 on the booked Saturday, got %', n;
  END IF;

  -- 2. The day before is clear.
  SELECT count(*) INTO n FROM public.bookings_on_date(v_pitch_id, v_sat - 1);
  IF n <> 0 THEN
    RAISE EXCEPTION 'bookings_on_date: expected 0 the day before, got %', n;
  END IF;

  -- 3. A cancelled booking released its slot and must not block anything.
  SELECT count(*) INTO n FROM public.bookings_on_date(v_pitch_id, v_sat + 7);
  IF n <> 0 THEN
    RAISE EXCEPTION
      'bookings_on_date: cancelled booking counted as a collision (got %)', n;
  END IF;

  -- 4. Removing the Saturday EVENING window strands it (19:00 is inside).
  SELECT count(*) INTO n
  FROM public.bookings_in_weekly_window(v_pitch_id, 6::smallint, '17:00', '23:00');
  IF n <> 1 THEN
    RAISE EXCEPTION
      'bookings_in_weekly_window: expected 1 in the evening window, got %', n;
  END IF;

  -- 5. Removing the MORNING window strands nothing — the split-window case
  --    that makes a naive "any booking that day" check wrong.
  SELECT count(*) INTO n
  FROM public.bookings_in_weekly_window(v_pitch_id, 6::smallint, '09:00', '13:00');
  IF n <> 0 THEN
    RAISE EXCEPTION
      'bookings_in_weekly_window: morning window should strand nothing, got %', n;
  END IF;

  -- 6. Same hours on a different weekday strand nothing.
  SELECT count(*) INTO n
  FROM public.bookings_in_weekly_window(v_pitch_id, 3::smallint, '17:00', '23:00');
  IF n <> 0 THEN
    RAISE EXCEPTION
      'bookings_in_weekly_window: wrong weekday should strand nothing, got %', n;
  END IF;

  -- 7. A window that merely abuts the booking does not overlap it.
  --    18:00–19:00 ends exactly where the booking starts.
  SELECT count(*) INTO n
  FROM public.bookings_in_weekly_window(v_pitch_id, 6::smallint, '18:00', '19:00');
  IF n <> 0 THEN
    RAISE EXCEPTION
      'bookings_in_weekly_window: abutting window counted as a collision (got %)', n;
  END IF;

  -- 8. A partial overlap still counts — shrinking a window to 19:30 would
  --    cut the booking in half, which is just as broken as removing it.
  SELECT count(*) INTO n
  FROM public.bookings_in_weekly_window(v_pitch_id, 6::smallint, '19:30', '23:00');
  IF n <> 1 THEN
    RAISE EXCEPTION
      'bookings_in_weekly_window: partial overlap should count, got %', n;
  END IF;

  -- 9. A restricting override that still covers the booking is safe.
  --    18:00–21:00 contains the 19:00–20:00 booking.
  SELECT count(*) INTO n
  FROM public.bookings_outside_window(v_pitch_id, v_sat, '18:00', '21:00');
  IF n <> 0 THEN
    RAISE EXCEPTION
      'bookings_outside_window: booking is inside the new hours, got %', n;
  END IF;

  -- 10. One that no longer covers it strands it — even though the day
  --     stays OPEN, which is the case a "did you close the day?" check
  --     would miss entirely.
  SELECT count(*) INTO n
  FROM public.bookings_outside_window(v_pitch_id, v_sat, '09:00', '13:00');
  IF n <> 1 THEN
    RAISE EXCEPTION
      'bookings_outside_window: morning-only override should strand the '
      'evening booking, got %', n;
  END IF;

  -- 11. Partial cover is not cover. 19:30–21:00 cuts the booking in half.
  SELECT count(*) INTO n
  FROM public.bookings_outside_window(v_pitch_id, v_sat, '19:30', '21:00');
  IF n <> 1 THEN
    RAISE EXCEPTION
      'bookings_outside_window: partially-covered booking should count, got %', n;
  END IF;

  RAISE NOTICE 'schedule collision lookups (1-11) passed';
END
$$;

-- ── Exception changes, judged by the day's hours AFTER the change ──────
-- (20260913000004, launch audit 2026-09-13). The test pitch has no weekly
-- rows yet, so Saturday is normally CLOSED — the case that made "removing
-- an exception can only add hours back" wrong.
DO $$
DECLARE
  v_pitch_id uuid;
  v_sat      date;
  v_override uuid;
  n          int;
BEGIN
  SELECT pitch_id, sat INTO v_pitch_id, v_sat FROM _col;

  -- Special hours 18:00–21:00 on a normally-closed Saturday; the paid
  -- 19:00–20:00 booking sits inside them.
  INSERT INTO public.pitch_schedule_overrides
    (pitch_id, override_date, is_closed, opens_at, closes_at)
  VALUES (v_pitch_id, v_sat, FALSE, '18:00', '21:00')
  RETURNING id INTO v_override;

  -- 12. Removing that exception strands the booking: the day falls back to
  --     the weekly hours, and there are none.
  SELECT count(*) INTO n FROM public.bookings_stranded_by_override_change(
    v_pitch_id, v_sat, p_remove_override_id => v_override);
  IF n <> 1 THEN
    RAISE EXCEPTION
      'override change: removing the only exception on a closed day should '
      'strand the booking, got %', n;
  END IF;

  -- 13. A second window on the same date strands nothing — the booking is
  --     inside the date's existing window. (bookings_outside_window, asked
  --     about the new window alone, said 1 here: a false refusal.)
  SELECT count(*) INTO n FROM public.bookings_stranded_by_override_change(
    v_pitch_id, v_sat,
    p_add_is_closed => FALSE, p_add_opens_at => '09:00', p_add_closes_at => '13:00');
  IF n <> 0 THEN
    RAISE EXCEPTION
      'override change: a second window must not count bookings in the '
      'first, got %', n;
  END IF;

  -- 14. A closure strands it, whatever windows the date had.
  SELECT count(*) INTO n FROM public.bookings_stranded_by_override_change(
    v_pitch_id, v_sat, p_add_is_closed => TRUE);
  IF n <> 1 THEN
    RAISE EXCEPTION 'override change: a closure should strand the booking, got %', n;
  END IF;

  -- Now give Saturday weekly evening hours that cover the booking.
  INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at)
  VALUES (v_pitch_id, 6, '17:00', '23:00');

  -- 15. Removing the exception is safe when the weekly hours cover it.
  SELECT count(*) INTO n FROM public.bookings_stranded_by_override_change(
    v_pitch_id, v_sat, p_remove_override_id => v_override);
  IF n <> 0 THEN
    RAISE EXCEPTION
      'override change: weekly hours cover the booking after removal, got %', n;
  END IF;

  -- 16. Morning-only special hours on a date with no exception replace the
  --     covering weekly evening and strand the booking.
  DELETE FROM public.pitch_schedule_overrides WHERE id = v_override;
  SELECT count(*) INTO n FROM public.bookings_stranded_by_override_change(
    v_pitch_id, v_sat,
    p_add_is_closed => FALSE, p_add_opens_at => '09:00', p_add_closes_at => '13:00');
  IF n <> 1 THEN
    RAISE EXCEPTION
      'override change: special hours replace the weekly evening, got %', n;
  END IF;

  -- 17. A different date is untouched by any of it.
  SELECT count(*) INTO n FROM public.bookings_stranded_by_override_change(
    v_pitch_id, v_sat - 1, p_add_is_closed => TRUE);
  IF n <> 0 THEN
    RAISE EXCEPTION 'override change: the day before has no bookings, got %', n;
  END IF;

  RAISE NOTICE 'schedule collision lookups passed';
END
$$;

ROLLBACK;
