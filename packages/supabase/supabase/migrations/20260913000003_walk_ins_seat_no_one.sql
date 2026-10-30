-- 20260913000003_walk_ins_seat_no_one.sql
-- A walk-in is the owner's bookkeeping, not a fixture the owner plays in.
--
-- create-walk-in-booking sets bookings.user_id to the ACTING owner/admin
-- (20260829000001: FK integrity without fabricating accounts for people
-- who walked in off the street). But tg_bookings_seat_organiser seats
-- user_id as an 'in' outfield player on EVERY insert, so each walk-in an
-- owner typed in made them a player on it. Launch audit 2026-09-13:
--   * my_record() counted every completed walk-in as a match the owner
--     played, with its "played with" and venue tallies;
--   * community_week_stats() counted the owner among the week's players;
--   * the owner's player app showed walk-ins in Bookings and as "Next
--     match" (v_fixture is participant-gated);
--   * as "organiser" the owner could flip is_open (bookings_update_open_self)
--     and put a walk-in on the public open-matches board for strangers.
-- (The cancel/refund half — cancel-booking and admin-refund-booking
-- refusing walk-ins — lands in the Edge Functions in the same change.)

-- ════════════════════════════════════════════════════════════════════
-- 1. The trigger seats the organiser of APP bookings only
-- ════════════════════════════════════════════════════════════════════
-- Still an invariant of the table (every app booking has its organiser on
-- the roster, however it was made); walk-ins simply have no player
-- organiser — their customer is walk_in_name, not an account.
CREATE OR REPLACE FUNCTION public.tg_bookings_seat_organiser()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.origin = 'walk_in' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.booking_participants (booking_id, user_id, slot_kind)
  VALUES (NEW.id, NEW.user_id, 'outfield')
  ON CONFLICT (booking_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 2. Backfill — unseat the acting owner from every existing walk-in
-- ════════════════════════════════════════════════════════════════════
-- Only the row the trigger created (user_id = the booking's user_id); any
-- other roster row is left alone.
DELETE FROM public.booking_participants AS bp
USING public.bookings AS b
WHERE bp.booking_id = b.id
  AND b.origin = 'walk_in'
  AND bp.user_id = b.user_id;

-- ════════════════════════════════════════════════════════════════════
-- 3. A walk-in can never be an open match
-- ════════════════════════════════════════════════════════════════════
-- The organiser switch's policy is row-narrow on user_id, which a walk-in's
-- acting owner satisfies. A CHECK closes it for every write path at once.
UPDATE public.bookings
   SET is_open = FALSE
 WHERE origin = 'walk_in'
   AND is_open;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_walk_in_never_open
  CHECK (origin = 'app' OR NOT is_open);

COMMENT ON CONSTRAINT bookings_walk_in_never_open ON public.bookings IS
  'Walk-ins are the owner''s own bookkeeping; they never go on the open '
  'matches board (launch audit 2026-09-13).';

-- ════════════════════════════════════════════════════════════════════
-- 4. v_fixture — the player app's fixture view drops walk-ins
-- ════════════════════════════════════════════════════════════════════
-- Unseating alone is not enough: the view also admits b.user_id =
-- auth.uid(), which the acting owner is on every walk-in, so their
-- Bookings tab and "Next match" would still list them. v_fixture is read
-- only by the player app; owners see walk-ins in the dashboard through
-- v_venue_booking_roster. 20260901000001 verbatim except the WHERE.
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
    b.open_level
  FROM public.bookings b
  JOIN public.pitches  p ON p.id = b.pitch_id
  JOIN public.venues   v ON v.id = p.venue_id
  JOIN public.cities   c ON c.id = v.city_id
 WHERE b.origin = 'app'
   AND (b.user_id = auth.uid()
        OR public.is_participant_of_booking(b.id)
        OR public.is_admin());
