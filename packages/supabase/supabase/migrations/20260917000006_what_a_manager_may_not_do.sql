-- ────────────────────────────────────────────────────────────────────
-- What a manager may not do
-- ────────────────────────────────────────────────────────────────────
-- Slice D of docs/plans/venue-staff.md, and the enforcement half of
-- ADR-0041: **a manager runs the day; an owner decides what the venue
-- is, what it charges, and sees what it earned.**
--
-- venue_owners.role has had two values since 20260421000003 and has
-- meant almost nothing. data-model.md scoped it — "everything an owner
-- does except the venue's money" — and exactly two Edge Functions
-- honoured it. Everywhere else the gate is is_venue_owner_of_venue(),
-- which matches on user_id and never reads role, so at the RLS boundary
-- a manager has always been an owner.
--
-- That was harmless while nobody could create a manager but the founder.
-- 20260917000005 (slice C) ended that: an owner adds his own staff now,
-- so the default is about to be load-bearing, and what it currently says
-- is that the person hired to stand at a counter reads Ludi's commission
-- off /earnings and may change what the venue charges.
--
-- Six objects move from owner-or-manager to owner-only. Everything a
-- manager needs in order to run a day is untouched: reading venues and
-- pitches (he must quote a price), schedules and overrides (a burst pipe
-- at 08:00 is his to act on), bookings, walk-ins, series, notes, and the
-- roster with ADR-0023's phone window.
--
-- is_venue_owner_of_venue() is deliberately NOT changed. It means "has
-- access to this venue", dozens of policies mean exactly that, and
-- redefining it would silently move all of them — including the ones
-- that would lock a manager out of the day. has_venue_role(venue, role)
-- from 20260917000004 is the role-aware one. Two functions with two
-- honest names beat one function with a changed meaning.

-- ────────────────────────────────────────────────────────────────────
-- 1. What the venue earned, and what Ludi took
-- ────────────────────────────────────────────────────────────────────
-- The sharpest of the six, and the one that decides whether staff
-- accounts get used at all. A venue that will not give the evening shift
-- a login BECAUSE the login shows the commission is a venue whose
-- workers keep using paper.
--
-- The view is definer-rights with its own caller predicate, so this is a
-- one-line change wearing a whole view body — the CREATE OR REPLACE VIEW
-- tax. Everything below is 20260913000002 verbatim except the WHERE.
CREATE OR REPLACE VIEW public.v_venue_earnings_daily
WITH (security_invoker = off) AS
  WITH split_fixtures AS (
    -- One row per split booking whose venue Transfer exists. Grouping by
    -- the booking keeps the fee arithmetic single-rounded and exact
    -- against what settle_split_booking transferred.
    SELECT
      b.pitch_id,
      b.id                                             AS booking_id,
      ((MAX(p.created_at) AT TIME ZONE 'Europe/Nicosia')::date)
                                                       AS day,
      SUM(p.amount_cents)::bigint                      AS gross_cents,
      SUM(p.refunded_amount_cents)::bigint             AS refunded_cents,
      ROUND(
        b.platform_fee_cents::numeric
          * (SUM(p.amount_cents) - SUM(p.refunded_amount_cents))
          / b.total_cents
      )::bigint                                        AS fee_cents,
      COUNT(*)::int                                    AS payments_count
    FROM public.payments p
    JOIN public.bookings b ON b.id = p.booking_id
    WHERE b.is_split
      AND b.stripe_transfer_id IS NOT NULL
      AND p.status IN ('succeeded', 'refunded', 'partially_refunded')
    GROUP BY b.id, b.pitch_id, b.platform_fee_cents, b.total_cents
  ),

  earning_rows AS (
    SELECT
      b.pitch_id,
      p.booking_id,
      ((p.created_at AT TIME ZONE 'Europe/Nicosia')::date) AS day,
      p.amount_cents::bigint                           AS gross_cents,
      p.refunded_amount_cents::bigint                  AS refunded_cents,
      COALESCE(ROUND(
        p.application_fee_cents::numeric
          * (p.amount_cents - p.refunded_amount_cents)
          / NULLIF(p.amount_cents, 0)
      ), 0)::bigint                                    AS fee_cents,
      1                                                AS payments_count,
      (p.payment_method = 'offline')                   AS is_offline
    FROM public.payments p
    JOIN public.bookings b ON b.id = p.booking_id
    WHERE NOT b.is_split
      AND p.status IN ('succeeded', 'refunded', 'partially_refunded')

    UNION ALL

    SELECT
      sf.pitch_id,
      sf.booking_id,
      sf.day,
      sf.gross_cents,
      sf.refunded_cents,
      sf.fee_cents,
      sf.payments_count,
      FALSE                                            AS is_offline
    FROM split_fixtures sf
  )

  SELECT
    v.id                                                          AS venue_id,
    v.name                                                        AS venue_name,
    r.day                                                         AS day,
    SUM(r.gross_cents)::bigint                                    AS gross_cents,
    SUM(r.refunded_cents)::bigint                                 AS refunded_cents,
    SUM(r.fee_cents)::bigint                                      AS fee_cents,
    (SUM(r.gross_cents) - SUM(r.refunded_cents))::bigint          AS net_cents,
    (SUM(r.gross_cents) - SUM(r.refunded_cents)
                        - SUM(r.fee_cents))::bigint               AS venue_net_cents,
    SUM(r.payments_count)::int                                    AS payments_count,
    COUNT(DISTINCT r.booking_id)::int                             AS bookings_count,
    COALESCE(SUM(r.gross_cents) FILTER (WHERE r.is_offline), 0)::bigint
                                                                  AS offline_gross_cents,
    COALESCE(SUM(r.fee_cents) FILTER (WHERE r.is_offline), 0)::bigint
                                                                  AS offline_fee_cents
  FROM earning_rows r
  JOIN public.pitches pt ON pt.id = r.pitch_id
  JOIN public.venues v ON v.id = pt.venue_id
  WHERE (public.has_venue_role(v.id, 'owner') OR public.is_admin())
  GROUP BY v.id, v.name, r.day;
