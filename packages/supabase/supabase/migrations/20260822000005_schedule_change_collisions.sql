-- 20260822000005_schedule_change_collisions.sql
-- Count the bookings a schedule change would strand (M6 #41f).
--
-- ────────────────────────────────────────────────────────────────────
-- The gap
-- ────────────────────────────────────────────────────────────────────
-- `get_available_slots` subtracts bookings from availability. Nothing
-- subtracts availability from bookings. So an owner who closes a Saturday
-- leaves a PAID booking pointing at a shut pitch: no slot is offered to
-- anyone else, no one is told, and a player turns up to a locked gate.
--
-- This is the single most dangerous action on the venue-owner surface, and
-- until now it was completely unguarded. Gap 7 in
-- docs/plans/venue-owner-admin.md.
--
-- Cancelling those bookings automatically is NOT the answer — it moves
-- money (refunds run through admin-refund-booking with an audit row and a
-- required reason) and it is not a decision an availability editor should
-- make on someone's behalf. So the editor's job is to REFUSE and say what
-- is in the way. These functions are what it counts with.
--
-- ────────────────────────────────────────────────────────────────────
-- Why SECURITY INVOKER
-- ────────────────────────────────────────────────────────────────────
-- Deliberately not DEFINER. `bookings_select_self_or_owner_or_admin` already
-- lets a venue owner see bookings for their own pitches, so RLS gives the
-- right answer for the right caller with no bypass to reason about. A
-- caller who cannot see a pitch's bookings gets 0 — and also cannot edit
-- that pitch's schedule, so the answer never gets used.
--
-- Only states that hold a slot count. 'completed' is excluded because it is
-- necessarily in the past; cancelled/refunded states released their slot.
--
-- Session: 2026-08-22 M6 #41f.

-- Dropped rather than replaced: CREATE OR REPLACE cannot change a
-- function's return type, and these grew a `time_range_of` column during
-- development. Harmless on a clean database, and keeps the migration
-- re-appliable against a dev stack that already has the earlier shape.
DROP FUNCTION IF EXISTS public.bookings_outside_window(uuid, date, time, time);
DROP FUNCTION IF EXISTS public.bookings_in_weekly_window(uuid, smallint, time, time);
DROP FUNCTION IF EXISTS public.bookings_on_date(uuid, date);

-- ────────────────────────────────────────────────────────────────────
-- Bookings on one date — for a closure or a restricting override.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bookings_on_date(
  p_pitch_id uuid,
  p_date     date
) RETURNS TABLE (
  id            uuid,
  code          text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  state         text,
  time_range_of tstzrange
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.code, b.starts_at, b.ends_at, b.state, b.time_range
  FROM public.bookings AS b
  WHERE
    b.pitch_id = p_pitch_id
    AND b.state IN ('pending', 'paid', 'confirmed')
    AND b.ends_at > now()
    AND b.time_range && tstzrange(
      (p_date + time '00:00') AT TIME ZONE 'Europe/Nicosia',
      ((p_date + 1) + time '00:00') AT TIME ZONE 'Europe/Nicosia',
      '[)'
    )
  ORDER BY b.starts_at;
$$;

COMMENT ON FUNCTION public.bookings_on_date(uuid, date) IS
  'Future bookings still holding a slot on a given local date. Used by the '
  'schedule editor to refuse a closure that would strand them.';

-- ────────────────────────────────────────────────────────────────────
-- Bookings inside a recurring weekly window — for deleting or shrinking
-- a pitch_schedules row.
-- ────────────────────────────────────────────────────────────────────
-- A weekly row recurs forever, so "which bookings does removing it
-- strand?" has no natural end date. Rather than invent a horizon constant
-- that is wrong for somebody, the search is bounded by the data: the
-- furthest future booking that actually exists on this pitch. Beyond that
-- there is nothing to strand.
CREATE OR REPLACE FUNCTION public.bookings_in_weekly_window(
  p_pitch_id    uuid,
  p_day_of_week smallint,
  p_opens_at    time,
  p_closes_at   time
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
  WITH horizon AS (
    SELECT max(b.starts_at) AS last_start
    FROM public.bookings AS b
    WHERE
      b.pitch_id = p_pitch_id
      AND b.state IN ('pending', 'paid', 'confirmed')
      AND b.ends_at > now()
  ),
  dates AS (
    SELECT d::date AS the_date
    FROM horizon AS h
    CROSS JOIN LATERAL generate_series(
      (now() AT TIME ZONE 'Europe/Nicosia')::date,
      (h.last_start AT TIME ZONE 'Europe/Nicosia')::date,
      '1 day'::interval
    ) AS d
    WHERE h.last_start IS NOT NULL
      AND EXTRACT(DOW FROM d)::smallint = p_day_of_week
  )
  SELECT DISTINCT b.id, b.code, b.starts_at, b.ends_at, b.state
  FROM dates AS dt
  INNER JOIN public.bookings AS b
    ON
      b.pitch_id = p_pitch_id
      AND b.state IN ('pending', 'paid', 'confirmed')
      AND b.ends_at > now()
      AND b.time_range && tstzrange(
        (dt.the_date + p_opens_at)  AT TIME ZONE 'Europe/Nicosia',
        (dt.the_date + p_closes_at) AT TIME ZONE 'Europe/Nicosia',
        '[)'
      )
  ORDER BY b.starts_at;
$$;

COMMENT ON FUNCTION public.bookings_in_weekly_window(uuid, smallint, time, time) IS
  'Future bookings falling inside a recurring weekly window. Bounded by the '
  'furthest existing future booking rather than an invented horizon.';

-- ────────────────────────────────────────────────────────────────────
-- Bookings a RESTRICTING override would strand.
-- ────────────────────────────────────────────────────────────────────
-- An override replaces the day's weekly windows (#41a), so "the day stays
-- open" is not the same as "every booking survives": anything booked
-- outside the new hours is stranded just as surely as by a full closure.
--
-- Lives here rather than being filtered in TypeScript because the
-- comparison is between a local wall-clock window and a timestamptz, and
-- every other piece of Europe/Nicosia arithmetic in this codebase is in
-- SQL. Doing it in JS means reimplementing the tz conversion next to code
-- that already gets it right.
CREATE OR REPLACE FUNCTION public.bookings_outside_window(
  p_pitch_id  uuid,
  p_date      date,
  p_opens_at  time,
  p_closes_at time
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
  SELECT b.id, b.code, b.starts_at, b.ends_at, b.state
  FROM public.bookings_on_date(p_pitch_id, p_date) AS b
  WHERE NOT (
    b.time_range_of <@ tstzrange(
      (p_date + p_opens_at)  AT TIME ZONE 'Europe/Nicosia',
      (p_date + p_closes_at) AT TIME ZONE 'Europe/Nicosia',
      '[)'
    )
  )
  ORDER BY b.starts_at;
$$;

COMMENT ON FUNCTION public.bookings_outside_window(uuid, date, time, time) IS
  'Bookings on a date that would fall outside a restricting override. An '
  'override replaces the day, so a booking outside the new hours is '
  'stranded even though the day is still open.';

GRANT EXECUTE ON FUNCTION public.bookings_on_date(uuid, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.bookings_in_weekly_window(uuid, smallint, time, time)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.bookings_outside_window(uuid, date, time, time)
  TO authenticated;
