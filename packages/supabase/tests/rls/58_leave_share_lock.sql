-- 58_leave_share_lock.sql — leaving a collecting fixture under the lock
-- Under test (20261020000102_leave_share_lock):
--   begin_leave_share — service role only; refuses the organiser, a
--     stranger and an open card sheet; on a collecting split fixture marks
--     the leaver's share `refunding` and seats them out in one go; a retry
--     returns what is still owed
--   settle_split_booking — does not count a `refunding` share
--
-- Fixture: e570, a split fixture on pitch c2 still collecting, organiser
-- a4. Shares: the organiser 3000, P (d571) 1000, Q (d572) 1000 — all
-- succeeded, which is the full 5000: Q's share has just landed and its
-- settle has not run yet. R (d573) sits with a card sheet still open.
BEGIN;
SELECT plan(11);

INSERT INTO auth.users (id) VALUES
('00000000-0000-4000-8000-00000000d571'),
('00000000-0000-4000-8000-00000000d572'),
('00000000-0000-4000-8000-00000000d573')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (id, first_name, last_name, city_id, role)
SELECT v.id::uuid, v.n, 'Test', (SELECT id FROM public.cities WHERE code = 'larnaca'), 'player'
FROM (VALUES
  ('00000000-0000-4000-8000-00000000d571', 'Panos'),
  ('00000000-0000-4000-8000-00000000d572', 'Kyriakos'),
  ('00000000-0000-4000-8000-00000000d573', 'Rafael')
) AS v (id, n)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  gk_slots, outfield_slots, is_split, share_amount_cents, collect_deadline, stripe_transfer_id,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-00000000e570', 'RLS-2030-5700', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2', date_trunc('hour', now()) + interval '6 days',
  date_trunc('hour', now()) + interval '6 days 1 hour',
  'collecting', 1, 4, TRUE, 1000, date_trunc('hour', now()) + interval '5 days', NULL,
  5000, 0, 5000, 500, 'standard'
);

INSERT INTO public.booking_participants (id, booking_id, user_id, slot_kind) VALUES
('00000000-0000-4000-8000-00000000f571', '00000000-0000-4000-8000-00000000e570', '00000000-0000-4000-8000-00000000d571', 'outfield'),
('00000000-0000-4000-8000-00000000f572', '00000000-0000-4000-8000-00000000e570', '00000000-0000-4000-8000-00000000d572', 'outfield'),
('00000000-0000-4000-8000-00000000f573', '00000000-0000-4000-8000-00000000e570', '00000000-0000-4000-8000-00000000d573', 'outfield');

INSERT INTO public.payments (
  id, booking_id, stripe_payment_intent_id, amount_cents, application_fee_cents, status, kind, participant_id
) VALUES
(
  '00000000-0000-4000-8000-00000000a570', '00000000-0000-4000-8000-00000000e570', 'pi_test_5700_org', 3000, 0,
  'succeeded', 'share',
  (SELECT bp.id FROM public.booking_participants AS bp
   WHERE bp.booking_id = '00000000-0000-4000-8000-00000000e570'
     AND bp.user_id = '00000000-0000-4000-8000-0000000000a4')
),
(
  '00000000-0000-4000-8000-00000000a571', '00000000-0000-4000-8000-00000000e570', 'pi_test_5700_p', 1000, 0,
  'succeeded', 'share', '00000000-0000-4000-8000-00000000f571'
),
(
  '00000000-0000-4000-8000-00000000a572', '00000000-0000-4000-8000-00000000e570', 'pi_test_5700_q', 1000, 0,
  'succeeded', 'share', '00000000-0000-4000-8000-00000000f572'
),
(
  '00000000-0000-4000-8000-00000000a573', '00000000-0000-4000-8000-00000000e570', 'pi_test_5700_r', 1000, 0,
  'requires_payment_method', 'share', '00000000-0000-4000-8000-00000000f573'
);

-- ── who may call it ─────────────────────────────────────────────────
-- 1. without the service-role claim it refuses even a role that holds
--    EXECUTE (here the owner): the guard reads the JWT, not the ACL, so it
--    holds whatever the grants are. The ACL itself (service_role only) is
--    56_function_acl's to check.
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', TRUE);
SELECT throws_ok(
  $$SELECT * FROM public.begin_leave_share(
      '00000000-0000-4000-8000-00000000e570', '00000000-0000-4000-8000-00000000d571')$$,
  'P0001',
  'LEAVE_FORBIDDEN',
  'begin_leave_share: no service-role claim, no leave'
);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

