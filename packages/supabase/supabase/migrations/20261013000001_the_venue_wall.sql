-- 20261013000001_the_venue_wall.sql
-- The venue's wall (plans/venue-wall.md, ADR-0043): the lobby screen
-- shows, beside each booked block, the seats an opened fixture is still
-- short of, and the screen carries that fixture's invite so a man at the
-- counter can join from his phone before he leaves.
--
-- One function re-stated: public_venue_schedule gains, per item, the
-- open-seat counts and the join token - only where the community board
-- (v_open_fixtures, ADR-0028) would list the same fixture: organiser
-- opened it, live (collecting/paid/confirmed), not kicked off, short at
-- least one player. Every other item reads exactly as before. Counts,
-- never names: the same minimisation as the board and fixture_preview.
--
-- Re-stated from 20260917000002 with three keys added to each item.

CREATE OR REPLACE FUNCTION public.public_venue_schedule(p_token text, p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today  date := (now() AT TIME ZONE 'Europe/Nicosia')::date;
  v_date   date := coalesce(p_date, v_today);
  v_venue  record;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 32 THEN
    RETURN NULL;
  END IF;
  SELECT v.id, v.name INTO v_venue
  FROM public.venue_displays AS d
  INNER JOIN public.venues AS v ON v.id = d.venue_id
  WHERE d.token = p_token AND v.is_active;
  IF v_venue.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_date NOT BETWEEN v_today - 1 AND v_today + 31 THEN
    v_date := v_today;
  END IF;

  RETURN jsonb_build_object(
    'venue', v_venue.name,
    'date', v_date,
    'courts', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'type', p.type,
          -- a joined court lists its halves, so a screen can show the
          -- physical courts and put a 7v7 booking on both
          'parts', coalesce((
            SELECT jsonb_agg(c.child_pitch_id)
            FROM public.pitch_components AS c
            WHERE c.parent_pitch_id = p.id
          ), '[]'::jsonb)
        ) ORDER BY p.name
      )
      FROM public.pitches AS p
      WHERE p.venue_id = v_venue.id AND p.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'pitch_id', b.pitch_id,
          'starts_at', b.starts_at,
          'ends_at', b.ends_at,
          'kind', CASE WHEN m.id IS NULL THEN 'booked' ELSE 'cfa' END,
          'category', m.category,
          'home', m.home_team,
          'away', m.away_team,
          'round', m.round_label,
          -- the wall: present only while the board would list it
          'open_gk', CASE WHEN w.listed THEN w.gk_open END,
          'open_outfield', CASE WHEN w.listed THEN w.outfield_open END,
          'share_cents', CASE WHEN w.listed AND b.is_split THEN b.share_amount_cents END,
          'join', CASE WHEN w.listed THEN b.invite_token END
        ) ORDER BY b.starts_at, b.pitch_id
      )
      FROM public.bookings AS b
      INNER JOIN public.pitches AS p ON p.id = b.pitch_id
      LEFT JOIN public.cfa_matches AS m ON m.booking_id = b.id
      CROSS JOIN LATERAL (
        SELECT
          s.gk_open,
          s.outfield_open,
          (
            b.is_open
            AND b.state IN ('collecting', 'paid', 'confirmed')
            AND b.starts_at > now()
            AND (s.gk_open > 0 OR s.outfield_open > 0)
          ) AS listed
        FROM (
          SELECT
            coalesce(b.gk_slots, 0) - count(*) FILTER (WHERE x.slot_kind = 'gk')::int AS gk_open,
            coalesce(b.outfield_slots, 0) - count(*) FILTER (WHERE x.slot_kind = 'outfield')::int AS outfield_open
          FROM public.booking_participants AS x
          WHERE x.booking_id = b.id AND x.status = 'in'
        ) AS s
      ) AS w
      WHERE p.venue_id = v_venue.id
        AND p.is_active
        AND b.state IN ('pending', 'collecting', 'paid', 'confirmed', 'completed')
        AND (b.starts_at AT TIME ZONE 'Europe/Nicosia')::date = v_date
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.public_venue_schedule(text, date) IS
'Public schedule screen of a venue, by its display link. CFA matches in full; '
'every other booking as booked only - no names, no phones. An opened, live, '
'short fixture also carries its open-seat counts and invite token (ADR-0043), '
'exactly the set the community board lists.';

GRANT EXECUTE ON FUNCTION public.public_venue_schedule(text, date) TO anon, authenticated;
