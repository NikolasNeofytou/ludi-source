-- 20260901000001_open_match_details.sql
-- Board enhancements, day two of ADR-0028 (plans/open-matches.md
-- changelog 2026-09-01): the organiser can tag their listing's level,
-- and board rows carry enough to say what a spot roughly costs. Still
-- counts-never-names - a level is fixture metadata, not identity, and
-- the one identity-shaped idea (organiser member number) was
-- deliberately rejected against ADR-0012/0021 minimisation.

-- ════════════════════════════════════════════════════════════════════
-- 1. The level tag
-- ════════════════════════════════════════════════════════════════════
-- Structured enum, no free text: a notes field would make the board a
-- moderation surface and a PII leak in one stroke. NULL = unsaid,
-- which most listings will be.
ALTER TABLE public.bookings
  ADD COLUMN open_level text
  CONSTRAINT bookings_open_level_valid
  CHECK (open_level IN ('casual', 'competitive'));

COMMENT ON COLUMN public.bookings.open_level IS
  'Organiser''s level tag for the community listing (ADR-0028): casual '
  'or competitive, NULL when unsaid. Structured on purpose - free text '
  'here would be a moderation surface.';

-- ════════════════════════════════════════════════════════════════════
-- 2. The column guard learns the second writable column
-- ════════════════════════════════════════════════════════════════════
-- Same body as 20260831000003 with open_level added to the subtraction
-- list. Everything else bookings has - and grows later - stays frozen.
CREATE OR REPLACE FUNCTION public.tg_bookings_block_columns_for_organiser()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'is_open' - 'open_level' - 'updated_at' - 'time_range')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'is_open' - 'open_level' - 'updated_at' - 'time_range') THEN
    RAISE EXCEPTION
      'an organiser may open or close their fixture, nothing else'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 3. The board rows say more - views re-stated with columns APPENDED
-- ════════════════════════════════════════════════════════════════════
-- total_cents + the slot totals let the client render "~€X a head if it
-- fills" on free fixtures. Deliberate exposure: the pitch's hourly price
-- is already public on Discover, so the booking total derives from
-- public facts; platform_fee_cents stays out, as everywhere.
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
    f.open_level
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
      b.open_level
    FROM public.bookings b
    JOIN public.pitches  p ON p.id = b.pitch_id
    JOIN public.venues   v ON v.id = p.venue_id
    JOIN public.cities   c ON c.id = v.city_id
    WHERE b.is_open
      AND b.state IN ('collecting', 'paid', 'confirmed')
      AND b.starts_at > now()
  ) f
  WHERE f.gk_open > 0 OR f.outfield_open > 0;

-- Grants survive CREATE OR REPLACE (the view keeps its identity), but
-- the posture is re-stated so a reader of this file sees it without
-- chasing the prior migration.
REVOKE ALL ON public.v_open_fixtures FROM anon;
GRANT SELECT ON public.v_open_fixtures TO authenticated;

-- v_fixture: the organiser's switch card renders the level chips, so the
-- participant read path carries the current value. Appended at the end,
-- the only shape CREATE OR REPLACE VIEW permits.
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
 WHERE b.user_id = auth.uid()
    OR public.is_participant_of_booking(b.id)
    OR public.is_admin();
