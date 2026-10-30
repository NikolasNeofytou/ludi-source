-- 20261016000002_cfa_follow_and_notices.sql
-- A parent follows a CFA team, and is told (plans/cfa-in-the-app.md K2,
-- K3, K4, K6, K7; ADR-0051, ADR-0048).
--
-- A follow is a private subscription from a player to a team's fixtures:
-- readable by its player only, never counted, never listed. It points at a
-- team row; every read and every notice expands it to the same team (name +
-- category + group) in any Ludi venue's CFA competition of that season.
--
-- Contents:
--   1. team_follows + follow_team / unfollow_team (CFA teams only)
--   2. match_followers — who follows either team of a match
--   3. the app's reads: venue_fixtures (K2), my_team_fixtures (K3),
--      cfa_today_nearby (K7) — authenticated, never a CFA score
--   4. the ledger widens: a team notice is about a match, not a booking
--      (booking_id nullable for those kinds only), four kinds added
--   5. mint_player_notice and quiet hours learn the new kinds
--   6. the causes: a match loaded (team_programme), a change written
--      (team_changed), an hour before (team_reminder, in the R5 sweep)
--   7. ask_parents — the organiser asks the parents who play (K6)
--   8. claim_player_notifications renders a notice with no booking

-- ════════════════════════════════════════════════════════════════════
-- 1. The follow
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE public.team_follows (
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.competition_teams (id) ON DELETE CASCADE,
  -- "I play too": the parent may be asked to the parents' game at the
  -- venue this team plays at (K6, an ask under the R4 rules)
  plays boolean NOT NULL DEFAULT FALSE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, team_id)
);

CREATE INDEX team_follows_team_idx ON public.team_follows (team_id);

COMMENT ON TABLE public.team_follows IS
'A player''s private subscription to a CFA team''s fixtures (ADR-0051). '
'Readable by its player only — never counted, listed or shown to anyone, '
'the venue''s owner included. Written through follow_team / unfollow_team.';

ALTER TABLE public.team_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_follows_select_own ON public.team_follows
FOR SELECT TO authenticated
USING (user_id = auth.uid());

REVOKE ALL ON public.team_follows FROM public, anon;
REVOKE INSERT, UPDATE, DELETE ON public.team_follows FROM authenticated;
GRANT SELECT ON public.team_follows TO authenticated;

CREATE OR REPLACE FUNCTION public.follow_team(p_team_id uuid, p_plays boolean DEFAULT FALSE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'follow_team: sign in first' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.competition_teams AS t
    INNER JOIN public.competitions AS c ON c.id = t.competition_id
    WHERE t.id = p_team_id AND c.kind = 'cfa_grassroots'
  ) THEN
    RAISE EXCEPTION 'follow_team: no such CFA team' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM public.team_follows WHERE user_id = v_me AND team_id <> p_team_id) >= 20 THEN
    RAISE EXCEPTION 'follow_team: twenty teams at most' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.team_follows (user_id, team_id, plays)
  VALUES (v_me, p_team_id, coalesce(p_plays, FALSE))
  ON CONFLICT (user_id, team_id) DO UPDATE SET plays = excluded.plays;
END;
$$;

