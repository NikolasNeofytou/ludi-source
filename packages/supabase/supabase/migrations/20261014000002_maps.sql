-- 20261014000002_maps.sql
-- Maps (plans/maps.md): the map shows activity, and the player's own
-- grounds. The views the app already reads learn where their game is, so
-- a fixture can give directions, the board and the keeper list can be
-- drawn on the mini-map, and the invite preview can show the venue. Two
-- functions for the two new pictures: the island's live venues for the
-- site, and the caller's grounds for the Record.
--
-- Contents:
--   1. v_fixture gains venue_id, venue_address, lat, lng (re-stated from
--      20260913000003, columns appended)
--   2. v_open_fixtures gains venue_id, lat, lng (re-stated from
--      20261013000002)
--   3. v_keeper_requests gains venue_id, lat, lng (re-stated from
--      20261013000005, with #276's inlined open-place check)
--   4. fixture_preview gains lat, lng (the return type changes: DROP +
--      CREATE, grants re-applied)
--   5. venue_pins() - the island, signed out
--   6. my_grounds() - where the caller has played

-- ════════════════════════════════════════════════════════════════════
-- 1. v_fixture
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_fixture
WITH (security_invoker = off) AS
  SELECT
    b.id                        AS booking_id,
    b.code,
    b.starts_at,
    b.ends_at,
    b.state,
    b.cancelled_at,
    b.cancellation_policy,
    b.cancellation_refund_cents,
    b.total_cents,
    b.gk_slots,
    b.outfield_slots,
    (SELECT count(*) FROM public.booking_participants x
      WHERE x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'gk')::int
                                AS gk_filled,
    (SELECT count(*) FROM public.booking_participants x
      WHERE x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'outfield')::int
                                AS outfield_filled,
    b.invite_token,
    p.id                        AS pitch_id,
    p.name                      AS pitch_name,
    p.type                      AS pitch_type,
    v.name                      AS venue_name,
    c.name_en                   AS city_name_en,
    c.name_gr                   AS city_name_gr,
    (b.user_id = auth.uid())    AS viewer_is_organiser,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'addon_code',       a.addon_code,
                'quantity',         a.quantity,
                'unit_price_cents', a.unit_price_cents)
              ORDER BY a.addon_code)
         FROM public.booking_addons a
        WHERE a.booking_id = b.id),
      '[]'::jsonb)              AS addons,
    b.is_split,
    b.share_amount_cents,
    b.collect_deadline,
    b.is_open,
    -- 2026-09-01: the listing's level tag.
    b.open_level,
    -- 2026-10-14 (plans/maps.md): where the game is, for directions.
    v.id                        AS venue_id,
    v.address                   AS venue_address,
    v.lat,
    v.lng
  FROM public.bookings b
  JOIN public.pitches  p ON p.id = b.pitch_id
  JOIN public.venues   v ON v.id = p.venue_id
  JOIN public.cities   c ON c.id = v.city_id
 WHERE b.origin = 'app'
   AND (b.user_id = auth.uid()
        OR public.is_participant_of_booking(b.id)
        OR public.is_admin());

-- ════════════════════════════════════════════════════════════════════
-- 2. v_open_fixtures
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_open_fixtures
WITH (security_invoker = off) AS
SELECT
  f.booking_id,
  f.starts_at,
  f.ends_at,
  f.pitch_type,
  f.pitch_name,
  f.venue_name,
  f.city_name_en,
  f.city_name_gr,
  f.gk_open,
  f.outfield_open,
  f.is_split,
  f.share_amount_cents,
  f.invite_token,
  f.total_cents,
  f.gk_slots,
  f.outfield_slots,
  f.open_level,
  f.played_with_squad,
  f.venue_id,
  f.lat,
  f.lng
