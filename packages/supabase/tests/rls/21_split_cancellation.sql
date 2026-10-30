-- 21_split_cancellation.sql — the pre/post-confirm boundary (migration
-- 20260830000004).
--
-- The sweeper's refund pass heals PRE-confirm deaths at 100%; POST-confirm
-- cancellation is pro-rata and belongs to cancel-booking. The boundary is
-- bookings.stripe_transfer_id: once the venue Transfer exists, the sweeper
-- must never "heal" a crashed pro-rata fan-out up to 100%.
BEGIN;
SELECT plan(3);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

-- eA: died pre-confirm (no transfer) with money still held → sweeper's.
-- eB: cancelled post-confirm (transfer recorded) with a share the crashed
--     fan-out didn't reach → NOT the sweeper's.
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents,
  cancellation_policy, is_split, share_amount_cents, collect_deadline,
  cancelled_at, stripe_transfer_id
) VALUES
  ('00000000-0000-4000-8000-0000000000ea', 'RLS-2031-000a',
   '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c2',
   now() + interval '10 days', now() + interval '10 days 1 hour', 'cancelled',
   4000, 500, 4500, 450, 'standard', TRUE, 450, now() + interval '9 days',
   now(), NULL),
  ('00000000-0000-4000-8000-0000000000eb', 'RLS-2031-000b',
   '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c2',
   now() + interval '11 days', now() + interval '11 days 1 hour', 'refunded',
   4000, 500, 4500, 450, 'standard', TRUE, 450, now() + interval '10 days',
   now(), 'tr_test_w5_eb');

INSERT INTO public.payments (
  booking_id, stripe_payment_intent_id, amount_cents,
  application_fee_cents, status, kind, participant_id
) VALUES
  ('00000000-0000-4000-8000-0000000000ea', 'pi_w5_pre', 450, 0,
   'succeeded', 'share',
   (SELECT id FROM public.booking_participants
     WHERE booking_id = '00000000-0000-4000-8000-0000000000ea')),
  ('00000000-0000-4000-8000-0000000000eb', 'pi_w5_post', 450, 0,
   'succeeded', 'share',
   (SELECT id FROM public.booking_participants
     WHERE booking_id = '00000000-0000-4000-8000-0000000000eb'));

-- 1 — the sweeper sees exactly the pre-confirm corpse.
SELECT is(
  (SELECT array_agg(stripe_payment_intent_id) FROM public.refundable_split_payments()),
  ARRAY['pi_w5_pre'],
  'refundable: pre-confirm money only — a recorded Transfer fences the sweeper out'
);

-- 2 — the fence is the column, not the state: flip eA's transfer on and it
-- vanishes from the sweep too.
UPDATE public.bookings SET stripe_transfer_id = 'tr_test_w5_ea'
 WHERE id = '00000000-0000-4000-8000-0000000000ea';
SELECT is(
  (SELECT count(*)::int FROM public.refundable_split_payments()),
  0,
  'refundable: the stripe_transfer_id column is the boundary'
);

-- 3 — one venue Transfer per fixture, enforced at the schema.
SELECT throws_ok(
  $$UPDATE public.bookings SET stripe_transfer_id = 'tr_test_w5_ea'
     WHERE id = '00000000-0000-4000-8000-0000000000eb'$$,
  '23505',
  NULL,
  'stripe_transfer_id is UNIQUE — two fixtures cannot claim one Transfer'
);

SELECT * FROM finish();
ROLLBACK;
