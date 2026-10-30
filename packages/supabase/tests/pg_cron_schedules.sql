-- tests/pg_cron_schedules.sql
-- Verifies the three cleanup jobs registered in migration
-- 20260423000003_pg_cron_cleanup_schedules.sql actually landed in
-- cron.job. Skips gracefully when pg_cron isn't installed (e.g. vanilla
-- Postgres in CI).
--
-- Run locally after `supabase db reset` to catch regressions — e.g.
-- someone renaming a cleanup function without updating the schedule's
-- command string.

DO $$
DECLARE
  v_has_pg_cron boolean;
  v_count       int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_available_extensions
    WHERE name = 'pg_cron' AND installed_version IS NOT NULL
  ) INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE NOTICE 'pg_cron not installed; skipping schedule verification.';
    RETURN;
  END IF;

  -- Expect all three Ludi jobnames to be present.
  SELECT count(*) INTO v_count
  FROM cron.job
  WHERE jobname IN (
    'ludi-cleanup-stale-pending-bookings',
    'ludi-cleanup-expired-idempotency-keys',
    'ludi-cleanup-old-stripe-events'
  );
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'expected 3 ludi-* cron jobs, found %', v_count;
  END IF;

  -- Sanity-check each command string actually calls the target function,
  -- so a rename on one side without the other fails loudly.
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'ludi-cleanup-stale-pending-bookings'
      AND command ILIKE '%cleanup_stale_pending_bookings%'
  ) THEN
    RAISE EXCEPTION 'stale-pending job command does not reference the cleanup function';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'ludi-cleanup-expired-idempotency-keys'
      AND command ILIKE '%cleanup_expired_idempotency_keys%'
  ) THEN
    RAISE EXCEPTION 'idempotency-keys job command does not reference the cleanup function';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'ludi-cleanup-old-stripe-events'
      AND command ILIKE '%cleanup_old_stripe_events%'
  ) THEN
    RAISE EXCEPTION 'stripe-events job command does not reference the cleanup function';
  END IF;

  RAISE NOTICE 'pg_cron schedule verification passed (3 jobs, commands match).';
END
$$;
