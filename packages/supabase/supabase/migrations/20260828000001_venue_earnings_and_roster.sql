-- 20260828000001_venue_earnings_and_roster.sql
-- M6 #41g — the owner's money and the owner's roster, plus a security fix
-- the work surfaced. Plan: docs/plans/venue-owner-admin.md (gaps 1 + 2,
-- re-plan 2026-08-28). Privacy decision: docs/adr/0023.
--
-- ════════════════════════════════════════════════════════════════════
-- 0. SECURITY FIX — v_gmv_daily leaked the platform rollup
-- ════════════════════════════════════════════════════════════════════
-- v_gmv_daily's closing comment claimed "views inherit RLS from the base
-- tables". That is false for a view owned by `postgres`: without
-- security_invoker the query runs with the OWNER's privileges, and table
-- owners bypass RLS (no FORCE ROW LEVEL SECURITY here). Proven on the
-- local stack 2026-08-28: with one succeeded payment in the table, an
-- authenticated stranger read 1 rollup row from the view while the base
-- table correctly returned 0. Any signed-in player could read Ludi's
-- daily gross/net/refund numbers via PostgREST.
--
-- security_invoker = on makes the original comment true: the view now
-- evaluates under the caller, payments_select_self_or_admin applies, an
-- admin sees the platform rollup and a player sees only buckets built
-- from their own payments (harmless, as the original comment accepted).
--
-- Restated as CREATE OR REPLACE … WITH (…) rather than ALTER VIEW … SET
-- because the option is set at creation like every other view in this
-- repo — and sqlfluff's postgres dialect cannot parse the ALTER form.
-- Body is byte-identical to 20260515000001.
CREATE OR REPLACE VIEW public.v_gmv_daily
WITH (security_invoker = on) AS
SELECT
  ((p.created_at AT TIME ZONE 'Europe/Nicosia')::date)         AS day,
  SUM(p.amount_cents)::bigint                                  AS gross_cents,
  SUM(p.refunded_amount_cents)::bigint                         AS refunded_cents,
  (SUM(p.amount_cents) - SUM(p.refunded_amount_cents))::bigint AS net_cents,
  COUNT(*)::int                                                AS payments_count,
  COUNT(DISTINCT p.booking_id)::int                            AS bookings_count
FROM public.payments p
WHERE p.status IN ('succeeded', 'refunded', 'partially_refunded')
GROUP BY 1;

COMMENT ON VIEW public.v_gmv_daily IS
  'Daily payments rollup for the admin dashboard. Bucketed by Europe/Nicosia '
  'local date. Excludes pending/failed/cancelled payments. Refunds attributed '
  'to the original payment date. security_invoker=on (2026-08-28): evaluates '
  'under the caller so payments RLS applies — admin sees all, a player sees '
  'only their own buckets, a stranger sees nothing.';

