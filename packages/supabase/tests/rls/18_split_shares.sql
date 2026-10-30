-- 18_split_shares.sql — the split-payment substrate (migration 20260830000001)
--
-- Objects under test:
--   bookings_state_check + bookings_pitch_id_time_range_excl — 'collecting'
--     is a real state and it HOLDS THE SLOT (the anchor decision)
--   bookings_split_shape — is_split / share_amount_cents / collect_deadline
--     travel together, and 'collecting' is split-only
--   cleanup_stale_pending_bookings — must NOT sweep 'collecting' (its clock
--     is collect_deadline, not 15 minutes; the ledger's nastiest row)
--   payments.kind / participant_id + payments_kind_participant
--   payments_one_live_share_per_participant — leave-rejoin-repay survives
--   payments_select_share_payer — the teammate who paid can see their row
--   join_fixture() — refuses split fixtures until confirmed (ADR-0022's
--     boundary); still serves free fixtures
--   fixture_preview() — a collecting fixture still previews as joinable
BEGIN;
SELECT plan(17);

-- ────────────────────────────────────────────────────────────────────
-- Fixtures (as the test superuser, before any identity switch).
-- g1: a split fixture mid-collection. g2: collecting and old (the sweep
-- bait). g3: pending and old (the sweep's positive control).
-- ────────────────────────────────────────────────────────────────────
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents,
  cancellation_policy, is_split, share_amount_cents, collect_deadline,
  created_at
) VALUES (
  '00000000-0000-4000-8000-0000000000e1',
  'RLS-2031-0001',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2',
  '2031-06-01 18:00+00', '2031-06-01 19:00+00', 'collecting',
  4000, 500, 4500, 450,
  'standard', TRUE, 450, '2031-05-31 18:00+00',
  now()
), (
  '00000000-0000-4000-8000-0000000000e2',
  'RLS-2031-0002',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2',
  '2031-06-02 18:00+00', '2031-06-02 19:00+00', 'collecting',
  4000, 500, 4500, 450,
  'standard', TRUE, 450, '2031-06-01 18:00+00',
  now() - interval '1 hour'
), (
  '00000000-0000-4000-8000-0000000000e3',
  'RLS-2031-0003',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2',
  '2031-06-03 18:00+00', '2031-06-03 19:00+00', 'pending',
  4000, 500, 4500, 450,
  'standard', FALSE, NULL, NULL,
  now() - interval '1 hour'
);

-- Tokens travel out of band, same as test 13: a non-owner cannot read
-- invite_token off bookings under RLS (by design), so the superuser
-- copies them into a temp table before any identity switch. f1 is the
-- bootstrap free fixture, used to prove the split guard does not
-- over-block the free door.
CREATE TEMP TABLE t_w2_links AS
  SELECT id, invite_token FROM public.bookings
   WHERE id IN ('00000000-0000-4000-8000-0000000000e1',
                '00000000-0000-4000-8000-0000000000f1');
GRANT SELECT ON t_w2_links TO anon, authenticated;

-- a2 takes an outfield slot on g1 (the trigger has already seated a4).
INSERT INTO public.booking_participants (id, booking_id, user_id, slot_kind)
VALUES (
  '00000000-0000-4000-8000-0000000000d9',
  '00000000-0000-4000-8000-0000000000e1',
  '00000000-0000-4000-8000-0000000000a2',
  'outfield'
);

-- 1
SELECT is(
  (SELECT count(*)::int FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000e1'
      AND state = 'collecting' AND is_split),
  1,
  'bookings_state_check: collecting is a real state'
);

-- 2 — the anchor decision: a collecting fixture HOLDS its slot.
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state,
      base_price_cents, addons_price_cents, total_cents,
      platform_fee_cents, cancellation_policy)
    VALUES ('RLS-2031-0009',
      '00000000-0000-4000-8000-0000000000a2',
      '00000000-0000-4000-8000-0000000000c2',
      '2031-06-01 18:30+00', '2031-06-01 19:30+00', 'pending',
      4000, 0, 4000, 400, 'standard')$$,
  '23P01',
  NULL,
  'EXCLUDE: an overlapping booking cannot be created against a collecting fixture'
);

-- 3
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state,
      base_price_cents, addons_price_cents, total_cents,
      platform_fee_cents, cancellation_policy,
      is_split, share_amount_cents, collect_deadline)
    VALUES ('RLS-2031-0010',
      '00000000-0000-4000-8000-0000000000a2',
      '00000000-0000-4000-8000-0000000000c2',
      '2031-07-01 18:00+00', '2031-07-01 19:00+00', 'pending',
      4000, 0, 4000, 400, 'standard',
      true, NULL, '2031-06-30 18:00+00')$$,
  '23514',
  NULL,
  'bookings_split_shape: is_split without share_amount_cents is rejected'
);

-- 4
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state,
      base_price_cents, addons_price_cents, total_cents,
      platform_fee_cents, cancellation_policy)
    VALUES ('RLS-2031-0011',
      '00000000-0000-4000-8000-0000000000a2',
      '00000000-0000-4000-8000-0000000000c2',
      '2031-07-02 18:00+00', '2031-07-02 19:00+00', 'collecting',
      4000, 0, 4000, 400, 'standard')$$,
  '23514',
  NULL,
  'bookings_split_shape: collecting is meaningless off a split booking'
);

-- ────────────────────────────────────────────────────────────────────
-- The 15-minute sweeper and the ledger's nastiest row
-- ────────────────────────────────────────────────────────────────────
SELECT public.cleanup_stale_pending_bookings();

