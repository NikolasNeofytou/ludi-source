-- 20260830000005_fixture_split_read.sql
-- C2 W6 - the fixture read path learns split money. Both views re-stated
-- verbatim from 20260824000001 with columns APPENDED (the only shape
-- CREATE OR REPLACE VIEW permits): v_fixture gains is_split /
-- share_amount_cents / collect_deadline; v_fixture_roster gains
-- share_paid. Definer posture, caller predicates, and grants unchanged -
-- the new columns expose nothing a participant does not already share in.

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
    -- Fill counts, added for W7 (the bookings tab reusing this view as "my
    -- fixtures" — see below). "A fixture that is short should say so from
    -- the list", not only once you have opened it.
    (SELECT count(*) FROM public.booking_participants x
      WHERE x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'gk')::int
                                AS gk_filled,
    (SELECT count(*) FROM public.booking_participants x
      WHERE x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'outfield')::int
                                AS outfield_filled,
    -- The invite link, for the people entitled to pass it on. Everyone this
    -- view returns either created the fixture or joined it with this token,
    -- so exposing it here grants nothing they do not already hold — and the
    -- organiser cannot share a link the app refuses to show them.
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
    -- C2 W6: what the money layer needs on screen. NULL/false off split.
    b.is_split,
    b.share_amount_cents,
    b.collect_deadline
  FROM public.bookings b
  JOIN public.pitches  p ON p.id = b.pitch_id
  JOIN public.venues   v ON v.id = p.venue_id
  JOIN public.cities   c ON c.id = v.city_id
 WHERE b.user_id = auth.uid()
    OR public.is_participant_of_booking(b.id)
    OR public.is_admin();

CREATE OR REPLACE VIEW public.v_fixture_roster
WITH (security_invoker = off) AS
  SELECT
    bp.id                       AS participant_id,
    bp.booking_id,
    bp.user_id,
    bp.slot_kind,
    bp.status,
    bp.joined_at,
    bp.left_at,
    u.first_name,
    u.handle,
    (bp.user_id = b.user_id)    AS is_organiser,
    (bp.user_id = auth.uid())   AS is_you,
    -- C2 W6: a split roster shows who has actually paid. Meaningless (and
    -- always false) on free fixtures; partially_refunded still counts as
    -- paid - the policy took some back, the seat was bought.
    EXISTS (SELECT 1 FROM public.payments pay
             WHERE pay.participant_id = bp.id
               AND pay.kind = 'share'
               AND pay.status IN ('succeeded','partially_refunded'))
                                AS share_paid
  FROM public.booking_participants bp
  JOIN public.bookings b ON b.id = bp.booking_id
  JOIN public.users    u ON u.id = bp.user_id
 WHERE b.user_id = auth.uid()
    OR public.is_participant_of_booking(bp.booking_id)
    OR public.is_admin();
