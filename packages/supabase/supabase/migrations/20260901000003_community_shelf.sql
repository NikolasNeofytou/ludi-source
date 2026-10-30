-- 20260901000003_community_shelf.sql
-- The shelf under the community board (founder request 2026-09-01):
-- standing, real-action content - never simulated activity. Two pieces
-- of substrate:
--   1. cities.whatsapp_group_url - the official per-city group
--      (Playtomic's documented liquidity pattern) as an in-app card.
--      Shown only where the founder has actually created the group.
--   2. community_week_stats() - aggregate proof of life from real
--      completed fixtures. Counts only, and the client hides the strip
--      entirely at zero, so it cannot look dead.

-- ════════════════════════════════════════════════════════════════════
-- 1. The city group link
-- ════════════════════════════════════════════════════════════════════
-- Public-read by the existing cities_select_public policy - a WhatsApp
-- invite link is public by nature. Admin-only write via
-- cities_admin_write; the founder sets it from the SQL editor,
-- concierge-first.
ALTER TABLE public.cities
  ADD COLUMN whatsapp_group_url text
  CONSTRAINT cities_whatsapp_url_shape
  CHECK (
    whatsapp_group_url IS NULL
    OR whatsapp_group_url LIKE 'https://chat.whatsapp.com/%'
  );

COMMENT ON COLUMN public.cities.whatsapp_group_url IS
  'Official per-city WhatsApp group (community-v2.md operational move). '
  'NULL until the founder creates the group; the app renders a join '
  'card only when set. chat.whatsapp.com links only, by CHECK.';

-- ════════════════════════════════════════════════════════════════════
-- 2. Proof of life
-- ════════════════════════════════════════════════════════════════════
-- Completed fixtures in the trailing week + distinct players who stood
-- on those rosters. Definer because bookings/participants are locked
-- down; safe because it returns two integers and nothing else.
CREATE OR REPLACE FUNCTION public.community_week_stats()
RETURNS TABLE (matches_7d int, players_7d int)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(DISTINCT b.id)::int        AS matches_7d,
    count(DISTINCT bp.user_id)::int  AS players_7d
  FROM public.bookings b
  LEFT JOIN public.booking_participants bp
    ON bp.booking_id = b.id
   AND bp.status = 'in'
  WHERE b.state = 'completed'
    AND b.ends_at > now() - interval '7 days';
$$;

COMMENT ON FUNCTION public.community_week_stats() IS
  'The shelf''s proof-of-life strip: completed matches and distinct '
  'seated players over the trailing 7 days. Two integers, no identities.';

REVOKE ALL ON FUNCTION public.community_week_stats() FROM public;
REVOKE ALL ON FUNCTION public.community_week_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.community_week_stats() TO authenticated;
