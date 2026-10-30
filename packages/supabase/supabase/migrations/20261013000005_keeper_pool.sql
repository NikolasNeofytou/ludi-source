-- 20261013000005_keeper_pool.sql
-- The goalkeeper pool (plans/keeper-pool.md, ADR-0047), the product half of
-- docs/plans/goalkeeper-trial.md: a player says whether he will go in goal;
-- an organiser short a keeper posts the game to the pool; the first willing
-- player to claim it takes the gloves, free; afterwards both sides say
-- whether the other showed up and whether they would again.
--
-- From the trial's ladder this builds the free rungs only: the pool (a
-- full game), the reserve (twenty minutes), and the clock that widens the
-- first to the second inside 48 hours. Credits and cash wait on money.
--
-- Contents:
--   1. users.goes_in_goal - 'full' | 'rotation' | 'no'
--   2. gk_requests, gk_feedback
--   3. gk_post / gk_withdraw (organiser), gk_claim (a willing player),
--      gk_request_for (the fixture's own request), gk_feedback_give,
--      gk_feedback_due, my_keeper_record
--   4. v_keeper_requests - what a willing player sees
--   5. v_fixture_roster learns keeper_free: a keeper from the pool plays
--      free, so a split roster must not call him unpaid

-- ════════════════════════════════════════════════════════════════════
-- 1. Will you go in goal?
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.users
  ADD COLUMN goes_in_goal text NOT NULL DEFAULT 'no'
  CHECK (goes_in_goal IN ('full', 'rotation', 'no'));

COMMENT ON COLUMN public.users.goes_in_goal IS
'full = will keep goal for a whole game (the keeper pool); rotation = will '
'take 20-30 minutes (the reserve); no = never shown keeper requests '
'(ADR-0047). The player''s own setting, asked on the profile.';

CREATE INDEX users_goes_in_goal_idx ON public.users (city_id, goes_in_goal) WHERE goes_in_goal <> 'no';

-- ════════════════════════════════════════════════════════════════════
-- 2. Requests and the record
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE public.gk_requests (
  id           uuid PRIMARY KEY DEFAULT public.uuid7(),
  booking_id   uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  shape        text NOT NULL DEFAULT 'full' CHECK (shape IN ('full', 'rotation')),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'withdrawn')),
  claimed_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  claimed_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gk_requests_claim_matches_status CHECK ((status = 'claimed') = (claimed_at IS NOT NULL))
);

CREATE UNIQUE INDEX gk_requests_one_open_per_booking ON public.gk_requests (booking_id) WHERE status = 'open';
CREATE INDEX gk_requests_booking_idx ON public.gk_requests (booking_id);
CREATE INDEX gk_requests_requested_by_idx ON public.gk_requests (requested_by);
CREATE INDEX gk_requests_claimed_by_idx ON public.gk_requests (claimed_by) WHERE claimed_by IS NOT NULL;

COMMENT ON TABLE public.gk_requests IS
'An organiser short a keeper posted the game to the pool (ADR-0047). First '
'claim wins; the keeper plays free.';

CREATE TABLE public.gk_feedback (
  request_id uuid NOT NULL REFERENCES public.gk_requests (id) ON DELETE CASCADE,
  from_user  uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  about_user uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('organiser', 'keeper')),
  showed_up  boolean,
  again      boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, from_user),
  CONSTRAINT gk_feedback_showed_only_from_organiser CHECK ((role = 'organiser') = (showed_up IS NOT NULL))
);

CREATE INDEX gk_feedback_about_idx ON public.gk_feedback (about_user);
CREATE INDEX gk_feedback_from_idx ON public.gk_feedback (from_user);

COMMENT ON TABLE public.gk_feedback IS
'Two-sided, binary (goalkeeper-trial.md Mechanism 3): the organiser says '
'whether the keeper showed up and whether he would have him back; the keeper '
'says whether he would play for that team again.';

ALTER TABLE public.gk_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gk_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY gk_requests_select_own ON public.gk_requests
FOR SELECT TO authenticated
USING (requested_by = auth.uid() OR claimed_by = auth.uid() OR public.is_admin());

CREATE POLICY gk_feedback_select_own ON public.gk_feedback
FOR SELECT TO authenticated
USING (from_user = auth.uid() OR public.is_admin());

GRANT SELECT ON public.gk_requests, public.gk_feedback TO authenticated;
REVOKE ALL ON public.gk_requests, public.gk_feedback FROM anon;

