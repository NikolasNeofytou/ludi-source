-- 42_find_my_replacement.sql — a seat that changes hands (20261013000002, ADR-0044)
-- Under test:
--   ask_replacement / keep_my_seat — the leaver's two buttons and their guards
--   the column guard — the ask is never a bare UPDATE; a paid seat on a
--     collecting split fixture cannot leave without its refund
--   fixture_preview / v_open_fixtures / public_venue_schedule — a seat up
--     for grabs reads as one; v_crew_seats shows it to the asker's crew only
--   take_seat — the free swap; refuses a paid seat, an empty ask, a taker
--     already in
--   begin_seat_swap / stale_seat_swaps / revert_seat_swap — the paid swap's
--     service half, and its reversal when the taker never pays
--   v_venue_earnings_daily — a share handed back in a swap is not venue money
--
-- Fixtures: organiser a4 on venue_a (b1, owner a2). New players: D (d101,
-- asks on the free fixture), T (d102, takes it), C (d103, played with D),
-- P (d104, paid seat on the split fixtures), Q (d105, takes P's seat).
BEGIN;
SELECT plan(31);

-- ────────────────────────────────────────────────────────────────────
-- Players and fixtures, as the test superuser
-- ────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id) VALUES
('00000000-0000-4000-8000-00000000d101'),
('00000000-0000-4000-8000-00000000d102'),
('00000000-0000-4000-8000-00000000d103'),
('00000000-0000-4000-8000-00000000d104'),
('00000000-0000-4000-8000-00000000d105')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (id, first_name, last_name, city_id, role)
SELECT v.id::uuid, v.n, 'Test', (SELECT id FROM public.cities WHERE code = 'larnaca'), 'player'
FROM (VALUES
  ('00000000-0000-4000-8000-00000000d101', 'Dimitris'),
  ('00000000-0000-4000-8000-00000000d102', 'Takis'),
  ('00000000-0000-4000-8000-00000000d103', 'Christos'),
  ('00000000-0000-4000-8000-00000000d104', 'Panos'),
  ('00000000-0000-4000-8000-00000000d105', 'Kyriakos')
) AS v (id, n)
ON CONFLICT (id) DO NOTHING;

