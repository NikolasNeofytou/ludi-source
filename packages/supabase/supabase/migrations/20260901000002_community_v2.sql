-- 20260901000002_community_v2.sql
-- Community v2 - the record & the rebook (plans/community-v2.md).
-- Three substrate units, none of which presume a crowd:
--   1. complete_played_bookings() + cron - a played fixture finally
--      BECOMES completed (ledger defect #45), the substrate every
--      asynchronous mechanic stands on.
--   2. my_record() - matches played + distinct teammates for the
--      caller, read from real rosters on completed fixtures.
--   3. bookings.rebooked_from - the chain that turns "the recurring
--      squad" from a guess into a measurable object (C3's trigger).

-- ════════════════════════════════════════════════════════════════════
-- 1. Completion flip
-- ════════════════════════════════════════════════════════════════════
-- Only the two at-rest active states flip. 'collecting' is excluded on
-- purpose - expire_collecting owns that lifecycle and a collecting
-- fixture past its start is that sweep's problem, not this one's.
-- Terminal states are already terminal. The organiser column guard
-- passes because cron executes as postgres (is_privileged_writer).
CREATE OR REPLACE FUNCTION public.complete_played_bookings()
RETURNS int
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  WITH flipped AS (
    UPDATE public.bookings
       SET state = 'completed'
     WHERE state IN ('paid', 'confirmed')
       AND ends_at < now()
    RETURNING 1
  )
  SELECT count(*)::int FROM flipped;
$$;

COMMENT ON FUNCTION public.complete_played_bookings() IS
  'Marks played fixtures completed (ledger #45). Cron-only: clients '
  'never flip states. Returns the number of bookings flipped.';

-- Cron-only: no client role may call it.
REVOKE ALL ON FUNCTION public.complete_played_bookings() FROM public;
REVOKE ALL ON FUNCTION public.complete_played_bookings() FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not available; skipping complete-played-bookings schedule.';
    RAISE NOTICE '  Expected in CI. On Supabase this registers the hourly completion flip.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- Hourly, five past - fixtures end on the hour, so :05 completes them
  -- within minutes of the final whistle without a busier cadence.
  PERFORM cron.schedule(
    'ludi-complete-played-bookings',
    '5 * * * *',
    $cmd$SELECT public.complete_played_bookings();$cmd$
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 2. The record
-- ════════════════════════════════════════════════════════════════════
-- Caller-scoped on purpose: v2 shows a player their OWN record. Putting
-- these numbers on the public card is a consent-copy decision
-- (ADR-0012/0013) deferred to its own change - a definer read that only
-- ever answers for auth.uid() cannot leak anyone else's history.
CREATE OR REPLACE FUNCTION public.my_record()
RETURNS TABLE (matches_played int, teammates int)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(DISTINCT bp.booking_id)::int         AS matches_played,
    count(DISTINCT other.user_id)::int         AS teammates
  FROM public.booking_participants bp
  JOIN public.bookings b
    ON b.id = bp.booking_id
   AND b.state = 'completed'
  LEFT JOIN public.booking_participants other
    ON other.booking_id = bp.booking_id
   AND other.status = 'in'
   AND other.user_id <> auth.uid()
  WHERE bp.user_id = auth.uid()
    AND bp.status = 'in';
$$;

COMMENT ON FUNCTION public.my_record() IS
  'The caller''s persistent record: completed matches played and '
  'distinct teammates stood on a roster with. Own data only - the '
  'public-card version is a separate, consent-gated decision.';

REVOKE ALL ON FUNCTION public.my_record() FROM public;
REVOKE ALL ON FUNCTION public.my_record() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_record() TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 3. The rebook chain
-- ════════════════════════════════════════════════════════════════════
-- Set once at creation by create-booking when the flow was entered via
-- "book again" (the Edge Function verifies the caller stood on the
-- source fixture's roster and drops the link otherwise). Never client-
-- writable afterwards: the organiser column guard already freezes every
-- column outside its subtraction list, this one included.
ALTER TABLE public.bookings
  ADD COLUMN rebooked_from uuid REFERENCES public.bookings (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bookings.rebooked_from IS
  'The fixture this booking was "book again"-ed from (community-v2.md). '
  'Chains of these with overlapping rosters ARE the recurring squad - '
  'the C3 trigger reads this column instead of guessing.';

-- FKs index the child side (CONVENTIONS). Partial: almost every booking
-- is not a rebook.
CREATE INDEX bookings_rebooked_from_idx
  ON public.bookings (rebooked_from)
  WHERE rebooked_from IS NOT NULL;
