-- 20260423000001_stripe_events_and_venue_cascade.sql
-- Support migration for the `stripe-webhook` Edge Function.
--
-- Two concerns:
--
--   1. Idempotency for Stripe event delivery. Stripe can redeliver the same
--      event within a 3-day window (e.g. if our 2xx response was slow).
--      Without dedup, a second delivery of payment_intent.succeeded would
--      attempt to flip an already-confirmed booking and our handlers would
--      have to no-op defensively on every path. A per-event-id uniqueness
--      check keeps the handlers clean: "if we've seen this id, return 200
--      fast" is the first thing the dispatcher does.
--
--   2. Cascade venue Stripe status changes to pitches. The existing
--      tg_pitches_verify_guard trigger only fires on pitches-side UPDATEs,
--      so flipping a venue to `restricted` via the account.updated webhook
--      would silently leave its pitches bookable. Add a trigger on venues
--      that forces is_verified=false on all owned pitches when the status
--      leaves 'active'.
--
-- See docs/api-contract.md §5.3 (Webhook handlers) for what the webhook
-- does with each event type.
-- Session: 2026-04-23 stripe-webhook build (M1 #1).

-- ────────────────────────────────────────────────────────────────────
-- 1. stripe_events — event.id dedup for webhook delivery.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.stripe_events (
  event_id       text PRIMARY KEY,
  event_type     text NOT NULL,
  processed_at   timestamptz NOT NULL DEFAULT now(),
  response_code  int NOT NULL,       -- HTTP status we returned to Stripe
  notes          text                -- optional: "orphan-refund", "venue-status-active", etc.
);

CREATE INDEX stripe_events_type_idx ON public.stripe_events (event_type, processed_at DESC);

COMMENT ON TABLE public.stripe_events IS
  'Dedup log for Stripe webhook deliveries. Insert-on-receive; PK conflict means '
  'we already processed this event and should return 200 without re-running handlers.';

-- Service-role only. Clients cannot read or write; the webhook runs as
-- service role and has no use for RLS.
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies.

-- Cleanup: prune events older than 30 days. Stripe's redelivery window is
-- 3 days, so 30 is a generous margin. Called by pg_cron with the other
-- cleanup functions (wired up in M1 #4).
CREATE OR REPLACE FUNCTION public.cleanup_old_stripe_events(p_age_days int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count int;
BEGIN
  IF p_age_days IS NULL OR p_age_days < 7 THEN
    RAISE EXCEPTION 'p_age_days must be >= 7 (Stripe redelivery window is 3 days)';
  END IF;

  WITH del AS (
    DELETE FROM public.stripe_events
    WHERE processed_at < now() - (p_age_days::text || ' days')::interval
    RETURNING event_id
  )
  SELECT count(*) INTO v_count FROM del;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_stripe_events(int) IS
  'Delete stripe_events rows past the redelivery window. Default 30 days.';

-- ────────────────────────────────────────────────────────────────────
-- 2. Cascade venue Stripe status -> pitches.is_verified.
-- ────────────────────────────────────────────────────────────────────
-- When a venue's stripe_account_status leaves 'active', force all its
-- pitches to is_verified=false. Can't re-verify automatically on the
-- way back to active — that's an admin action (they re-check the pitch
-- details, photos, etc. before listing it).
CREATE OR REPLACE FUNCTION public.tg_venues_cascade_stripe_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.stripe_account_status IS DISTINCT FROM NEW.stripe_account_status
     AND NEW.stripe_account_status IS DISTINCT FROM 'active' THEN
    UPDATE public.pitches
    SET is_verified = false
    WHERE venue_id = NEW.id
      AND is_verified;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_venues_cascade_stripe_status
  AFTER UPDATE OF stripe_account_status ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.tg_venues_cascade_stripe_status();

COMMENT ON FUNCTION public.tg_venues_cascade_stripe_status() IS
  'Cascade venue Stripe status changes to pitch verification. If a venue '
  'leaves active, its pitches lose verification — admin must re-verify.';
