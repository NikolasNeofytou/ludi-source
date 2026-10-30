-- 20260902000003_community_v3.sql
-- Community v3 - the organiser & the thread (plans/community-v3.md).
-- The second research pass found two nouns every highly-rated
-- sport-social community surface has and ours does not: the organiser,
-- and the recurring series. Three reads, no new tables, no new
-- writable state - all of it makes v2's already-shipped substrate
-- visible, and every one of them is correct at a single user.
--   1. my_fixtures_to_fill() - the organiser lane: my upcoming
--      fixtures that still have seats.
--   2. v_open_fixtures.played_with_squad - the familiarity signal, the
--      counts-never-names answer to "should I join this?".
--   3. my_series() - the thread: my repeated slot at a venue, read out
--      of fixtures I actually stood on.

-- ════════════════════════════════════════════════════════════════════
-- 1. The organiser lane
-- ════════════════════════════════════════════════════════════════════
-- Caller-scoped by construction: the WHERE pins b.user_id to
-- auth.uid(), so this can only ever answer about the caller's own
-- fixtures. Definer because bookings is locked down and the seat
-- arithmetic reads booking_participants.
--
-- Deliberately NOT filtered on b.is_open. v_open_fixtures answers
-- "what is on the public board"; this answers "what of mine still
-- needs people", which is true whether or not the organiser listed it.
-- A fixture short of players is the organiser's problem either way,
-- and the share link is the tool either way.
CREATE OR REPLACE FUNCTION public.my_fixtures_to_fill()
RETURNS TABLE (
  booking_id     uuid,
  starts_at      timestamptz,
  ends_at        timestamptz,
  pitch_type     text,
  pitch_name     text,
  venue_name     text,
  city_name_en   text,
  city_name_gr   text,
  gk_open        int,
  outfield_open  int,
  is_open        boolean,
  invite_token   text
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    f.is_open,
    f.invite_token
  FROM (
    SELECT
      b.id           AS booking_id,
      b.starts_at,
      b.ends_at,
      p.type         AS pitch_type,
      p.name         AS pitch_name,
      v.name         AS venue_name,
      c.name_en      AS city_name_en,
      c.name_gr      AS city_name_gr,
      b.gk_slots       - (SELECT count(*) FROM public.booking_participants x
                           WHERE x.booking_id = b.id AND x.status = 'in'
                             AND x.slot_kind = 'gk')::int
                     AS gk_open,
      b.outfield_slots - (SELECT count(*) FROM public.booking_participants x
                           WHERE x.booking_id = b.id AND x.status = 'in'
                             AND x.slot_kind = 'outfield')::int
                     AS outfield_open,
      b.is_open,
      b.invite_token
    FROM public.bookings b
    JOIN public.pitches  p ON p.id = b.pitch_id
    JOIN public.venues   v ON v.id = p.venue_id
    JOIN public.cities   c ON c.id = v.city_id
    WHERE b.user_id = auth.uid()
      AND b.state IN ('collecting', 'paid', 'confirmed')
      AND b.starts_at > now()
  ) f
  WHERE f.gk_open > 0 OR f.outfield_open > 0
  ORDER BY f.starts_at;
$$;

COMMENT ON FUNCTION public.my_fixtures_to_fill() IS
  'The organiser lane (community-v3.md): the caller''s upcoming '
  'fixtures that still have empty seats, with the invite token for the '
  'share. Own fixtures only - the predicate pins b.user_id to '
  'auth.uid(). Listed or not: a fixture short of players needs filling '
  'either way.';

REVOKE ALL ON FUNCTION public.my_fixtures_to_fill() FROM public;
REVOKE ALL ON FUNCTION public.my_fixtures_to_fill() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_fixtures_to_fill() TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2. The familiarity signal on the board
-- ════════════════════════════════════════════════════════════════════
-- The research says a board row must answer "should I join?" before
-- the tap, and every comp answers it by naming the host. We rejected
-- that on 2026-09-01 (identity on a stranger-visible surface, against
-- ADR-0012/0021) and it stays rejected. This is the counts-never-names
-- form of the same answer, and it stands on the argument 20260902000001
-- already accepted for `played_with_you`: the number is SYMMETRIC. It
-- counts only fixtures the CALLER themselves stood on, so it discloses
-- nothing about a stranger's history the caller was not part of. A
-- viewer with no history reads 0 and the client hides the line.
--
-- Re-stated in full with the column APPENDED at the end - the only
-- shape CREATE OR REPLACE VIEW permits, and the shape that preserves
-- the grants from 20260831000003.
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
    f.played_with_squad
  FROM (
    SELECT
      b.id                        AS booking_id,
      b.starts_at,
      b.ends_at,
      p.type                      AS pitch_type,
      p.name                      AS pitch_name,
      v.name                      AS venue_name,
      c.name_en                   AS city_name_en,
      c.name_gr                   AS city_name_gr,
      b.gk_slots       - (SELECT count(*) FROM public.booking_participants x
                           WHERE x.booking_id = b.id AND x.status = 'in'
                             AND x.slot_kind = 'gk')::int
                                  AS gk_open,
      b.outfield_slots - (SELECT count(*) FROM public.booking_participants x
                           WHERE x.booking_id = b.id AND x.status = 'in'
                             AND x.slot_kind = 'outfield')::int
                                  AS outfield_open,
      b.is_split,
      b.share_amount_cents,
      b.invite_token,
      b.total_cents,
      b.gk_slots,
      b.outfield_slots,
      b.open_level,
      -- How many of the seated squad the viewer has completed a match
      -- with. Never who.
      (SELECT count(DISTINCT seat.user_id)::int
         FROM public.booking_participants seat
        WHERE seat.booking_id = b.id
          AND seat.status = 'in'
          AND seat.user_id <> auth.uid()
          AND EXISTS (
            SELECT 1
              FROM public.booking_participants mine
              JOIN public.booking_participants theirs
                ON theirs.booking_id = mine.booking_id
               AND theirs.user_id = seat.user_id
               AND theirs.status = 'in'
              JOIN public.bookings shared
                ON shared.id = mine.booking_id
               AND shared.state = 'completed'
             WHERE mine.user_id = auth.uid()
               AND mine.status = 'in'
          ))                      AS played_with_squad
    FROM public.bookings b
    JOIN public.pitches  p ON p.id = b.pitch_id
    JOIN public.venues   v ON v.id = p.venue_id
    JOIN public.cities   c ON c.id = v.city_id
    WHERE b.is_open
      AND b.state IN ('collecting', 'paid', 'confirmed')
      AND b.starts_at > now()
  ) f
  WHERE f.gk_open > 0 OR f.outfield_open > 0;

-- Grants survive CREATE OR REPLACE (the view keeps its identity); the
-- posture is re-stated so a reader of this file sees it in place.
REVOKE ALL ON public.v_open_fixtures FROM anon;
GRANT SELECT ON public.v_open_fixtures TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 3. The thread
-- ════════════════════════════════════════════════════════════════════
-- "Tuesdays at Camares" as one object instead of four unrelated rows.
--
-- Keyboard simplification against the plan: the plan proposed walking
-- rebooked_from recursively AND grouping by slot. The recursive walk
-- earns nothing once the grouping key exists - the group collapses the
-- same slot whether the bookings were chained by "book again" or made
-- one at a time, and grouping catches the repeat organiser who never
-- used the rebook flow. rebooked_from remains the creation-side link
-- and C3's trigger instrument (community-v2.md §3); this read does not
-- need it.
--
-- Two or more completed fixtures is the floor: one match is not a
-- thread, and a floor of 2 is what keeps this section honest on an
-- empty account rather than dressing a single game up as a habit.
--
-- Weekday and hour are Europe/Nicosia, not UTC - the series a player
-- recognises is "Tuesday 8pm", which is a local-clock fact.
CREATE OR REPLACE FUNCTION public.my_series()
RETURNS TABLE (
  venue_name      text,
  city_name_en    text,
  city_name_gr    text,
  pitch_type      text,
  weekday         int,
  kickoff_hour    int,
  played          int,
  last_played_at  timestamptz,
  next_booking_id uuid,
  next_starts_at  timestamptz
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH mine AS (
    SELECT
      b.id,
      b.starts_at,
      b.state,
      v.name     AS venue_name,
      c.name_en  AS city_name_en,
      c.name_gr  AS city_name_gr,
      p.type     AS pitch_type,
      EXTRACT(isodow FROM b.starts_at AT TIME ZONE 'Europe/Nicosia')::int AS weekday,
      EXTRACT(hour  FROM b.starts_at AT TIME ZONE 'Europe/Nicosia')::int  AS kickoff_hour
    FROM public.booking_participants bp
    JOIN public.bookings b ON b.id = bp.booking_id
    JOIN public.pitches  p ON p.id = b.pitch_id
    JOIN public.venues   v ON v.id = p.venue_id
    JOIN public.cities   c ON c.id = v.city_id
    WHERE bp.user_id = auth.uid()
      AND bp.status  = 'in'
      AND b.state IN ('completed', 'collecting', 'paid', 'confirmed')
  )
  SELECT
    m.venue_name,
    m.city_name_en,
    m.city_name_gr,
    m.pitch_type,
    m.weekday,
    m.kickoff_hour,
    count(*) FILTER (WHERE m.state = 'completed')::int  AS played,
    max(m.starts_at) FILTER (WHERE m.state = 'completed') AS last_played_at,
    (ARRAY_AGG(m.id ORDER BY m.starts_at)
       FILTER (WHERE m.starts_at > now()))[1]           AS next_booking_id,
    (ARRAY_AGG(m.starts_at ORDER BY m.starts_at)
       FILTER (WHERE m.starts_at > now()))[1]           AS next_starts_at
  FROM mine m
  GROUP BY
    m.venue_name, m.city_name_en, m.city_name_gr,
    m.pitch_type, m.weekday, m.kickoff_hour
  HAVING count(*) FILTER (WHERE m.state = 'completed') >= 2
  ORDER BY max(m.starts_at) DESC;
$$;

COMMENT ON FUNCTION public.my_series() IS
  'The thread (community-v3.md): the caller''s repeated slot - venue, '
  'format, local weekday and kickoff hour - with how many they have '
  'played, when they last played it, and the next one if it is booked. '
  'Own fixtures only. Two completed matches is the floor: one is not a '
  'series.';

REVOKE ALL ON FUNCTION public.my_series() FROM public;
REVOKE ALL ON FUNCTION public.my_series() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_series() TO authenticated;
