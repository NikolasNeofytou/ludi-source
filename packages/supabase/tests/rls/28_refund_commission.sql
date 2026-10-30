-- 28_refund_commission.sql — commission only on what the venue kept
-- (migration 20260913000002, ADR-0026 amendment)
--
-- Agreement clause 6.4: no commission on a fully refunded booking; on a
-- partial refund, commission applies to the amount retained. Stripe now
-- refunds the application fee pro-rata (refund_application_fee), so the
-- owner's Earnings page must scale a single-payer booking's fee by its
-- un-refunded fraction, the way split fixtures already do.
--
-- Fixture recap (_bootstrap.sql): a2 owns venue_a (b1), whose pitches
-- include c2; a4 is a player; the bootstrap payment (4000/400) is dated
-- now(), so this file's pinned 2031-08-03 day never collides with it.
BEGIN;
SELECT plan(3);

-- A confirmed single-payer booking: €43.00 with a €4.30 fee, the shape
-- measured in Stripe test mode for the ADR amendment.
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents,
  cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000ec',
  'RLS-2031-0012',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2',
  '2031-08-03 18:00+00', '2031-08-03 19:00+00', 'confirmed',
  4300, 0, 4300, 430,
  'standard'
);

INSERT INTO public.payments (
  booking_id, stripe_payment_intent_id, amount_cents,
  application_fee_cents, status, created_at
) VALUES (
  '00000000-0000-4000-8000-0000000000ec',
  'pi_refund_commission',
  4300, 430, 'succeeded',
  '2031-08-03 10:00+00'
);

-- 1 — before any refund, the full 10% (baseline unchanged by the view)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT (gross_cents, refunded_cents, fee_cents, venue_net_cents)::text
     FROM public.v_venue_earnings_daily
    WHERE day = '2031-08-03'),
  '(4300,0,430,3870)',
  'refund commission: unrefunded booking carries the full fee'
);

-- The player cancels 6–24h out: the standard policy refunds 50%.
-- charge.refunded syncs the running refunded total onto the payment.
RESET ROLE;
UPDATE public.payments
   SET status = 'partially_refunded', refunded_amount_cents = 2150
 WHERE stripe_payment_intent_id = 'pi_refund_commission';

-- 2 — commission on the retained 2150 only: Ludi 215, venue 1935 —
-- exactly what Stripe lands on with refund_application_fee.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT (gross_cents, refunded_cents, fee_cents, venue_net_cents)::text
     FROM public.v_venue_earnings_daily
    WHERE day = '2031-08-03'),
  '(4300,2150,215,1935)',
  'refund commission: a 50% refund halves the fee'
);

-- A full refund (venue cancelled, or an admin refund of the rest).
RESET ROLE;
UPDATE public.payments
   SET status = 'refunded', refunded_amount_cents = 4300
 WHERE stripe_payment_intent_id = 'pi_refund_commission';

-- 3 — no commission on a fully refunded booking
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT (gross_cents, refunded_cents, fee_cents, venue_net_cents)::text
     FROM public.v_venue_earnings_daily
    WHERE day = '2031-08-03'),
  '(4300,4300,0,0)',
  'refund commission: a full refund leaves no fee'
);

SELECT * FROM finish();
ROLLBACK;
