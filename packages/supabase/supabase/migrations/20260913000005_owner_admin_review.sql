-- 20260913000005_owner_admin_review.sql
-- Owner web-app review, 2026-09-13. Four database-side fixes:
--
--   1. venues' commercial columns were world-readable.
--   2. Platform GMV counted walk-in cash as money through Ludi.
--   3. The weekly-hours stranding check refused changes on dates an
--      exception already covers.
--   4. That stranding check lived only in the admin app; the database now
--      refuses a schedule change that would strand a booking, too.

-- ════════════════════════════════════════════════════════════════════
-- 1. venues — commission, Stripe account and contacts are not public
-- ════════════════════════════════════════════════════════════════════
-- venues_select_public_or_owner_or_admin filters ROWS: any active venue is
-- readable by anon, which is right for its name, address and pin. But RLS
-- has no column dimension, so the same policy handed anyone holding the
-- public anon key every active venue's take_rate_bps and stripe_account_id
-- (proven against prod 2026-09-13), and would do the same for
-- contact_phone / contact_email the moment an owner fills them in.
--
-- Column privileges close it: anon and authenticated keep SELECT on every
-- other column and lose it on these four. Admins and owners are
-- `authenticated` too, so they read the four through v_venue_private
-- below — ADR-0013 shape, definer rights with the caller predicate inside.
--
-- UPDATE is untouched: owners still edit their contacts, the privileged
-- columns stay guarded by tg_venues_block_privileged_columns. Edge
-- Functions connect as service_role and are unaffected. Supabase applies
-- its default table grants at CREATE time, so this REVOKE is the last word
-- in production (the CI stub re-grants blanket SELECT in
-- tests/rls/_bootstrap.sql, which restates this block).
--
-- lat / lng first. They were PostgREST computed columns —
-- public.lat(venues) / public.lng(venues), 20260822000004 — and PostgREST
-- calls those with the WHOLE ROW, which Postgres only permits a caller who
-- can SELECT every column. Revoking any column would therefore have broken
-- every `lat, lng` read, the player app's pitch list included (proven on
-- the pgtap database: "permission denied for table venues"). As stored
-- generated columns they are ordinary columns, granted like the rest; the
-- API shape (`select=lat,lng`) is unchanged.
ALTER TABLE public.venues
  ADD COLUMN lat double precision
    GENERATED ALWAYS AS (ST_Y(coords::geometry)) STORED,
  ADD COLUMN lng double precision
    GENERATED ALWAYS AS (ST_X(coords::geometry)) STORED;

COMMENT ON COLUMN public.venues.lat IS
  'Latitude as a number, generated from coords (the geography column '
  'serialises as hex EWKB). Replaced the lat(venues) computed column.';
COMMENT ON COLUMN public.venues.lng IS
  'Longitude as a number, generated from coords. PostGIS X is longitude — '
  'the reverse of how humans say it.';

DROP FUNCTION public.lat(public.venues);
DROP FUNCTION public.lng(public.venues);

REVOKE SELECT ON public.venues FROM anon, authenticated;
GRANT SELECT (
  id,
  name,
  address,
  city_id,
  coords,
  lat,
  lng,
  stripe_account_status,
  cancellation_policy,
  is_active,
  created_at,
  updated_at
) ON public.venues TO anon, authenticated;

CREATE VIEW public.v_venue_private
WITH (security_invoker = off, security_barrier = TRUE) AS
SELECT
  v.id AS venue_id,
  v.contact_phone,
  v.contact_email,
  v.stripe_account_id,
  v.take_rate_bps
FROM public.venues AS v
WHERE public.is_admin() OR public.is_venue_owner_of_venue(v.id);

COMMENT ON VIEW public.v_venue_private IS
  'The venues columns that are not public: contacts, Stripe account id, '
  'take rate. Rows for venues the caller owns or manages, every row for an '
  'admin, nothing otherwise. Definer rights (security_invoker = off) with '
  'the caller predicate inside, per ADR-0013 — the base columns are '
  'revoked from anon/authenticated (20260913000005).';