-- ════════════════════════════════════════════════════════════════════
-- 1. v_venue_earnings_daily — "how much did I make, and when?"
-- ════════════════════════════════════════════════════════════════════
-- The owner-dimensioned counterpart to v_gmv_daily. payments stays closed
-- to owners (payments_select_self_or_admin is untouched); this view is the
-- only bridge, and it is aggregate-only — no payment intents, no player
-- identities, no per-row Stripe state.
--
-- ADR-0013 shape: definer rights (security_invoker = off) so the joins can
-- cross tables the caller cannot read, with the caller predicate INSIDE the
-- view. auth.uid()/is_admin() still resolve from the caller's JWT.
--
-- Day bucketing matches v_gmv_daily (Europe/Nicosia, payment date, refunds
-- attributed to the original payment's day) so the founder's platform
-- numbers and the owner's venue numbers reconcile by construction.
--
-- Money columns, and what they honestly mean:
--   gross_cents      — what players paid for this venue's pitches
--   refunded_cents   — reversals, attributed to the original payment day
--   fee_cents        — Ludi's cut as charged (application_fee_cents)
--   net_cents        — gross − refunded (money that stayed moved)
--   venue_net_cents  — gross − refunded − fee: the venue's take, computed
--                      conservatively. On a Stripe refund the application
--                      fee may itself be returned to the platform; this
--                      floor treats the full fee as kept, so the owner is
--                      never shown more than they will receive. Exact
--                      refund-fee accounting is a webhook concern, not a
--                      view concern — revisit if partial refunds become
--                      common.
--
-- Forward note (41j, walk-ins): offline walk-in bookings will insert a
-- payments row with a synthetic intent id and an offline marker. Because
-- this view reads payments, walk-in revenue will appear here with no
-- schema change — that is deliberate; see the 2026-08-28 re-plan.
CREATE VIEW public.v_venue_earnings_daily
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
    COUNT(DISTINCT p.booking_id)::int                             AS bookings_count
  FROM public.payments p
  JOIN public.bookings b  ON b.id  = p.booking_id
  JOIN public.pitches  pt ON pt.id = b.pitch_id
  JOIN public.venues   v  ON v.id  = pt.venue_id
  WHERE p.status IN ('succeeded', 'refunded', 'partially_refunded')
    AND (public.is_venue_owner_of_venue(v.id) OR public.is_admin())
  GROUP BY v.id, v.name, 3;

COMMENT ON VIEW public.v_venue_earnings_daily IS
  'Venue-dimensioned daily earnings for the owner dashboard (M6 #41g). '
  'Definer-rights view with its own caller predicate: owners see only their '
  'venues, admin sees all, everyone else sees nothing. Aggregates only — '
  'payments base table stays closed to owners. venue_net_cents is a '
  'conservative floor (full fee treated as kept on refunds).';

GRANT SELECT ON public.v_venue_earnings_daily TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2. v_venue_booking_roster — "who is turning up tonight?"
-- ════════════════════════════════════════════════════════════════════
-- ADR-0023 in code. One row per booking on the owner's pitches, carrying
-- the organiser's name, the booking code, party size, the addons the venue
-- must fulfil (bibs and ball rental are legal requirements on every CY
-- booking), and — ONLY inside the operational window — the organiser's
-- phone.
--
-- Excluded by construction, per ADR-0023: email, stripe_customer_id,
-- platform_fee_cents, booking notes, and all profile attributes.
--
-- The phone window is enforced HERE, not in the UI, so no client bug can
-- widen it: non-NULL only for money-moved states and only from 24 h before
-- kickoff until the slot ends. Phone lives solely in auth.users; this
-- definer view is the one bridge (precedent: admin_lookup_user_by_phone,
-- 20260827000001). Anonymised players (ADR-0018) appear with nulled names
-- — the row stays, because the booking happened.
--
-- total_cents is included because bookings' own SELECT policy already
-- shows it to the owner — repeating it here grants nothing new and saves
-- the UI a second query. party_size stays NULL for pre-participants
-- bookings rather than showing a fake 0 (ADR-0012's no-zeros posture).
CREATE VIEW public.v_venue_booking_roster
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
    u.first_name,
    u.last_name,
    (b.gk_slots + b.outfield_slots)::int  AS party_size,
    (SELECT count(*) FROM public.booking_participants bp
      WHERE bp.booking_id = b.id AND bp.status = 'in')::int
                                          AS confirmed_count,
    CASE
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
      '[]'::jsonb)                        AS addons
  FROM public.bookings b
  JOIN public.pitches p  ON p.id  = b.pitch_id
  JOIN public.venues  v  ON v.id  = p.venue_id
  JOIN public.users   u  ON u.id  = b.user_id
  LEFT JOIN auth.users au ON au.id = b.user_id
 WHERE public.is_venue_owner_of_pitch(b.pitch_id)
    OR public.is_admin();

COMMENT ON VIEW public.v_venue_booking_roster IS
  'The owner''s booking sheet (M6 #41g, ADR-0023). Organiser name + code + '
  'party size + addons per booking on the caller''s pitches; phone exposed '
  'only for paid/confirmed bookings within 24h-before-kickoff → slot end, '
  'enforced in the view. Never exposes email, notes, platform fee, or '
  'profile attributes.';

GRANT SELECT ON public.v_venue_booking_roster TO authenticated;
