-- 20_expire_collecting.sql — the split-payment clocks (migration
-- 20260830000003). The Edge Function owns the Stripe calls; these helpers
-- own WHICH rows, so the clock logic is tested here with injected clocks:
--   expiring_split_bookings()  — T-24h deadline + 2h grace, not before
--   refundable_split_payments() — succeeded share/cover money on dead split
--     fixtures only (never booking-kind rows, never live fixtures)
--   stale_share_claims()       — seats with a share PI dead at the card
--     sheet for 15+ min; never the organiser's anchor seat
--   assert_service_role()      — all three refuse non-service requests
BEGIN;
SELECT plan(8);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

-- e6: expired (deadline 3h ago — grace ran out at T-22h, 1h ago).
-- e7: deadline 30min ago — inside the organiser's grace; NOT expired.
-- e8: live collecting fixture carrying the stale-claim cases.
-- e9: already-cancelled split fixture holding succeeded money (pass-b bait).
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents,
  cancellation_policy, is_split, share_amount_cents, collect_deadline, cancelled_at
) VALUES
  ('00000000-0000-4000-8000-0000000000e6', 'RLS-2031-0006',
   '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c2',
   now() + interval '21 hours', now() + interval '22 hours', 'collecting',
   4000, 500, 4500, 450, 'standard', TRUE, 450, now() - interval '3 hours', NULL),
  ('00000000-0000-4000-8000-0000000000e7', 'RLS-2031-0007',
   '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c2',
   now() + interval '23 hours 30 minutes', now() + interval '24 hours 30 minutes', 'collecting',
   4000, 500, 4500, 450, 'standard', TRUE, 450, now() - interval '30 minutes', NULL),
  ('00000000-0000-4000-8000-0000000000e8', 'RLS-2031-0008',
   '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c2',
   now() + interval '5 days', now() + interval '5 days 1 hour', 'collecting',
   4000, 500, 4500, 450, 'standard', TRUE, 450, now() + interval '4 days', NULL),
  ('00000000-0000-4000-8000-0000000000e9', 'RLS-2031-0009x',
   '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c2',
   now() + interval '6 days', now() + interval '6 days 1 hour', 'cancelled',
   4000, 500, 4500, 450, 'standard', TRUE, 450, now() + interval '5 days', now());

-- Seats on e8: a2's share PI has been dead at the card sheet for 20 min
-- (stale); a3's for 5 min (fresh). The organiser's anchor seat exists via
-- the trigger and must never be swept.
INSERT INTO public.booking_participants (id, booking_id, user_id, slot_kind) VALUES
  ('00000000-0000-4000-8000-0000000000db',
   '00000000-0000-4000-8000-0000000000e8',
   '00000000-0000-4000-8000-0000000000a2', 'outfield'),
  ('00000000-0000-4000-8000-0000000000dc',
   '00000000-0000-4000-8000-0000000000e8',
   '00000000-0000-4000-8000-0000000000a3', 'outfield');

INSERT INTO public.payments (
  id, booking_id, stripe_payment_intent_id, amount_cents,
  application_fee_cents, status, kind, participant_id, created_at
) VALUES
  ('00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-0000000000e8', 'pi_w4_stale', 450, 0,
   'requires_payment_method', 'share',
   '00000000-0000-4000-8000-0000000000db', now() - interval '20 minutes'),
  ('00000000-0000-4000-8000-0000000000b2',
   '00000000-0000-4000-8000-0000000000e8', 'pi_w4_fresh', 450, 0,
   'requires_payment_method', 'share',
   '00000000-0000-4000-8000-0000000000dc', now() - interval '5 minutes'),
  ('00000000-0000-4000-8000-0000000000b3',
   '00000000-0000-4000-8000-0000000000e9', 'pi_w4_dead_share', 450, 0,
   'succeeded', 'share',
   (SELECT id FROM public.booking_participants
     WHERE booking_id = '00000000-0000-4000-8000-0000000000e9'
       AND user_id = '00000000-0000-4000-8000-0000000000a4'),
   now() - interval '1 hour');

-- 1 — only the fixture whose grace has run out expires.
SELECT is(
  (SELECT array_agg(booking_id) FROM public.expiring_split_bookings()),
  ARRAY['00000000-0000-4000-8000-0000000000e6']::uuid[],
  'expiring: past T-22h expires; inside the grace and live fixtures do not'
);

-- 2 — a shorter grace is the knob it claims to be.
SELECT is(
  (SELECT count(*)::int FROM public.expiring_split_bookings(interval '10 minutes')),
  2,
  'expiring: the grace parameter moves the line (e7 joins at 10min grace)'
);

-- 3 — dead-fixture money: e9's succeeded share, and nothing else.
SELECT is(
  (SELECT array_agg(stripe_payment_intent_id) FROM public.refundable_split_payments()),
  ARRAY['pi_w4_dead_share'],
  'refundable: succeeded share on a cancelled split fixture, only'
);

-- 4 — booking-kind money on dead NON-split bookings never appears
-- (the single-payer refund path owns those).
SELECT is(
  (SELECT count(*)::int FROM public.refundable_split_payments() r
    JOIN public.payments p ON p.id = r.payment_id
   WHERE p.kind = 'booking'),
  0,
  'refundable: never touches booking-kind payments'
);

-- 5 — the stale claim and only the stale claim.
SELECT is(
  (SELECT array_agg(stripe_payment_intent_id) FROM public.stale_share_claims()),
  ARRAY['pi_w4_stale'],
  'stale: the 20-minute corpse, not the 5-minute one'
);

-- 6 — the organiser's anchor seat is structurally unsweepable.
SELECT is(
  (SELECT count(*)::int FROM public.stale_share_claims(interval '0 minutes') s
    JOIN public.booking_participants bp ON bp.id = s.participant_id
    JOIN public.bookings b ON b.id = bp.booking_id
   WHERE bp.user_id = b.user_id),
  0,
  'stale: never the organiser, even at zero grace'
);

-- 7 — pgtap regression pin from W2's census: the 15-minute pending
-- cleaner and this sweeper divide the world cleanly — the pending cleaner
-- still refuses collecting rows even when they are ancient.
UPDATE public.bookings SET created_at = now() - interval '2 days'
 WHERE id = '00000000-0000-4000-8000-0000000000e6';
SELECT public.cleanup_stale_pending_bookings();
SELECT is(
  (SELECT state FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000e6'),
  'collecting',
  'the pending cleaner still keeps its hands off collecting (18''s pin holds)'
);

-- 8 — no service claim, no answers.
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', TRUE);
SELECT throws_ok(
  $$SELECT * FROM public.expiring_split_bookings()$$,
  'P0001',
  'SERVICE_ROLE_ONLY',
  'helpers: refuse any request that is not service-role'
);

SELECT * FROM finish();
ROLLBACK;