-- Read-only, and it must be said out loud. A one-table view with no
-- aggregates is auto-updatable, Supabase's default privileges hand
-- `authenticated` INSERT/UPDATE/DELETE on every new relation, and a
-- definer-rights view writes to venues as its owner — past RLS. Left at
-- the defaults, `DELETE /rest/v1/v_venue_private?venue_id=eq.…` let any
-- owner or manager delete their venue and cascade its courts and hours
-- (found in review before this shipped). security_barrier keeps a
-- caller's own WHERE clause from being evaluated ahead of the view's
-- ownership filter.
REVOKE ALL ON public.v_venue_private FROM public, anon, authenticated;
GRANT SELECT ON public.v_venue_private TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2. v_gmv_daily — money through Ludi only
-- ════════════════════════════════════════════════════════════════════
-- Walk-ins (20260829000001) write an offline payments row so the owner's
-- earnings include them. The platform rollup read the same table and so
-- counted a venue's counter cash as Ludi GMV: €300 of walk-ins moved
-- /gmv's gross by €300. The venue's earnings view keeps its online/offline
-- split; the platform view counts Stripe money only. Otherwise
-- byte-identical to 20260828000001.
CREATE OR REPLACE VIEW public.v_gmv_daily
WITH (security_invoker = on) AS
SELECT
  ((p.created_at AT TIME ZONE 'Europe/Nicosia')::date)         AS day,
  SUM(p.amount_cents)::bigint                                  AS gross_cents,
  SUM(p.refunded_amount_cents)::bigint                         AS refunded_cents,
  (SUM(p.amount_cents) - SUM(p.refunded_amount_cents))::bigint AS net_cents,
  COUNT(*)::int                                                AS payments_count,
  COUNT(DISTINCT p.booking_id)::int                            AS bookings_count
FROM public.payments p
WHERE p.status IN ('succeeded', 'refunded', 'partially_refunded')
  AND p.payment_method = 'stripe'
GROUP BY 1;

COMMENT ON VIEW public.v_gmv_daily IS
  'Daily rollup of money paid through Ludi (Stripe payments only — walk-in '
  'cash is the venue''s, see v_venue_earnings_daily). Bucketed by '
  'Europe/Nicosia local date. Excludes pending/failed/cancelled payments. '
  'Refunds attributed to the original payment date. security_invoker=on: '
  'payments RLS applies — admin sees all, a player only their own buckets.';

-- ════════════════════════════════════════════════════════════════════
-- 3. bookings_in_weekly_window — skip dates an exception replaces
-- ════════════════════════════════════════════════════════════════════
-- An exception replaces the day's weekly hours (20260822000001;
-- get_available_slots and bookings_stranded_by_override_change both model
-- it that way). This function still counted bookings on such dates as
-- living in the weekly window, so a booking inside a Saturday-the-20th
-- special-hours exception blocked editing the regular Saturday window —
-- which does not apply on the 20th at all. Those dates are now skipped;
-- everything else is byte-identical to 20260830000001.
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

