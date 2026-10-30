-- 19_settle_split.sql — settle_split_booking() (migration 20260830000002)
--
-- The race-safe confirm for split fixtures. Under test:
--   pending → collecting on the anchor share (real money holds the slot)
--   collecting stays collecting on a partial sum
--   collecting → confirmed on the exact sum, with should_transfer, the
--     venue destination, and transfer_cents = total − platform fee
--   confirmed keeps should_transfer = true (webhook-death redelivery)
--   over-collection RAISES (the sum invariant, asserted where counted)
--   non-split bookings are refused
--   clients cannot execute it at all (service role only)
--   fixture_preview (extended) says what a slot costs
BEGIN;
SELECT plan(13);

-- settle_split_booking() admits only service-role requests (its in-function
-- guard reads the JWT role claim). The legit calls below present it the way
-- the webhook's service client does; test 11 swaps it out and expects the
-- door shut.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

-- A split fixture on pitch c2 (venue b1 carries a stripe_account_id in
-- bootstrap), organiser a4, 4500 total, 450 fee, 450/share, state pending —
-- exactly what create-booking writes before the anchor settles.
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents,
  cancellation_policy, is_split, share_amount_cents, collect_deadline
) VALUES (
  '00000000-0000-4000-8000-0000000000e5',
  'RLS-2031-0005',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2',
  '2031-07-10 18:00+00', '2031-07-10 19:00+00', 'pending',
  4000, 500, 4500, 450,
  'standard', TRUE, 450, '2031-07-09 18:00+00'
);

-- The organiser's participant row was seated by the trigger; a2 joins too.
INSERT INTO public.booking_participants (id, booking_id, user_id, slot_kind)
VALUES (
  '00000000-0000-4000-8000-0000000000da',
  '00000000-0000-4000-8000-0000000000e5',
  '00000000-0000-4000-8000-0000000000a2',
  'outfield'
);

CREATE TEMP TABLE t_organiser AS
  SELECT id FROM public.booking_participants
   WHERE booking_id = '00000000-0000-4000-8000-0000000000e5'
     AND user_id    = '00000000-0000-4000-8000-0000000000a4';

-- 1 — nothing succeeded yet: settle is a no-op that reports honestly.
SELECT is(
  (SELECT s.state FROM public.settle_split_booking(
     '00000000-0000-4000-8000-0000000000e5') s),
  'pending',
  'settle: no succeeded shares, no movement'
);

-- The anchor share settles (what the webhook records before calling settle).
INSERT INTO public.payments (
  booking_id, stripe_payment_intent_id, amount_cents,
  application_fee_cents, status, kind, participant_id
) SELECT
  '00000000-0000-4000-8000-0000000000e5',
  'pi_settle_anchor', 450, 0, 'succeeded', 'share', id
FROM t_organiser;

-- 2
SELECT is(
  (SELECT s.state FROM public.settle_split_booking(
     '00000000-0000-4000-8000-0000000000e5') s),
  'collecting',
  'settle: the anchor share flips pending → collecting'
);

