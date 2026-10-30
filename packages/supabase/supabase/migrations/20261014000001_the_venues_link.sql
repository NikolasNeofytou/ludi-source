-- 20261014000001_the_venues_link.sql
-- The venue's own link (plans/reach.md, R1): ludi.football/v/<slug> is a
-- page per venue for its Instagram bio, its Google listing and the QR on
-- the counter. The page reads one function and nothing else; the slug is
-- Ludi's to set, like the commercial columns, so a venue's address on the
-- web cannot change under a printed QR.
--
-- Contents:
--   1. venues.slug, backfilled, guarded like the commercial columns
--   2. venue_page(slug) - what the page shows, readable signed out
--   3. venue_slugs() - the sitemap

-- ════════════════════════════════════════════════════════════════════
-- 1. The slug
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.venues ADD COLUMN slug text;

ALTER TABLE public.venues ADD CONSTRAINT venues_slug_shape
CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{2,39}$');

CREATE UNIQUE INDEX venues_slug_key ON public.venues (slug);

-- venues is granted column by column since 20260913000005; the slug is in
-- the URL, so it is as public as the name.
GRANT SELECT (slug) ON public.venues TO anon, authenticated;

COMMENT ON COLUMN public.venues.slug IS
'The venue''s own address on the site, ludi.football/v/<slug> (plans/'
'reach.md R1). Lowercase, digits and dashes, 3-40 characters, unique. '
'Ludi sets it; NULL means the venue has no page.';

-- The two live venues get the short names the print packs already use
-- (apps/site/lib/scan-source.ts); every other active venue gets its name,
-- lowered and dashed, where that makes a valid slug nobody else holds.
UPDATE public.venues SET slug = 'campeone'
WHERE slug IS NULL AND is_active AND name = 'Campeone';
UPDATE public.venues SET slug = 'kamares'
WHERE slug IS NULL AND is_active AND name = 'Kamares Futsal';

UPDATE public.venues AS v
SET slug = c.slug
FROM (
  SELECT r.id, r.slug
  FROM (
    SELECT
      d.id,
      d.slug,
      row_number() OVER (PARTITION BY d.slug ORDER BY d.created_at) AS n
    FROM (
      SELECT
        id,
        created_at,
        trim(BOTH '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) AS slug
      FROM public.venues
      WHERE slug IS NULL AND is_active
    ) AS d
  ) AS r
  WHERE r.n = 1
    AND r.slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'
    AND NOT EXISTS (SELECT 1 FROM public.venues AS x WHERE x.slug = r.slug)
) AS c
WHERE v.id = c.id;

-- The column guard learns the slug (re-stated from 20260822000003 with
-- one line added). An owner edits name, address, pin and contacts; the
-- slug is printed on his counter and is Ludi's to change.
CREATE OR REPLACE FUNCTION public.tg_venues_block_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN new;
  END IF;

  IF new.city_id IS DISTINCT FROM old.city_id
    OR new.take_rate_bps IS DISTINCT FROM old.take_rate_bps
    OR new.stripe_account_id IS DISTINCT FROM old.stripe_account_id
    OR new.stripe_account_status IS DISTINCT FROM old.stripe_account_status
    OR new.cancellation_policy IS DISTINCT FROM old.cancellation_policy
    OR new.is_active IS DISTINCT FROM old.is_active
    OR new.slug IS DISTINCT FROM old.slug THEN
    RAISE EXCEPTION
      'venue owners may not change commercial, payment or platform fields'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN new;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 2. What the page shows
-- ════════════════════════════════════════════════════════════════════
-- One row for an active venue with that slug: where it is, how many
-- courts in which formats, the lowest hourly price, today's hours across
-- the courts that are not closed today, and whether the app can take the
-- booking (Stripe active and a live court) or the counter does.
CREATE OR REPLACE FUNCTION public.venue_page(p_slug text)
RETURNS TABLE (
  venue_id uuid,
  name text,
  address text,
  city_code text,
  city_name_en text,
  city_name_gr text,
  lat double precision,
  lng double precision,
  contact_phone text,
  bookable boolean,
  courts int,
  formats text [],
  from_price_cents int,
  opens_today time,
  closes_today time
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH today AS (
    SELECT
      (now() AT TIME ZONE 'Europe/Nicosia')::date AS d,
      EXTRACT(DOW FROM (now() AT TIME ZONE 'Europe/Nicosia'))::smallint AS dow
  ),
  live AS (
    SELECT p.id, p.type, p.price_per_hour_cents
    FROM public.pitches AS p
    INNER JOIN public.venues AS v ON p.venue_id = v.id
    WHERE v.slug = p_slug AND v.is_active AND p.is_active AND p.is_verified
  ),
  hours AS (
    SELECT min(s.opens_at) AS opens_at, max(s.closes_at) AS closes_at
    FROM public.pitch_schedules AS s
    INNER JOIN live ON s.pitch_id = live.id
    CROSS JOIN today
    WHERE s.day_of_week = today.dow
      AND NOT EXISTS (
        SELECT 1 FROM public.pitch_schedule_overrides AS o
        WHERE o.pitch_id = live.id AND o.override_date = today.d AND o.is_closed
      )
  )
  SELECT
    v.id,
    v.name,
    v.address,
    c.code,
    c.name_en,
    c.name_gr,
    v.lat,
    v.lng,
    v.contact_phone,
    v.stripe_account_status = 'active' AND EXISTS (SELECT 1 FROM live),
    (SELECT count(*)::int FROM live),
    (SELECT coalesce(array_agg(DISTINCT live.type ORDER BY live.type), '{}') FROM live),
    (SELECT min(live.price_per_hour_cents) FROM live),
    (SELECT hours.opens_at FROM hours),
    (SELECT hours.closes_at FROM hours)
  FROM public.venues AS v
  INNER JOIN public.cities AS c ON v.city_id = c.id
  WHERE v.slug = p_slug AND v.is_active;
$$;

COMMENT ON FUNCTION public.venue_page(text) IS
'The venue''s page on the site (plans/reach.md R1): an active venue by '
'slug, its live courts, lowest price, today''s hours and whether the app '
'books it. Readable signed out; nothing here is not already public.';

-- ════════════════════════════════════════════════════════════════════
-- 3. The sitemap
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.venue_slugs()
RETURNS TABLE (slug text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.slug FROM public.venues AS v
  WHERE v.is_active AND v.slug IS NOT NULL
  ORDER BY v.slug;
$$;

REVOKE ALL ON FUNCTION public.venue_page(text) FROM public;
REVOKE ALL ON FUNCTION public.venue_slugs() FROM public;
GRANT EXECUTE ON FUNCTION public.venue_page(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venue_slugs() TO anon, authenticated;