FROM (
  SELECT
    b.id AS booking_id,
    b.starts_at,
    b.ends_at,
    p.type AS pitch_type,
    p.name AS pitch_name,
    v.name AS venue_name,
    c.name_en AS city_name_en,
    c.name_gr AS city_name_gr,
    b.gk_slots - (
      SELECT count(*) FROM public.booking_participants AS x
      WHERE x.booking_id = b.id AND x.status = 'in'
        AND x.slot_kind = 'gk' AND x.replacing_since IS NULL
    )::int AS gk_open,
    b.outfield_slots - (
      SELECT count(*) FROM public.booking_participants AS x
      WHERE x.booking_id = b.id AND x.status = 'in'
        AND x.slot_kind = 'outfield' AND x.replacing_since IS NULL
    )::int AS outfield_open,
    b.is_split,
    b.share_amount_cents,
    b.invite_token,
    b.total_cents,
    b.gk_slots,
    b.outfield_slots,
    b.open_level,
    (
      SELECT count(DISTINCT seat.user_id)::int
      FROM public.booking_participants AS seat
      WHERE seat.booking_id = b.id
        AND seat.status = 'in'
        AND seat.user_id <> auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.booking_participants AS mine
          INNER JOIN public.booking_participants AS theirs
            ON mine.booking_id = theirs.booking_id
            AND theirs.user_id = seat.user_id
            AND theirs.status = 'in'
          INNER JOIN public.bookings AS shared
            ON mine.booking_id = shared.id
            AND shared.state = 'completed'
          WHERE mine.user_id = auth.uid()
            AND mine.status = 'in'
        )
    ) AS played_with_squad,
    v.id AS venue_id,
    v.lat,
    v.lng
  FROM public.bookings AS b
  INNER JOIN public.pitches AS p ON b.pitch_id = p.id
  INNER JOIN public.venues AS v ON p.venue_id = v.id
  INNER JOIN public.cities AS c ON v.city_id = c.id
  WHERE b.is_open
    AND b.state IN ('collecting', 'paid', 'confirmed')
    AND b.starts_at > now()
) AS f
WHERE f.gk_open > 0 OR f.outfield_open > 0;

-- ════════════════════════════════════════════════════════════════════
-- 3. v_keeper_requests
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_keeper_requests
WITH (security_invoker = off) AS
SELECT
  r.id AS request_id,
  b.id AS booking_id,
  b.starts_at,
  b.ends_at,
  p.type AS pitch_type,
  p.name AS pitch_name,
  v.name AS venue_name,
  c.name_en AS city_name_en,
  c.name_gr AS city_name_gr,
  r.shape,
  b.open_level,
  (
    SELECT count(*)::int FROM public.gk_feedback AS f
    WHERE f.about_user = r.requested_by AND f.role = 'keeper' AND f.again
  ) AS keepers_would_return,
  (
    SELECT count(*)::int FROM public.gk_feedback AS f
    WHERE f.about_user = r.requested_by AND f.role = 'keeper'
  ) AS keepers_played,
  v.id AS venue_id,
  v.lat,
  v.lng
FROM public.gk_requests AS r
INNER JOIN public.bookings AS b ON r.booking_id = b.id
INNER JOIN public.pitches AS p ON b.pitch_id = p.id
INNER JOIN public.venues AS v ON p.venue_id = v.id
INNER JOIN public.cities AS c ON v.city_id = c.id
INNER JOIN public.users AS me ON me.id = auth.uid()
WHERE r.status = 'open'
  AND b.state IN ('collecting', 'paid', 'confirmed')
  AND b.starts_at > now()
  AND v.city_id = me.city_id
  AND public.gk_audience_ok(me.goes_in_goal, r.shape, b.starts_at)
  -- a keeper place is still open (gk_open_places, inlined: that helper is
  -- not the caller's to execute, and a view's function calls run as him)
  AND b.gk_slots > (
    SELECT count(*) FROM public.booking_participants AS x
    WHERE
      x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'gk'
      AND x.replacing_since IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.booking_participants AS x
    WHERE x.booking_id = b.id AND x.user_id = auth.uid() AND x.status = 'in'
  );

-- ════════════════════════════════════════════════════════════════════
-- 4. fixture_preview
-- ════════════════════════════════════════════════════════════════════
DROP FUNCTION public.fixture_preview(text);