COMMENT ON VIEW public.v_venue_earnings_daily IS
  'Venue-dimensioned daily earnings for the owner dashboard (M6 #41g/#41j, '
  'ADR-0027). OWNER-ONLY since ADR-0041 — a manager runs the day and does '
  'not see what the day earned. Definer-rights view with its own caller '
  'predicate. gross/fee/venue_net span both payment methods; '
  'offline_gross_cents/offline_fee_cents carve out the walk-in share '
  '(offline fee is commission OWED, not collected). Commission is charged '
  'only on what the venue kept (agreement clause 6.4): every row''s fee is '
  'scaled by its un-refunded fraction — per payment for single-payer '
  'bookings, at booking grain from platform_fee_cents for split fixtures, '
  'which count only once bookings.stripe_transfer_id exists (a collecting '
  'fixture is not venue revenue).';

-- ────────────────────────────────────────────────────────────────────
-- 2. What has been paid out
-- ────────────────────────────────────────────────────────────────────
-- The payouts mirror on /earnings. Same reasoning as the view above; the
-- Stripe Express dashboard behind it was already owner-only, so this
-- closes the half that was reachable without it.
DROP POLICY venue_payouts_select_owner_or_admin ON public.venue_payouts;

CREATE POLICY venue_payouts_select_owner_or_admin
  ON public.venue_payouts FOR SELECT
  USING (public.has_venue_role(venue_id, 'owner') OR public.is_admin());

-- ────────────────────────────────────────────────────────────────────
-- 3. The commercial terms
-- ────────────────────────────────────────────────────────────────────
-- v_venue_private exists (20260913000005) because those four columns had
-- been publicly readable. take_rate_bps is the commission rate itself, so
-- withholding /earnings while leaving this readable would be theatre.
--
-- Consequence worth stating: the Today page's setup checklist reads this
-- view, so it now returns nothing for a manager. The page skips the
-- checklist for them rather than rendering "not done" against steps that
-- are done — which is right anyway. Onboarding a venue is an owner's job.
CREATE OR REPLACE VIEW public.v_venue_private
WITH (security_invoker = off, security_barrier = TRUE) AS
SELECT
  v.id AS venue_id,
  v.contact_phone,
  v.contact_email,
  v.stripe_account_id,
  v.take_rate_bps
