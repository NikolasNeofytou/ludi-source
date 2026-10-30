-- 22_split_earnings.sql — split fixtures in v_venue_earnings_daily
-- (migration 20260831000001)
--
-- ADR-0027 pins two promises the original #41g view broke:
--   * a collecting fixture is NOT venue revenue — share rows are status
--     'succeeded' while the fixture still collects, and must not count;
--   * the fee ledger for a split is bookings.platform_fee_cents, not
--     payments.application_fee_cents (which is 0 on every share/cover row).
-- Under test: the transfer-exists boundary (bookings.stripe_transfer_id),
-- booking-grain fee arithmetic, and the pro-rata post-cancel fraction.
--
-- Fixture recap (_bootstrap.sql): a2 owns venue_a (b1), whose pitches
-- include c2; a4 is a player; the bootstrap payment (4000/400, non-split)
-- is the baseline row the owner already sees.
BEGIN;
SELECT plan(5);

-- A split fixture on pitch c2, organiser a4: total 900, fee 90, two 450
-- shares, still collecting — both shares succeeded, no venue Transfer.
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents,
  cancellation_policy, is_split, share_amount_cents, collect_deadline
) VALUES (
  '00000000-0000-4000-8000-0000000000e9',
  'RLS-2031-0009',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2',
  '2031-07-12 18:00+00', '2031-07-12 19:00+00', 'collecting',
  800, 100, 900, 90,
  'standard', TRUE, 450, '2031-07-11 18:00+00'
);

-- The organiser's participant row was seated by the trigger; a5 joins.
INSERT INTO public.booking_participants (id, booking_id, user_id, slot_kind)
VALUES (
  '00000000-0000-4000-8000-0000000000db',
  '00000000-0000-4000-8000-0000000000e9',
  '00000000-0000-4000-8000-0000000000a5',
  'outfield'
);

-- Both shares settle. created_at is pinned so the fixture's earnings day
-- (2031-07-12 in Nicosia) can never collide with the bootstrap payment's
-- now()-dated row.
INSERT INTO public.payments (
  booking_id, stripe_payment_intent_id, amount_cents,
  application_fee_cents, status, kind, participant_id, created_at
) SELECT
  '00000000-0000-4000-8000-0000000000e9',
  'pi_earn_share_' || bp.user_id,
  450, 0, 'succeeded', 'share', bp.id,
  '2031-07-12 10:00+00'
FROM public.booking_participants bp
WHERE bp.booking_id = '00000000-0000-4000-8000-0000000000e9';

-- 1 — collecting money is invisible: the owner still sees only the
-- bootstrap baseline, and none of the 900 leaks into any rollup.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT (count(*), SUM(gross_cents))::text
     FROM public.v_venue_earnings_daily),
  '(1,4000)',
  'earnings: a collecting fixture is not venue revenue (ADR-0027)'
);

-- The webhook confirms and records the one venue Transfer.
RESET ROLE;
UPDATE public.bookings
   SET state = 'confirmed', stripe_transfer_id = 'tr_earn_e9'
 WHERE id = '00000000-0000-4000-8000-0000000000e9';

-- 2 — the fixture now surfaces, on its own settle day
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_earnings_daily),
  2,
  'earnings: the confirmed fixture appears once the Transfer exists'
);

-- 3 — and the money columns match what settle transferred: fee is the
-- booking ledger (90), not the share rows' zeros; venue_net = 900 − 90.
SELECT is(
  (SELECT (gross_cents, fee_cents, net_cents, venue_net_cents)::text
     FROM public.v_venue_earnings_daily
    WHERE day = '2031-07-12'),
  '(900,90,900,810)',
  'earnings: split fee comes from platform_fee_cents, not payment rows'
);

-- 4 — booking grain: two shares roll up as one fixture
SELECT is(
  (SELECT (payments_count, bookings_count)::text
     FROM public.v_venue_earnings_daily
    WHERE day = '2031-07-12'),
  '(2,1)',
  'earnings: shares aggregate at booking grain'
);

-- One share refunds pro-rata after confirm (cancel-booking's W5 path:
-- refund half the money, reverse half the transfer).
RESET ROLE;
UPDATE public.payments
   SET status = 'refunded', refunded_amount_cents = 450
 WHERE stripe_payment_intent_id = 'pi_earn_share_00000000-0000-4000-8000-0000000000a5';

-- 5 — the fee scales with the un-refunded fraction: Ludi keeps 45,
-- the venue keeps 405 — exactly (1 − X%) of transfer_cents.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT (gross_cents, refunded_cents, fee_cents, venue_net_cents)::text
     FROM public.v_venue_earnings_daily
    WHERE day = '2031-07-12'),
  '(900,450,45,405)',
  'earnings: pro-rata refund scales the fee by the un-refunded fraction'
);

SELECT * FROM finish();
ROLLBACK;
