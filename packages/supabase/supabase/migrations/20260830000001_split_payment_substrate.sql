-- 20260830000001_split_payment_substrate.sql
-- C2 W2 - the schema split payment stands on (docs/plans/split-payment.md,
-- ADR-0026, ADR-0027). Four things happen here, and nothing moves money yet:
--
--   1. bookings learns the 'collecting' state - the anchor decision made
--      real: a split fixture holds its slot on the organiser's own paid
--      share while the invite collects the rest. The state joins the CHECK,
--      the EXCLUDE predicate, and every function that enumerates
--      slot-holding states (the fifteen-site census in
--      docs/spikes/scheduled-edge-function.md; this migration closes the
--      database rows, W3-W6 close the functions and clients against it).
--   2. bookings gains is_split / share_amount_cents / collect_deadline,
--      frozen at creation like gk_slots (a pitch edit must not reshape
--      live money).
--   3. payments gains kind ('booking'|'share'|'cover') and participant_id.
--      A share IS a payments row - FUTURE.md's parked instinct, kept. Who
--      owes is derived from the roster, never stored.
--   4. join_fixture refuses split fixtures that are not yet confirmed;
--      claim-share (W3) is the paid door.
--
-- Deliberately NOT here: pg_net (W4 creates it, with the pg_cron-style
-- availability guard), the claim-share/expire-collecting functions (W3/W4),
-- and any change to cleanup_stale_pending_bookings - it sweeps only
-- state='pending' by construction, and test 18 pins that.

-- ────────────────────────────────────────────────────────────────────
-- 1. bookings: the collecting state
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  DROP CONSTRAINT bookings_state_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_state_check CHECK (state IN (
    'pending','collecting','paid','confirmed','completed',
    'cancelled','refunded','refunded_by_admin','cancelled_no_refund'
  ));

-- The EXCLUDE predicate is the anchor decision: 'collecting' holds the
-- slot. (Third edition of this constraint: initial schema, then 000007
-- added 'pending', now 'collecting'.)
ALTER TABLE public.bookings
  DROP CONSTRAINT bookings_pitch_id_time_range_excl;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_pitch_id_time_range_excl
  EXCLUDE USING gist (
    pitch_id   WITH =,
    time_range WITH &&
  ) WHERE (state IN ('pending','collecting','paid','confirmed','completed'));

COMMENT ON CONSTRAINT bookings_pitch_id_time_range_excl ON public.bookings IS
  'Double-booking prevention. pending holds for ~15 min '
  '(cleanup_stale_pending_bookings); collecting holds until '
  'collect_deadline (expire-collecting, C2 W4); paid/confirmed/completed '
  'hold outright.';

-- ────────────────────────────────────────────────────────────────────
-- 2. bookings: the split columns, frozen at creation
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN is_split           boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN share_amount_cents int     CHECK (share_amount_cents > 0),
  ADD COLUMN collect_deadline   timestamptz;

-- The pair travels together, and 'collecting' is meaningless off a split
-- booking. share_amount_cents is the ordinary per-head; the organiser's
-- share absorbs the rounding remainder upward (share-math.ts — floor, not
-- ceil: ceil's nicer-looking downward absorption goes negative on totals
-- small relative to the squad).
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_split_shape CHECK (
    (is_split = (share_amount_cents IS NOT NULL))
    AND (is_split = (collect_deadline IS NOT NULL))
    AND (state <> 'collecting' OR is_split)
  );

-- The W4 sweeper's scan: collecting rows by deadline, nothing else.
CREATE INDEX bookings_collecting_deadline_idx
  ON public.bookings (collect_deadline)
  WHERE state = 'collecting';

COMMENT ON COLUMN public.bookings.share_amount_cents IS
  'Per-head share, frozen at creation (floor(total/slots)); the organiser '
  'pays total - share*(slots-1), absorbing the rounding remainder upward. '
  'NULL unless is_split.';
COMMENT ON COLUMN public.bookings.collect_deadline IS
  'When all shares must be in: kickoff - 24h (compressed for late '
  'bookings, C2 W3). At deadline the organiser has 2h to cover or the '
  'fixture cancels with 100% share refunds (expire-collecting, W4).';

-- ────────────────────────────────────────────────────────────────────
-- 3. payments: a share is a payment with a participant attached
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN participant_id uuid REFERENCES public.booking_participants(id)
                                 ON DELETE RESTRICT,
  ADD COLUMN kind text NOT NULL DEFAULT 'booking'
                       CHECK (kind IN ('booking','share','cover'));

-- booking-kind rows are the single-PI path and carry no participant;
-- share/cover rows always do (cover points at the organiser's row).
ALTER TABLE public.payments
  ADD CONSTRAINT payments_kind_participant CHECK (
    (kind = 'booking') = (participant_id IS NULL)
  );

-- One LIVE share per participant. 'refunded' does not block: leaving
-- refunds the share, and rejoining creates a fresh one
-- (leave-rejoin-repay - test 18 walks it).
CREATE UNIQUE INDEX payments_one_live_share_per_participant
  ON public.payments (participant_id)
  WHERE kind = 'share' AND status NOT IN ('cancelled','failed','refunded');

CREATE INDEX payments_participant_idx ON public.payments (participant_id)
  WHERE participant_id IS NOT NULL;

-- A share payer may read their own share row. The existing
-- payments_select_self_or_admin covers the organiser (via the booking);
-- this covers the teammate who paid. Writes stay service-role only.
CREATE POLICY payments_select_share_payer ON public.payments
  FOR SELECT USING (
    participant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.booking_participants bp
      WHERE bp.id = payments.participant_id
        AND bp.user_id = auth.uid()
    )
  );