-- ════════════════════════════════════════════════════════════════════
-- 3. Functions
-- ════════════════════════════════════════════════════════════════════
-- Open keeper places on a fixture: free gk slots, plus gk seats a keeper is
-- handing over (ADR-0044) that nobody paid for.
CREATE OR REPLACE FUNCTION public.gk_open_places(p_booking_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (b.gk_slots - (
      SELECT count(*) FROM public.booking_participants AS x
      WHERE x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'gk'
    ))::int
    + (
      SELECT count(*) FROM public.booking_participants AS x
      WHERE x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'gk'
        AND x.replacing_since IS NOT NULL
    )::int
  FROM public.bookings AS b
  WHERE b.id = p_booking_id;
$$;

-- Who a request reaches: the pool always; the reserve too once kickoff is
-- inside 48 hours, or straight away when only twenty minutes are asked.
CREATE OR REPLACE FUNCTION public.gk_audience_ok(p_goes text, p_shape text, p_starts_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_goes = 'full'
    OR (p_goes = 'rotation' AND (p_shape = 'rotation' OR p_starts_at - now() <= interval '48 hours'));
$$;

CREATE OR REPLACE FUNCTION public.gk_post(p_booking_id uuid, p_shape text DEFAULT 'full')
RETURNS TABLE (request_id uuid, audience int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_city    uuid;
  v_id      uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'GK_NOT_ORGANISER' USING ERRCODE = '42501';
  END IF;
  IF p_shape NOT IN ('full', 'rotation') THEN
    RAISE EXCEPTION 'GK_BAD_SHAPE' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.state NOT IN ('collecting', 'paid', 'confirmed') OR v_booking.starts_at <= now() THEN
    RAISE EXCEPTION 'GK_FIXTURE_NOT_LIVE' USING ERRCODE = 'P0001';
  END IF;
  IF public.gk_open_places(p_booking_id) <= 0 THEN
    RAISE EXCEPTION 'GK_NO_PLACE' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.id INTO v_id FROM public.gk_requests AS r WHERE r.booking_id = p_booking_id AND r.status = 'open';
  IF v_id IS NULL THEN
    INSERT INTO public.gk_requests (booking_id, requested_by, shape)
    VALUES (p_booking_id, auth.uid(), p_shape)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.gk_requests SET shape = p_shape WHERE id = v_id;
  END IF;

  SELECT v.city_id INTO v_city
  FROM public.pitches AS p
  INNER JOIN public.venues AS v ON p.venue_id = v.id
  WHERE p.id = v_booking.pitch_id;

  RETURN QUERY
  SELECT v_id, (
    SELECT count(*)::int FROM public.users AS u
    WHERE u.city_id = v_city
      AND public.gk_audience_ok(u.goes_in_goal, p_shape, v_booking.starts_at)
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_participants AS x
        WHERE x.booking_id = p_booking_id AND x.user_id = u.id AND x.status = 'in'
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.gk_withdraw(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.gk_requests SET status = 'withdrawn'
  WHERE id = p_request_id AND requested_by = auth.uid() AND status = 'open';
END;
$$;

-- First claim wins. The keeper takes a free keeper slot, or the seat of a
-- keeper who asked to be replaced (a free swap); either way he plays free.
CREATE OR REPLACE FUNCTION public.gk_claim(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req     public.gk_requests%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_goes    text;
  v_city    uuid;
  v_row     public.booking_participants%ROWTYPE;
  v_free    int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_req FROM public.gk_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GK_REQUEST_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = v_req.booking_id FOR UPDATE;
  SELECT * INTO v_req FROM public.gk_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.status <> 'open' THEN
    RAISE EXCEPTION 'GK_ALREADY_TAKEN' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.state NOT IN ('collecting', 'paid', 'confirmed') OR v_booking.starts_at <= now() THEN
    RAISE EXCEPTION 'GK_FIXTURE_NOT_LIVE' USING ERRCODE = 'P0001';
  END IF;

  SELECT u.goes_in_goal, u.city_id INTO v_goes, v_city FROM public.users AS u WHERE u.id = auth.uid();
  IF NOT public.gk_audience_ok(coalesce(v_goes, 'no'), v_req.shape, v_booking.starts_at) THEN
    RAISE EXCEPTION 'GK_NOT_IN_POOL' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row FROM public.booking_participants
  WHERE booking_id = v_booking.id AND user_id = auth.uid();
  IF FOUND AND v_row.status = 'in' THEN
    RAISE EXCEPTION 'GK_ALREADY_IN' USING ERRCODE = 'P0001';
  END IF;

  v_free := v_booking.gk_slots - (
    SELECT count(*) FROM public.booking_participants AS x
    WHERE x.booking_id = v_booking.id AND x.status = 'in' AND x.slot_kind = 'gk'
  )::int;

  IF v_free > 0 THEN
    IF v_row.id IS NOT NULL THEN
      UPDATE public.booking_participants SET status = 'in', slot_kind = 'gk' WHERE id = v_row.id;
    ELSE
      INSERT INTO public.booking_participants (booking_id, user_id, slot_kind)
      VALUES (v_booking.id, auth.uid(), 'gk');
    END IF;
  ELSE
    -- a keeper handing his seat over; a paid split seat raises
    -- SEAT_REQUIRES_PAYMENT and the claim is not made
    PERFORM public._swap_seat(v_booking.invite_token, auth.uid(), 'gk', FALSE);
  END IF;

  UPDATE public.gk_requests SET status = 'claimed', claimed_by = auth.uid(), claimed_at = now()
  WHERE id = p_request_id;
  RETURN v_booking.id;
END;
$$;

-- The fixture's own request, for its organiser's screen.
CREATE OR REPLACE FUNCTION public.gk_request_for(p_booking_id uuid)
RETURNS TABLE (request_id uuid, status text, shape text, claimed_by_name text, audience int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_city    uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN;
  END IF;
  SELECT v.city_id INTO v_city
  FROM public.pitches AS p INNER JOIN public.venues AS v ON p.venue_id = v.id
  WHERE p.id = v_booking.pitch_id;

  RETURN QUERY
  SELECT r.id, r.status, r.shape, u.first_name,
    (
      SELECT count(*)::int FROM public.users AS w
      WHERE w.city_id = v_city
        AND public.gk_audience_ok(w.goes_in_goal, r.shape, v_booking.starts_at)
        AND NOT EXISTS (
          SELECT 1 FROM public.booking_participants AS x
          WHERE x.booking_id = p_booking_id AND x.user_id = w.id AND x.status = 'in'
        )
    )
  FROM public.gk_requests AS r
  LEFT JOIN public.users AS u ON r.claimed_by = u.id
  WHERE r.booking_id = p_booking_id AND r.status IN ('open', 'claimed')
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$$;

-- After the final whistle: what the caller still owes the record for this
-- fixture, if anything.
CREATE OR REPLACE FUNCTION public.gk_feedback_due(p_booking_id uuid)
RETURNS TABLE (request_id uuid, role text, other_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.id,
    CASE WHEN r.requested_by = auth.uid() THEN 'organiser' ELSE 'keeper' END,
    CASE WHEN r.requested_by = auth.uid() THEN k.first_name ELSE o.first_name END
  FROM public.gk_requests AS r
  INNER JOIN public.bookings AS b ON r.booking_id = b.id
  INNER JOIN public.users AS o ON r.requested_by = o.id
  INNER JOIN public.users AS k ON r.claimed_by = k.id
  WHERE r.booking_id = p_booking_id
    AND r.status = 'claimed'
    AND b.ends_at < now()
    AND b.ends_at > now() - interval '14 days'
    AND b.state IN ('paid', 'confirmed', 'completed')
    AND auth.uid() IN (r.requested_by, r.claimed_by)
    AND NOT EXISTS (
      SELECT 1 FROM public.gk_feedback AS f WHERE f.request_id = r.id AND f.from_user = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.gk_feedback_give(p_request_id uuid, p_showed_up boolean, p_again boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req public.gk_requests%ROWTYPE;
  v_end timestamptz;
BEGIN
  SELECT * INTO v_req FROM public.gk_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.status <> 'claimed' OR auth.uid() NOT IN (v_req.requested_by, v_req.claimed_by) THEN
    RAISE EXCEPTION 'GK_NOT_YOURS' USING ERRCODE = '42501';
  END IF;
  SELECT ends_at INTO v_end FROM public.bookings WHERE id = v_req.booking_id;
  IF v_end >= now() THEN
    RAISE EXCEPTION 'GK_NOT_PLAYED_YET' USING ERRCODE = 'P0001';
  END IF;
  IF p_again IS NULL OR (auth.uid() = v_req.requested_by AND p_showed_up IS NULL) THEN
    RAISE EXCEPTION 'GK_ANSWER_MISSING' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.gk_feedback (request_id, from_user, about_user, role, showed_up, again)
  VALUES (
    p_request_id,
    auth.uid(),
    CASE WHEN auth.uid() = v_req.requested_by THEN v_req.claimed_by ELSE v_req.requested_by END,
    CASE WHEN auth.uid() = v_req.requested_by THEN 'organiser' ELSE 'keeper' END,
    CASE WHEN auth.uid() = v_req.requested_by THEN p_showed_up END,
    p_again
  )
  ON CONFLICT (request_id, from_user) DO UPDATE
    SET showed_up = excluded.showed_up, again = excluded.again, created_at = now();
END;
$$;

-- The caller's own record in goal.
CREATE OR REPLACE FUNCTION public.my_keeper_record()
RETURNS TABLE (games int, showed int, no_shows int, wanted_back int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT count(*)::int FROM public.gk_requests AS r
       INNER JOIN public.bookings AS b ON r.booking_id = b.id
      WHERE r.claimed_by = auth.uid() AND r.status = 'claimed' AND b.ends_at < now()),
    (SELECT count(*)::int FROM public.gk_feedback WHERE about_user = auth.uid() AND role = 'organiser' AND showed_up),
    (SELECT count(*)::int FROM public.gk_feedback WHERE about_user = auth.uid() AND role = 'organiser' AND NOT showed_up),
    (SELECT count(*)::int FROM public.gk_feedback WHERE about_user = auth.uid() AND role = 'organiser' AND again);
$$;

REVOKE ALL ON FUNCTION public.gk_open_places(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.gk_post(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.gk_withdraw(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.gk_claim(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.gk_request_for(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.gk_feedback_due(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.gk_feedback_give(uuid, boolean, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.my_keeper_record() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gk_post(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gk_withdraw(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gk_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gk_request_for(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gk_feedback_due(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gk_feedback_give(uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_keeper_record() TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. What a willing player sees
-- ════════════════════════════════════════════════════════════════════
-- Open requests in his city that reach him, on live future fixtures that
-- still have a keeper place, that he is not already on. With the team's
-- record from keepers who played for that organiser before. Counts, never
-- the roster.
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
  ) AS keepers_played
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

COMMENT ON VIEW public.v_keeper_requests IS
'Keeper requests a willing player can claim (ADR-0047): his city, his '
'willingness, a place still open, not his own game. Counts only.';

REVOKE ALL ON public.v_keeper_requests FROM anon;
GRANT SELECT ON public.v_keeper_requests TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. The roster says who plays free (re-stated from 20261013000002,
-- column appended)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_fixture_roster
WITH (security_invoker = off) AS
SELECT
  bp.id AS participant_id,
  bp.booking_id,
  bp.user_id,
  bp.slot_kind,
  bp.status,
  bp.joined_at,
  bp.left_at,
  u.first_name,
  u.handle,
  (bp.user_id = b.user_id) AS is_organiser,
  (bp.user_id = auth.uid()) AS is_you,
  EXISTS (
    SELECT 1 FROM public.payments AS pay
    WHERE pay.participant_id = bp.id
      AND pay.kind = 'share'
      AND pay.status IN ('succeeded', 'partially_refunded')
  ) AS share_paid,
  u.skill_level,
  u.positions,
  u.preferred_foot,
  CASE
    WHEN bp.user_id = auth.uid() THEN NULL
    ELSE (
      SELECT count(*)::int
      FROM public.booking_participants AS mine
      INNER JOIN public.booking_participants AS theirs
        ON mine.booking_id = theirs.booking_id
      INNER JOIN public.bookings AS shared
        ON mine.booking_id = shared.id
      WHERE mine.user_id = auth.uid()
        AND mine.status = 'in'
        AND theirs.user_id = bp.user_id
        AND theirs.status = 'in'
        AND shared.state = 'completed'
    )
  END AS played_with_you,
  bp.replacing_since,
  (bp.replaced_by IS NOT NULL) AS was_replaced,
  EXISTS (
    SELECT 1 FROM public.gk_requests AS gk
    WHERE gk.booking_id = bp.booking_id AND gk.claimed_by = bp.user_id AND gk.status = 'claimed'
  ) AS keeper_free
FROM public.booking_participants AS bp
INNER JOIN public.bookings AS b ON bp.booking_id = b.id
INNER JOIN public.users AS u ON bp.user_id = u.id
WHERE b.user_id = auth.uid()
  OR public.is_participant_of_booking(bp.booking_id)
  OR public.is_admin();
