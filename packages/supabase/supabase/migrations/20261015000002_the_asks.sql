-- 20261015000002_the_asks.sql
-- The asks are minted (plans/reach.md R4, ADR-0048): a keeper wanted goes
-- to the willing players the pool already reaches; a seat handed over
-- goes to the crew the board already shows it to; and the answers —
-- a keeper found, a seat taken, a game full — go to the one who asked.
-- Every audience is the query the feature already uses, restated once
-- here for the ledger; the player's two switches and the quiet hours
-- are mint_player_notice's.
--
-- Contents:
--   1. keeper_wanted — on gk_post, and widened every five minutes as the
--      reserve comes into range
--   2. keeper_found  — on gk_claim, to the organiser
--   3. seat_offered  — on ask_replacement, to the crew
--   4. seat_taken    — when the swap is done, to the one who asked
--   5. game_full     — when the last seat fills, to the organiser
--   6. the clock     — ludi-mint-keeper-asks

-- ════════════════════════════════════════════════════════════════════
-- 1. Keeper wanted
-- ════════════════════════════════════════════════════════════════════
-- The audience is v_keeper_requests' WHERE, seen from the request's side:
-- the venue's city, willing for this shape at this notice
-- (gk_audience_ok), not the organiser, not already on the roster. The
-- reserve ("rotation") comes into range 48 hours before kickoff, so the
-- clock calls this again for every open request until then; the ledger
-- mints each player once.
CREATE OR REPLACE FUNCTION public.mint_keeper_wanted(p_request_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req record;
  v_who record;
  v_n int := 0;
BEGIN
  SELECT
    r.id, r.booking_id, r.requested_by, r.shape, b.starts_at, b.state, b.gk_slots, v.city_id
  INTO v_req
  FROM public.gk_requests AS r
  INNER JOIN public.bookings AS b ON b.id = r.booking_id
  INNER JOIN public.pitches AS p ON p.id = b.pitch_id
  INNER JOIN public.venues AS v ON v.id = p.venue_id
  WHERE r.id = p_request_id AND r.status = 'open';
  IF NOT FOUND
    OR v_req.state NOT IN ('collecting', 'paid', 'confirmed')
    OR v_req.starts_at <= now()
    OR v_req.gk_slots <= (
      SELECT count(*) FROM public.booking_participants AS x
      WHERE x.booking_id = v_req.booking_id AND x.status = 'in' AND x.slot_kind = 'gk'
        AND x.replacing_since IS NULL
    )
  THEN
    RETURN 0;
  END IF;

  FOR v_who IN
    SELECT u.id FROM public.users AS u
    WHERE u.city_id = v_req.city_id
      AND u.id <> v_req.requested_by
      AND u.anonymized_at IS NULL
      AND public.gk_audience_ok(u.goes_in_goal, v_req.shape, v_req.starts_at)
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_participants AS x
        WHERE x.booking_id = v_req.booking_id AND x.user_id = u.id AND x.status = 'in'
      )
  LOOP
    v_n := v_n + public.mint_player_notice(v_who.id, 'keeper_wanted', v_req.booking_id, v_req.id);
  END LOOP;
  RETURN v_n;
END;
$$;

-- Every five minutes, every open request still worth asking: the reserve
-- that was out of range at posting comes into it.
CREATE OR REPLACE FUNCTION public.mint_keeper_asks()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req record;
  v_n int := 0;