COMMENT ON COLUMN public.payments.kind IS
  'booking = the single-PI path (unchanged); share = one participant''s '
  'slice of a split fixture; cover = the organiser''s shortfall payment '
  'at the deadline (ADR-0027).';

-- ────────────────────────────────────────────────────────────────────
-- 4. Every function that enumerates slot-holding states, re-created
--    with 'collecting' - bodies verbatim from their source migrations,
--    one list changed each (plus join_fixture's split guard).
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
    AND b.state IN ('pending', 'paid', 'confirmed', 'collecting')
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
  WITH horizon AS (
    SELECT max(b.starts_at) AS last_start
    FROM public.bookings AS b
    WHERE
      b.pitch_id = p_pitch_id
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
  )
  SELECT DISTINCT b.id, b.code, b.starts_at, b.ends_at, b.state
  FROM dates AS dt
  INNER JOIN public.bookings AS b
    ON
      b.pitch_id = p_pitch_id
      AND b.state IN ('pending', 'paid', 'confirmed', 'collecting')
      AND b.ends_at > now()
      AND b.time_range && tstzrange(
        (dt.the_date + p_opens_at)  AT TIME ZONE 'Europe/Nicosia',
        (dt.the_date + p_closes_at) AT TIME ZONE 'Europe/Nicosia',
        '[)'
      )
  ORDER BY b.starts_at;
$$;

CREATE OR REPLACE FUNCTION public.fixture_preview(p_invite_token text)
RETURNS TABLE (
  -- Not PII, not the roster — the booking's own primary key. Safe to return
  -- pre-join because RLS still gates every read of v_fixture/v_fixture_roster
  -- by it; it only lets the client route to /booking/<id> after joining
  -- rather than needing a second round trip to resolve one.
  booking_id       uuid,
  starts_at        timestamptz,
  ends_at          timestamptz,
  pitch_type       text,
  pitch_name       text,
  venue_name       text,
  city_name_en     text,
  city_name_gr     text,
  gk_open          int,
  outfield_open    int,
  joinable         boolean
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    b.id,
    b.starts_at,
    b.ends_at,
    p.type,
    p.name,
    v.name,
    c.name_en,
    c.name_gr,
    b.gk_slots       - (SELECT count(*) FROM public.booking_participants x
                         WHERE x.booking_id = b.id AND x.status = 'in'
                           AND x.slot_kind = 'gk')::int,
    b.outfield_slots - (SELECT count(*) FROM public.booking_participants x
                         WHERE x.booking_id = b.id AND x.status = 'in'
                           AND x.slot_kind = 'outfield')::int,
    (b.state IN ('pending','paid','confirmed','collecting') AND b.starts_at > now())
  FROM public.bookings b
  JOIN public.pitches  p ON p.id = b.pitch_id
  JOIN public.venues   v ON v.id = p.venue_id
  JOIN public.cities   c ON c.id = v.city_id
 WHERE b.invite_token = p_invite_token;
$$;

CREATE OR REPLACE FUNCTION public.join_fixture(
  p_invite_token text,
  p_slot_kind    text DEFAULT 'outfield'
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_id      uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'P0001';
  END IF;

  IF p_slot_kind NOT IN ('gk','outfield') THEN
    RAISE EXCEPTION 'INVALID_SLOT_KIND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_booking
    FROM public.bookings
   WHERE invite_token = p_invite_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_INVITE' USING ERRCODE = 'P0001';
  END IF;

  -- Split fixtures take money to join (ADR-0022's pre-drawn boundary,
  -- now load-bearing): the free RPC refuses them until they are
  -- confirmed. Post-confirmation the fixture is bought, and a
  -- replacement joining free is correct - settling with the leaver is
  -- not Ludi's business. claim-share (Edge Function, C2 W3) owns
  -- joining while money is still moving.
  IF v_booking.is_split AND v_booking.state <> 'confirmed' THEN
    RAISE EXCEPTION 'SPLIT_FIXTURE_REQUIRES_PAYMENT' USING ERRCODE = 'P0001';
  END IF;

  IF v_booking.state NOT IN ('pending','paid','confirmed') THEN
    RAISE EXCEPTION 'FIXTURE_CANCELLED' USING ERRCODE = 'P0001';
  END IF;

  IF v_booking.starts_at <= now() THEN
    RAISE EXCEPTION 'FIXTURE_STARTED' USING ERRCODE = 'P0001';
  END IF;

  -- Rejoining is the same row coming back, not a second one. Capacity is
  -- re-checked by the trigger on the way through, so someone who left a full
  -- fixture does not get their slot back automatically.
  UPDATE public.booking_participants
     SET status = 'in', slot_kind = p_slot_kind
   WHERE booking_id = v_booking.id
     AND user_id    = auth.uid()
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.booking_participants (booking_id, user_id, slot_kind)
  VALUES (v_booking.id, auth.uid(), p_slot_kind)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