-- 5 — positive control: the sweep genuinely ran.
SELECT is(
  (SELECT state FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000e3'),
  'cancelled_no_refund',
  'cleanup_stale_pending_bookings: an hour-old pending booking is swept'
);

-- 6 — the pin: collecting is NOT pending, and the 15-minute clock
-- must never touch it (its clock is collect_deadline, W4's sweeper).
SELECT is(
  (SELECT state FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000e2'),
  'collecting',
  'cleanup_stale_pending_bookings: an hour-old collecting fixture is untouched'
);

-- ────────────────────────────────────────────────────────────────────
-- payments: kind / participant shape
-- ────────────────────────────────────────────────────────────────────

-- 7
SELECT throws_ok(
  $$INSERT INTO public.payments (
      booking_id, stripe_payment_intent_id, amount_cents,
      application_fee_cents, status, kind)
    VALUES ('00000000-0000-4000-8000-0000000000e1',
      'pi_test_w2_bad1', 450, 0, 'processing', 'share')$$,
  '23514',
  NULL,
  'payments_kind_participant: a share must name its participant'
);

-- 8
SELECT throws_ok(
  $$INSERT INTO public.payments (
      booking_id, stripe_payment_intent_id, amount_cents,
      application_fee_cents, status, kind, participant_id)
    VALUES ('00000000-0000-4000-8000-0000000000e1',
      'pi_test_w2_bad2', 4500, 450, 'processing', 'booking',
      '00000000-0000-4000-8000-0000000000d9')$$,
  '23514',
  NULL,
  'payments_kind_participant: a booking-kind payment carries no participant'
);

-- 9
INSERT INTO public.payments (
  id, booking_id, stripe_payment_intent_id, amount_cents,
  application_fee_cents, status, kind, participant_id
) VALUES (
  '00000000-0000-4000-8000-0000000000b9',
  '00000000-0000-4000-8000-0000000000e1',
  'pi_test_w2_s1', 450, 0, 'succeeded', 'share',
  '00000000-0000-4000-8000-0000000000d9'
);
SELECT is(
  (SELECT count(*)::int FROM public.payments
    WHERE stripe_payment_intent_id = 'pi_test_w2_s1'),
  1,
  'a share payment row inserts cleanly'
);

-- 10
SELECT throws_ok(
  $$INSERT INTO public.payments (
      booking_id, stripe_payment_intent_id, amount_cents,
      application_fee_cents, status, kind, participant_id)
    VALUES ('00000000-0000-4000-8000-0000000000e1',
      'pi_test_w2_s1_dup', 450, 0, 'processing', 'share',
      '00000000-0000-4000-8000-0000000000d9')$$,
  '23505',
  NULL,
  'payments_one_live_share_per_participant: a second live share is rejected'
);

-- 11 — leave-rejoin-repay: refunding the first share unblocks a fresh one.
UPDATE public.payments SET status = 'refunded', refunded_amount_cents = 450
 WHERE stripe_payment_intent_id = 'pi_test_w2_s1';
INSERT INTO public.payments (
  booking_id, stripe_payment_intent_id, amount_cents,
  application_fee_cents, status, kind, participant_id
) VALUES (
  '00000000-0000-4000-8000-0000000000e1',
  'pi_test_w2_s2', 450, 0, 'succeeded', 'share',
  '00000000-0000-4000-8000-0000000000d9'
);
SELECT is(
  (SELECT count(*)::int FROM public.payments
    WHERE participant_id = '00000000-0000-4000-8000-0000000000d9'
      AND kind = 'share'
      AND status NOT IN ('cancelled','failed','refunded')),
  1,
  'leave-rejoin-repay: after a refund, exactly one live share stands'
);

-- ────────────────────────────────────────────────────────────────────
-- join_fixture: the free door refuses split fixtures; preview stays open
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);

-- 12
SELECT throws_ok(
  $$SELECT public.join_fixture(
      (SELECT invite_token FROM t_w2_links
        WHERE id = '00000000-0000-4000-8000-0000000000e1'),
      'outfield')$$,
  'P0001',
  'SPLIT_FIXTURE_REQUIRES_PAYMENT',
  'join_fixture: refuses a split fixture that is not yet confirmed'
);

-- 13 — the guard does not over-block: the bootstrap free fixture f1
-- still accepts a3 through the free door.
SELECT ok(
  public.join_fixture(
    (SELECT invite_token FROM t_w2_links
      WHERE id = '00000000-0000-4000-8000-0000000000f1'),
    'outfield') IS NOT NULL,
  'join_fixture: a free fixture still joins through the free door'
);

-- 14 — the invite still previews while collecting; joining is claim-share's
-- job (W3), but the link must not read as dead.
SELECT is(
  (SELECT joinable FROM public.fixture_preview(
     (SELECT invite_token FROM t_w2_links
       WHERE id = '00000000-0000-4000-8000-0000000000e1'))),
  TRUE,
  'fixture_preview: a collecting fixture previews as joinable'
);

-- ────────────────────────────────────────────────────────────────────
-- payments RLS: who can see a share
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);

-- 15
SELECT is(
  (SELECT count(*)::int FROM public.payments
    WHERE stripe_payment_intent_id = 'pi_test_w2_s2'),
  1,
  'payments_select_share_payer: the payer sees their own share'
);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);

-- 16
SELECT is(
  (SELECT count(*)::int FROM public.payments
    WHERE booking_id = '00000000-0000-4000-8000-0000000000e1'),
  0,
  'payments RLS: a stranger sees none of the fixture''s money'
);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);

-- 17
SELECT is(
  (SELECT count(*)::int FROM public.payments
    WHERE stripe_payment_intent_id = 'pi_test_w2_s2'),
  1,
  'payments_select_self_or_admin: the organiser still sees the booking''s money'
);

SELECT * FROM finish();
ROLLBACK;
