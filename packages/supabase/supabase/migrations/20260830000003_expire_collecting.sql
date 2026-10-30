-- 20260830000003_expire_collecting.sql
-- C2 W4 — the split-payment clocks (docs/plans/split-payment.md §decisions,
-- docs/spikes/scheduled-edge-function.md).
--
-- Three selection helpers put the WHICH in SQL where pgtap can clock-inject
-- rows; the expire-collecting Edge Function owns the DOING (refunds cannot
-- live in the database — ADR-0022). Each helper carries the same in-body
-- service-role guard as settle_split_booking(): they enumerate money rows,
-- and an ACL is one blanket grant away from gone.
--
-- The sweep is three idempotent passes, and the helpers are shaped so a
-- tick that dies mid-pass is healed by the next tick:
--   a. expiring_split_bookings()  → flip collecting → cancelled (T-22h)
--   b. refundable_split_payments() → succeeded share/cover money still
--      sitting on DEAD split bookings — self-healing: pass (a) crashing
--      after the flip leaves rows exactly here
--   c. stale_share_claims()       → seats whose share PI died unpaid
--      (claim-share's 15-minute grace, mirroring pending bookings)

CREATE FUNCTION public.assert_service_role() RETURNS void
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_role text;
BEGIN
  BEGIN
    v_role := (current_setting('request.jwt.claims', true))::jsonb->>'role';
  EXCEPTION WHEN others THEN
    v_role := NULL;
  END;
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_ONLY' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_service_role() IS
  'In-body guard for money-path helpers: only requests carrying the '
  'service_role JWT claim pass. Extracted from settle_split_booking''s '
  'inline version — same posture, one spelling (C2 W4).';

-- a. Split fixtures whose cover-or-die grace has run out: collect_deadline
--    (T-24h) plus the 2h grace is behind us and the fixture never filled.
CREATE FUNCTION public.expiring_split_bookings(p_grace interval DEFAULT interval '2 hours')
RETURNS TABLE (booking_id uuid)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  RETURN QUERY
    SELECT b.id FROM public.bookings b
     WHERE b.state = 'collecting'
       AND b.collect_deadline + p_grace <= now();
END;
$$;

-- b. Money still held on dead split fixtures. Covers both the ordinary
--    expiry fan-out and the crash-recovery case (state flipped, refunds
--    interrupted). ANY dead state qualifies — an organiser cancel while
--    collecting produces the same rows.
CREATE FUNCTION public.refundable_split_payments()
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
       AND b.state IN ('cancelled','cancelled_no_refund','refunded','refunded_by_admin')
       AND pay.kind IN ('share','cover')
       AND pay.status = 'succeeded';
END;
$$;

-- c. Seats held by a share PI that never settled: participant 'in' on a
--    live split fixture, their newest share payment stuck pre-succeeded and
--    older than the grace. The claimant lost interest at the card sheet;
--    the slot goes back on the market, same as a stale pending booking.
CREATE FUNCTION public.stale_share_claims(p_age interval DEFAULT interval '15 minutes')
RETURNS TABLE (
  participant_id uuid,
  payment_id uuid,
  stripe_payment_intent_id text
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  RETURN QUERY
    SELECT bp.id, pay.id, pay.stripe_payment_intent_id
      FROM public.booking_participants bp
      JOIN public.bookings b ON b.id = bp.booking_id
      JOIN LATERAL (
        SELECT p2.id, p2.stripe_payment_intent_id, p2.status, p2.created_at
          FROM public.payments p2
         WHERE p2.participant_id = bp.id AND p2.kind = 'share'
         ORDER BY p2.created_at DESC
         LIMIT 1
      ) pay ON true
     WHERE b.is_split
       AND b.state = 'collecting'
       AND bp.status = 'in'
       AND bp.user_id <> b.user_id  -- never sweep the organiser's anchor seat
       AND pay.status IN ('requires_payment_method','requires_confirmation','processing')
       AND pay.created_at < now() - p_age;
END;
$$;

REVOKE ALL ON FUNCTION public.expiring_split_bookings(interval)  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.refundable_split_payments()        FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.stale_share_claims(interval)       FROM public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- The clock: every 5 minutes, POST to the expire-collecting Edge
-- Function. Guarded like 20260423000003: CI's vanilla postgis container
-- has neither pg_cron nor pg_net and must still apply this migration.
--
-- URL and secret come from Vault (hosted: Dashboard > Vault; local:
-- supabase_vault ships in the stack) under the names
--   expire_collecting_url     e.g. https://<ref>.supabase.co/functions/v1/expire-collecting
--   expire_collecting_secret  the EXPIRE_COLLECTING_SECRET the function checks
-- Until both exist the job errors visibly in cron.job_run_details each
-- tick — seeding them is a founder deploy-day step (split-payment.md).
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE 'pg_cron/pg_net unavailable; skipping expire-collecting schedule.';
    RAISE NOTICE '  Expected in CI. On Supabase this schedules the split-payment sweeper.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  PERFORM cron.schedule(
    'ludi-expire-collecting',
    '*/5 * * * *',
    $job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets
               WHERE name = 'expire_collecting_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-expire-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                             WHERE name = 'expire_collecting_secret')
      ),
      body := '{}'::jsonb
    )
    $job$
  );

  RAISE NOTICE 'Scheduled ludi-expire-collecting every 5 minutes.';
END;
$$;
