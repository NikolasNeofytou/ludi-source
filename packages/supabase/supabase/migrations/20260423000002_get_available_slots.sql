-- 20260423000002_get_available_slots.sql
-- RPC used by the mobile pitch-detail screen to render the availability grid.
-- See docs/api-contract.md §4.2.
--
-- Derivation rule (from docs/data-model.md):
--   for each date D in [start, end]:
--     slots = generate from pitch_schedules where day_of_week = dow(D),
--             bounded by pitch_schedule_overrides (closed date, or custom hours),
--             stepped by slot_duration_minutes;
--     for each slot S:
--       available = S is in the future
--                   AND no booking in (pending,paid,confirmed,completed)
--                   overlaps S.
--
-- Returns every candidate slot — including unavailable ones — so the UI can
-- render them struck-through rather than hidden (better UX per docs/ui/sitemap.md).
--
-- SECURITY DEFINER because the function must see ALL bookings to compute
-- availability, not just the caller's. The only data leaving the function
-- is (starts_at, ends_at, is_available) triples — no booking ids, no user
-- ids, no prices — so the RLS bypass is tightly scoped.
--
-- Session: 2026-04-23 M1 #2.

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
    SELECT d::date                       AS the_date,
           EXTRACT(DOW FROM d)::smallint AS dow
    FROM generate_series(p_start_date, p_end_date, '1 day'::interval) AS d
  ),
  overrides AS (
    -- Date-specific exceptions for this pitch within the window.
    SELECT override_date, is_closed, opens_at, closes_at
    FROM public.pitch_schedule_overrides
    WHERE pitch_id = p_pitch_id
      AND override_date BETWEEN p_start_date AND p_end_date
  ),
  day_schedules AS (
    -- Recurring weekly schedule ∪ overrides. An override's opens_at /
    -- closes_at replaces the schedule's for that date (COALESCE), and
    -- is_closed=true nukes the day entirely.
    SELECT
      d.the_date,
      COALESCE(o.opens_at,  s.opens_at)  AS opens_at,
      COALESCE(o.closes_at, s.closes_at) AS closes_at,
      s.slot_duration_minutes,
      COALESCE(o.is_closed, false)       AS is_closed
    FROM dates d
    JOIN public.pitch_schedules s
      ON s.pitch_id = p_pitch_id
     AND s.day_of_week = d.dow
    LEFT JOIN overrides o
      ON o.override_date = d.the_date
  ),
  slot_starts AS (
    -- Explode each open window into slot-sized steps. LATERAL because the
    -- series bounds reference the outer row's columns.
    SELECT
      ds.slot_duration_minutes,
      slot_start
    FROM day_schedules ds
    CROSS JOIN LATERAL generate_series(
      -- Treat schedule time-of-day as local wall time in the venue's tz,
      -- then convert to timestamptz for the comparison against bookings.
      (ds.the_date + ds.opens_at)  AT TIME ZONE v_venue_tz,
      (ds.the_date + ds.closes_at) AT TIME ZONE v_venue_tz
        - make_interval(mins => ds.slot_duration_minutes),
      make_interval(mins => ds.slot_duration_minutes)
    ) AS slot_start
    WHERE NOT ds.is_closed
  )
  SELECT
    ss.slot_start AS starts_at,
    ss.slot_start + make_interval(mins => ss.slot_duration_minutes) AS ends_at,
    (ss.slot_start > now())
      AND NOT EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.pitch_id = p_pitch_id
          AND b.state IN ('pending','paid','confirmed','completed')
          AND b.time_range && tstzrange(
            ss.slot_start,
            ss.slot_start + make_interval(mins => ss.slot_duration_minutes),
            '[)'
          )
      )
    AS is_available
  FROM slot_starts ss
  ORDER BY ss.slot_start;
END;
$$;

COMMENT ON FUNCTION public.get_available_slots(uuid, date, date) IS
  'Availability grid for a pitch. Returns every candidate slot in [start,end] '
  'including unavailable ones (so UI can render struck-through). SECURITY DEFINER '
  'so it sees all bookings; only (starts_at, ends_at, is_available) leaves the '
  'function boundary. Timezone hardcoded to Europe/Nicosia for MVP.';

-- The mobile app calls this via supabase.rpc(), which runs as the
-- `authenticated` role for signed-in users and `anon` for guests.
-- Pitch detail is public-readable per the contract, so both roles can call.
GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, date, date)
  TO anon, authenticated;