-- 3
SELECT is(
  (SELECT state FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000e5'),
  'collecting',
  'settle: the flip is real, not just reported'
);

-- 4 — a2's share lands; sum is 900 of 4500: stays collecting, no transfer.
INSERT INTO public.payments (
  booking_id, stripe_payment_intent_id, amount_cents,
  application_fee_cents, status, kind, participant_id
) VALUES (
  '00000000-0000-4000-8000-0000000000e5',
  'pi_settle_s2', 450, 0, 'succeeded', 'share',
  '00000000-0000-4000-8000-0000000000da'
);
SELECT is(
  (SELECT s.state || ':' || s.should_transfer FROM public.settle_split_booking(
     '00000000-0000-4000-8000-0000000000e5') s),
  'collecting:false',
  'settle: a partial sum stays collecting with no transfer'
);

-- 5 — the organiser covers the rest at the deadline (kind=cover, W4's
-- path) and the sum closes exactly.
INSERT INTO public.payments (
  booking_id, stripe_payment_intent_id, amount_cents,
  application_fee_cents, status, kind, participant_id
) SELECT
  '00000000-0000-4000-8000-0000000000e5',
  'pi_settle_cover', 3600, 0, 'succeeded', 'cover', id
FROM t_organiser;

SELECT is(
  (SELECT s.state || ':' || s.should_transfer || ':' || s.transfer_cents
     FROM public.settle_split_booking('00000000-0000-4000-8000-0000000000e5') s),
  'confirmed:true:4050',
  'settle: the exact sum confirms and hands the webhook total − fee to transfer'
);

-- 6
SELECT is(
  (SELECT state FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000e5'),
  'confirmed',
  'settle: confirmed on the row itself'
);

-- 7 — redelivery safety: a webhook that died between the flip and the
-- Transfer must be able to finish the job. Stripe's idempotency key makes
-- the repeat create a no-op, so should_transfer STAYS true.
SELECT is(
  (SELECT s.state || ':' || s.should_transfer FROM public.settle_split_booking(
     '00000000-0000-4000-8000-0000000000e5') s),
  'confirmed:true',
  'settle: confirmed keeps should_transfer true for redelivery'
);

-- 8 — the destination is the venue's account, resolved server-side.
SELECT is(
  (SELECT s.destination FROM public.settle_split_booking(
     '00000000-0000-4000-8000-0000000000e5') s),
  (SELECT v.stripe_account_id FROM public.venues v
     JOIN public.pitches p ON p.venue_id = v.id
    WHERE p.id = '00000000-0000-4000-8000-0000000000c2'),
  'settle: destination is the fixture''s venue account'
);

-- 9 — over-collection is a RAISE, not a bigger transfer. (A second live
-- *share* for a participant can't even insert — W2's unique index blocks
-- it, test 18 — so the vehicle is a stray extra cover row.)
INSERT INTO public.payments (
  booking_id, stripe_payment_intent_id, amount_cents,
  application_fee_cents, status, kind, participant_id
) SELECT
  '00000000-0000-4000-8000-0000000000e5',
  'pi_settle_over', 450, 0, 'succeeded', 'cover', id
FROM t_organiser;
SELECT throws_ok(
  $$SELECT * FROM public.settle_split_booking(
      '00000000-0000-4000-8000-0000000000e5')$$,
  'P0001',
  NULL,
  'settle: over-collection raises rather than compounding'
);
DELETE FROM public.payments WHERE stripe_payment_intent_id = 'pi_settle_over';

-- 10 — a non-split booking is refused (f1 is the bootstrap free fixture).
SELECT throws_ok(
  $$SELECT * FROM public.settle_split_booking(
      '00000000-0000-4000-8000-0000000000f1')$$,
  'P0001',
  'SETTLE_NOT_SPLIT',
  'settle: refuses non-split bookings'
);

-- 11 — a client-shaped request has no EXECUTE: the migration revoked it.
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.settle_split_booking(uuid)', 'execute'),
  'settle: a signed-in caller has no EXECUTE'
);

-- 11b — and the in-function guard refuses one anyway, no matter what the
-- ACL says: Supabase's default privileges grant every new function to
-- anon and authenticated, so an ACL-only defence is one forgotten REVOKE
-- from gone. The grant exists only to reach the guard; ROLLBACK drops it.
RESET ROLE;
GRANT EXECUTE ON FUNCTION public.settle_split_booking(uuid) TO authenticated;
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', TRUE);
SELECT throws_ok(
  $$SELECT * FROM public.settle_split_booking(
      '00000000-0000-4000-8000-0000000000e5')$$,
  'P0001',
  'SETTLE_FORBIDDEN',
  'settle: refuses any request that is not service-role'
);
RESET ROLE;

-- 12 — the extended preview says what a slot costs.
SELECT is(
  (SELECT p.is_split || ':' || p.share_amount_cents
     FROM public.fixture_preview(
       (SELECT invite_token FROM public.bookings
         WHERE id = '00000000-0000-4000-8000-0000000000e5')) p),
  'true:450',
  'fixture_preview: is_split and share_amount_cents ride along'
);

SELECT * FROM finish();
ROLLBACK;