-- 2. the organiser cancels instead
SELECT throws_ok(
  $$SELECT * FROM public.begin_leave_share(
      '00000000-0000-4000-8000-00000000e570', '00000000-0000-4000-8000-0000000000a4')$$,
  'P0001',
  'LEAVE_ORGANISER',
  'begin_leave_share: the organiser cannot leave'
);

-- 3. someone not on the roster has nothing to leave
SELECT throws_ok(
  $$SELECT * FROM public.begin_leave_share(
      '00000000-0000-4000-8000-00000000e570', '00000000-0000-4000-8000-0000000000a5')$$,
  'P0001',
  'LEAVE_NOT_ON_ROSTER',
  'begin_leave_share: a stranger is not on the roster'
);

-- 4. an open card sheet must be cancelled at Stripe first
SELECT throws_ok(
  $$SELECT * FROM public.begin_leave_share(
      '00000000-0000-4000-8000-00000000e570', '00000000-0000-4000-8000-00000000d573')$$,
  'P0001',
  'LEAVE_PAYMENT_IN_FLIGHT',
  'begin_leave_share: a live share PI is refused'
);

-- ── P leaves ────────────────────────────────────────────────────────
CREATE TEMP TABLE t_owed AS
SELECT * FROM public.begin_leave_share(
  '00000000-0000-4000-8000-00000000e570', '00000000-0000-4000-8000-00000000d571'
);

-- 5. the caller is told exactly one share to refund, P's
SELECT is(
  (SELECT string_agg(o.payment_id::text || ':' || o.amount_cents, ',') FROM t_owed AS o),
  '00000000-0000-4000-8000-00000000a571:1000',
  'begin_leave_share: returns the leaver''s share to refund'
);

-- 6. the share is marked refunding, not yet refunded
SELECT is(
  (SELECT p.status FROM public.payments AS p WHERE p.id = '00000000-0000-4000-8000-00000000a571'),
  'refunding',
  'begin_leave_share: the share is refunding'
);

-- 7. and the seat is out, in the same transaction
SELECT is(
  (SELECT bp.status FROM public.booking_participants AS bp
   WHERE bp.id = '00000000-0000-4000-8000-00000000f571'),
  'out',
  'begin_leave_share: the leaver is seated out'
);

-- 8. Q's settle now runs and does not count P's share: 4000 of 5000, so
--    the fixture keeps collecting instead of confirming on money it is
--    about to give back
SELECT is(
  (SELECT s.state || ':' || s.should_transfer::text
   FROM public.settle_split_booking('00000000-0000-4000-8000-00000000e570') AS s),
  'collecting:false',
  'settle_split_booking: a refunding share is not counted'
);

-- 9. a retry (the Stripe refund failed) finds the seat out and the share
--    still owed, and hands it back again
SELECT is(
  (SELECT count(*)::int FROM public.begin_leave_share(
     '00000000-0000-4000-8000-00000000e570', '00000000-0000-4000-8000-00000000d571')),
  1,
  'begin_leave_share: a retry returns what is still owed'
);

-- 10. once refunded, there is nothing left to leave
UPDATE public.payments SET status = 'refunded', refunded_amount_cents = 1000
WHERE id = '00000000-0000-4000-8000-00000000a571';
SELECT throws_ok(
  $$SELECT * FROM public.begin_leave_share(
      '00000000-0000-4000-8000-00000000e570', '00000000-0000-4000-8000-00000000d571')$$,
  'P0001',
  'LEAVE_NOT_ON_ROSTER',
  'begin_leave_share: out and refunded means not on the roster'
);

-- 11. the CHECK takes the new status and still refuses nonsense
SELECT throws_ok(
  $$UPDATE public.payments SET status = 'refundingish'
    WHERE id = '00000000-0000-4000-8000-00000000a572'$$,
  '23514',
  NULL,
  'payments_status_check: still a closed list'
);

SELECT * FROM finish();
ROLLBACK;
