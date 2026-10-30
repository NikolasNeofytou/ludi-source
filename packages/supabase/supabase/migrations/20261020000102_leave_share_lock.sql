-- ────────────────────────────────────────────────────────────────────
-- Leaving a collecting fixture holds the booking while it counts
-- ────────────────────────────────────────────────────────────────────
-- Follow-up to plans/find-my-replacement.md (20261013000002), from the
-- 2026-10-19 pre-public review. Dormant while split payment is off.
--
-- leave-share refunded the leaver's share first and seated them out
-- after, without holding the booking. settle_split_booking() counts every
-- `succeeded` share under FOR UPDATE, so a settle running in that gap
-- could count a share that was about to be refunded and confirm the
-- fixture on money it no longer had.
--
-- Now the order is: lock the booking (the same lock settle takes),
-- re-check it is still collecting, mark the leaver's share `refunding` —
-- a status settle does not count — and seat them out, all in one
-- transaction. The Stripe refund happens after, outside any lock. A
-- refund that fails stays `refunding`: leave-share retried by the player
-- picks it up, and so does the expire-collecting sweeper; charge.refunded
-- flips it to `refunded` whichever gets there.

-- ────────────────────────────────────────────────────────────────────
-- 1. payments.status gains 'refunding'
-- ────────────────────────────────────────────────────────────────────
-- The CHECK is still the inline one from 20260421000003 (never widened
-- since), so its name is Postgres's default. DROP without IF EXISTS on
-- purpose: if prod named it differently, this fails loudly instead of
-- adding a second CHECK that would refuse the new status.
ALTER TABLE public.payments
  DROP CONSTRAINT payments_status_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check CHECK (status IN (
    'requires_payment_method', 'requires_confirmation',
    'processing', 'succeeded', 'cancelled', 'failed',
    'refunded', 'partially_refunded', 'refunding'
  ));

COMMENT ON COLUMN public.payments.status IS
  'Stripe PaymentIntent status, plus refunding: a leaver''s share marked '
  'for refund under the booking lock (begin_leave_share) and not yet '
  'confirmed refunded. settle_split_booking counts only succeeded.';

-- ────────────────────────────────────────────────────────────────────
-- 2. begin_leave_share(booking, user) — the locked half of leave-share
-- ────────────────────────────────────────────────────────────────────
-- Returns the shares the caller must now refund at Stripe (the ones
-- marked refunding, including any left from an earlier attempt). Raises:
--   LEAVE_NOT_ON_ROSTER     no seat, or a seat already out with nothing owed
--   LEAVE_ORGANISER         the organiser cancels instead
--   LEAVE_PAYMENT_IN_FLIGHT a share PI still open at the card sheet; the
--                           Edge Function cancels those before calling
--
-- Off a collecting split fixture this is the plain seat-out the function
-- always did, now under the same lock.
--
-- Service-role only, guarded in the body like settle_split_booking: an
-- ACL alone is one blanket GRANT away from gone.
CREATE FUNCTION public.begin_leave_share(p_booking_id uuid, p_user_id uuid)
RETURNS TABLE (
  payment_id               uuid,
  stripe_payment_intent_id text,
  amount_cents             int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_role    text;
  v_booking public.bookings%ROWTYPE;
  v_seat    public.booking_participants%ROWTYPE;
BEGIN
  BEGIN
    v_role := (current_setting('request.jwt.claims', true))::jsonb ->> 'role';
  EXCEPTION WHEN others THEN
    v_role := NULL;
  END;
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'LEAVE_FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- The same lock settle_split_booking takes: whichever runs second sees
  -- what the first one wrote.
  SELECT * INTO v_booking
  FROM public.bookings AS b
  WHERE b.id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEAVE_NOT_ON_ROSTER' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.user_id = p_user_id THEN
    RAISE EXCEPTION 'LEAVE_ORGANISER' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_seat
  FROM public.booking_participants AS bp
  WHERE
    bp.booking_id = p_booking_id
    AND bp.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEAVE_NOT_ON_ROSTER' USING ERRCODE = 'P0001';
  END IF;

  IF v_seat.status = 'in' THEN
    IF v_booking.is_split AND v_booking.state = 'collecting' THEN
      IF EXISTS (
        SELECT 1
        FROM public.payments AS pay
        WHERE
          pay.participant_id = v_seat.id
          AND pay.kind = 'share'
          AND pay.status IN ('requires_payment_method', 'requires_confirmation', 'processing')
      ) THEN
        RAISE EXCEPTION 'LEAVE_PAYMENT_IN_FLIGHT' USING ERRCODE = 'P0001';
      END IF;

      UPDATE public.payments AS pay
      SET status = 'refunding'
      WHERE
        pay.participant_id = v_seat.id
        AND pay.kind = 'share'
        AND pay.status = 'succeeded';
    END IF;

    UPDATE public.booking_participants AS bp
    SET status = 'out'
    WHERE bp.id = v_seat.id;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.payments AS pay
    WHERE
      pay.participant_id = v_seat.id
      AND pay.kind = 'share'
      AND pay.status = 'refunding'
  ) THEN
    RAISE EXCEPTION 'LEAVE_NOT_ON_ROSTER' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT pay.id, pay.stripe_payment_intent_id, pay.amount_cents
  FROM public.payments AS pay
  WHERE
    pay.participant_id = v_seat.id
    AND pay.kind = 'share'
    AND pay.status = 'refunding';
END;
$fn$;

COMMENT ON FUNCTION public.begin_leave_share(uuid, uuid) IS
  'The locked half of leave-share: locks the booking FOR UPDATE, and on a '
  'collecting split fixture marks the leaver''s succeeded share refunding '
  '(settle_split_booking does not count it) before seating them out. '
  'Returns the shares to refund at Stripe. Service role only.';

REVOKE ALL ON FUNCTION public.begin_leave_share(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_leave_share(uuid, uuid) TO service_role;