-- ════════════════════════════════════════════════════════════════════
-- 4. The stranding rule, enforced by the database
-- ════════════════════════════════════════════════════════════════════
-- The schedule editor asks bookings_in_weekly_window /
-- bookings_stranded_by_override_change before every change and refuses
-- with a readable list. That check ran only in the app: an owner's session
-- token could DELETE a pitch_schedules row straight through PostgREST and
-- leave paid bookings on a closed pitch, and the check-then-write gap let
-- a booking landing in between be stranded by an honest edit.
--
-- These triggers ask the same functions, in the same transaction as the
-- write. The app's pre-check still runs first and still gives the good
-- message; the trigger is the backstop. SECURITY INVOKER, so the caller's
-- RLS applies exactly as it does to the app's check — and service_role
-- (no RLS) sees every booking, which is the strictest reading.
--
-- Weekly rows: a DELETE strands whatever the window held; an UPDATE
-- strands only the slivers it gives up — the same "removed parts only"
-- rule updateScheduleWindow applies — unless it moves the window to
-- another pitch or day, which gives up all of it.
CREATE OR REPLACE FUNCTION public.tg_pitch_schedules_no_stranding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hit boolean := FALSE;
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW.pitch_id IS DISTINCT FROM OLD.pitch_id
     OR NEW.day_of_week IS DISTINCT FROM OLD.day_of_week THEN
    SELECT EXISTS (
      SELECT 1 FROM public.bookings_in_weekly_window(
        OLD.pitch_id, OLD.day_of_week, OLD.opens_at, OLD.closes_at
      )
    ) INTO v_hit;
  ELSE
    IF NEW.opens_at > OLD.opens_at THEN
      SELECT EXISTS (
        SELECT 1 FROM public.bookings_in_weekly_window(
          OLD.pitch_id, OLD.day_of_week, OLD.opens_at, NEW.opens_at
        )
      ) INTO v_hit;
    END IF;
    IF NOT v_hit AND NEW.closes_at < OLD.closes_at THEN
      SELECT EXISTS (
        SELECT 1 FROM public.bookings_in_weekly_window(
          OLD.pitch_id, OLD.day_of_week, NEW.closes_at, OLD.closes_at
        )
      ) INTO v_hit;
    END IF;
  END IF;

  IF v_hit THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'SCHEDULE_CHANGE_STRANDS_BOOKINGS: this change would leave '
                'existing bookings outside the pitch''s opening hours',
      HINT = 'Cancel or move those bookings first.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_pitch_schedules_no_stranding
BEFORE UPDATE OR DELETE ON public.pitch_schedules
FOR EACH ROW EXECUTE FUNCTION public.tg_pitch_schedules_no_stranding();

-- Exception rows: judged by the day's hours afterwards, exactly as the
-- editor judges them (20260913000004). INSERT adds a row, DELETE removes
-- one, UPDATE is remove-then-add — split across two dates if it moves.
CREATE OR REPLACE FUNCTION public.tg_pitch_overrides_no_stranding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hit boolean := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.bookings_stranded_by_override_change(
        NEW.pitch_id, NEW.override_date, NULL,
        NEW.is_closed, NEW.opens_at, NEW.closes_at
      )
    ) INTO v_hit;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.bookings_stranded_by_override_change(
        OLD.pitch_id, OLD.override_date, OLD.id
      )
    ) INTO v_hit;
  ELSIF NEW.pitch_id = OLD.pitch_id
        AND NEW.override_date = OLD.override_date THEN
    SELECT EXISTS (
      SELECT 1 FROM public.bookings_stranded_by_override_change(
        NEW.pitch_id, NEW.override_date, OLD.id,
        NEW.is_closed, NEW.opens_at, NEW.closes_at
      )
    ) INTO v_hit;
  ELSE
    SELECT
      EXISTS (
        SELECT 1 FROM public.bookings_stranded_by_override_change(
          OLD.pitch_id, OLD.override_date, OLD.id
        )
      )
      OR EXISTS (
        SELECT 1 FROM public.bookings_stranded_by_override_change(
          NEW.pitch_id, NEW.override_date, NULL,
          NEW.is_closed, NEW.opens_at, NEW.closes_at
        )
      )
    INTO v_hit;
  END IF;

  IF v_hit THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'SCHEDULE_CHANGE_STRANDS_BOOKINGS: this change would leave '
                'existing bookings outside the pitch''s opening hours',
      HINT = 'Cancel or move those bookings first.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_pitch_overrides_no_stranding
BEFORE INSERT OR UPDATE OR DELETE ON public.pitch_schedule_overrides
FOR EACH ROW EXECUTE FUNCTION public.tg_pitch_overrides_no_stranding();
