-- 20260829000001_walk_in_bookings.sql
-- M6 #41j — the schema half of walk-in bookings. Re-plan 2026-08-28:
-- walk-ins are REAL bookings with an offline payment path, so the phone
-- rings, the owner blocks the slot, and the money still counts — without
-- touching the Stripe path at all (the create-booking function has a zero
-- diff this weekend; walk-ins get their own Edge Function).
--
-- Everything here is additive: three nullable-or-defaulted columns, one
-- CHECK widening, and append-only CREATE OR REPLACE on the two #41g views.

-- ────────────────────────────────────────────────────────────────────
-- 1. bookings — where did this booking come from, and who is it for?
-- ────────────────────────────────────────────────────────────────────
-- origin discriminates the two creation paths. user_id stays NOT NULL and
-- points at the ACTING owner/admin for a walk-in (FK integrity without
-- fabricating accounts for people who walked in off the street); the
-- customer's identity lives in walk_in_name / walk_in_phone, supplied by
-- the owner about their own customer. That is the owner's data, not
-- platform-collected player data, so ADR-0023's phone window does not
-- apply to it — the roster view below hands it straight back to them.
ALTER TABLE public.bookings
  ADD COLUMN origin        text NOT NULL DEFAULT 'app'
                           CHECK (origin IN ('app', 'walk_in')),
  ADD COLUMN walk_in_name  text CHECK (char_length(walk_in_name) <= 120),
  ADD COLUMN walk_in_phone text CHECK (char_length(walk_in_phone) <= 30),
  ADD CONSTRAINT bookings_walk_in_fields_check CHECK (
    origin = 'walk_in' OR (walk_in_name IS NULL AND walk_in_phone IS NULL)
  );

COMMENT ON COLUMN public.bookings.origin IS
  'How the booking was created: app (player, via create-booking + Stripe) '
  'or walk_in (owner/admin, via create-walk-in-booking, paid offline).';
COMMENT ON COLUMN public.bookings.walk_in_name IS
  'Walk-in customer name as the owner entered it. Only for origin=walk_in; '
  'user_id points at the acting owner, not the customer.';

-- ────────────────────────────────────────────────────────────────────
-- 2. payments — the offline method
-- ────────────────────────────────────────────────────────────────────
-- A walk-in gets a payments row like any booking (that is the whole point:
-- v_venue_earnings_daily reads payments, so walk-in revenue counts from
-- day one). stripe_payment_intent_id stays NOT NULL UNIQUE — offline rows
-- carry the synthetic id 'offline_<booking_id>', which can never collide
-- with a real 'pi_…'. The commission on offline rows is RECORDED, not
-- collected (re-plan decision 3); settlement stays manual.
ALTER TABLE public.payments
  ADD COLUMN payment_method text NOT NULL DEFAULT 'stripe'
                            CHECK (payment_method IN ('stripe', 'offline'));

COMMENT ON COLUMN public.payments.payment_method IS
  'stripe: money moved through the platform. offline: cash/card at the '
  'venue — amount and fee are bookkeeping (fee owed, not collected).';

-- ────────────────────────────────────────────────────────────────────
-- 3. admin_actions — walk-in vocabulary
-- ────────────────────────────────────────────────────────────────────
-- The Edge Function writes these as service role (RLS bypassed), so only
-- the CHECK needs widening — the owner INSERT policy's vocabulary stays
-- as 41i defined it.
ALTER TABLE public.admin_actions
  DROP CONSTRAINT admin_actions_action_type_check;

ALTER TABLE public.admin_actions
  ADD CONSTRAINT admin_actions_action_type_check CHECK (action_type IN (
    'refund_booking','verify_pitch','deactivate_pitch','activate_pitch',
    'create_venue','deactivate_venue','anonymize_user','other',
    'update_venue','create_pitch','update_pitch',
    'schedule_change','override_change',
    'walk_in_created','walk_in_cancelled'
  ));

