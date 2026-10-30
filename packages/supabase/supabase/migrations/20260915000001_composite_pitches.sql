-- 20260915000001_composite_pitches.sql
-- Composite pitches: a pitch may be MADE OF other pitches at the same
-- venue (Campeone's 7-a-side is two adjacent 5-a-sides). The composite
-- is an ordinary pitches row — own name, type, price, hours, verification
-- — so listing, seats and payouts learn nothing. What changes is what a
-- booking OCCUPIES: a booking on a leaf occupies that leaf; a booking on
-- a composite occupies each member. No two active bookings may occupy
-- the same unit at the same time. See docs/plans/composite-pitch.md and
-- ADR-0032.
--
-- Enforcement is in the database, beside the existing EXCLUDE (which
-- keeps covering same-pitch races through its GiST index): a BEFORE
-- trigger on bookings takes an advisory lock per physical unit, then
-- refuses an overlap with any active booking on a pitch that shares a
-- unit. Advisory locks serialise a 7v7 insert against a concurrent insert
-- on either half; READ COMMITTED gives the waiter a fresh snapshot once
-- the lock is released, so it sees the committed row. Both booking edge
-- functions already map 23P01 to SLOT_UNAVAILABLE, so they need no change.

-- ────────────────────────────────────────────────────────────────────
-- pitch_components — which leaves a composite is made of
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.pitch_components (
  parent_pitch_id uuid        NOT NULL REFERENCES public.pitches (id) ON DELETE CASCADE,
  child_pitch_id  uuid        NOT NULL REFERENCES public.pitches (id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_pitch_id, child_pitch_id),
  CHECK (parent_pitch_id <> child_pitch_id)
);

CREATE INDEX pitch_components_child_idx
  ON public.pitch_components (child_pitch_id);

COMMENT ON TABLE public.pitch_components IS
  'A composite pitch (parent) is made of leaf pitches (children) at the '
  'same venue. One level only: a child is never itself a parent. A '
  'booking on the parent occupies every child; a booking on a child '
  'blocks the parent. See docs/plans/composite-pitch.md.';

-- Same venue, one level deep. SECURITY DEFINER so the check reads both
-- pitch rows whatever the caller may see — it returns nothing but a
-- refusal, and the venue match IS the security property.
CREATE OR REPLACE FUNCTION public.tg_pitch_components_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent_venue uuid;
  v_child_venue  uuid;
BEGIN
  SELECT venue_id INTO v_parent_venue FROM public.pitches WHERE id = NEW.parent_pitch_id;
  SELECT venue_id INTO v_child_venue  FROM public.pitches WHERE id = NEW.child_pitch_id;

  IF v_parent_venue IS NULL OR v_child_venue IS NULL OR v_parent_venue <> v_child_venue THEN
    RAISE EXCEPTION 'COMPOSITE_VENUE_MISMATCH: a pitch can only be made of pitches at its own venue'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.pitch_components WHERE parent_pitch_id = NEW.child_pitch_id) THEN
    RAISE EXCEPTION 'COMPOSITE_NESTING: a composite pitch cannot be a member of another'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.pitch_components WHERE child_pitch_id = NEW.parent_pitch_id) THEN
    RAISE EXCEPTION 'COMPOSITE_NESTING: a member pitch cannot itself be made of others'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_pitch_components_guard
  BEFORE INSERT OR UPDATE ON public.pitch_components
  FOR EACH ROW EXECUTE FUNCTION public.tg_pitch_components_guard();

-- ────────────────────────────────────────────────────────────────────
-- Units and blockers
-- ────────────────────────────────────────────────────────────────────
-- The physical surfaces a pitch occupies: its children if it has any,
-- else itself.
CREATE OR REPLACE FUNCTION public.pitch_units(p_pitch_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.child_pitch_id
  FROM public.pitch_components AS c
  WHERE c.parent_pitch_id = p_pitch_id
  UNION ALL
  SELECT p_pitch_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pitch_components AS c WHERE c.parent_pitch_id = p_pitch_id
  );
$$;

