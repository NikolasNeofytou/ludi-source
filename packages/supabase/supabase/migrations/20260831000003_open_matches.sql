-- 20260831000003_open_matches.sql
-- Open matches (ADR-0028, plans/open-matches.md): a fixture becomes
-- discoverable by any signed-in user when its organiser opens it. The
-- board is a definer view over bookings - no new tables, because the
-- shared booking IS the match row. Joining an open match is following
-- its invite: the view publishes the capability token (ADR-0021), and
-- the client walks the existing /f/<token> path, so every join guard
-- and money door stays single-sourced.

-- ════════════════════════════════════════════════════════════════════
-- 1. The listing consent
-- ════════════════════════════════════════════════════════════════════
-- Default-off: nothing is public unless the organiser says so.
ALTER TABLE public.bookings
  ADD COLUMN is_open boolean NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.bookings.is_open IS
  'Organiser listed this fixture on the community board (ADR-0028). '
  'Opening publishes the invite capability to signed-in users while the '
  'row stays listed; closing delists but - like un-sharing a link - '
  'revokes nothing already read. Rotation stays the revoker (ADR-0021).';

-- The board reads a handful of rows sorted by kickoff; keep that off
-- the main index entirely (nearly every booking has is_open = FALSE).
CREATE INDEX bookings_open_board_idx
  ON public.bookings (starts_at)
  WHERE is_open;

-- ════════════════════════════════════════════════════════════════════
-- 2. The organiser's switch - a flag flip is not an RPC
-- ════════════════════════════════════════════════════════════════════
-- Same boundary leaving a fixture drew (ADR-0022, fixture.ts): it moves
-- no money, so it is a plain RLS-gated UPDATE. bookings has never had a
-- client UPDATE policy; this one is row-narrow (your own booking) and
-- the trigger below is the column-level half.
CREATE POLICY bookings_update_open_self ON public.bookings
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS is row-level; this is the column-level half (the
-- tg_booking_participants_block_identity_columns pattern). Compare the
-- whole row minus the columns an organiser's flip may touch, so every
-- column bookings has - and every column it grows later - stays frozen
-- without this list needing maintenance. updated_at is exempt because
-- tg_bookings_updated_at (alphabetically later, same BEFORE UPDATE
-- phase) rewrites it after us on the same NEW row. time_range is
-- exempt because it is GENERATED STORED: Postgres computes generated
-- columns only after every BEFORE trigger has run, so NEW.time_range
-- arrives here NULL while OLD carries the stored value - a phantom
-- diff on every UPDATE (JOURNAL 2026-08-31).
CREATE OR REPLACE FUNCTION public.tg_bookings_block_columns_for_organiser()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'is_open' - 'updated_at' - 'time_range')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'is_open' - 'updated_at' - 'time_range') THEN
    RAISE EXCEPTION
      'an organiser may open or close their fixture, nothing else'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_bookings_block_columns_for_organiser
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_bookings_block_columns_for_organiser();

-- ════════════════════════════════════════════════════════════════════
-- 3. The board
-- ════════════════════════════════════════════════════════════════════
-- Preview-shaped: counts, never names - a board row and a forwarded
-- link are the same stranger-facing surface (fixture_preview's
-- minimisation, ADR-0012/0021). Listed only while live and short a
-- player: 'pending' is an unpaid checkout and is not advertised; a full
-- or kicked-off fixture is not a place to play. invite_token is the
-- point of the view, not a leak - see ADR-0028.
CREATE VIEW public.v_open_fixtures
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
    f.invite_token
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
      b.invite_token
    FROM public.bookings b
    JOIN public.pitches  p ON p.id = b.pitch_id
    JOIN public.venues   v ON v.id = p.venue_id
    JOIN public.cities   c ON c.id = v.city_id
    WHERE b.is_open
      AND b.state IN ('collecting', 'paid', 'confirmed')
      AND b.starts_at > now()
  ) f
  WHERE f.gk_open > 0 OR f.outfield_open > 0;

COMMENT ON VIEW public.v_open_fixtures IS
  'The community board (ADR-0028): fixtures whose organiser opened them, '
  'still live, not started, short at least one player. Counts only - no '
  'names, no roster, no organiser, no code. Carries invite_token so a '
  'signed-in viewer joins through the ordinary /f/<token> path.';

-- Signed-in surface only. The anon funnel already exists and stays the
-- invite link (ADR-0025); withholding anon here keeps whole-board
-- scraping one credential more expensive (ADR-0028 §alternatives).
REVOKE ALL ON public.v_open_fixtures FROM anon;
GRANT SELECT ON public.v_open_fixtures TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. v_fixture learns is_open - the switch renders its own state
-- ════════════════════════════════════════════════════════════════════
-- Re-stated verbatim from 20260830000005 with the column APPENDED (the
-- only shape CREATE OR REPLACE VIEW permits). Definer posture, caller
-- predicate and grants unchanged - is_open exposes nothing to anyone
-- who could not already flip it or see the board row.
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
    -- ADR-0028: whether this fixture is on the community board.
    b.is_open
  FROM public.bookings b
  JOIN public.pitches  p ON p.id = b.pitch_id
  JOIN public.venues   v ON v.id = p.venue_id
  JOIN public.cities   c ON c.id = v.city_id
 WHERE b.user_id = auth.uid()
    OR public.is_participant_of_booking(b.id)
    OR public.is_admin();