CREATE FUNCTION public.fixture_preview(p_invite_token text)
RETURNS TABLE (
  booking_id         uuid,
  starts_at          timestamptz,
  ends_at            timestamptz,
  pitch_type         text,
  pitch_name         text,
  venue_name         text,
  city_name_en       text,
  city_name_gr       text,
  gk_open            int,
  outfield_open      int,
  joinable           boolean,
  is_split           boolean,
  share_amount_cents int,
  gk_replacing       int,
  outfield_replacing int,
  lat                double precision,
  lng                double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    b.id,
    b.starts_at,
    b.ends_at,
    p.type,
    p.name,
    v.name,
    c.name_en,
    c.name_gr,
    b.gk_slots - (
      SELECT count(*) FROM public.booking_participants AS x
      WHERE x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'gk'
    )::int,
    b.outfield_slots - (
      SELECT count(*) FROM public.booking_participants AS x
      WHERE x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'outfield'
    )::int,
    (b.state IN ('pending', 'paid', 'confirmed', 'collecting') AND b.starts_at > now()),
    b.is_split,
    b.share_amount_cents,
    (
      SELECT count(*) FROM public.booking_participants AS x
      WHERE x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'gk'
        AND x.replacing_since IS NOT NULL
    )::int,
    (
      SELECT count(*) FROM public.booking_participants AS x
      WHERE x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'outfield'
        AND x.replacing_since IS NOT NULL
    )::int,
    v.lat,
    v.lng
  FROM public.bookings AS b
  INNER JOIN public.pitches AS p ON b.pitch_id = p.id
  INNER JOIN public.venues AS v ON p.venue_id = v.id
  INNER JOIN public.cities AS c ON v.city_id = c.id
  WHERE b.invite_token = p_invite_token;
$$;
REVOKE ALL ON FUNCTION public.fixture_preview(text) FROM public;
GRANT EXECUTE ON FUNCTION public.fixture_preview(text) TO anon, authenticated;

COMMENT ON FUNCTION public.fixture_preview(text) IS
'What an invite link shows before you are on the roster: when, where, '
'format, spots open, whether it can still be joined, on a split fixture '
'what a slot costs, how many seats players are waiting to hand over '
'(ADR-0044), and the venue''s point (plans/maps.md). Never names, never '
'the booking code.';

-- ════════════════════════════════════════════════════════════════════
-- 5. The island: live venues with a page, for the site's map
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.venue_pins()
RETURNS TABLE (
  slug text,
  name text,
  lat double precision,
  lng double precision,
  city_code text,
  courts int,
  bookable boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    v.slug,
    v.name,
    v.lat,
    v.lng,
    c.code,
    (
      SELECT count(*)::int FROM public.pitches AS p
      WHERE p.venue_id = v.id AND p.is_active AND p.is_verified
    ),
    v.stripe_account_status = 'active' AND EXISTS (
      SELECT 1 FROM public.pitches AS p
      WHERE p.venue_id = v.id AND p.is_active AND p.is_verified
    )
  FROM public.venues AS v
  INNER JOIN public.cities AS c ON v.city_id = c.id
  WHERE v.is_active AND v.slug IS NOT NULL AND v.lat IS NOT NULL
  ORDER BY v.name;
$$;

COMMENT ON FUNCTION public.venue_pins() IS
'Every active venue with a page, as a pin (plans/maps.md): the site''s '
'island map and the venue page''s own map. Readable signed out.';

-- ════════════════════════════════════════════════════════════════════
-- 6. Your grounds: where the caller has played, by completed games
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.my_grounds()
RETURNS TABLE (
  venue_id uuid,
  name text,
  slug text,
  lat double precision,
  lng double precision,
  games int,
  last_played timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    v.id,
    v.name,
    v.slug,
    v.lat,
    v.lng,
    count(DISTINCT b.id)::int,
    max(b.ends_at)
  FROM public.booking_participants AS bp
  INNER JOIN public.bookings AS b ON bp.booking_id = b.id AND b.state = 'completed'
  INNER JOIN public.pitches AS p ON b.pitch_id = p.id
  INNER JOIN public.venues AS v ON p.venue_id = v.id
  WHERE bp.user_id = auth.uid() AND bp.status = 'in'
  GROUP BY v.id, v.name, v.slug, v.lat, v.lng
  ORDER BY count(DISTINCT b.id) DESC, max(b.ends_at) DESC;
$$;

COMMENT ON FUNCTION public.my_grounds() IS
'The caller''s grounds (plans/maps.md): the venues of their completed '
'games, counted the way my_record() counts - a seat in, a completed '
'booking. Own data only.';

REVOKE ALL ON FUNCTION public.venue_pins() FROM public;
REVOKE ALL ON FUNCTION public.my_grounds() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.venue_pins() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_grounds() TO authenticated;