-- Every pitch whose bookings block this one: itself, its units, and any
-- composite that shares a unit with it. For a leaf with no parent this
-- is just {self}; for a leaf under a 7v7 it is {self, the 7v7}; for the
-- 7v7 it is {the 7v7, both halves, any other composite over either half}.
CREATE OR REPLACE FUNCTION public.pitch_blockers(p_pitch_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH units AS (
    SELECT u AS unit FROM public.pitch_units(p_pitch_id) AS u
  )
  SELECT DISTINCT q
  FROM (
    SELECT p_pitch_id AS q
    UNION ALL
    SELECT u.unit FROM units AS u
    UNION ALL
    SELECT c.parent_pitch_id
    FROM units AS u
    INNER JOIN public.pitch_components AS c ON c.child_pitch_id = u.unit
  ) AS s;
$$;

COMMENT ON FUNCTION public.pitch_blockers(uuid) IS
  'Pitches whose active bookings occupy a unit this pitch needs. The one '
  'predicate availability and the schedule guards share.';

-- ────────────────────────────────────────────────────────────────────
-- The guard on bookings
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_bookings_composite_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unit  uuid;
  v_range tstzrange;
BEGIN
  IF NEW.state NOT IN ('pending', 'collecting', 'paid', 'confirmed', 'completed') THEN
    RETURN NEW;
  END IF;

  -- A pitch that takes part in no composition is fully covered by the
  -- EXCLUDE constraint; don't pay for a lock it doesn't need.
  IF NOT EXISTS (
    SELECT 1 FROM public.pitch_components AS c
    WHERE c.parent_pitch_id = NEW.pitch_id OR c.child_pitch_id = NEW.pitch_id
  ) THEN
    RETURN NEW;
  END IF;

  -- Serialise on the physical units, in a fixed order so two writers
  -- locking overlapping sets cannot deadlock.
  FOR v_unit IN
    SELECT u FROM public.pitch_units(NEW.pitch_id) AS u ORDER BY u
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_unit::text, 0));
  END LOOP;

  -- time_range is a stored generated column and is not populated yet in
  -- a BEFORE trigger; build the same half-open range by hand.
  v_range := tstzrange(NEW.starts_at, NEW.ends_at, '[)');

  -- Same-pitch overlap is the EXCLUDE's job; this checks the OTHER pitches
  -- that share a unit.
  IF EXISTS (
    SELECT 1
    FROM public.bookings AS b
    WHERE
      b.id <> NEW.id
      AND b.pitch_id <> NEW.pitch_id
      AND b.pitch_id IN (SELECT public.pitch_blockers(NEW.pitch_id))
      AND b.state IN ('pending', 'collecting', 'paid', 'confirmed', 'completed')
      AND b.time_range && v_range
  ) THEN
    RAISE EXCEPTION 'COMPOSITE_SLOT_TAKEN: a pitch sharing this surface is booked for that time'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_bookings_composite_guard
  BEFORE INSERT OR UPDATE OF pitch_id, starts_at, ends_at, state ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_bookings_composite_guard();

-- ────────────────────────────────────────────────────────────────────
-- is_pitch_bookable — a composite with an inactive member is not
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_pitch_bookable(p_pitch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pitches AS p
    INNER JOIN public.venues AS v ON v.id = p.venue_id
    WHERE p.id = p_pitch_id
      AND p.is_verified
      AND p.is_active
      AND v.is_active
      AND v.stripe_account_status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM public.pitch_components AS c
        INNER JOIN public.pitches AS ch ON ch.id = c.child_pitch_id
        WHERE c.parent_pitch_id = p.id
          AND NOT ch.is_active
      )
  );
$$;

