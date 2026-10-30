-- 20261013000002_find_my_replacement.sql
-- Find my replacement (plans/find-my-replacement.md, ADR-0044): a player who
-- cannot make it keeps the seat until someone takes it, and when someone
-- does, the seat moves to them in one step - and on a paid split fixture
-- the money follows: the taker pays the frozen share, the leaver gets
-- theirs back.
--
-- Contents, in dependency order:
--   1. booking_participants.replacing_since / replaced_by
--   2. the column guard learns the two columns, and the paid-leaver guard
--      (a paid seat on a collecting split fixture leaves through
--      leave-share, which refunds - found while building this: the plain
--      UPDATE left the money behind and the next claimant over-collected)
--   3. leaving clears the ask
--   4. seat_swaps - the ledger of seats changing hands
--   5. ask_replacement / keep_my_seat - the leaver's two buttons
--   6. the swap itself: _swap_seat (internal), take_seat (free, signed-in),
--      begin_seat_swap / revert_seat_swap / stale_seat_swaps (service)
--   7. reads: v_fixture_roster, fixture_preview, v_open_fixtures,
--      public_venue_schedule, v_crew_seats
--   8. earnings: a share given back because a taker paid for the seat is
--      neither gross nor refund for the venue

-- ════════════════════════════════════════════════════════════════════
-- 1. The ask, on the seat
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.booking_participants
  ADD COLUMN replacing_since timestamptz,
  ADD COLUMN replaced_by uuid REFERENCES public.booking_participants (id) ON DELETE SET NULL;

ALTER TABLE public.booking_participants
  ADD CONSTRAINT booking_participants_replacing_only_while_in
  CHECK (replacing_since IS NULL OR status = 'in');

CREATE INDEX booking_participants_replacing_idx
  ON public.booking_participants (booking_id, replacing_since)
  WHERE replacing_since IS NOT NULL;
CREATE INDEX booking_participants_replaced_by_idx
  ON public.booking_participants (replaced_by)
  WHERE replaced_by IS NOT NULL;

COMMENT ON COLUMN public.booking_participants.replacing_since IS
'The player asked for a replacement at this moment and still holds the seat '
'until someone takes it (ADR-0044). Only while status = in; leaving clears it.';
COMMENT ON COLUMN public.booking_participants.replaced_by IS
'Who took this seat when it changed hands. Set on the leaver''s row by the swap.';

-- ════════════════════════════════════════════════════════════════════
-- 2. The column guard, re-stated (20260824000001) with two additions
-- ════════════════════════════════════════════════════════════════════
-- The paid-leaver check reads bookings and payments, which the leaving
-- player's own RLS hides (bookings is self-or-owner, payments is payer or
-- organiser). A definer helper answers the one question, for the caller's
-- own seat only.
CREATE OR REPLACE FUNCTION public.seat_holds_collecting_share(p_participant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.booking_participants AS bp
    INNER JOIN public.bookings AS b ON bp.booking_id = b.id
    INNER JOIN public.payments AS pay ON pay.participant_id = bp.id
    WHERE bp.id = p_participant_id
      AND bp.user_id = auth.uid()
      AND b.is_split
      AND b.state = 'collecting'
      AND pay.kind = 'share'
      AND pay.status IN ('succeeded', 'processing', 'requires_payment_method', 'requires_confirmation')
  );
$$;