CREATE OR REPLACE FUNCTION public.unfollow_team(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unfollow_team: sign in first' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.team_follows WHERE user_id = auth.uid() AND team_id = p_team_id;
END;
$$;

REVOKE ALL ON FUNCTION public.follow_team(uuid, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.unfollow_team(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.follow_team(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unfollow_team(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2. Who follows a match
-- ════════════════════════════════════════════════════════════════════
-- Either team, by its key, in any Ludi venue's competition of the same
-- kind and season.
CREATE OR REPLACE FUNCTION public.match_followers(p_match_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT f.user_id
  FROM public.competition_matches AS m
  INNER JOIN public.competitions AS c ON c.id = m.competition_id
  INNER JOIN public.competition_teams AS mt ON mt.id IN (m.home_team_id, m.away_team_id)
  INNER JOIN public.competition_teams AS ft
    ON lower(btrim(ft.name)) = lower(btrim(mt.name))
    AND lower(btrim(coalesce(ft.category, ''))) = lower(btrim(coalesce(mt.category, '')))
    AND lower(btrim(coalesce(ft.group_label, ''))) = lower(btrim(coalesce(mt.group_label, '')))
  INNER JOIN public.competitions AS fc
    ON fc.id = ft.competition_id AND fc.kind = c.kind AND fc.season = c.season
  INNER JOIN public.team_follows AS f ON f.team_id = ft.id
  WHERE m.id = p_match_id
$$;

REVOKE ALL ON FUNCTION public.match_followers(uuid) FROM public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 3. What the app reads
-- ════════════════════════════════════════════════════════════════════
-- K2: a venue's competition matches between two dates (a fortnight at
-- most), at the venue only (no away rows), not cancelled. A score only
-- where the competition's scores are public — never for CFA (ADR-0050,
-- amended). following_* tell the caller which teams they follow.
CREATE OR REPLACE FUNCTION public.venue_fixtures(p_venue_id uuid, p_from date, p_to date)
RETURNS TABLE (
  match_id uuid,
  competition_kind text,
  kickoff_at timestamptz,
  ends_at timestamptz,
  court text,
  category text,
  round_label text,
  status text,
  home_team_id uuid,
  home text,
  away_team_id uuid,
  away text,
  home_score smallint,
  away_score smallint,
  following_home boolean,
  following_away boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'venue_fixtures: sign in first' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 14 THEN
    RAISE EXCEPTION 'venue_fixtures: a fortnight at most' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    c.kind,
    m.kickoff_at,
    coalesce(CASE WHEN b.state = 'confirmed' THEN b.ends_at END, m.kickoff_at + interval '1 hour'),
    CASE WHEN b.state = 'confirmed' THEN p.name END,
    m.category,
    m.round_label,
    m.status,
    h.id,
    h.name,
    a.id,
    a.name,
    CASE WHEN c.scores_public THEN m.home_score END,
    CASE WHEN c.scores_public THEN m.away_score END,
    EXISTS (SELECT 1 FROM public.team_follows AS f WHERE f.user_id = v_me AND f.team_id = h.id),
    EXISTS (SELECT 1 FROM public.team_follows AS f WHERE f.user_id = v_me AND f.team_id = a.id)
  FROM public.competition_matches AS m
  INNER JOIN public.competitions AS c ON c.id = m.competition_id
  INNER JOIN public.venues AS v ON v.id = c.venue_id AND v.is_active
  INNER JOIN public.competition_teams AS h ON h.id = m.home_team_id
  INNER JOIN public.competition_teams AS a ON a.id = m.away_team_id
  LEFT JOIN public.bookings AS b ON b.id = m.booking_id
  LEFT JOIN public.pitches AS p ON p.id = b.pitch_id
  WHERE
    c.venue_id = p_venue_id
    AND m.elsewhere IS NULL
    AND m.status <> 'cancelled'
    AND (m.kickoff_at AT TIME ZONE 'Europe/Nicosia')::date BETWEEN p_from AND p_to
  ORDER BY m.kickoff_at, p.name NULLS LAST, m.category;
END;
$$;

-- K3: the caller's followed teams' matches from two hours ago to six weeks
-- ahead, across every competition holding the same team, an away match
-- stored at two Ludi venues told once (the one at a Ludi venue wins).
-- Cancelled matches stay in, marked, so a parent sees why a Saturday
-- emptied.
CREATE OR REPLACE FUNCTION public.my_team_fixtures()
RETURNS TABLE (
  match_id uuid,
  followed_team_id uuid,
  kickoff_at timestamptz,
  venue_id uuid,
  venue_name text,
  venue_lat double precision,
  venue_lng double precision,
  elsewhere text,
  court text,
  category text,
  home text,
  away text,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'my_team_fixtures: sign in first' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    x.match_id, x.followed_team_id, x.kickoff_at, x.venue_id, x.venue_name,
    x.venue_lat, x.venue_lng, x.elsewhere, x.court, x.category, x.home, x.away, x.status
  FROM (
    SELECT DISTINCT ON (m.kickoff_at, lower(btrim(h.name)), lower(btrim(a.name)), lower(coalesce(m.category, '')))
      m.id AS match_id,
      f.team_id AS followed_team_id,
      m.kickoff_at,
      CASE WHEN m.elsewhere IS NULL THEN v.id END AS venue_id,
      coalesce(m.elsewhere, v.name) AS venue_name,
      CASE WHEN m.elsewhere IS NULL THEN v.lat END AS venue_lat,
      CASE WHEN m.elsewhere IS NULL THEN v.lng END AS venue_lng,
      m.elsewhere,
      CASE WHEN b.state = 'confirmed' THEN p.name END AS court,
      m.category,
      h.name AS home,
      a.name AS away,
      m.status
    FROM public.team_follows AS f
    INNER JOIN public.competition_teams AS ft ON ft.id = f.team_id
    INNER JOIN public.competitions AS fc ON fc.id = ft.competition_id
    INNER JOIN public.competition_teams AS mt
      ON lower(btrim(mt.name)) = lower(btrim(ft.name))
      AND lower(btrim(coalesce(mt.category, ''))) = lower(btrim(coalesce(ft.category, '')))
      AND lower(btrim(coalesce(mt.group_label, ''))) = lower(btrim(coalesce(ft.group_label, '')))
    INNER JOIN public.competitions AS c
      ON c.id = mt.competition_id AND c.kind = fc.kind AND c.season = fc.season
    INNER JOIN public.competition_matches AS m
      ON m.competition_id = c.id AND mt.id IN (m.home_team_id, m.away_team_id)
    INNER JOIN public.venues AS v ON v.id = c.venue_id
    INNER JOIN public.competition_teams AS h ON h.id = m.home_team_id
    INNER JOIN public.competition_teams AS a ON a.id = m.away_team_id
    LEFT JOIN public.bookings AS b ON b.id = m.booking_id
    LEFT JOIN public.pitches AS p ON p.id = b.pitch_id
    WHERE
      f.user_id = v_me
      AND m.kickoff_at >= now() - interval '2 hours'
      AND m.kickoff_at < now() + interval '42 days'
    ORDER BY
      m.kickoff_at, lower(btrim(h.name)), lower(btrim(a.name)), lower(coalesce(m.category, '')),
      (m.elsewhere IS NULL) DESC
  ) AS x
  ORDER BY x.kickoff_at;
END;
$$;

-- K7: today's CFA mornings in a city — a venue, how many matches, the next
-- kick-off still to come.
CREATE OR REPLACE FUNCTION public.cfa_today_nearby(p_city_id uuid)
RETURNS TABLE (
  venue_id uuid,
  venue_name text,
  matches int,
  next_kickoff timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'cfa_today_nearby: sign in first' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    v.id,
    v.name,
    count(*)::int,
    min(m.kickoff_at) FILTER (WHERE m.kickoff_at > now())
  FROM public.competition_matches AS m
  INNER JOIN public.competitions AS c ON c.id = m.competition_id AND c.kind = 'cfa_grassroots'
  INNER JOIN public.venues AS v ON v.id = c.venue_id AND v.is_active AND v.city_id = p_city_id
  WHERE
    m.elsewhere IS NULL
    AND m.status <> 'cancelled'
    AND (m.kickoff_at AT TIME ZONE 'Europe/Nicosia')::date = (now() AT TIME ZONE 'Europe/Nicosia')::date
  GROUP BY v.id, v.name
  ORDER BY count(*) DESC, v.name;
END;
$$;

REVOKE ALL ON FUNCTION public.venue_fixtures(uuid, date, date) FROM public, anon;
REVOKE ALL ON FUNCTION public.my_team_fixtures() FROM public, anon;
REVOKE ALL ON FUNCTION public.cfa_today_nearby(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.venue_fixtures(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_team_fixtures() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cfa_today_nearby(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. The ledger: a notice about a match
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_kind_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_kind_check CHECK (
  kind IN (
    'booking_confirmed', 'reminder', 'fixture_cancelled',
    'keeper_wanted', 'keeper_found', 'seat_offered', 'seat_taken', 'game_full',
    'team_programme', 'team_changed', 'team_reminder', 'parents_game'
  )
);
ALTER TABLE public.player_notifications ALTER COLUMN booking_id DROP NOT NULL;
-- every kind but the three about a followed team's match still names its
-- booking; those carry the match (or, for a change, the change) in ref_id
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_booking_or_team CHECK (
  booking_id IS NOT NULL
  OR (kind IN ('team_programme', 'team_changed', 'team_reminder') AND ref_id IS NOT NULL)
);

-- ════════════════════════════════════════════════════════════════════
-- 5. Minting and quiet hours know the new kinds
-- ════════════════════════════════════════════════════════════════════
-- Held at night (23:00-08:00) unless kickoff is before 11:00: the asks,
-- and now the parents' game, the programme and a change. A team's hour-
-- before reminder is never held, like the player's own.
CREATE OR REPLACE FUNCTION public.notice_send_after(
  p_kind text, p_kickoff timestamptz, p_now timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_local timestamp;
  v_release timestamptz;
BEGIN
  IF p_kind NOT IN ('keeper_wanted', 'seat_offered', 'parents_game', 'team_programme', 'team_changed') THEN
    RETURN p_now;
  END IF;
  v_local := p_now AT TIME ZONE 'Asia/Nicosia';
  IF v_local::time >= time '23:00' THEN
    v_release := (date_trunc('day', v_local) + interval '1 day 8 hours') AT TIME ZONE 'Asia/Nicosia';
  ELSIF v_local::time < time '08:00' THEN
    v_release := (date_trunc('day', v_local) + interval '8 hours') AT TIME ZONE 'Asia/Nicosia';
  ELSE
    RETURN p_now;
  END IF;
  IF p_kickoff < v_release + interval '3 hours' THEN
    RETURN p_now;
  END IF;
  RETURN v_release;
END;
$$;

-- Same contract as 20261014000004. New: the parents' game is an ask (the
-- asks switch); a team notice is the parent's own games (the games
-- switch) and has no booking — its kickoff is the match's.
CREATE OR REPLACE FUNCTION public.mint_player_notice(
  p_user_id uuid,
  p_kind text,
  p_booking_id uuid,
  p_ref_id uuid DEFAULT NULL,
  p_send_after timestamptz DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_ask boolean := p_kind IN ('keeper_wanted', 'seat_offered', 'parents_game');
  v_wants_email boolean := p_kind IN ('booking_confirmed', 'fixture_cancelled');
  v_switch boolean;
  v_erased boolean;
  v_email text;
  v_has_token boolean;
  v_kickoff timestamptz;
  v_send_after timestamptz;
  v_push_status text;
  v_push_error text;
  v_inserted int := 0;
  v_n int;
BEGIN
  SELECT
    CASE WHEN v_is_ask THEN u.notify_asks ELSE u.notify_games END,
    u.anonymized_at IS NOT NULL,
    au.email
  INTO v_switch, v_erased, v_email
  FROM public.users AS u
  LEFT JOIN auth.users AS au ON au.id = u.id
  WHERE u.id = p_user_id;
  IF NOT FOUND OR v_erased THEN
    RETURN 0;
  END IF;

  IF p_booking_id IS NOT NULL THEN
    SELECT b.starts_at INTO v_kickoff FROM public.bookings AS b WHERE b.id = p_booking_id;
  ELSIF p_kind IN ('team_programme', 'team_reminder') THEN
    SELECT m.kickoff_at INTO v_kickoff FROM public.competition_matches AS m WHERE m.id = p_ref_id;
  ELSIF p_kind = 'team_changed' THEN
    SELECT m.kickoff_at INTO v_kickoff
    FROM public.competition_match_changes AS x
    INNER JOIN public.competition_matches AS m ON m.id = x.match_id
    WHERE x.id = p_ref_id;
  END IF;
  IF v_kickoff IS NULL THEN
    RETURN 0;
  END IF;
  v_send_after := coalesce(p_send_after, public.notice_send_after(p_kind, v_kickoff));

  SELECT exists(
    SELECT 1 FROM public.push_tokens AS t
    WHERE t.user_id = p_user_id AND t.disabled_at IS NULL
  ) INTO v_has_token;

  IF NOT v_switch THEN
    v_push_status := 'skipped';
    v_push_error := 'switched_off';
  ELSIF NOT v_has_token THEN
    v_push_status := 'skipped';
    v_push_error := 'no_token';
  ELSE
    v_push_status := 'pending';
    v_push_error := NULL;
  END IF;

  INSERT INTO public.player_notifications
  (user_id, kind, booking_id, ref_id, channel, send_after, status, error)
  VALUES (p_user_id, p_kind, p_booking_id, p_ref_id, 'push', v_send_after, v_push_status, v_push_error)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_inserted := v_inserted + v_n;

  IF v_wants_email AND v_switch AND v_email IS NOT NULL THEN
    INSERT INTO public.player_notifications
    (user_id, kind, booking_id, ref_id, channel, send_after)
    VALUES (p_user_id, p_kind, p_booking_id, p_ref_id, 'email', v_send_after)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_inserted := v_inserted + v_n;
  END IF;

  RETURN v_inserted;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 6. The causes
-- ════════════════════════════════════════════════════════════════════
-- A CFA match loaded for the first time: its followers are told the
-- programme. The loader keeps a match's row across re-loads (K1), so a
-- Wednesday re-load of an unchanged round tells nobody again.
CREATE OR REPLACE FUNCTION public.tg_competition_matches_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_who record;
BEGIN
  IF NEW.status <> 'scheduled' OR NEW.kickoff_at <= now() OR NOT EXISTS (
    SELECT 1 FROM public.competitions AS c WHERE c.id = NEW.competition_id AND c.kind = 'cfa_grassroots'
  ) THEN
    RETURN NEW;
  END IF;
  FOR v_who IN SELECT f.user_id FROM public.match_followers(NEW.id) AS f LOOP
    PERFORM public.mint_player_notice(v_who.user_id, 'team_programme', NULL, NEW.id);
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_competition_matches_notify
AFTER INSERT ON public.competition_matches
FOR EACH ROW EXECUTE FUNCTION public.tg_competition_matches_notify();

-- A change written (kick-off, court, venue, status): its followers are
-- told, once per change row.
CREATE OR REPLACE FUNCTION public.tg_competition_match_changes_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_who record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.competition_matches AS m
    INNER JOIN public.competitions AS c ON c.id = m.competition_id
    WHERE m.id = NEW.match_id AND c.kind = 'cfa_grassroots' AND m.kickoff_at > now()
  ) THEN
    RETURN NEW;
  END IF;
  FOR v_who IN SELECT f.user_id FROM public.match_followers(NEW.match_id) AS f LOOP
    PERFORM public.mint_player_notice(v_who.user_id, 'team_changed', NULL, NEW.id);
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_competition_match_changes_notify
AFTER INSERT ON public.competition_match_changes
FOR EACH ROW EXECUTE FUNCTION public.tg_competition_match_changes_notify();

REVOKE ALL ON FUNCTION public.tg_competition_matches_notify() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_competition_match_changes_notify() FROM public, anon, authenticated;

-- The R5 sweep (every five minutes) gains the hour before a followed
-- team's match. Same window logic: the ten minutes before the hour,
-- overlapping a five-minute clock, the ledger deduplicating.
CREATE OR REPLACE FUNCTION public.mint_reminders(p_now timestamptz DEFAULT now())
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seat record;
  v_match record;
  v_who record;
  v_n int := 0;
BEGIN
  FOR v_seat IN
    SELECT b.id AS booking_id, bp.user_id
    FROM public.bookings AS b
    INNER JOIN public.booking_participants AS bp
      ON bp.booking_id = b.id AND bp.status = 'in'
    WHERE b.state IN ('paid', 'confirmed')
      AND b.origin = 'app'
      AND b.series_id IS NULL
      AND b.starts_at > p_now + interval '1 hour 50 minutes'
      AND b.starts_at <= p_now + interval '2 hours'
  LOOP
    v_n := v_n + public.mint_player_notice(v_seat.user_id, 'reminder', v_seat.booking_id, NULL, p_now);
  END LOOP;

  FOR v_match IN
    SELECT m.id
    FROM public.competition_matches AS m
    INNER JOIN public.competitions AS c ON c.id = m.competition_id AND c.kind = 'cfa_grassroots'
    WHERE m.status = 'scheduled'
      AND m.kickoff_at > p_now + interval '50 minutes'
      AND m.kickoff_at <= p_now + interval '1 hour'
  LOOP
    FOR v_who IN SELECT f.user_id FROM public.match_followers(v_match.id) AS f LOOP
      v_n := v_n + public.mint_player_notice(v_who.user_id, 'team_reminder', NULL, v_match.id, p_now);
    END LOOP;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 7. The parents' game (K6)
-- ════════════════════════════════════════════════════════════════════
-- The organiser of an open, upcoming fixture at a venue that hosts CFA
-- matches asks the parents who said "I play too" for a team playing
-- there this season — not anyone already in, not the organiser. Once per
-- fixture per parent (the ledger); the asks switch and quiet hours apply.
CREATE OR REPLACE FUNCTION public.ask_parents(p_booking_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_b record;
  v_who record;
  v_n int := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'ask_parents: sign in first' USING ERRCODE = '42501';
  END IF;
  SELECT b.id, b.user_id, b.state, b.is_open, b.starts_at, p.venue_id
  INTO v_b
  FROM public.bookings AS b
  INNER JOIN public.pitches AS p ON p.id = b.pitch_id
  WHERE b.id = p_booking_id;
  IF NOT FOUND OR v_b.user_id IS DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'ask_parents: not your game' USING ERRCODE = '42501';
  END IF;
  IF v_b.state NOT IN ('collecting', 'paid', 'confirmed') OR NOT v_b.is_open
    OR v_b.starts_at <= now() OR v_b.starts_at > now() + interval '7 days' THEN
    RAISE EXCEPTION 'ask_parents: an open game in the coming week' USING ERRCODE = '22023';
  END IF;

  FOR v_who IN
    SELECT DISTINCT f.user_id
    FROM public.team_follows AS f
    INNER JOIN public.competition_teams AS t ON t.id = f.team_id
    INNER JOIN public.competitions AS c
      ON c.id = t.competition_id
      AND c.kind = 'cfa_grassroots'
      AND c.venue_id = v_b.venue_id
      AND c.season = public.competition_season((v_b.starts_at AT TIME ZONE 'Europe/Nicosia')::date)
    WHERE f.plays
      AND f.user_id <> v_me
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_participants AS x
        WHERE x.booking_id = v_b.id AND x.user_id = f.user_id AND x.status = 'in'
      )
  LOOP
    v_n := v_n + public.mint_player_notice(v_who.user_id, 'parents_game', v_b.id);
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.ask_parents(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ask_parents(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 8. The sender reads a notice with no booking
-- ════════════════════════════════════════════════════════════════════
-- Same columns. The booking joins become LEFT; a team notice brings its
-- match in `context.match` (teams, category, the venue or the CFA's venue
-- name, the court, the status, the date, and what changed), and fills
-- starts_at / pitch_name / venue_name from the match.
CREATE OR REPLACE FUNCTION public.claim_player_notifications(p_limit int DEFAULT 100)
RETURNS TABLE (
  id uuid,
  kind text,
  channel text,
  user_id uuid,
  attempts int,
  locale text,
  first_name text,
  email text,
  tokens text [],
  booking_id uuid,
  code text,
  starts_at timestamptz,
  invite_token text,
  pitch_name text,
  venue_name text,
  context jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();

  UPDATE public.player_notifications AS n
  SET status = 'pending', claimed_at = NULL
  WHERE n.status = 'sending' AND n.claimed_at < now() - interval '10 minutes';

  RETURN QUERY
  WITH claimed AS (
    UPDATE public.player_notifications AS n
    SET status = 'sending', claimed_at = now(), attempts = n.attempts + 1
    WHERE n.id IN (
      SELECT p.id FROM public.player_notifications AS p
      WHERE p.status = 'pending' AND p.send_after <= now()
      ORDER BY p.send_after
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING n.id, n.kind, n.channel, n.user_id, n.attempts, n.booking_id, n.ref_id, n.created_at
  )

  SELECT
    c.id,
    c.kind,
    c.channel,
    c.user_id,
    c.attempts,
    coalesce(u.preferred_locale, 'en') AS locale,
    u.first_name,
    au.email::text,
    array(
      SELECT t.token FROM public.push_tokens AS t
      WHERE t.user_id = c.user_id AND t.disabled_at IS NULL
    ) AS tokens,
    c.booking_id,
    b.code,
    coalesce(b.starts_at, m.kickoff_at, c.created_at) AS starts_at,
    b.invite_token,
    coalesce(p.name, CASE WHEN mb.state = 'confirmed' THEN mp.name END) AS pitch_name,
    coalesce(v.name, m.elsewhere, mv.name) AS venue_name,
    jsonb_strip_nulls(jsonb_build_object(
      'shape', gk.shape,
      'keeper_name', ku.first_name,
      'slot_kind', bp.slot_kind,
      'match', CASE WHEN m.id IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
        'venue_id', CASE WHEN m.elsewhere IS NULL THEN mc.venue_id END,
        'date', to_char(m.kickoff_at AT TIME ZONE 'Europe/Nicosia', 'YYYY-MM-DD'),
        'category', m.category,
        'home', mh.name,
        'away', ma.name,
        'status', m.status,
        'what', x.what,
        'old', x.old_value,
        'new', x.new_value
      )) END
    )) AS context
  FROM claimed AS c
  INNER JOIN public.users AS u ON u.id = c.user_id
  LEFT JOIN auth.users AS au ON au.id = c.user_id
  LEFT JOIN public.bookings AS b ON b.id = c.booking_id
  LEFT JOIN public.pitches AS p ON p.id = b.pitch_id
  LEFT JOIN public.venues AS v ON v.id = p.venue_id
  LEFT JOIN public.gk_requests AS gk ON gk.id = c.ref_id
  LEFT JOIN public.users AS ku ON ku.id = gk.claimed_by
  LEFT JOIN public.booking_participants AS bp ON bp.id = c.ref_id
  LEFT JOIN public.competition_match_changes AS x
    ON c.kind = 'team_changed' AND x.id = c.ref_id
  LEFT JOIN public.competition_matches AS m
    ON m.id = CASE
      WHEN c.kind = 'team_changed' THEN x.match_id
      WHEN c.kind IN ('team_programme', 'team_reminder') THEN c.ref_id
    END
  LEFT JOIN public.competitions AS mc ON mc.id = m.competition_id
  LEFT JOIN public.venues AS mv ON mv.id = mc.venue_id
  LEFT JOIN public.bookings AS mb ON mb.id = m.booking_id
  LEFT JOIN public.pitches AS mp ON mp.id = mb.pitch_id
  LEFT JOIN public.competition_teams AS mh ON mh.id = m.home_team_id
  LEFT JOIN public.competition_teams AS ma ON ma.id = m.away_team_id;
END;
$$;
