-- 20260822000004_venue_lat_lng_computed.sql
-- Readable coordinates for the M6 #41e venue form.
--
-- PostgREST serialises a `geography` column as hex EWKB:
--
--   "coords": "0101000020E6100000F2B0506B9ACF40403CBD529621764140"
--
-- which is correct and completely unusable as the default value of a
-- number input. The admin's edit form rendered empty lat/lng fields
-- because of it — and an empty field submitted back would have been
-- coerced to 0, silently relocating the venue to POINT(0 0) in the Gulf
-- of Guinea.
--
-- These are PostgREST *computed columns*: a function taking the table's
-- row type is selectable as if it were a column, so the client asks for
-- `?select=id,name,lat,lng` and gets numbers. Preferred over decoding EWKB
-- in TypeScript (a binary parser in a form component is the kind of
-- cleverness that ages badly) and over a view (which would need its own
-- RLS reasoning; a computed column inherits the table's).
--
-- Note the order: PostGIS stores X=longitude, Y=latitude, which is the
-- reverse of how every mapping UI and every human says it.
--
-- Session: 2026-08-22 M6 #41e.

CREATE OR REPLACE FUNCTION public.lat(public.venues)
RETURNS double precision
LANGUAGE sql STABLE
AS $$
  SELECT ST_Y($1.coords::geometry);
$$;

CREATE OR REPLACE FUNCTION public.lng(public.venues)
RETURNS double precision
LANGUAGE sql STABLE
AS $$
  SELECT ST_X($1.coords::geometry);
$$;

COMMENT ON FUNCTION public.lat(public.venues) IS
  'PostgREST computed column: venue latitude as a number, because the '
  'geography column itself serialises as hex EWKB.';

COMMENT ON FUNCTION public.lng(public.venues) IS
  'PostgREST computed column: venue longitude as a number. PostGIS X is '
  'longitude — the reverse of how humans say it.';

GRANT EXECUTE ON FUNCTION public.lat(public.venues) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lng(public.venues) TO anon, authenticated;
