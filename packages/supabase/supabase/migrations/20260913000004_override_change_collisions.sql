-- 20260913000004_override_change_collisions.sql
-- One collision check for every exception (override) change, computed
-- against what the day's hours will be AFTERWARDS.
--
-- The schedule editor refuses a change that would strand a booking
-- (20260822000005). For date exceptions it asked the wrong question twice
-- (launch audit 2026-09-13):
--
--   * Removing an exception was never checked — "restoring the weekly hours
--     can only ADD availability back". But an exception REPLACES the day
--     (20260822000001), so the weekly hours can be narrower, or absent: a
--     pitch closed on Sundays, opened specially 10:00–18:00, booked at
--     11:00, then the exception deleted → a paid booking on a closed pitch,
--     no warning.
--   * Adding an open window asked bookings_outside_window about the NEW
--     window alone. A date may hold several non-overlapping windows
--     (20260822000002), so a booking already inside the date's other
--     window was counted as stranded and a perfectly safe second window
--     was refused.
--
-- The rule, same as get_available_slots: the open windows of (pitch, date)
-- are its override rows if any exist (a closure contributes none, so the
-- day is shut), otherwise the weekly rows for its day of week. This
-- function applies the proposed change — drop one override row, and/or add
-- one — resolves that rule, and returns the future bookings on the date
-- not fully inside any resulting window.
--
-- SECURITY INVOKER like its siblings: the owner's RLS on schedules,
-- overrides and bookings applies.
CREATE OR REPLACE FUNCTION public.bookings_stranded_by_override_change(
  p_pitch_id           uuid,
  p_date               date,
  p_remove_override_id uuid    DEFAULT NULL,
  p_add_is_closed      boolean DEFAULT NULL,
  p_add_opens_at       time    DEFAULT NULL,
  p_add_closes_at      time    DEFAULT NULL
) RETURNS TABLE (
  id        uuid,
  code      text,
  starts_at timestamptz,
  ends_at   timestamptz,
  state     text
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH overrides_after AS (
    SELECT o.is_closed, o.opens_at, o.closes_at
    FROM public.pitch_schedule_overrides AS o
    WHERE o.pitch_id = p_pitch_id
      AND o.override_date = p_date
      AND (p_remove_override_id IS NULL OR o.id <> p_remove_override_id)

    UNION ALL

    SELECT p_add_is_closed, p_add_opens_at, p_add_closes_at
    WHERE p_add_is_closed IS NOT NULL
  ),

  windows_after AS (
    -- Any override row left → it replaces the day; closures add nothing.
    -- A closure shuts the whole day: the table's exclusion constraint
    -- never lets one sit beside an open window, but a PROPOSED closure can,
    -- and the answer must be "everything on the date" either way.
    SELECT oa.opens_at, oa.closes_at
    FROM overrides_after AS oa
    WHERE NOT oa.is_closed
      AND NOT EXISTS (SELECT 1 FROM overrides_after AS c WHERE c.is_closed)

    UNION ALL

    -- No override row left → the weekly template applies.
    SELECT s.opens_at, s.closes_at
    FROM public.pitch_schedules AS s
    WHERE s.pitch_id = p_pitch_id
      AND s.day_of_week = EXTRACT(DOW FROM p_date)::smallint
      AND NOT EXISTS (SELECT 1 FROM overrides_after)
  )

  SELECT b.id, b.code, b.starts_at, b.ends_at, b.state
  FROM public.bookings_on_date(p_pitch_id, p_date) AS b
  WHERE NOT EXISTS (
    SELECT 1
    FROM windows_after AS w
    WHERE b.time_range_of <@ tstzrange(
      (p_date + w.opens_at)  AT TIME ZONE 'Europe/Nicosia',
      (p_date + w.closes_at) AT TIME ZONE 'Europe/Nicosia',
      '[)'
    )
  )
  ORDER BY b.starts_at;
$$;

COMMENT ON FUNCTION public.bookings_stranded_by_override_change(
  uuid, date, uuid, boolean, time, time
) IS
  'Future bookings on a date that would sit outside the day''s open hours '
  'after an exception change (drop p_remove_override_id and/or add one '
  'row). Resolves override-replaces-day exactly as get_available_slots '
  'does. Used by the schedule editor to refuse adding or removing an '
  'exception that would strand a booking.';

REVOKE ALL ON FUNCTION public.bookings_stranded_by_override_change(
  uuid, date, uuid, boolean, time, time
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bookings_stranded_by_override_change(
  uuid, date, uuid, boolean, time, time
) TO authenticated;
