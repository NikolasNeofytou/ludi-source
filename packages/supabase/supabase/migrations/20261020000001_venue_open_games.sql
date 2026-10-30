-- The venue's page lists its open games (plans/instagram.md IG-2, ADR-0056).
--
-- One venue's slice of the community board, signed out. It returns exactly
-- the fixtures v_open_fixtures lists (the organiser opened it, the booking
-- is live, it has not kicked off, it is short at least one player) at the
-- active venue with this slug, with only the fields its lobby screen
-- already shows (ADR-0043): when, the format, what is missing and the
-- invite. Never a name, never a price.
--
-- Reading the view rather than restating its predicate means the board,
-- the screen and the page can never disagree about what is open. There is
-- deliberately no all-venues variant: ADR-0028 keeps scraping the whole
-- board one credential more expensive, so the page widens it one venue at
-- a time, and LIMIT keeps one call small.

CREATE OR REPLACE FUNCTION public.venue_open_games(p_slug text)
RETURNS TABLE (
  starts_at timestamptz,
  ends_at timestamptz,
  pitch_type text,
  gk_open int,
  outfield_open int,
  invite_token text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    f.starts_at,
    f.ends_at,
    f.pitch_type,
    greatest(f.gk_open, 0),
    greatest(f.outfield_open, 0),
    f.invite_token
  FROM public.v_open_fixtures AS f
  INNER JOIN public.venues AS v ON f.venue_id = v.id
  WHERE v.slug = p_slug AND v.is_active
  ORDER BY f.starts_at, f.pitch_name
  LIMIT 50;
$$;

COMMENT ON FUNCTION public.venue_open_games(text) IS
  'The venue page''s open games (ADR-0056): v_open_fixtures for one active venue by slug, the lobby screen''s fields only, signed out.';

REVOKE ALL ON FUNCTION public.venue_open_games(text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_open_games(text) TO anon, authenticated;
