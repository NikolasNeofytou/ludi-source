-- 20260902000002_record_venues.sql
-- The record gains its third number: distinct venues played at.
--
-- Why: the profile rework (Direction C) leads with a stat strip, and the
-- researched formula wants three-to-five numbers on that line, each one a
-- doorway. Matches and teammates alone read thin. "Pitches" is the honest
-- third: it is earned the same way, it needs no new table, and it says
-- something matches-played does not — how far around Cyprus you have played.
--
-- Computed server-side inside my_record() rather than counted client-side
-- off v_fixture. The two populations are NOT the same: v_fixture is
-- organiser-or-participant, my_record is participant-with-status-'in'. An
-- organiser who never put themselves on the roster would make the two
-- disagree on the same screen. One definer function owns the record.
--
-- The return type changes, so this is a DROP + CREATE: CREATE OR REPLACE
-- cannot alter a function's OUT columns. Grants are re-applied below.

DROP FUNCTION IF EXISTS public.my_record();

CREATE FUNCTION public.my_record()
RETURNS TABLE (matches_played int, teammates int, venues int)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(DISTINCT bp.booking_id)::int   AS matches_played,
    count(DISTINCT other.user_id)::int   AS teammates,
    count(DISTINCT p.venue_id)::int      AS venues
  FROM public.booking_participants bp
  JOIN public.bookings b
    ON b.id = bp.booking_id
   AND b.state = 'completed'
  JOIN public.pitches p
    ON p.id = b.pitch_id
  LEFT JOIN public.booking_participants other
    ON other.booking_id = bp.booking_id
   AND other.status = 'in'
   AND other.user_id <> auth.uid()
  WHERE bp.user_id = auth.uid()
    AND bp.status = 'in';
$$;

COMMENT ON FUNCTION public.my_record() IS
  'The caller''s persistent record: completed matches played, distinct '
  'teammates stood on a roster with, and distinct venues played at. Own '
  'data only - the public-card version is a separate, consent-gated '
  'decision (ADR-0012 amendment, 2026-09-02).';

REVOKE ALL ON FUNCTION public.my_record() FROM public;
REVOKE ALL ON FUNCTION public.my_record() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_record() TO authenticated;
