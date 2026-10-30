-- 20260912000001_walk_ins_carry_no_fee.sql
-- Ludi takes no fee on bookings it did not bring.
--
-- Why: founder decision 2026-09-12 (docs/plans/venue-offer.md, decision 2).
-- Until now a walk-in carried a commission "owed, not collected": the
-- take rate landed on bookings.platform_fee_cents and on the offline
-- payments row's application_fee_cents, and v_venue_earnings_daily
-- subtracted it from the owner's venue_net. The venue agreement never
-- charged it (clauses 1 and 6: commission is due on Bookings made through
-- the Platform), and nothing ever collected it, so the owner dashboard has
-- been under-reporting every venue's takings by 10% of its walk-ins.
--
-- The rule is made structural rather than left to the Edge Function: a
-- walk-in booking and an offline payment can no longer carry a fee at all.
-- v_venue_earnings_daily needs no change; its offline_fee_cents column
-- simply reads 0 from here on.
--
-- Deploy order: create-walk-in-booking FIRST (it now writes 0), then this
-- migration. The old function would trip the new CHECKs on every walk-in.

-- 1. Backfill: every existing walk-in and offline payment to a zero fee.
UPDATE public.payments
SET application_fee_cents = 0
WHERE payment_method = 'offline'
  AND application_fee_cents <> 0;

UPDATE public.bookings
SET platform_fee_cents = 0
WHERE origin = 'walk_in'
  AND platform_fee_cents <> 0;

-- 2. The rule, in the schema.
ALTER TABLE public.payments
  ADD CONSTRAINT payments_offline_no_fee
  CHECK (payment_method <> 'offline' OR application_fee_cents = 0);

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_walk_in_no_fee
  CHECK (origin <> 'walk_in' OR platform_fee_cents = 0);

-- 3. The comments that said otherwise.
COMMENT ON COLUMN public.payments.payment_method IS
  'stripe: money moved through the platform. offline: cash/card taken at '
  'the venue for a walk-in, recorded so earnings are complete. Offline rows '
  'carry no Ludi fee (payments_offline_no_fee, 20260912000001).';

COMMENT ON VIEW public.v_venue_earnings_daily IS
  'Venue-dimensioned daily earnings for the owner dashboard (M6 #41g/#41j, '
  'ADR-0027). Definer-rights view with its own caller predicate. '
  'gross/fee/venue_net span both payment methods; offline_gross_cents '
  'carves out the walk-in share. offline_fee_cents is always 0 since '
  '20260912000001: Ludi takes no fee on walk-ins. Split fixtures count at '
  'booking grain, only once bookings.stripe_transfer_id exists, with fee = '
  'platform_fee_cents scaled by the un-refunded fraction; a collecting '
  'fixture is not venue revenue.';