-- ────────────────────────────────────────────────────────────────────
-- 4. v_venue_booking_roster — walk-in aware
-- ────────────────────────────────────────────────────────────────────
-- Same view, three changed expressions and one appended column (CREATE OR
-- REPLACE permits exactly that):
--   * first_name/last_name: the walk-in customer's name for walk-ins
--     (user_id is the acting owner — showing THEIR name would be wrong).
--   * organiser_phone: for walk-ins, the phone the owner themselves
--     entered, un-windowed (it is their data); app bookings keep the
--     ADR-0023 window unchanged.
--   * origin appended so the UI can badge walk-ins distinctly (41k).
CREATE OR REPLACE VIEW public.v_venue_booking_roster
WITH (security_invoker = off) AS
  SELECT
    b.id                                  AS booking_id,
    b.code,
    v.id                                  AS venue_id,
    p.id                                  AS pitch_id,
    p.name                                AS pitch_name,
    b.starts_at,
    b.ends_at,
    b.state,
    b.total_cents,
    CASE WHEN b.origin = 'walk_in' THEN b.walk_in_name
         ELSE u.first_name END            AS first_name,
    CASE WHEN b.origin = 'walk_in' THEN NULL
         ELSE u.last_name END             AS last_name,
    (b.gk_slots + b.outfield_slots)::int  AS party_size,
    (SELECT count(*) FROM public.booking_participants bp
      WHERE bp.booking_id = b.id AND bp.status = 'in')::int
                                          AS confirmed_count,
    CASE
      WHEN b.origin = 'walk_in' THEN b.walk_in_phone
      WHEN b.state IN ('paid', 'confirmed')
       AND now() >= b.starts_at - interval '24 hours'
       AND now() <  b.ends_at
      THEN au.phone
    END                                   AS organiser_phone,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'addon_code', a.addon_code,
                'quantity',   a.quantity)
              ORDER BY a.addon_code)
         FROM public.booking_addons a
        WHERE a.booking_id = b.id),
      '[]'::jsonb)                        AS addons,
    b.origin
  FROM public.bookings b
  JOIN public.pitches p  ON p.id  = b.pitch_id
  JOIN public.venues  v  ON v.id  = p.venue_id
  JOIN public.users   u  ON u.id  = b.user_id
  LEFT JOIN auth.users au ON au.id = b.user_id
 WHERE public.is_venue_owner_of_pitch(b.pitch_id)
    OR public.is_admin();

COMMENT ON VIEW public.v_venue_booking_roster IS
  'The owner''s booking sheet (M6 #41g/#41j, ADR-0023). Organiser name + '
  'code + party size + addons per booking on the caller''s pitches; app '
  'bookings expose the phone only within 24h-before-kickoff → slot end, '
  'walk-ins carry the owner-entered name/phone un-windowed. Never exposes '
  'email, notes, platform fee, or profile attributes.';

-- ────────────────────────────────────────────────────────────────────
-- 5. v_venue_earnings_daily — the online/offline split
-- ────────────────────────────────────────────────────────────────────
-- Re-plan decision 3 made concrete: two appended columns split the gross
-- and the fee by payment_method, so the UI can say "€X collected through
-- Ludi, €Y taken at the venue (€Z commission owed)". The pre-existing
-- columns keep their meaning: gross/fee/venue_net span BOTH methods —
-- walk-in revenue is revenue.
CREATE OR REPLACE VIEW public.v_venue_earnings_daily
WITH (security_invoker = off) AS
  SELECT
    v.id                                                          AS venue_id,
    v.name                                                        AS venue_name,
    ((p.created_at AT TIME ZONE 'Europe/Nicosia')::date)          AS day,
    SUM(p.amount_cents)::bigint                                   AS gross_cents,
    SUM(p.refunded_amount_cents)::bigint                          AS refunded_cents,
    SUM(p.application_fee_cents)::bigint                          AS fee_cents,
    (SUM(p.amount_cents) - SUM(p.refunded_amount_cents))::bigint  AS net_cents,
    (SUM(p.amount_cents) - SUM(p.refunded_amount_cents)
                         - SUM(p.application_fee_cents))::bigint  AS venue_net_cents,
    COUNT(*)::int                                                 AS payments_count,
    COUNT(DISTINCT p.booking_id)::int                             AS bookings_count,
    COALESCE(SUM(p.amount_cents)
               FILTER (WHERE p.payment_method = 'offline'), 0)::bigint
                                                                  AS offline_gross_cents,
    COALESCE(SUM(p.application_fee_cents)
               FILTER (WHERE p.payment_method = 'offline'), 0)::bigint
                                                                  AS offline_fee_cents
  FROM public.payments p
  JOIN public.bookings b  ON b.id  = p.booking_id
  JOIN public.pitches  pt ON pt.id = b.pitch_id
  JOIN public.venues   v  ON v.id  = pt.venue_id
  WHERE p.status IN ('succeeded', 'refunded', 'partially_refunded')
    AND (public.is_venue_owner_of_venue(v.id) OR public.is_admin())
  GROUP BY v.id, v.name, 3;

COMMENT ON VIEW public.v_venue_earnings_daily IS
  'Venue-dimensioned daily earnings for the owner dashboard (M6 #41g/#41j). '
  'Definer-rights view with its own caller predicate. gross/fee/venue_net '
  'span both payment methods; offline_gross_cents/offline_fee_cents carve '
  'out the walk-in share (offline fee is commission OWED, not collected).';
