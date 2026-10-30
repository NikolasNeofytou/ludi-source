-- 20260830000004_split_cancellation.sql
-- C2 W5 — cancelling a split fixture after it confirmed
-- (docs/plans/split-payment.md §refund table, ADR-0026/0027).
--
-- Two small things, both in service of one boundary: the sweeper heals
-- PRE-confirm deaths (100% refunds — nothing has transferred), and
-- POST-confirm cancellation is cancel-booking's job (pro-rata refunds plus
-- one proportional transfer reversal). The line between the two is whether
-- the venue Transfer exists.

-- 1. The webhook records the Transfer it creates, because W5's reversal
--    needs the id (Stripe reverses a transfer BY id) and because "has this
--    fixture's money moved" becomes a column instead of an inference.
ALTER TABLE public.bookings
  ADD COLUMN stripe_transfer_id text UNIQUE;

COMMENT ON COLUMN public.bookings.stripe_transfer_id IS
  'The one venue Transfer for a confirmed split fixture (ADR-0027), '
  'recorded by the webhook after settle says confirmed. NULL means no '
  'money has reached the venue — the boundary the sweeper''s refund pass '
  'keys on. Always NULL for non-split bookings (their money moves inside '
  'the destination charge).';

-- 2. refundable_split_payments() learns the boundary. Without this, a
--    crashed pro-rata fan-out (state already 'refunded', some shares still
--    'succeeded') would be "healed" by the sweeper at 100% — topping every
--    late payer up past what the policy owes. Post-transfer money is
--    cancel-booking's to unwind, never the sweeper's.
CREATE OR REPLACE FUNCTION public.refundable_split_payments()
RETURNS TABLE (payment_id uuid, stripe_payment_intent_id text, amount_cents int)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  RETURN QUERY
    SELECT pay.id, pay.stripe_payment_intent_id, pay.amount_cents
      FROM public.payments pay
      JOIN public.bookings b ON b.id = pay.booking_id
     WHERE b.is_split
       AND b.stripe_transfer_id IS NULL
       AND b.state IN ('cancelled','cancelled_no_refund','refunded','refunded_by_admin')
       AND pay.kind IN ('share','cover')
       AND pay.status = 'succeeded';
END;
$$;

REVOKE ALL ON FUNCTION public.refundable_split_payments() FROM public, anon, authenticated;