FROM public.venues AS v
WHERE public.is_admin() OR public.has_venue_role(v.id, 'owner');

COMMENT ON VIEW public.v_venue_private IS
  'The venues columns that are not public: contacts, Stripe account id, '
  'take rate. OWNER-ONLY since ADR-0041 — take_rate_bps is the commission '
  'rate, and a manager does not see what Ludi takes.';

-- ────────────────────────────────────────────────────────────────────
-- 4. What the venue is, and what a court is and costs
-- ────────────────────────────────────────────────────────────────────
-- Table-level rather than column-level on purpose. The house pattern for
-- "RLS is row-level and we need column-level" is a trigger
-- (tg_venues_block_privileged_columns, 20260822000003), and those
-- triggers stay — they guard what NO non-privileged writer may touch,
-- owner included. This is a different line: a manager may not edit these
-- rows at all, which a policy says more plainly than a trigger
-- enumerating columns.
--
-- SELECT is untouched on both. A manager must read a price to quote it
-- at the counter; he may not set it.
DROP POLICY venues_owner_or_admin_update ON public.venues;

CREATE POLICY venues_owner_or_admin_update ON public.venues
  FOR UPDATE
  TO authenticated
  USING (public.has_venue_role(id, 'owner') OR public.is_admin())
  WITH CHECK (public.has_venue_role(id, 'owner') OR public.is_admin());

DROP POLICY pitches_owner_or_admin_insert ON public.pitches;

CREATE POLICY pitches_owner_or_admin_insert ON public.pitches
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_venue_role(venue_id, 'owner') OR public.is_admin());

DROP POLICY pitches_owner_or_admin_update ON public.pitches;

CREATE POLICY pitches_owner_or_admin_update ON public.pitches
  FOR UPDATE
  TO authenticated
  USING (public.has_venue_role(venue_id, 'owner') OR public.is_admin())
  WITH CHECK (public.has_venue_role(venue_id, 'owner') OR public.is_admin());

-- ────────────────────────────────────────────────────────────────────
-- 5. What a composite court is made of
-- ────────────────────────────────────────────────────────────────────
-- pitch_components (20260915001, ADR-0032) says a 7v7 is these two
-- 5v5s. That is squarely "what a court is", so it belongs on the owner
-- side with the pitches policies above — and leaving it behind would
-- draw a line a manager could walk around: no editing the pitch row,
-- but free rein to restructure what the pitch is made of.
--
-- It keys on the PITCH, not the venue, so it needs the pitch-level
-- sibling of has_venue_role. Every other caller of
-- is_venue_owner_of_pitch() is the day — schedules, overrides, bookings,
-- the roster views, booking_notes, the owner audit vocabulary — and
-- stays exactly as it is.
CREATE OR REPLACE FUNCTION public.has_pitch_role(p_pitch_id uuid, p_role text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pitches AS p
    INNER JOIN public.venue_owners AS vo ON vo.venue_id = p.venue_id
    WHERE p.id = p_pitch_id
      AND vo.user_id = auth.uid()
      AND vo.role = p_role
  );
$$;

COMMENT ON FUNCTION public.has_pitch_role(uuid, text) IS
  'True if the caller holds exactly this venue_owners.role at the pitch''s '
  'venue. The role-aware counterpart of is_venue_owner_of_pitch(), which '
  'ignores role on purpose. ADR-0041.';

GRANT EXECUTE ON FUNCTION public.has_pitch_role(uuid, text) TO authenticated, service_role;

DROP POLICY pitch_components_owner_or_admin_insert ON public.pitch_components;

CREATE POLICY pitch_components_owner_or_admin_insert ON public.pitch_components
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_pitch_role(parent_pitch_id, 'owner') OR public.is_admin());

DROP POLICY pitch_components_owner_or_admin_delete ON public.pitch_components;

CREATE POLICY pitch_components_owner_or_admin_delete ON public.pitch_components
  FOR DELETE
  TO authenticated
  USING (public.has_pitch_role(parent_pitch_id, 'owner') OR public.is_admin());
