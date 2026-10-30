-- 37_manager_boundary.sql — what a manager may not do (ADR-0041)
-- Migration under test: 20260917000006_what_a_manager_may_not_do.
--
-- `venue_owners.role` had two values and meant almost nothing: every
-- policy gated on is_venue_owner_of_venue(), which matches on user_id and
-- never reads role, so a manager was an owner everywhere but two Edge
-- Functions. These assertions are the line, in both directions — the
-- "may not" ones say the boundary exists, and the "may" ones say it did
-- not take the day with it, which is the failure mode that matters.
--
-- Fixtures (_bootstrap): venue_a b1 with owner a2 and manager a3,
-- pitch_a1 c1, one succeeded payment of 4000 with a 400 fee.
BEGIN;
SELECT plan(18);

-- A payout row to read, and something for the owner's earnings view to
-- return. As superuser, before any set_test_user; rolls back with the rest.
INSERT INTO public.venue_payouts (
  venue_id, stripe_payout_id, amount_cents, currency, status, arrival_date
) VALUES (
  '00000000-0000-4000-8000-0000000000b1'::uuid,
  'po_rls_fixture_001', 3600, 'eur', 'paid', '2026-09-01'
) ON CONFLICT DO NOTHING;

-- ── The day: a manager keeps all of it ──────────────────────────────
-- First, and deliberately first. A boundary that also locks the counter
-- out of the counter is not a tighter boundary, it is an outage.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);

-- 1. he reads the venue he works at
SELECT is(
  (SELECT count(*)::int FROM public.venues AS v
   WHERE v.id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  1,
  'manager: still reads the venue'
);

-- 2. and its courts, including the unverified one an owner-or-manager
--    read is the only way to see
SELECT is(
  (SELECT count(*)::int FROM public.pitches AS p
   WHERE p.venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  2,
  'manager: still reads both courts, unverified included'
);

-- 3. and the price on them — he has to quote it at the counter
SELECT is(
  (SELECT p.price_per_hour_cents FROM public.pitches AS p
   WHERE p.id = '00000000-0000-4000-8000-0000000000c1'::uuid),
  4000,
  'manager: still reads a price'
);

-- 4. and sets the opening hours. A burst pipe at 08:00 is his to act on.
INSERT INTO public.pitch_schedules (
  pitch_id, day_of_week, opens_at, closes_at, slot_duration_minutes
) VALUES ('00000000-0000-4000-8000-0000000000c1'::uuid, 3, '10:00', '16:00', 60);
SELECT is(
  (SELECT count(*)::int FROM public.pitch_schedules AS s
   WHERE s.pitch_id = '00000000-0000-4000-8000-0000000000c1'::uuid
     AND s.day_of_week = 3),
  1,
  'manager: still sets opening hours'
);

-- ── What it earned: not his ─────────────────────────────────────────
-- 5. the earnings view answers nothing at all
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_earnings_daily AS e
   WHERE e.venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  0,
  'manager: sees no earnings, and so no commission'
);

-- 6. nor the payouts mirror
SELECT is(
  (SELECT count(*)::int FROM public.venue_payouts AS p
   WHERE p.venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  0,
  'manager: sees no payouts'
);

-- 7. nor v_venue_private, which carries take_rate_bps outright —
--    withholding /earnings while leaving this readable would be theatre
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_private AS p
   WHERE p.venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  0,
  'manager: sees no take rate'
);

-- ── What the venue is: not his ──────────────────────────────────────
-- RLS filters an UPDATE to nothing rather than raising, so the assertion
-- is on rows touched. Silent is the dangerous shape; these pin it down.
-- 8. he cannot move a price
WITH attempted AS (
  UPDATE public.pitches SET price_per_hour_cents = 9999
   WHERE id = '00000000-0000-4000-8000-0000000000c1'::uuid
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM attempted), 0, 'manager: cannot set a price');

-- 9. and the price really did not move
SELECT is(
  (SELECT p.price_per_hour_cents FROM public.pitches AS p
   WHERE p.id = '00000000-0000-4000-8000-0000000000c1'::uuid),
  4000,
  'manager: the price is unchanged after the attempt'
);

-- 10. he cannot rename the venue
WITH attempted AS (
  UPDATE public.venues SET name = 'Manager Renamed This'
   WHERE id = '00000000-0000-4000-8000-0000000000b1'::uuid
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM attempted), 0, 'manager: cannot rename the venue');

-- 11. nor add a court to it
SELECT throws_ok(
  $$INSERT INTO public.pitches (venue_id, name, type, surface, price_per_hour_cents)
    VALUES ('00000000-0000-4000-8000-0000000000b1'::uuid,
            'Manager Added This', '5-a-side', 'turf', 4000)$$,
  '42501',
  NULL,
  'manager: cannot add a court'
);

-- 12. nor restructure a composite court. pitch_components keys on the
--     pitch, not the venue, so it needed its own role-aware helper —
--     and without it the line had a door: no editing the pitch row, but
--     free rein over what the pitch is made of.
SELECT throws_ok(
  $$INSERT INTO public.pitch_components (parent_pitch_id, child_pitch_id)
    VALUES ('00000000-0000-4000-8000-0000000000c1'::uuid,
            '00000000-0000-4000-8000-0000000000c2'::uuid)$$,
  '42501',
  NULL,
  'manager: cannot restructure a composite court'
);

-- ── The owner still may, all of it ──────────────────────────────────
-- The other half of every assertion above. A migration that tightened
-- the owner out too would pass the first half and fail the venue.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);

-- 13. the owner sees what the venue earned
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_earnings_daily AS e
   WHERE e.venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  1,
  'owner: still sees the earnings'
);

-- 14. and the payout
SELECT is(
  (SELECT count(*)::int FROM public.venue_payouts AS p
   WHERE p.venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  1,
  'owner: still sees the payout'
);

-- 15. and the take rate
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_private AS p
   WHERE p.venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  1,
  'owner: still sees the take rate'
);

-- 16. and may set a price
WITH attempted AS (
  UPDATE public.pitches SET price_per_hour_cents = 4500
   WHERE id = '00000000-0000-4000-8000-0000000000c1'::uuid
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM attempted), 1, 'owner: still sets a price');

-- 17. and may rename the venue
WITH attempted AS (
  UPDATE public.venues SET name = 'Owner Renamed This'
   WHERE id = '00000000-0000-4000-8000-0000000000b1'::uuid
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM attempted), 1, 'owner: still renames the venue');

-- 18. and may say what a composite court is made of
INSERT INTO public.pitch_components (parent_pitch_id, child_pitch_id)
VALUES ('00000000-0000-4000-8000-0000000000c1'::uuid,
        '00000000-0000-4000-8000-0000000000c2'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.pitch_components AS c
   WHERE c.parent_pitch_id = '00000000-0000-4000-8000-0000000000c1'::uuid),
  1,
  'owner: still says what a composite court is made of'
);

SELECT * FROM finish();
ROLLBACK;