REVOKE ALL ON FUNCTION public.seat_holds_collecting_share(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.seat_holds_collecting_share(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_booking_participants_block_identity_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id
  OR NEW.user_id    IS DISTINCT FROM OLD.user_id
  OR NEW.joined_at  IS DISTINCT FROM OLD.joined_at
  OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'a participant may change their own status and slot, not whose row it is'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The ask goes through ask_replacement()/keep_my_seat(), which check the
  -- fixture; the hand-over through the swap. Never a bare UPDATE.
  IF NEW.replacing_since IS DISTINCT FROM OLD.replacing_since
  OR NEW.replaced_by     IS DISTINCT FROM OLD.replaced_by THEN
    RAISE EXCEPTION
      'ask for a replacement through ask_replacement(), not an UPDATE'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A paid seat on a fixture still collecting leaves through leave-share,
  -- which gives the share back. A bare status flip kept the money and made
  -- the next claimant over-collect (settle_split_booking refuses, and the
  -- fixture died at its deadline although it had filled).
  IF OLD.status = 'in' AND NEW.status = 'out'
     AND public.seat_holds_collecting_share(OLD.id) THEN
    RAISE EXCEPTION 'LEAVE_NEEDS_REFUND'
      USING ERRCODE = 'P0001',
      DETAIL = 'this seat has a share on it; leave through leave-share';
  END IF;

  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 3. Leaving clears the ask (re-stated from 20260824000001)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tg_booking_participants_stamp_left_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'out' AND OLD.status = 'in' THEN
    NEW.left_at := now();
    NEW.replacing_since := NULL;
  ELSIF NEW.status = 'in' THEN
    NEW.left_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 4. seat_swaps - a seat changing hands
-- ════════════════════════════════════════════════════════════════════
-- A free swap is written 'done' in the same transaction that moves the
-- seat. A paid one is 'pending' from the moment the seat moves until the
-- taker's share settles (the webhook gives the leaver's share back and
-- marks it done) or the taker abandons the card sheet (the sweeper puts
-- the seat back and marks it failed).
CREATE TABLE public.seat_swaps (
  id                  uuid PRIMARY KEY DEFAULT public.uuid7(),
  booking_id          uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  from_participant_id uuid NOT NULL REFERENCES public.booking_participants (id) ON DELETE CASCADE,
  to_participant_id   uuid NOT NULL REFERENCES public.booking_participants (id) ON DELETE CASCADE,
  from_payment_id     uuid REFERENCES public.payments (id),
  payment_id          uuid REFERENCES public.payments (id),
  status              text NOT NULL CHECK (status IN ('pending', 'done', 'failed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  settled_at          timestamptz,
  CONSTRAINT seat_swaps_settled_matches_status CHECK ((status = 'pending') = (settled_at IS NULL)),
  CONSTRAINT seat_swaps_pending_is_paid CHECK (status <> 'pending' OR from_payment_id IS NOT NULL)
);

CREATE INDEX seat_swaps_booking_idx ON public.seat_swaps (booking_id);
CREATE INDEX seat_swaps_from_idx ON public.seat_swaps (from_participant_id);
CREATE INDEX seat_swaps_to_idx ON public.seat_swaps (to_participant_id);
CREATE INDEX seat_swaps_from_payment_idx ON public.seat_swaps (from_payment_id) WHERE from_payment_id IS NOT NULL;
CREATE UNIQUE INDEX seat_swaps_payment_idx ON public.seat_swaps (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX seat_swaps_pending_idx ON public.seat_swaps (created_at) WHERE status = 'pending';

COMMENT ON TABLE public.seat_swaps IS
'Seats changing hands (ADR-0044). from = the player who asked for a '
'replacement, to = who took the seat. On a paid split fixture the taker '
'pays the frozen share (payment_id) and the leaver''s share (from_payment_id) '
'is given back. Service role only.';

ALTER TABLE public.seat_swaps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seat_swaps FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. The leaver's two buttons
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.ask_replacement(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_row     public.booking_participants%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FIXTURE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row FROM public.booking_participants
  WHERE booking_id = p_booking_id AND user_id = auth.uid();
  IF NOT FOUND OR v_row.status <> 'in' THEN
    RAISE EXCEPTION 'NOT_ON_ROSTER' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.user_id = auth.uid() THEN
    -- the organiser's seat is the booking; they cancel or hand it over by hand
    RAISE EXCEPTION 'ORGANISER_CANNOT_BE_REPLACED' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.state = 'collecting' THEN
    -- while the squad is still paying, leaving costs nothing and gives the
    -- share back; the seat reopens to the ordinary claim
    RAISE EXCEPTION 'LEAVE_INSTEAD' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.state NOT IN ('paid', 'confirmed') THEN
    RAISE EXCEPTION 'FIXTURE_NOT_LIVE' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.starts_at <= now() THEN
    RAISE EXCEPTION 'FIXTURE_STARTED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.booking_participants
  SET replacing_since = coalesce(replacing_since, now())
  WHERE id = v_row.id;
END;
$$;

COMMENT ON FUNCTION public.ask_replacement(uuid) IS
'The caller cannot make it but keeps the seat until someone takes it (ADR-0044). '
'Not the organiser, not while a split fixture is still collecting (leave instead).';

CREATE OR REPLACE FUNCTION public.keep_my_seat(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.booking_participants
  SET replacing_since = NULL
  WHERE booking_id = p_booking_id AND user_id = auth.uid() AND status = 'in';
END;
$$;

COMMENT ON FUNCTION public.keep_my_seat(uuid) IS
'The caller can play after all: the ask is withdrawn. A seat already taken is gone.';

REVOKE ALL ON FUNCTION public.ask_replacement(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.keep_my_seat(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ask_replacement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.keep_my_seat(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. The swap
-- ════════════════════════════════════════════════════════════════════
-- Seat first, money after - claim-share's order. The leaver goes out and
-- the taker comes in, in one transaction under the booking lock, so the
-- capacity trigger never sees eleven. On a paid split fixture the swap
-- stays 'pending' while the taker pays; if they never do, the sweeper
-- reverses it and the leaver is back on the seat, still asking.
CREATE OR REPLACE FUNCTION public._swap_seat(
  p_invite_token text,
  p_user_id      uuid,
  p_slot_kind    text,
  p_allow_paid   boolean
)
RETURNS TABLE (
  swap_id            uuid,
  booking_id         uuid,
  participant_id     uuid,
  needs_payment      boolean,
  share_amount_cents int,
  from_payment_id    uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking  public.bookings%ROWTYPE;
  v_taker    public.booking_participants%ROWTYPE;
  v_leaver   public.booking_participants%ROWTYPE;
  v_from_pay uuid;
  v_needs    boolean;
  v_tid      uuid;
  v_swap     uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'P0001';
  END IF;
  IF p_slot_kind IS NOT NULL AND p_slot_kind NOT IN ('gk', 'outfield') THEN
    RAISE EXCEPTION 'INVALID_SLOT_KIND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_booking FROM public.bookings AS b
  WHERE b.invite_token = p_invite_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_INVITE' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.state NOT IN ('paid', 'confirmed') THEN
    RAISE EXCEPTION 'SEAT_NOT_TAKEABLE' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.starts_at <= now() THEN
    RAISE EXCEPTION 'FIXTURE_STARTED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_taker FROM public.booking_participants AS x
  WHERE x.booking_id = v_booking.id AND x.user_id = p_user_id;
  IF FOUND AND v_taker.status = 'in' THEN
    RAISE EXCEPTION 'ALREADY_IN' USING ERRCODE = 'P0001';
  END IF;

  -- the longest-waiting ask of the kind asked for
  SELECT * INTO v_leaver FROM public.booking_participants AS x
  WHERE x.booking_id = v_booking.id
    AND x.status = 'in'
    AND x.replacing_since IS NOT NULL
    AND x.user_id <> p_user_id
    AND (p_slot_kind IS NULL OR x.slot_kind = p_slot_kind)
  ORDER BY x.replacing_since, x.id
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SEAT_TO_TAKE' USING ERRCODE = 'P0001';
  END IF;

  IF v_booking.is_split THEN
    SELECT pay.id INTO v_from_pay FROM public.payments AS pay
    WHERE pay.participant_id = v_leaver.id
      AND pay.kind = 'share'
      AND pay.status IN ('succeeded', 'partially_refunded')
    ORDER BY pay.created_at DESC
    LIMIT 1;
  END IF;
  v_needs := v_from_pay IS NOT NULL;

  IF v_needs AND NOT p_allow_paid THEN
    RAISE EXCEPTION 'SEAT_REQUIRES_PAYMENT' USING ERRCODE = 'P0001';
  END IF;
  IF v_needs AND v_taker.id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.payments AS pay
    WHERE pay.participant_id = v_taker.id
      AND pay.kind = 'share'
      AND pay.status NOT IN ('cancelled', 'failed', 'refunded')
  ) THEN
    -- left a paid seat on this fixture without a refund; one share each
    RAISE EXCEPTION 'ALREADY_PAID_HERE' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.booking_participants SET status = 'out' WHERE id = v_leaver.id;

  IF v_taker.id IS NOT NULL THEN
    UPDATE public.booking_participants
    SET status = 'in', slot_kind = v_leaver.slot_kind
    WHERE id = v_taker.id;
    v_tid := v_taker.id;
  ELSE
    INSERT INTO public.booking_participants (booking_id, user_id, slot_kind)
    VALUES (v_booking.id, p_user_id, v_leaver.slot_kind)
    RETURNING id INTO v_tid;
  END IF;

  UPDATE public.booking_participants SET replaced_by = v_tid WHERE id = v_leaver.id;

  INSERT INTO public.seat_swaps (
    booking_id, from_participant_id, to_participant_id, from_payment_id, status, settled_at
  ) VALUES (
    v_booking.id, v_leaver.id, v_tid, v_from_pay,
    CASE WHEN v_needs THEN 'pending' ELSE 'done' END,
    CASE WHEN v_needs THEN NULL ELSE now() END
  )
  RETURNING id INTO v_swap;

  RETURN QUERY SELECT v_swap, v_booking.id, v_tid, v_needs, v_booking.share_amount_cents, v_from_pay;
END;
$$;

REVOKE ALL ON FUNCTION public._swap_seat(text, uuid, text, boolean) FROM public, anon, authenticated;

COMMENT ON FUNCTION public._swap_seat(text, uuid, text, boolean) IS
'Internal: moves the longest-waiting replacing seat to p_user_id. Callers: '
'take_seat (signed-in, free seats only) and begin_seat_swap (service, paid).';

-- Signed-in, free seats: a non-split fixture, or a split seat nobody paid
-- for (the organiser covered it). A paid seat answers SEAT_REQUIRES_PAYMENT
-- and the client goes to take-seat.
CREATE OR REPLACE FUNCTION public.take_seat(p_invite_token text, p_slot_kind text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking uuid;
BEGIN
  SELECT s.booking_id INTO v_booking
  FROM public._swap_seat(p_invite_token, auth.uid(), p_slot_kind, FALSE) AS s;
  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.take_seat(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.take_seat(text, text) TO authenticated;

COMMENT ON FUNCTION public.take_seat(text, text) IS
'Take a seat whose player asked for a replacement (ADR-0044). Free seats only; '
'returns the booking id. A paid split seat goes through the take-seat function.';

-- Service: the take-seat Edge Function, which then creates the taker's PI.
CREATE OR REPLACE FUNCTION public.begin_seat_swap(
  p_invite_token text,
  p_user_id      uuid,
  p_slot_kind    text DEFAULT NULL
)
RETURNS TABLE (
  swap_id            uuid,
  booking_id         uuid,
  participant_id     uuid,
  needs_payment      boolean,
  share_amount_cents int,
  from_payment_id    uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  RETURN QUERY SELECT * FROM public._swap_seat(p_invite_token, p_user_id, p_slot_kind, TRUE);
END;
$$;

-- Service: put a pending swap back - the taker never paid. Seat to the
-- leaver, still asking; the taker out.
CREATE OR REPLACE FUNCTION public.revert_seat_swap(p_swap_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_swap public.seat_swaps%ROWTYPE;
BEGIN
  PERFORM public.assert_service_role();

  SELECT * INTO v_swap FROM public.seat_swaps WHERE id = p_swap_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  PERFORM 1 FROM public.bookings WHERE id = v_swap.booking_id FOR UPDATE;
  SELECT * INTO v_swap FROM public.seat_swaps WHERE id = p_swap_id FOR UPDATE;
  IF v_swap.status <> 'pending' THEN
    RETURN FALSE;
  END IF;

  UPDATE public.booking_participants SET status = 'out'
  WHERE id = v_swap.to_participant_id AND status = 'in';

  UPDATE public.booking_participants
  SET status = 'in', replacing_since = now(), replaced_by = NULL
  WHERE id = v_swap.from_participant_id
    AND status = 'out'
    AND replaced_by = v_swap.to_participant_id;

  UPDATE public.seat_swaps SET status = 'failed', settled_at = now() WHERE id = p_swap_id;
  RETURN TRUE;
END;
$$;

-- Service: the sweeper's selection - pending swaps whose taker has had
-- the card sheet for longer than the grace.
CREATE OR REPLACE FUNCTION public.stale_seat_swaps(p_age interval DEFAULT interval '15 minutes')
RETURNS TABLE (swap_id uuid, payment_id uuid, stripe_payment_intent_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  RETURN QUERY
  SELECT s.id, s.payment_id, pay.stripe_payment_intent_id
  FROM public.seat_swaps AS s
  LEFT JOIN public.payments AS pay ON pay.id = s.payment_id
  WHERE s.status = 'pending'
    AND s.created_at < now() - p_age
    AND (pay.id IS NULL OR pay.status NOT IN ('succeeded', 'partially_refunded', 'refunded'));
END;
$$;

REVOKE ALL ON FUNCTION public.begin_seat_swap(text, uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.revert_seat_swap(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.stale_seat_swaps(interval) FROM public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 7. Reads
-- ════════════════════════════════════════════════════════════════════
-- 7a. The roster carries the ask (re-stated from 20260902000001, column
-- appended - the only shape CREATE OR REPLACE VIEW permits).
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
  (bp.replaced_by IS NOT NULL) AS was_replaced
FROM public.booking_participants AS bp
INNER JOIN public.bookings AS b ON bp.booking_id = b.id
INNER JOIN public.users AS u ON bp.user_id = u.id
WHERE b.user_id = auth.uid()
  OR public.is_participant_of_booking(bp.booking_id)
  OR public.is_admin();

-- 7b. The invite says how many seats are up for grabs. gk_open and
-- outfield_open stay the free seats (join_fixture's arithmetic); the two
-- new columns are the seats someone is waiting to hand over.
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
  outfield_replacing int
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
    )::int
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
'what a slot costs - and how many seats players are waiting to hand over '
'(ADR-0044). Never names, never the booking code.';

-- 7c. The board lists a seat up for grabs as a seat (re-stated from
-- 20260902000003; only the two counts change).
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
    ) AS played_with_squad
  FROM public.bookings AS b
  INNER JOIN public.pitches AS p ON b.pitch_id = p.id
  INNER JOIN public.venues AS v ON p.venue_id = v.id
  INNER JOIN public.cities AS c ON v.city_id = c.id
  WHERE b.is_open
    AND b.state IN ('collecting', 'paid', 'confirmed')
    AND b.starts_at > now()
) AS f
WHERE f.gk_open > 0 OR f.outfield_open > 0;

REVOKE ALL ON public.v_open_fixtures FROM anon;
GRANT SELECT ON public.v_open_fixtures TO authenticated;

-- 7d. The wall counts the same seats as the board (re-stated from
-- 20261013000001; only the two counts in the lateral change).
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
            coalesce(b.gk_slots, 0)
            - count(*) FILTER (WHERE x.slot_kind = 'gk' AND x.replacing_since IS NULL)::int AS gk_open,
            coalesce(b.outfield_slots, 0)
            - count(*) FILTER (WHERE x.slot_kind = 'outfield' AND x.replacing_since IS NULL)::int AS outfield_open
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

GRANT EXECUTE ON FUNCTION public.public_venue_schedule(text, date) TO anon, authenticated;

-- 7e. Your crew's seats: a seat up for grabs on a fixture where you have
-- finished a match with the player asking, or with the organiser - whether
-- or not the fixture is on the board. The ask is the leaver's consent to
-- their own teammates seeing it; the organiser's past squads are the
-- people their invite link would have reached anyway (ADR-0044).
CREATE OR REPLACE VIEW public.v_crew_seats
WITH (security_invoker = off) AS
SELECT
  b.id AS booking_id,
  b.starts_at,
  b.ends_at,
  p.type AS pitch_type,
  p.name AS pitch_name,
  v.name AS venue_name,
  c.name_en AS city_name_en,
  c.name_gr AS city_name_gr,
  count(*) FILTER (WHERE r.slot_kind = 'gk')::int AS gk_replacing,
  count(*) FILTER (WHERE r.slot_kind = 'outfield')::int AS outfield_replacing,
  b.is_split,
  b.share_amount_cents,
  b.invite_token,
  min(r.replacing_since) AS asked_at
FROM public.bookings AS b
INNER JOIN public.booking_participants AS r
  ON r.booking_id = b.id AND r.status = 'in' AND r.replacing_since IS NOT NULL
INNER JOIN public.pitches AS p ON b.pitch_id = p.id
INNER JOIN public.venues AS v ON p.venue_id = v.id
INNER JOIN public.cities AS c ON v.city_id = c.id
WHERE b.state IN ('paid', 'confirmed')
  AND b.starts_at > now()
  AND auth.uid() IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.booking_participants AS me
    WHERE me.booking_id = b.id AND me.user_id = auth.uid() AND me.status = 'in'
  )
  AND EXISTS (
    SELECT 1
    FROM public.booking_participants AS mine
    INNER JOIN public.booking_participants AS theirs
      ON mine.booking_id = theirs.booking_id AND theirs.status = 'in'
    INNER JOIN public.bookings AS played
      ON mine.booking_id = played.id AND played.state = 'completed'
    WHERE mine.user_id = auth.uid()
      AND mine.status = 'in'
      AND theirs.user_id IN (r.user_id, b.user_id)
      AND theirs.user_id <> auth.uid()
  )
GROUP BY b.id, p.type, p.name, v.name, c.name_en, c.name_gr;

COMMENT ON VIEW public.v_crew_seats IS
'Seats players are waiting to hand over, on fixtures where the viewer has '
'completed a match with the player asking or with the organiser (ADR-0044). '
'Counts only; carries the invite token because taking the seat is following '
'the invite.';

REVOKE ALL ON public.v_crew_seats FROM anon;
GRANT SELECT ON public.v_crew_seats TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 8. Earnings: a share handed back because a taker paid for the seat
-- ════════════════════════════════════════════════════════════════════
-- Re-stated from 20260917000006 with one predicate: the leaver's share,
-- given back in a completed swap, is neither gross nor a refund for the
-- venue - the taker's share stands in its place.
CREATE OR REPLACE VIEW public.v_venue_earnings_daily
WITH (security_invoker = off) AS
WITH split_fixtures AS (
  SELECT
    b.pitch_id,
    b.id AS booking_id,
    ((max(p.created_at) AT TIME ZONE 'Europe/Nicosia')::date) AS day,
    sum(p.amount_cents)::bigint AS gross_cents,
    sum(p.refunded_amount_cents)::bigint AS refunded_cents,
    round(
      b.platform_fee_cents::numeric
      * (sum(p.amount_cents) - sum(p.refunded_amount_cents))
      / b.total_cents
    )::bigint AS fee_cents,
    count(*)::int AS payments_count
  FROM public.payments AS p
  INNER JOIN public.bookings AS b ON p.booking_id = b.id
  WHERE b.is_split
    AND b.stripe_transfer_id IS NOT NULL
    AND p.status IN ('succeeded', 'refunded', 'partially_refunded')
    AND NOT EXISTS (
      SELECT 1 FROM public.seat_swaps AS s
      WHERE s.from_payment_id = p.id AND s.status = 'done'
    )
  GROUP BY b.id, b.pitch_id, b.platform_fee_cents, b.total_cents
),

earning_rows AS (
  SELECT
    b.pitch_id,
    p.booking_id,
    ((p.created_at AT TIME ZONE 'Europe/Nicosia')::date) AS day,
    p.amount_cents::bigint AS gross_cents,
    p.refunded_amount_cents::bigint AS refunded_cents,
    coalesce(round(
      p.application_fee_cents::numeric
      * (p.amount_cents - p.refunded_amount_cents)
      / nullif(p.amount_cents, 0)
    ), 0)::bigint AS fee_cents,
    1 AS payments_count,
    (p.payment_method = 'offline') AS is_offline
  FROM public.payments AS p
  INNER JOIN public.bookings AS b ON p.booking_id = b.id
  WHERE NOT b.is_split
    AND p.status IN ('succeeded', 'refunded', 'partially_refunded')

  UNION ALL

  SELECT
    sf.pitch_id,
    sf.booking_id,
    sf.day,
    sf.gross_cents,
    sf.refunded_cents,
    sf.fee_cents,
    sf.payments_count,
    FALSE AS is_offline
  FROM split_fixtures AS sf
)

SELECT
  v.id AS venue_id,
  v.name AS venue_name,
  r.day,
  sum(r.gross_cents)::bigint AS gross_cents,
  sum(r.refunded_cents)::bigint AS refunded_cents,
  sum(r.fee_cents)::bigint AS fee_cents,
  (sum(r.gross_cents) - sum(r.refunded_cents))::bigint AS net_cents,
  (sum(r.gross_cents) - sum(r.refunded_cents) - sum(r.fee_cents))::bigint AS venue_net_cents,
  sum(r.payments_count)::int AS payments_count,
  count(DISTINCT r.booking_id)::int AS bookings_count,
  coalesce(sum(r.gross_cents) FILTER (WHERE r.is_offline), 0)::bigint AS offline_gross_cents,
  coalesce(sum(r.fee_cents) FILTER (WHERE r.is_offline), 0)::bigint AS offline_fee_cents
FROM earning_rows AS r
INNER JOIN public.pitches AS pt ON r.pitch_id = pt.id
INNER JOIN public.venues AS v ON pt.venue_id = v.id
WHERE (public.has_venue_role(v.id, 'owner') OR public.is_admin())
GROUP BY v.id, v.name, r.day;