-- h0: a match D and C finished together last week (C is D's crew)
-- h1: a free fixture in three days, D on it
-- h2: a split fixture, confirmed and transferred, P paid his share
-- h3: a split fixture still collecting, P paid, T seated unpaid
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  gk_slots, outfield_slots, is_split, share_amount_cents, collect_deadline, stripe_transfer_id,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES
(
  '00000000-0000-4000-8000-00000000e200', 'RLS-2030-4200', '00000000-0000-4000-8000-0000000000a3',
  '00000000-0000-4000-8000-0000000000c2', now() - interval '7 days', now() - interval '7 days' + interval '1 hour',
  'completed', 1, 4, FALSE, NULL, NULL, NULL, 5000, 0, 5000, 500, 'standard'
),
(
  '00000000-0000-4000-8000-00000000e201', 'RLS-2030-4201', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '3 days',
  date_trunc('hour', now()) + interval '3 days 1 hour',
  'confirmed', 1, 4, FALSE, NULL, NULL, NULL, 5000, 0, 5000, 500, 'standard'
),
(
  '00000000-0000-4000-8000-00000000e202', 'RLS-2030-4202', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2', date_trunc('hour', now()) + interval '4 days',
  date_trunc('hour', now()) + interval '4 days 1 hour',
  'confirmed', 1, 4, TRUE, 1000, date_trunc('hour', now()) + interval '3 days', 'tr_test_4202',
  5000, 0, 5000, 500, 'standard'
),
(
  '00000000-0000-4000-8000-00000000e203', 'RLS-2030-4203', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2', date_trunc('hour', now()) + interval '5 days',
  date_trunc('hour', now()) + interval '5 days 1 hour',
  'collecting', 1, 4, TRUE, 1000, date_trunc('hour', now()) + interval '4 days', NULL,
  5000, 0, 5000, 500, 'standard'
);

INSERT INTO public.booking_participants (id, booking_id, user_id, slot_kind) VALUES
('00000000-0000-4000-8000-00000000f200', '00000000-0000-4000-8000-00000000e200', '00000000-0000-4000-8000-00000000d101', 'outfield'),
('00000000-0000-4000-8000-00000000f201', '00000000-0000-4000-8000-00000000e200', '00000000-0000-4000-8000-00000000d103', 'outfield'),
('00000000-0000-4000-8000-00000000f210', '00000000-0000-4000-8000-00000000e201', '00000000-0000-4000-8000-00000000d101', 'outfield'),
('00000000-0000-4000-8000-00000000f220', '00000000-0000-4000-8000-00000000e202', '00000000-0000-4000-8000-00000000d104', 'outfield'),
('00000000-0000-4000-8000-00000000f230', '00000000-0000-4000-8000-00000000e203', '00000000-0000-4000-8000-00000000d104', 'outfield'),
('00000000-0000-4000-8000-00000000f231', '00000000-0000-4000-8000-00000000e203', '00000000-0000-4000-8000-00000000d102', 'outfield');

-- h2 is paid in full: the organiser 4000, P 1000. h3: P paid 1000.
INSERT INTO public.payments (
  id, booking_id, stripe_payment_intent_id, amount_cents, application_fee_cents, status, kind, participant_id
) VALUES
(
  '00000000-0000-4000-8000-00000000a420', '00000000-0000-4000-8000-00000000e202', 'pi_test_4202_org', 4000, 0,
  'succeeded', 'share',
  (SELECT id FROM public.booking_participants
   WHERE booking_id = '00000000-0000-4000-8000-00000000e202' AND user_id = '00000000-0000-4000-8000-0000000000a4')
),
(
  '00000000-0000-4000-8000-00000000a421', '00000000-0000-4000-8000-00000000e202', 'pi_test_4202_p', 1000, 0,
  'succeeded', 'share', '00000000-0000-4000-8000-00000000f220'
),
(
  '00000000-0000-4000-8000-00000000a430', '00000000-0000-4000-8000-00000000e203', 'pi_test_4203_p', 1000, 0,
  'succeeded', 'share', '00000000-0000-4000-8000-00000000f230'
);

CREATE TEMP TABLE t_d AS
SELECT
  ((date_trunc('hour', now()) + interval '3 days') AT TIME ZONE 'Europe/Nicosia')::date AS d,
  date_trunc('hour', now()) + interval '3 days' AS at;
GRANT SELECT ON t_d TO anon, authenticated;

CREATE TEMP TABLE t_tok AS
SELECT id, invite_token AS tok FROM public.bookings
WHERE id IN ('00000000-0000-4000-8000-00000000e201', '00000000-0000-4000-8000-00000000e202');
GRANT SELECT ON t_tok TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- The ask
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-00000000d101'::uuid);
-- 1
SELECT lives_ok(
  $$SELECT public.ask_replacement('00000000-0000-4000-8000-00000000e201')$$,
  'ask_replacement: a player asks'
);
-- 2
SELECT isnt(
  (SELECT replacing_since FROM public.v_fixture_roster
   WHERE booking_id = '00000000-0000-4000-8000-00000000e201' AND is_you),
  NULL,
  'ask_replacement: the roster shows the ask'
);
-- 3
SELECT throws_ok(
  $$UPDATE public.booking_participants SET replacing_since = NULL
    WHERE id = '00000000-0000-4000-8000-00000000f210'$$,
  '42501', NULL,
  'column guard: the ask is not a bare UPDATE'
);
-- 4
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$SELECT public.ask_replacement('00000000-0000-4000-8000-00000000e201')$$,
  'P0001', 'ORGANISER_CANNOT_BE_REPLACED',
  'ask_replacement: the organiser cannot'
);

