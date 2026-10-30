-- 20260913000002_refund_scales_commission.sql
-- A refunded app booking carries commission only on what the venue kept.
--
-- The agreement (clause 6.4): "No Commission is payable on Bookings that
-- are fully refunded… Where a cancellation charge… is retained by the
-- Venue Owner, the Commission applies to the amount retained." The venue
-- offer says the same ("nothing on full refunds").
--
-- Stripe side (fixed in the same change): single-payer refunds now pass
-- refund_application_fee alongside reverse_transfer. A destination charge
-- with application_fee_amount transfers the FULL amount to the venue, so a
-- bare reverse_transfer pulled the whole refund out of the venue while
-- Ludi kept its whole fee — measured in test mode on €43 / 10% refunded
-- 50%: venue 1720 / Ludi 430, against the contract's 1935 / 215. With the
-- fee refunded pro-rata Stripe lands exactly on 1935 / 215.
--
-- This view: non-split rows reported payments.application_fee_cents — the
-- fee at booking — however much was refunded, so the owner's Earnings page
-- would still show the full 10% on a refunded booking. They now use the
-- same un-refunded-fraction scaling split fixtures already use. Stripe
-- rounds its pro-rata fee refund independently, so a row can differ from
-- the Stripe ledger by a cent. Walk-ins (offline) carry a zero fee and
-- stay zero. Everything else is 20260831000001 verbatim.
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
  WHERE (public.is_venue_owner_of_venue(v.id) OR public.is_admin())
  GROUP BY v.id, v.name, r.day;

COMMENT ON VIEW public.v_venue_earnings_daily IS
  'Venue-dimensioned daily earnings for the owner dashboard (M6 #41g/#41j, '
  'ADR-0027). Definer-rights view with its own caller predicate. '
  'gross/fee/venue_net span both payment methods; offline_gross_cents/'
  'offline_fee_cents carve out the walk-in share (offline fee is commission '
  'OWED, not collected). Commission is charged only on what the venue kept '
  '(agreement clause 6.4): every row''s fee is scaled by its un-refunded '
  'fraction — per payment for single-payer bookings, at booking grain from '
  'platform_fee_cents for split fixtures, which count only once '
  'bookings.stripe_transfer_id exists (a collecting fixture is not venue '
  'revenue).';
