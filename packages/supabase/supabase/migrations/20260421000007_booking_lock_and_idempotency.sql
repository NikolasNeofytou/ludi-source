-- 20260421000007_booking_lock_and_idempotency.sql
-- Support migration for the `create-booking` Edge Function.
--
-- Three concerns:
--
--   1. Strengthen the bookings EXCLUDE constraint so `pending` reservations
--      also block overlaps. Without this, two users can both start a checkout
--      for the same slot and the conflict only surfaces at webhook-settlement
--      time — forcing a refund on the loser. Airline-style: the slot is held
--      the moment the booking row exists, and released by cleanup if the
--      user abandons.
--
--   2. Add `idempotency_keys` — response cache keyed by the client-provided
--      Idempotency-Key header. Protects against double-charges on retry
--      (lost response, bad network, user mashes the button).
--
--   3. Add two cleanup functions intended to be driven by pg_cron once
--      provisioned: one expires stale pending bookings (default 15m), the
--      other prunes expired idempotency rows.
--
-- See docs/api-contract.md §5.1 and docs/data-model.md bookings section.
-- Session: 2026-04-21 create-booking build.

-- ────────────────────────────────────────────────────────────────────
-- 1. Strengthen the EXCLUDE predicate to include 'pending'.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  DROP CONSTRAINT bookings_pitch_id_time_range_excl;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_pitch_id_time_range_excl
  EXCLUDE USING gist (
    pitch_id   WITH =,
    time_range WITH &&
  ) WHERE (state IN ('pending','paid','confirmed','completed'));

COMMENT ON CONSTRAINT bookings_pitch_id_time_range_excl ON public.bookings IS
  'Double-booking prevention including pending holds. Pending rows reserve '
  'the slot until paid (via webhook) or expired (cleanup_stale_pending_bookings).';

-- ────────────────────────────────────────────────────────────────────
-- 2. idempotency_keys — response cache for safe Edge Function retries.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.idempotency_keys (
  key              text PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_hash     text NOT NULL,
  response_status  int  NOT NULL,
  response_body    jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX idempotency_keys_expires_idx ON public.idempotency_keys (expires_at);
CREATE INDEX idempotency_keys_user_idx    ON public.idempotency_keys (user_id);

COMMENT ON TABLE public.idempotency_keys IS
  'Edge Function response cache keyed by client-provided Idempotency-Key. '
  'Retry-safety for money-moving endpoints. 24h TTL pruned by cleanup_expired_idempotency_keys().';
COMMENT ON COLUMN public.idempotency_keys.request_hash IS
  'SHA-256 of the canonicalized request body. If a retry arrives with the same key '
  'but a different hash, treat as a misuse (409): the same key must mean the same request.';

-- RLS: no client access at all. Service role only (Edge Functions).
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies — clients cannot read or write this table.

-- ────────────────────────────────────────────────────────────────────
-- 3a. Cleanup: expire pending bookings older than N minutes.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_stale_pending_bookings(p_age_minutes int DEFAULT 15)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_age_minutes IS NULL OR p_age_minutes < 1 THEN
    RAISE EXCEPTION 'p_age_minutes must be >= 1';
  END IF;

  WITH expired AS (
    UPDATE public.bookings
    SET state        = 'cancelled_no_refund',
        cancelled_at = now()
    WHERE state = 'pending'
      AND created_at < now() - (p_age_minutes::text || ' minutes')::interval
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM expired;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.cleanup_stale_pending_bookings(int) IS
  'Cancel pending bookings older than N minutes (default 15). '
  'Releases the EXCLUDE lock so the slot is bookable again. '
  'Does NOT cancel the Stripe PaymentIntent — that is the webhook handler''s '
  'responsibility (it must check booking state before flipping to paid).';

-- ────────────────────────────────────────────────────────────────────
-- 3b. Cleanup: prune expired idempotency keys.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_expired_idempotency_keys()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  WITH del AS (
    DELETE FROM public.idempotency_keys
    WHERE expires_at < now()
    RETURNING key
  )
  SELECT count(*) INTO v_count FROM del;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_idempotency_keys() IS
  'Delete idempotency keys past their expiry. Intended to run every 10 minutes via pg_cron.';