-- ────────────────────────────────────────────────────────────────────
-- Who can see the seat
-- ────────────────────────────────────────────────────────────────────
RESET ROLE;
UPDATE public.bookings SET is_open = TRUE WHERE id = '00000000-0000-4000-8000-00000000e201';

SELECT public.set_test_anon();
-- 5
SELECT is(
  (SELECT outfield_replacing FROM public.fixture_preview((SELECT tok FROM t_tok WHERE id = '00000000-0000-4000-8000-00000000e201'))),
  1,
  'fixture_preview: one outfield seat is up for grabs'
);
-- 6
SELECT is(
  (SELECT outfield_open FROM public.fixture_preview((SELECT tok FROM t_tok WHERE id = '00000000-0000-4000-8000-00000000e201'))),
  2,
  'fixture_preview: the free seats are unchanged (organiser and D are both in)'
);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
-- 7
SELECT is(
  (SELECT outfield_open FROM public.v_open_fixtures WHERE booking_id = '00000000-0000-4000-8000-00000000e201'),
  3,
  'v_open_fixtures: the board counts the asked-for seat as open'
);
-- 8
SELECT is(
  (SELECT count(*) FROM public.v_crew_seats),
  0::bigint,
  'v_crew_seats: no seat for someone who never played with D or the organiser'
);

SELECT public.set_test_user('00000000-0000-4000-8000-00000000d103'::uuid);
-- 9
SELECT is(
  (SELECT outfield_replacing FROM public.v_crew_seats WHERE booking_id = '00000000-0000-4000-8000-00000000e201'),
  1,
  'v_crew_seats: D''s teammate sees his seat'
);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
CREATE TEMP TABLE t_disp AS SELECT public.venue_display_token('00000000-0000-4000-8000-0000000000b1') AS tok;
GRANT SELECT ON t_disp TO anon, authenticated;
SELECT public.set_test_anon();
CREATE TEMP TABLE t_wall AS
SELECT i AS item
FROM t_d, jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_disp), t_d.d) -> 'items') AS i;
-- 10
SELECT is(
  (SELECT (item ->> 'open_outfield')::int FROM t_wall, t_d
   WHERE (item ->> 'starts_at')::timestamptz = t_d.at
     AND item ->> 'pitch_id' = '00000000-0000-4000-8000-0000000000c1'),
  3,
  'public_venue_schedule: the wall counts the same seats as the board'
);

-- ────────────────────────────────────────────────────────────────────
-- The free swap
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-00000000d102'::uuid);
-- 11
SELECT throws_ok(
  $$SELECT public.take_seat((SELECT tok FROM t_tok WHERE id = '00000000-0000-4000-8000-00000000e201'), 'gk')$$,
  'P0001', 'NO_SEAT_TO_TAKE',
  'take_seat: no keeper asked to be replaced'
);
-- 12
SELECT is(
  public.take_seat((SELECT tok FROM t_tok WHERE id = '00000000-0000-4000-8000-00000000e201')),
  '00000000-0000-4000-8000-00000000e201'::uuid,
  'take_seat: T takes D''s seat'
);
-- 13
SELECT throws_ok(
  $$SELECT public.take_seat((SELECT tok FROM t_tok WHERE id = '00000000-0000-4000-8000-00000000e201'))$$,
  'P0001', 'ALREADY_IN',
  'take_seat: a player already in cannot take a second seat'
);

