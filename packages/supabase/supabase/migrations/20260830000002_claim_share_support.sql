-- 20260830000002_claim_share_support.sql
-- C2 W3 - the database half of claiming a paid slot and settling a split
-- fixture (docs/plans/split-payment.md, ADR-0027).
--
--   1. fixture_preview grows is_split + share_amount_cents so an invite can
--      say what a slot costs before the claim. RETURNS TABLE columns are
--      part of the signature, so this is DROP + CREATE + regrant - the
--      change W2 deliberately deferred.
--   2. settle_split_booking() - the race-safe confirm. Two webhook
--      deliveries for two shares can land in the same instant; JS cannot
--      hold a transaction, so the FOR UPDATE lock and the sum arithmetic
--      live here. The function only moves state; the Transfer stays in the
--      webhook (ADR-0022: money moves in functions we can see in Stripe's
--      dashboard, and Stripe's transfer:{booking_id} idempotency key makes
--      the create safe under every race and redelivery this function
--      permits).

-- ────────────────────────────────────────────────────────────────────
-- 1. fixture_preview, extended
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION public.fixture_preview(text);

CREATE FUNCTION public.fixture_preview(p_invite_token text)
RETURNS TABLE (
  -- Not PII, not the roster — the booking's own primary key. Safe to return
  -- pre-join because RLS still gates every read of v_fixture/v_fixture_roster
  -- by it; it only lets the client route to /booking/<id> after joining
  -- rather than needing a second round trip to resolve one.
  booking_id       uuid,
  starts_at        timestamptz,
  ends_at          timestamptz,
  pitch_type       text,
  pitch_name       text,
  venue_name       text,
  city_name_en     text,
  city_name_gr     text,
  gk_open          int,
  outfield_open    int,
  joinable         boolean,
  -- C2 W3: the invite must be able to say what a slot costs before the
  -- claim - both NULL on a non-split fixture.
  is_split         boolean,
  share_amount_cents int
)
LANGUAGE sql STABLE
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
    b.gk_slots       - (SELECT count(*) FROM public.booking_participants x
                         WHERE x.booking_id = b.id AND x.status = 'in'
                           AND x.slot_kind = 'gk')::int,
    b.outfield_slots - (SELECT count(*) FROM public.booking_participants x
                         WHERE x.booking_id = b.id AND x.status = 'in'
                           AND x.slot_kind = 'outfield')::int,
    (b.state IN ('pending','paid','confirmed','collecting') AND b.starts_at > now()),
    b.is_split,
    b.share_amount_cents
  FROM public.bookings b
  JOIN public.pitches  p ON p.id = b.pitch_id
  JOIN public.venues   v ON v.id = p.venue_id
  JOIN public.cities   c ON c.id = v.city_id
 WHERE b.invite_token = p_invite_token;
$$;

-- DROP discards the old grants; the preview stays open to the signed-out
-- web fallback (ADR-0025).
REVOKE ALL ON FUNCTION public.fixture_preview(text) FROM public;
GRANT EXECUTE ON FUNCTION public.fixture_preview(text) TO anon, authenticated;

COMMENT ON FUNCTION public.fixture_preview(text) IS
  'What an invite link shows before you are on the roster: when, where, '
  'format, spots open, whether it can still be joined - and on a split '
  'fixture, what a slot costs. Never names, never the booking code.';

-- ────────────────────────────────────────────────────────────────────
-- 2. settle_split_booking - the race-safe confirm
-- ────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.settle_split_booking(p_booking_id uuid)
RETURNS TABLE (
  state              text,
  should_transfer    boolean,
  transfer_cents     int,
  destination        text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_sum     bigint;
  v_dest    text;
  v_role    text;
BEGIN
  -- The guard travels WITH the function, not just in its ACL: Supabase's
  -- default privileges hand EXECUTE on new functions to anon/authenticated,
  -- and the RLS test harness deliberately mirrors that — an ACL-only
  -- defence is one blanket grant away from gone. Only a service-role
  -- request (the webhook) may settle; even a superuser psql session must
  -- present the claim, which keeps ad-hoc SQL out of the money path.
  BEGIN
    v_role := (current_setting('request.jwt.claims', true))::jsonb->>'role';
  EXCEPTION WHEN others THEN
    v_role := NULL;
  END;
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SETTLE_FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  -- The lock is the whole point: concurrent settles serialize here, so the
  -- collecting -> confirmed flip happens exactly once.
  SELECT * INTO v_booking FROM public.bookings b
   WHERE b.id = p_booking_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SETTLE_UNKNOWN_BOOKING' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_booking.is_split THEN
    RAISE EXCEPTION 'SETTLE_NOT_SPLIT' USING ERRCODE = 'P0001';
  END IF;

  SELECT v.stripe_account_id INTO v_dest
    FROM public.pitches p
    JOIN public.venues  v ON v.id = p.venue_id
   WHERE p.id = v_booking.pitch_id;

  SELECT COALESCE(sum(pay.amount_cents), 0) INTO v_sum
    FROM public.payments pay
   WHERE pay.booking_id = p_booking_id
     AND pay.kind IN ('share','cover')
     AND pay.status = 'succeeded';

  -- The sum invariant, asserted where the money is counted. Over-collection
  -- means a share was created against wrong arithmetic; confirming and
  -- transferring on top of it would compound the bug silently.
  IF v_sum > v_booking.total_cents THEN
    RAISE EXCEPTION 'SETTLE_OVERCOLLECTED: % > % on booking %',
      v_sum, v_booking.total_cents, p_booking_id USING ERRCODE = 'P0001';
  END IF;

  -- Already terminal (confirmed included): report, don't touch. Confirmed
  -- keeps should_transfer = true so a webhook that died between the flip
  -- and the Transfer finishes the job on redelivery - Stripe's idempotency
  -- key makes the repeat create a no-op.
  IF v_booking.state NOT IN ('pending','collecting') THEN
    RETURN QUERY SELECT v_booking.state,
      v_booking.state = 'confirmed',
      (v_booking.total_cents - v_booking.platform_fee_cents)::int,
      v_dest;
    RETURN;
  END IF;

  IF v_sum = v_booking.total_cents THEN
    UPDATE public.bookings SET state = 'confirmed'
     WHERE id = p_booking_id;
    RETURN QUERY SELECT 'confirmed'::text, true,
      (v_booking.total_cents - v_booking.platform_fee_cents)::int,
      v_dest;
    RETURN;
  END IF;

  -- The anchor share landing is what moves pending -> collecting: real
  -- money now holds the slot (the anchor decision, split-payment.md).
  IF v_booking.state = 'pending' AND v_sum > 0 THEN
    UPDATE public.bookings SET state = 'collecting'
     WHERE id = p_booking_id;
    RETURN QUERY SELECT 'collecting'::text, false, 0, v_dest;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_booking.state, false, 0, v_dest;
END;
$fn$;

-- The webhook (service role) is the only caller. Nothing a client could do
-- with it is legitimate.
REVOKE ALL ON FUNCTION public.settle_split_booking(uuid) FROM public, anon, authenticated;

COMMENT ON FUNCTION public.settle_split_booking(uuid) IS
  'Race-safe split-fixture settlement: locks the booking, re-counts '
  'succeeded share/cover payments, flips pending->collecting on the anchor '
  'and collecting->confirmed on the full sum. Raises on over-collection. '
  'Returns whether the caller should (idempotently) create the venue '
  'Transfer. Service role only (C2 W3, ADR-0027).';