BEGIN
  FOR v_req IN
    SELECT r.id FROM public.gk_requests AS r
    INNER JOIN public.bookings AS b ON b.id = r.booking_id
    WHERE r.status = 'open' AND b.starts_at > now()
  LOOP
    v_n := v_n + public.mint_keeper_wanted(v_req.id);
  END LOOP;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_gk_requests_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF tg_op = 'INSERT' AND NEW.status = 'open' THEN
    PERFORM public.mint_keeper_wanted(NEW.id);
  ELSIF tg_op = 'UPDATE' AND NEW.status = 'claimed' AND OLD.status = 'open' THEN
    -- 2. Keeper found: the organiser, with the keeper's name in the
    --    context the sender reads (claim_player_notifications joins
    --    gk_requests.claimed_by).
    PERFORM public.mint_player_notice(NEW.requested_by, 'keeper_found', NEW.booking_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_gk_requests_notify
AFTER INSERT OR UPDATE OF status ON public.gk_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_gk_requests_notify();

-- ════════════════════════════════════════════════════════════════════
-- 3. Seat offered — the crew
-- ════════════════════════════════════════════════════════════════════
-- v_crew_seats' audience from the seat's side: players who finished a
-- match with the one asking or with the organiser, not on this roster,
-- not the asker, not the organiser. ask_replacement sets
-- replacing_since; a reverted paid swap sets it again, and the ledger
-- does not tell the crew twice.
CREATE OR REPLACE FUNCTION public.mint_seat_offered(p_participant_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seat record;
  v_who record;
  v_n int := 0;
BEGIN
  SELECT bp.id, bp.booking_id, bp.user_id, b.user_id AS organiser_id, b.state, b.starts_at
  INTO v_seat
  FROM public.booking_participants AS bp
  INNER JOIN public.bookings AS b ON b.id = bp.booking_id
  WHERE bp.id = p_participant_id AND bp.status = 'in' AND bp.replacing_since IS NOT NULL;
  IF NOT FOUND OR v_seat.state NOT IN ('paid', 'confirmed') OR v_seat.starts_at <= now() THEN
    RETURN 0;
  END IF;

  FOR v_who IN
    SELECT DISTINCT mine.user_id
    FROM public.booking_participants AS mine
    INNER JOIN public.booking_participants AS theirs
      ON mine.booking_id = theirs.booking_id AND theirs.status = 'in'
    INNER JOIN public.bookings AS played
      ON mine.booking_id = played.id AND played.state = 'completed'
    WHERE mine.status = 'in'
      AND theirs.user_id IN (v_seat.user_id, v_seat.organiser_id)
      AND mine.user_id NOT IN (v_seat.user_id, v_seat.organiser_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_participants AS x
        WHERE x.booking_id = v_seat.booking_id AND x.user_id = mine.user_id AND x.status = 'in'
      )
  LOOP
    v_n := v_n + public.mint_player_notice(v_who.user_id, 'seat_offered', v_seat.booking_id, v_seat.id);
  END LOOP;
  RETURN v_n;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 5. Game full — the organiser
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mint_game_full(p_booking_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_b record;
  v_gk int;
  v_out int;
BEGIN
  SELECT b.id, b.user_id, b.state, b.gk_slots, b.outfield_slots, b.origin, b.series_id
  INTO v_b
  FROM public.bookings AS b WHERE b.id = p_booking_id;
  IF NOT FOUND OR v_b.state NOT IN ('paid', 'confirmed') OR v_b.origin = 'walk_in' OR v_b.series_id IS NOT NULL THEN
    RETURN 0;
  END IF;
  SELECT
    count(*) FILTER (WHERE x.slot_kind = 'gk'),
    count(*) FILTER (WHERE x.slot_kind = 'outfield')
  INTO v_gk, v_out
  FROM public.booking_participants AS x
  WHERE x.booking_id = p_booking_id AND x.status = 'in';
  IF v_gk < v_b.gk_slots OR v_out < v_b.outfield_slots THEN
    RETURN 0;
  END IF;
  RETURN public.mint_player_notice(v_b.user_id, 'game_full', v_b.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_booking_participants_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF tg_op = 'UPDATE' AND OLD.replacing_since IS NULL AND NEW.replacing_since IS NOT NULL THEN
    PERFORM public.mint_seat_offered(NEW.id);
  END IF;
  IF NEW.status = 'in' AND (tg_op = 'INSERT' OR OLD.status <> 'in' OR OLD.slot_kind <> NEW.slot_kind) THEN
    PERFORM public.mint_game_full(NEW.booking_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_booking_participants_notify
AFTER INSERT OR UPDATE OF status, slot_kind, replacing_since ON public.booking_participants
FOR EACH ROW EXECUTE FUNCTION public.tg_booking_participants_notify();

-- ════════════════════════════════════════════════════════════════════
-- 4. Seat taken — the one who asked
-- ════════════════════════════════════════════════════════════════════
-- A free swap is born done; a paid one is done when the webhook settles
-- it (and failed when it reverts, which tells nobody — the seat is the
-- asker's again and the crew was told once).
CREATE OR REPLACE FUNCTION public.tg_seat_swaps_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_leaver uuid;
BEGIN
  IF NEW.status = 'done' AND (tg_op = 'INSERT' OR OLD.status <> 'done') THEN
    SELECT bp.user_id INTO v_leaver FROM public.booking_participants AS bp WHERE bp.id = NEW.from_participant_id;
    IF v_leaver IS NOT NULL THEN
      PERFORM public.mint_player_notice(v_leaver, 'seat_taken', NEW.booking_id, NEW.from_participant_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_seat_swaps_notify
AFTER INSERT OR UPDATE OF status ON public.seat_swaps
FOR EACH ROW EXECUTE FUNCTION public.tg_seat_swaps_notify();

REVOKE ALL ON FUNCTION public.mint_keeper_wanted(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.mint_keeper_asks() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.mint_seat_offered(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.mint_game_full(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_gk_requests_notify() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_booking_participants_notify() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_seat_swaps_notify() FROM public, anon, authenticated;

COMMENT ON FUNCTION public.mint_keeper_wanted(uuid) IS
'Mints keeper_wanted for every willing player the request reaches — the '
'venue''s city, gk_audience_ok for the shape and the notice, not the '
'organiser, not on the roster — while the request is open, the game is '
'live and a keeper place is open (ADR-0048, plans/reach.md R4).';
COMMENT ON FUNCTION public.mint_keeper_asks() IS
'Every open request again, every five minutes: the reserve comes into '
'range 48 hours out; the ledger mints each player once.';
COMMENT ON FUNCTION public.mint_seat_offered(uuid) IS
'Mints seat_offered for the crew of a seat up for grabs: players who '
'finished a match with the one asking or with the organiser, not on this '
'roster (ADR-0044''s v_crew_seats, from the seat''s side).';
COMMENT ON FUNCTION public.mint_game_full(uuid) IS
'Mints game_full for the organiser the moment every seat is in, once.';

-- ════════════════════════════════════════════════════════════════════
-- 6. The clock
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron unavailable; skipping mint-keeper-asks schedule.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;

  PERFORM cron.schedule(
    'ludi-mint-keeper-asks',
    '*/5 * * * *',
    $cmd$SELECT public.mint_keeper_asks();$cmd$
  );

  RAISE NOTICE 'Scheduled ludi-mint-keeper-asks every 5 minutes.';
END;
$$;