RESET ROLE;
-- 14
SELECT is(
  (SELECT status || '/' || (replaced_by IS NOT NULL)::text || '/' || (replacing_since IS NULL)::text
   FROM public.booking_participants WHERE id = '00000000-0000-4000-8000-00000000f210'),
  'out/true/true',
  'take_seat: D is out, replaced, no longer asking'
);
-- 15
SELECT is(
  (SELECT slot_kind FROM public.booking_participants
   WHERE booking_id = '00000000-0000-4000-8000-00000000e201'
     AND user_id = '00000000-0000-4000-8000-00000000d102' AND status = 'in'),
  'outfield',
  'take_seat: T sits in D''s outfield seat'
);
-- 16
SELECT is(
  (SELECT status FROM public.seat_swaps WHERE from_participant_id = '00000000-0000-4000-8000-00000000f210'),
  'done',
  'take_seat: a free swap is recorded done'
);

-- ────────────────────────────────────────────────────────────────────
-- The paid swap: a confirmed split fixture
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-00000000d104'::uuid);
SELECT public.ask_replacement('00000000-0000-4000-8000-00000000e202');

SELECT public.set_test_user('00000000-0000-4000-8000-00000000d105'::uuid);
-- 17
SELECT throws_ok(
  $$SELECT public.take_seat((SELECT tok FROM t_tok WHERE id = '00000000-0000-4000-8000-00000000e202'))$$,
  'P0001', 'SEAT_REQUIRES_PAYMENT',
  'take_seat: a paid seat is not free'
);
-- 18 — the paid swap starts in the Edge Function, on the service key: a
-- player has no EXECUTE on begin_seat_swap
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.begin_seat_swap(text,uuid,text)', 'execute'),
  'begin_seat_swap: a player has no EXECUTE'
);
-- 18b — and its in-body guard refuses one even with a grant (only here to
-- reach the guard; ROLLBACK drops it)
RESET ROLE;
GRANT EXECUTE ON FUNCTION public.begin_seat_swap(text, uuid, text) TO authenticated;
SELECT public.set_test_user('00000000-0000-4000-8000-00000000d105'::uuid);
SELECT throws_ok(
  $$SELECT * FROM public.begin_seat_swap((SELECT tok FROM t_tok WHERE id = '00000000-0000-4000-8000-00000000e202'),
      '00000000-0000-4000-8000-00000000d105'::uuid)$$,
  'P0001', 'SERVICE_ROLE_ONLY',
  'begin_seat_swap: service only'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
CREATE TEMP TABLE t_swap AS
SELECT * FROM public.begin_seat_swap(
  (SELECT tok FROM t_tok WHERE id = '00000000-0000-4000-8000-00000000e202'),
  '00000000-0000-4000-8000-00000000d105'::uuid
);
-- 19
SELECT is(
  (SELECT needs_payment FROM t_swap),
  TRUE,
  'begin_seat_swap: P paid, so Q pays'
);
-- 20
SELECT is(
  (SELECT from_payment_id FROM t_swap),
  '00000000-0000-4000-8000-00000000a421'::uuid,
  'begin_seat_swap: the share to give back is P''s'
);
-- 21
SELECT is(
  (SELECT string_agg(user_id::text || ':' || status, ',' ORDER BY user_id)
   FROM public.booking_participants
   WHERE booking_id = '00000000-0000-4000-8000-00000000e202'
     AND user_id IN ('00000000-0000-4000-8000-00000000d104', '00000000-0000-4000-8000-00000000d105')),
  '00000000-0000-4000-8000-00000000d104:out,00000000-0000-4000-8000-00000000d105:in',
  'begin_seat_swap: the seat moves before the money'
);
-- 22
SELECT is(
  (SELECT count(*) FROM public.stale_seat_swaps(interval '-1 minute') WHERE swap_id = (SELECT swap_id FROM t_swap)),
  1::bigint,
  'stale_seat_swaps: an unpaid swap past its grace is selected'
);
-- 23
SELECT is(
  public.revert_seat_swap((SELECT swap_id FROM t_swap)),
  TRUE,
  'revert_seat_swap: the taker never paid'
);
-- 24
SELECT is(
  (SELECT status || '/' || (replacing_since IS NOT NULL)::text FROM public.booking_participants
   WHERE id = '00000000-0000-4000-8000-00000000f220'),
  'in/true',
  'revert_seat_swap: P is back on the seat, still asking'
);
-- 25
SELECT is(
  (SELECT status FROM public.seat_swaps WHERE id = (SELECT swap_id FROM t_swap)),
  'failed',
  'revert_seat_swap: the swap is failed'
);

-- ────────────────────────────────────────────────────────────────────
-- A collecting split fixture: leave instead, and only with the refund
-- ────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', TRUE);
SELECT public.set_test_user('00000000-0000-4000-8000-00000000d104'::uuid);
-- 26
SELECT throws_ok(
  $$SELECT public.ask_replacement('00000000-0000-4000-8000-00000000e203')$$,
  'P0001', 'LEAVE_INSTEAD',
  'ask_replacement: while the squad is still paying, leave instead'
);
-- 27
SELECT throws_ok(
  $$UPDATE public.booking_participants SET status = 'out'
    WHERE id = '00000000-0000-4000-8000-00000000f230'$$,
  'P0001', 'LEAVE_NEEDS_REFUND',
  'guard: a paid seat on a collecting fixture cannot leave without its refund'
);
SELECT public.set_test_user('00000000-0000-4000-8000-00000000d102'::uuid);
-- 28
SELECT lives_ok(
  $$UPDATE public.booking_participants SET status = 'out'
    WHERE id = '00000000-0000-4000-8000-00000000f231'$$,
  'guard: an unpaid seat leaves as before'
);

-- ────────────────────────────────────────────────────────────────────
-- Earnings: the handed-back share is not venue money
-- ────────────────────────────────────────────────────────────────────
-- Finish h2's swap the way the webhook does: Q's share succeeded, P's
-- refunded, the swap done.
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
CREATE TEMP TABLE t_swap2 AS
SELECT * FROM public.begin_seat_swap(
  (SELECT tok FROM t_tok WHERE id = '00000000-0000-4000-8000-00000000e202'),
  '00000000-0000-4000-8000-00000000d105'::uuid
);
INSERT INTO public.payments (
  id, booking_id, stripe_payment_intent_id, amount_cents, application_fee_cents, status, kind, participant_id
) VALUES (
  '00000000-0000-4000-8000-00000000a422', '00000000-0000-4000-8000-00000000e202', 'pi_test_4202_q', 1000, 0,
  'succeeded', 'share', (SELECT participant_id FROM t_swap2)
);
UPDATE public.payments SET status = 'refunded', refunded_amount_cents = 1000
WHERE id = '00000000-0000-4000-8000-00000000a421';
UPDATE public.seat_swaps SET payment_id = '00000000-0000-4000-8000-00000000a422'
WHERE id = (SELECT swap_id FROM t_swap2);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
CREATE TEMP TABLE t_before AS
SELECT sum(gross_cents) AS g, sum(refunded_cents) AS r FROM public.v_venue_earnings_daily
WHERE venue_id = '00000000-0000-4000-8000-0000000000b1';

RESET ROLE;
UPDATE public.seat_swaps SET status = 'done', settled_at = now() WHERE id = (SELECT swap_id FROM t_swap2);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
-- 29
SELECT is(
  (SELECT (t_before.g - sum(e.gross_cents))::int FROM public.v_venue_earnings_daily AS e, t_before
   WHERE e.venue_id = '00000000-0000-4000-8000-0000000000b1' GROUP BY t_before.g),
  1000,
  'earnings: the share handed back in a swap leaves gross'
);
-- 30
SELECT is(
  (SELECT (t_before.r - sum(e.refunded_cents))::int FROM public.v_venue_earnings_daily AS e, t_before
   WHERE e.venue_id = '00000000-0000-4000-8000-0000000000b1' GROUP BY t_before.r),
  1000,
  'earnings: and is not a refund the venue gave'
);

SELECT * FROM finish();
ROLLBACK;
