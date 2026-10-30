-- 20260831000001_split_fixture_earnings.sql
-- v_venue_earnings_daily learns what a split fixture actually pays.
--
-- The bug: every share/cover payments row is written with
-- application_fee_cents = 0 — correctly, because on the SCT path the fee
-- is implicit in the one venue Transfer of total − platform_fee_cents
-- (ADR-0027: "bookings.platform_fee_cents remains the ledger"). But the
-- view summed payments.application_fee_cents, so a confirmed split
-- fixture surfaced as "fee 0, venue_net = gross" while Stripe transferred
-- the smaller, correct amount. On a €45 fixture at 1000 bps the owner's
-- Earnings page overstated their money by €4.50, per fixture.
--
-- ADR-0027 also asserts the earnings views "must not count a collecting
-- fixture as venue revenue (already excluded by construction)". That was
-- not true: share rows are status 'succeeded' while the fixture is still
-- collecting, and the old view counted them. Both defects close here on
-- the boundary 20260830000004 built for exactly this question:
-- bookings.stripe_transfer_id — NULL means no money has reached the venue.
--
-- Shape of the fix: non-split rows (destination charges, walk-ins) keep
-- their per-payment semantics untouched. Split fixtures enter at booking
-- grain instead — only once the venue Transfer exists, dated the day the
-- last share settled (the money's day, not each share's). The effective
-- fee is platform_fee_cents scaled by the un-refunded fraction, which is
-- exactly what a pro-rata post-confirm cancellation leaves standing:
-- refund X% of the shares + reverse X% of the transfer means Ludi keeps
-- (1 − X%) of the fee.
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
      p.application_fee_cents::bigint                  AS fee_cents,
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
  WHERE (public.is_venue_owner_of_venue(v.id) OR public.is_admin())
  GROUP BY v.id, v.name, r.day;

COMMENT ON VIEW public.v_venue_earnings_daily IS
  'Venue-dimensioned daily earnings for the owner dashboard (M6 #41g/#41j, '
  'ADR-0027). Definer-rights view with its own caller predicate. '
  'gross/fee/venue_net span both payment methods; offline_gross_cents/'
  'offline_fee_cents carve out the walk-in share (offline fee is commission '
  'OWED, not collected). Split fixtures count at booking grain, only once '
  'bookings.stripe_transfer_id exists, with fee = platform_fee_cents scaled '
  'by the un-refunded fraction — a collecting fixture is not venue revenue.';
