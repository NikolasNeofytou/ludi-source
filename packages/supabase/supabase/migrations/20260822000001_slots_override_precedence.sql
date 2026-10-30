-- 20260822000001_slots_override_precedence.sql
-- M6 #41a — fix get_available_slots for split windows and off-schedule
-- overrides. See docs/spikes/schedule-derivation-defects.md for the
-- reproduction that motivated this.
--
-- ────────────────────────────────────────────────────────────────────
-- What was wrong
-- ────────────────────────────────────────────────────────────────────
-- The previous `day_schedules` CTE LEFT JOINed the date override onto
-- EVERY weekly row for that day and COALESCEd the hours:
--
--     COALESCE(o.opens_at,  s.opens_at)  AS opens_at,
--     COALESCE(o.closes_at, s.closes_at) AS closes_at,
--
-- Two consequences, both reproduced 2026-08-22:
--
--   1. A pitch with split windows (09:00-13:00 and 17:00-23:00 — which
--      the relaxed UNIQUE on pitch_schedules exists to allow) plus one
--      "open 10:00-12:00 this Saturday" override collapsed BOTH rows to
--      10:00-12:00, so every slot came back twice.
--   2. The join to pitch_schedules was INNER, so an override on a date
--      whose day_of_week has no weekly row matched nothing and vanished.
--      "We're opening specially this Sunday" returned zero slots and
--      raised no error.
--
-- Latent until now only because no pitch has split windows. The M6 #41
-- schedule editor is the feature that creates them, so this lands first.
--
-- ────────────────────────────────────────────────────────────────────
-- The new rule: overrides REPLACE the day, they do not amend it
-- ────────────────────────────────────────────────────────────────────
-- For a pitch P and date D, the open windows of D are:
--
--   * the pitch_schedule_overrides rows for (P, D), if any exist —
--     is_closed = TRUE contributes no window, so a closure row means the
--     day is shut;
--   * otherwise the pitch_schedules rows for dow(D).
--
-- One sentence, no COALESCE, no per-row fan-out. Both defects fall out:
-- an override contributes exactly the windows it names (no duplication),
-- and it needs no weekly row to exist (off-schedule opening works).
--
-- Why replace rather than intersect: intersection ("bound each weekly
-- window by the override") also fixes the duplication and can express
-- "close the morning only", but it cannot open a normally-closed day —
-- there is no window to intersect with — which is defect 2. Replacement
-- expresses the same restrictions by naming what stays OPEN ("open
-- 17:00-23:00" rather than "close 09:00-13:00") and handles the
-- off-schedule case for free.
--
-- Known limit, deliberate: UNIQUE (pitch_id, override_date) still allows
-- only one override row per date, so an exception day whose open hours
-- are non-contiguous ("open 09:00-11:00 and 19:00-21:00 on the 15th")
-- cannot be expressed yet. The derivation below is already written as a
-- set of rows, so relaxing that UNIQUE is all it takes. That happens in
-- #41b alongside the btree_gist exclusion constraints, so overlapping
-- overrides can never become insertable in the window between the two
-- migrations.
--
-- Session: 2026-08-22 M6 #41a.

-- ────────────────────────────────────────────────────────────────────
-- An override now carries its own slot duration.
-- ────────────────────────────────────────────────────────────────────
-- Under the old COALESCE model the override borrowed the weekly row's
-- slot_duration_minutes. Under replacement there may be no weekly row to
-- borrow from, and when a day has split windows with different durations
-- there is no non-arbitrary one to pick. So the override states its own.
--
-- DEFAULT 60 matches pitch_schedules' own default. Every schedule row in
-- the database today is 60, and the single existing override row is a
-- closure (no slots derived from it either way), so backfilling the
-- default changes no current output.
ALTER TABLE public.pitch_schedule_overrides
  ADD COLUMN IF NOT EXISTS slot_duration_minutes smallint NOT NULL DEFAULT 60;

ALTER TABLE public.pitch_schedule_overrides
  DROP CONSTRAINT IF EXISTS pitch_schedule_overrides_slot_duration_check;

ALTER TABLE public.pitch_schedule_overrides
  ADD CONSTRAINT pitch_schedule_overrides_slot_duration_check
  CHECK (slot_duration_minutes IN (30, 60, 90, 120));

COMMENT ON COLUMN public.pitch_schedule_overrides.slot_duration_minutes IS
  'Slot size for this exception day. An override replaces the weekly '
  'windows entirely, so it cannot borrow the weekly rows slot size — '
  'there may not be one. Defaults to 60, matching pitch_schedules.';

COMMENT ON TABLE public.pitch_schedule_overrides IS
  'Per-date exceptions. An override REPLACES the weekly windows for its '
  'date rather than amending them: is_closed = TRUE shuts the day, '
  'otherwise the row IS the days only open window. See '
  'get_available_slots.';

-- ────────────────────────────────────────────────────────────────────
-- The derivation
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_pitch_id   uuid,
  p_start_date date,
  p_end_date   date
) RETURNS TABLE (
  starts_at    timestamptz,
  ends_at      timestamptz,
  is_available boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Single-country MVP. When a second country ships, promote this to
  -- venues.timezone and read it per-pitch.
  v_venue_tz       constant text := 'Europe/Nicosia';
  -- Cap the range so a buggy client can't request a million slots.
  v_max_range_days constant int  := 31;
  v_range_days     int := p_end_date - p_start_date;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'p_start_date and p_end_date are required';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'p_end_date (%) must be on or after p_start_date (%)',
      p_end_date, p_start_date;
  END IF;
  IF v_range_days > v_max_range_days THEN
    RAISE EXCEPTION 'date range too large: % days (max %)',
      v_range_days, v_max_range_days;
  END IF;

  RETURN QUERY
  WITH dates AS (
    -- One row per day in the requested window.
    SELECT
      d::date                       AS the_date,
      EXTRACT(DOW FROM d)::smallint AS dow
    FROM generate_series(p_start_date, p_end_date, '1 day'::interval) AS d
  ),

  override_windows AS (
    -- Date-specific exceptions. These REPLACE the weekly template for
    -- their date. is_closed rows are carried through here (not filtered
    -- yet) because their presence is what suppresses the weekly rows.
    SELECT
      d.the_date,
      o.opens_at,
      o.closes_at,
      o.slot_duration_minutes,
      o.is_closed
    FROM dates AS d
    INNER JOIN public.pitch_schedule_overrides AS o
      ON o.override_date = d.the_date
    WHERE o.pitch_id = p_pitch_id
  ),

  weekly_windows AS (
    -- The recurring template, for dates that have no override at all.
    SELECT
      d.the_date,
      s.opens_at,
      s.closes_at,
      s.slot_duration_minutes,
      FALSE AS is_closed
    FROM dates AS d
    INNER JOIN public.pitch_schedules AS s
      ON s.day_of_week = d.dow
    WHERE
      s.pitch_id = p_pitch_id
      AND NOT EXISTS (
        SELECT 1 FROM override_windows AS ow
        WHERE ow.the_date = d.the_date
      )
  ),

  day_windows AS (
    -- Precedence resolved. A closed override contributes nothing, and
    -- because it suppressed the weekly rows above, the day is shut.
    --
    -- NOTE: two OVERLAPPING weekly rows for the same (pitch, dow) still
    -- produce overlapping slots here. That is a data defect the database
    -- should refuse, not something to paper over with DISTINCT — masking
    -- it would hide genuinely different slot sizes and make the bad row
    -- invisible. #41b adds the btree_gist exclusion constraint.
    SELECT
      the_date,
      opens_at,
      closes_at,
      slot_duration_minutes
    FROM override_windows
    WHERE NOT is_closed

    UNION ALL

    SELECT
      the_date,
      opens_at,
      closes_at,
      slot_duration_minutes
    FROM weekly_windows
  ),

  slot_starts AS (
    -- Explode each open window into slot-sized steps. LATERAL because the
    -- series bounds reference the outer row's columns. A window shorter
    -- than one slot yields nothing — no partial slots.
    SELECT
      dw.slot_duration_minutes,
      slot_start
    FROM day_windows AS dw
    CROSS JOIN LATERAL generate_series(
      -- Treat schedule time-of-day as local wall time in the venue's tz,
      -- then convert to timestamptz for the comparison against bookings.
      (dw.the_date + dw.opens_at) AT TIME ZONE v_venue_tz,
      (dw.the_date + dw.closes_at) AT TIME ZONE v_venue_tz
        - make_interval(mins => dw.slot_duration_minutes),
      make_interval(mins => dw.slot_duration_minutes)
    ) AS slot_start
  )

  SELECT
    ss.slot_start AS starts_at,
    ss.slot_start + make_interval(mins => ss.slot_duration_minutes) AS ends_at,
    (ss.slot_start > now())
    AND NOT EXISTS (
      SELECT 1
      FROM public.bookings AS b
      WHERE
        b.pitch_id = p_pitch_id
        AND b.state IN ('pending', 'paid', 'confirmed', 'completed')
        AND b.time_range && tstzrange(
          ss.slot_start,
          ss.slot_start + make_interval(mins => ss.slot_duration_minutes),
          '[)'
        )
    ) AS is_available
  FROM slot_starts AS ss
  ORDER BY ss.slot_start;
END;
$$;

COMMENT ON FUNCTION public.get_available_slots(uuid, date, date) IS
  'Availability grid for a pitch. Returns every candidate slot in '
  '[start,end] including unavailable ones (so UI can render '
  'struck-through). A date override REPLACES that days weekly windows '
  'rather than amending them. SECURITY DEFINER so it sees all bookings; '
  'only (starts_at, ends_at, is_available) leaves the function boundary. '
  'Timezone hardcoded to Europe/Nicosia for MVP.';

-- Unchanged from 20260423000002: pitch detail is public-readable per the
-- contract, so both roles can call.
GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, date, date)
  TO anon, authenticated;
