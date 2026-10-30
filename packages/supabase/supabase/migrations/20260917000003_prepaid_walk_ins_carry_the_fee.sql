-- 20260917000003_prepaid_walk_ins_carry_the_fee.sql
-- The fee follows the money, not the phone call.
--
-- Why: the venue agreement (PR #242, clauses 2.3, 4.1(d), 4.3, 4.4, 6.5)
-- now charges the commission on every amount collected through Ludi,
-- including a Prepayment: the full price or a deposit paid through Ludi
-- (e.g. a payment link from the owner dashboard) for a booking the owner
-- took by phone or in person. Founder, 2026-09-17: phoning the owner must
-- never work as a discount. Bookings taken AND paid at the venue stay free.
--
-- 20260912000001 wrote the old rule into the schema by origin:
-- bookings_walk_in_no_fee forbade any fee on a walk-in, which would make a
-- prepaid walk-in impossible to record correctly. This keys the booking
-- rule on where the money is collected instead:
--   * bookings.prepaid — true when a walk-in's money is collected through
--     Ludi. Only a walk-in can be prepaid; an app booking is always paid
--     through Ludi already.
--   * a walk-in may carry a fee only when prepaid.
--   * payments_offline_no_fee stays exactly as it is: money taken at the
--     venue never carries a fee. A prepaid walk-in's payment is a stripe row.
--
-- Nothing creates a prepaid walk-in yet (the payment link is unbuilt), so
-- every existing and new row reads prepaid = false and the rule is
-- unchanged for them. Additive; no deploy order.

ALTER TABLE public.bookings
  ADD COLUMN prepaid boolean NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT bookings_prepaid_is_walk_in
    CHECK (origin = 'walk_in' OR NOT prepaid);

ALTER TABLE public.bookings
  DROP CONSTRAINT bookings_walk_in_no_fee;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_venue_collected_no_fee
    CHECK (origin <> 'walk_in' OR prepaid OR platform_fee_cents = 0);

COMMENT ON COLUMN public.bookings.prepaid IS
  'Walk-ins only: true when the customer paid through Ludi (a Prepayment, '
  'agreement clause 6.5), so the booking carries the commission like an '
  'app booking. false = paid at the venue, no fee '
  '(bookings_venue_collected_no_fee, 20260917000003).';

COMMENT ON COLUMN public.bookings.origin IS
  'How the booking was created: app (player, via create-booking + Stripe) '
  'or walk_in (owner/admin, via create-walk-in-booking). Who pays the fee '
  'is decided by where the money is collected (prepaid), not by origin.';