-- ────────────────────────────────────────────────────────────────────
-- get_available_slots — subtract every blocker's bookings
-- ────────────────────────────────────────────────────────────────────
-- Identical to 20260830000001 except the one predicate: `b.pitch_id =
-- p_pitch_id` becomes `b.pitch_id IN (pitch_blockers(p_pitch_id))`.
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
  v_venue_tz       constant text := 'Europe/Nicosia';
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
    SELECT
      d::date                       AS the_date,
      EXTRACT(DOW FROM d)::smallint AS dow
    FROM generate_series(p_start_date, p_end_date, '1 day'::interval) AS d
  ),

  override_windows AS (
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
    SELECT
      dw.slot_duration_minutes,
      slot_start
    FROM day_windows AS dw
    CROSS JOIN LATERAL generate_series(
      (dw.the_date + dw.opens_at) AT TIME ZONE v_venue_tz,
      (dw.the_date + dw.closes_at) AT TIME ZONE v_venue_tz
        - make_interval(mins => dw.slot_duration_minutes),
      make_interval(mins => dw.slot_duration_minutes)
    ) AS slot_start
  ),

  blockers AS (
    SELECT b AS pitch_id FROM public.pitch_blockers(p_pitch_id) AS b
  )

  SELECT
    ss.slot_start AS starts_at,
    ss.slot_start + make_interval(mins => ss.slot_duration_minutes) AS ends_at,
    (ss.slot_start > now())
    AND NOT EXISTS (
      SELECT 1
      FROM public.bookings AS b
      WHERE
        b.pitch_id IN (SELECT bl.pitch_id FROM blockers AS bl)
        AND b.state IN ('pending', 'paid', 'confirmed', 'completed', 'collecting')
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

-- ────────────────────────────────────────────────────────────────────
-- Schedule guards — a closure strands the composite's bookings too
-- ────────────────────────────────────────────────────────────────────
-- Identical to 20260822000005 except the predicate. bookings_outside_window
-- and bookings_stranded_by_override_change read bookings_on_date and so
-- inherit it.
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
    b.pitch_id IN (SELECT public.pitch_blockers(p_pitch_id))
    AND b.state IN ('pending', 'paid', 'confirmed')
    AND b.ends_at > now()
    AND b.time_range && tstzrange(
      (p_date + time '00:00') AT TIME ZONE 'Europe/Nicosia',
      ((p_date + 1) + time '00:00') AT TIME ZONE 'Europe/Nicosia',
      '[)'
    )
  ORDER BY b.starts_at;
$$;

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
  -- Body from 20260913000005 (skips dates an exception replaces, counts
  -- collecting fixtures) with the blockers predicate.
  WITH blockers AS (
    SELECT b AS pitch_id FROM public.pitch_blockers(p_pitch_id) AS b
  ),
  horizon AS (
    SELECT max(b.starts_at) AS last_start
    FROM public.bookings AS b
    WHERE
      b.pitch_id IN (SELECT bl.pitch_id FROM blockers AS bl)
      AND b.state IN ('pending', 'paid', 'confirmed', 'collecting')
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.pitch_schedule_overrides AS o
        WHERE o.pitch_id = p_pitch_id
          AND o.override_date = d::date
      )
  )
  SELECT DISTINCT b.id, b.code, b.starts_at, b.ends_at, b.state
  FROM dates AS dt
  INNER JOIN public.bookings AS b
    ON
      b.pitch_id IN (SELECT bl.pitch_id FROM blockers AS bl)
      AND b.state IN ('pending', 'paid', 'confirmed', 'collecting')
      AND b.ends_at > now()
      AND b.time_range && tstzrange(
        (dt.the_date + p_opens_at)  AT TIME ZONE 'Europe/Nicosia',
        (dt.the_date + p_closes_at) AT TIME ZONE 'Europe/Nicosia',
        '[)'
      )
  ORDER BY b.starts_at;
$$;

-- ────────────────────────────────────────────────────────────────────
-- RLS — readable wherever the parent is; written by its venue
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.pitch_components ENABLE ROW LEVEL SECURITY;

-- The subquery runs under the caller's own pitches policy, so anon sees
-- the make-up of bookable pitches only, and an owner sees their own.
CREATE POLICY pitch_components_select_with_parent ON public.pitch_components
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.pitches AS p WHERE p.id = parent_pitch_id)
  );

CREATE POLICY pitch_components_owner_or_admin_insert ON public.pitch_components
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_venue_owner_of_pitch(parent_pitch_id) OR public.is_admin());

CREATE POLICY pitch_components_owner_or_admin_delete ON public.pitch_components
  FOR DELETE
  TO authenticated
  USING (public.is_venue_owner_of_pitch(parent_pitch_id) OR public.is_admin());

GRANT SELECT ON public.pitch_components TO anon, authenticated;
GRANT INSERT, DELETE ON public.pitch_components TO authenticated;
GRANT EXECUTE ON FUNCTION public.pitch_units(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pitch_blockers(uuid) TO anon, authenticated;
