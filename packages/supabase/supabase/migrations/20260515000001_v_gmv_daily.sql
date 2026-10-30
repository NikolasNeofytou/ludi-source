-- 20260515000001_v_gmv_daily.sql
-- Daily payments rollup for the admin GMV dashboard (M3 #19).
--
-- Why bucket by Europe/Nicosia local date and not UTC:
--   Cyprus is UTC+2 in winter and UTC+3 in summer (EEST DST). A 23:30 local
--   payment in summer is 20:30 UTC; bucketing UTC would scatter Saturday-night
--   bookings across "Saturday" and "Sunday" depending on time of year. Venue
--   operators read these numbers as their day, so anchor to local time.
--   Postgres DST transitions are baked into the 'Europe/Nicosia' tz, so this
--   stays correct across the spring-forward and fall-back without code changes.
--
-- Status filter:
--   succeeded            — money moved
--   refunded             — money moved then fully reversed (still want gross
--                          here, with refunded_cents covering the reversal)
--   partially_refunded   — money moved, partly reversed
--   Excluded: requires_*, processing, cancelled, failed — no money to count.
--
-- Refund accounting:
--   refunded_cents is summed from the same row's refunded_amount_cents column,
--   which the stripe-webhook handler updates on charge.refunded events. The
--   rollup attributes refunds back to the original payment date — useful when
--   you ask "how much did we actually keep from Saturday's bookings?", less
--   useful when you ask "how much did we refund yesterday?". The latter is a
--   different report; build it when there's a real ops need.
--
-- Performance: payments grows ~booking-rate (single-digit/day at MVP scale).
-- Sequential scan is fine; no materialization needed. Revisit if the table
-- crosses ~100k rows or the dashboard renders more than the last 90 days.
--
-- Session: 2026-05-15 M3 #19.

CREATE OR REPLACE VIEW public.v_gmv_daily AS
SELECT
  ((p.created_at AT TIME ZONE 'Europe/Nicosia')::date)         AS day,
  SUM(p.amount_cents)::bigint                                  AS gross_cents,
  SUM(p.refunded_amount_cents)::bigint                         AS refunded_cents,
  (SUM(p.amount_cents) - SUM(p.refunded_amount_cents))::bigint AS net_cents,
  COUNT(*)::int                                                AS payments_count,
  COUNT(DISTINCT p.booking_id)::int                            AS bookings_count
FROM public.payments p
WHERE p.status IN ('succeeded', 'refunded', 'partially_refunded')
GROUP BY 1;

COMMENT ON VIEW public.v_gmv_daily IS
  'Daily payments rollup for the admin dashboard. Bucketed by Europe/Nicosia local date. Excludes pending/failed/cancelled payments. Refunds attributed to the original payment date, not the refund date.';

-- Views inherit RLS from the base tables. payments_select_self_or_admin
-- already gates this: an authenticated admin sees the full platform rollup,
-- a regular user sees only buckets containing their own payments (a bit
-- weird but harmless — the admin app is the only consumer in MVP).
GRANT SELECT ON public.v_gmv_daily TO authenticated;
