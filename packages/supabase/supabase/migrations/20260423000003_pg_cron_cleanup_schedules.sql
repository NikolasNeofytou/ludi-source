-- 20260423000003_pg_cron_cleanup_schedules.sql
-- Schedule the three cleanup functions shipped in migrations 007 and 008.
--
-- The functions themselves (cleanup_stale_pending_bookings,
-- cleanup_expired_idempotency_keys, cleanup_old_stripe_events) are useless
-- without a scheduler wired up — they exist but never fire. This migration
-- closes the loop.
--
-- Schedule rationale:
--   * stale_pending_bookings  : every 5 min. Airline-style 15-min hold on
--     slot reservations; running the cleaner every 5 min means a caller
--     sees a freed slot within 15-20 min of the original holder abandoning.
--   * expired_idempotency_keys: every 10 min. TTL is 24 h, so the pruning
--     cadence is just about keeping the table compact, not about
--     correctness. 10 min is plenty.
--   * old_stripe_events       : daily at 03:00. Stripe's redelivery
--     window is 3 days, we retain 30, and the table grows at event-rate
--     not request-rate — once a day is overkill-safe. 03:00 is the
--     low-traffic hour across Cyprus and Europe.
--
-- Environment handling:
--   - Supabase (local + hosted): pg_cron is available AND preloaded via
--     shared_preload_libraries — scheduling Just Works.
--   - Vanilla Postgres (CI postgis container): pg_cron is not installed.
--     We detect that and skip gracefully. The migration still succeeds
--     so the rest of the pipeline isn't blocked.
--
-- Idempotency: cron.schedule(jobname, …) upserts by jobname, so reruns
-- replace the existing job rather than duplicating.
--
-- Session: 2026-04-23 M1 #4.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not available in this Postgres instance; skipping schedule setup.';
    RAISE NOTICE '  This is expected in CI (vanilla postgis container).';
    RAISE NOTICE '  On Supabase this migration will schedule 3 cleanup jobs.';
    RAISE NOTICE '  If you see this message in staging or production, enable pg_cron first (Dashboard > Database > Extensions).';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- Every 5 minutes: release slot holds older than 15 min.
  PERFORM cron.schedule(
    'ludi-cleanup-stale-pending-bookings',
    '*/5 * * * *',
    $cmd$SELECT public.cleanup_stale_pending_bookings(15);$cmd$
  );

  -- Every 10 minutes: prune expired idempotency keys (24 h TTL).
  PERFORM cron.schedule(
    'ludi-cleanup-expired-idempotency-keys',
    '*/10 * * * *',
    $cmd$SELECT public.cleanup_expired_idempotency_keys();$cmd$
  );

  -- Daily at 03:00 UTC: drop Stripe events older than 30 days.
  PERFORM cron.schedule(
    'ludi-cleanup-old-stripe-events',
    '0 3 * * *',
    $cmd$SELECT public.cleanup_old_stripe_events(30);$cmd$
  );

  -- COMMENT ON EXTENSION requires the extension to exist. EXECUTE lets us
  -- run it dynamically inside the guarded block; outside the block it
  -- would error in CI where pg_cron isn't installed.
  EXECUTE $cmt$COMMENT ON EXTENSION pg_cron IS 'Schedules Ludi cleanup functions. Jobs live in cron.job (query: SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE ''ludi-%'').'$cmt$;

  RAISE NOTICE 'Scheduled 3 Ludi cleanup jobs via pg_cron.';
END
$$;
