-- 45_keeper_pool.sql — the goalkeeper pool (20261013000005, ADR-0047)
-- Under test:
--   gk_post: organiser only; the audience is the pool, and the reserve only
--     inside 48 hours; one open request per fixture
--   v_keeper_requests: shown by city and willingness, never to the unwilling
--   gk_claim: first claim wins; the unwilling are refused; a keeper handing
--     his seat over is replaced through the swap
--   v_fixture_roster.keeper_free
--   gk_feedback_due / gk_feedback_give / my_keeper_record: after the match,
--     both sides, binary
--   gk_withdraw
--
-- Fixtures: a4 organises on venue_a (b1, Larnaca). New players: K1 (full,
-- Larnaca), K2 (rotation, Larnaca), K3 (no, Larnaca), K4 (full, Nicosia),
-- P (a keeper who will ask to be replaced).
BEGIN;
SELECT plan(25);

INSERT INTO auth.users (id) VALUES
('00000000-0000-4000-8000-00000000c501'),
('00000000-0000-4000-8000-00000000c502'),
('00000000-0000-4000-8000-00000000c503'),
('00000000-0000-4000-8000-00000000c504'),
('00000000-0000-4000-8000-00000000c505')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (id, first_name, last_name, city_id, role, goes_in_goal)
SELECT v.id::uuid, v.n, 'Keeper', (SELECT id FROM public.cities WHERE code = v.city), 'player', v.goes
FROM (VALUES
  ('00000000-0000-4000-8000-00000000c501', 'Kleanthis', 'larnaca', 'full'),
  ('00000000-0000-4000-8000-00000000c502', 'Kypros', 'larnaca', 'rotation'),
  ('00000000-0000-4000-8000-00000000c503', 'Kyriacos', 'larnaca', 'no'),
  ('00000000-0000-4000-8000-00000000c504', 'Kimon', 'nicosia', 'full'),
  ('00000000-0000-4000-8000-00000000c505', 'Pavlos', 'larnaca', 'no')
) AS v (id, n, city, goes)
ON CONFLICT (id) DO UPDATE
  SET first_name = excluded.first_name, city_id = excluded.city_id, goes_in_goal = excluded.goes_in_goal;

-- k1: three days out, no keeper. k2: tomorrow, no keeper. k3: a keeper seat
-- held by Pavlos, who will ask to be replaced (gk_slots = 1, so it is full).
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES
(
  '00000000-0000-4000-8000-00000000e501', 'RLS-2034-K001', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '3 days',
  date_trunc('hour', now()) + interval '3 days 1 hour', 'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard'
),
(
  '00000000-0000-4000-8000-00000000e502', 'RLS-2034-K002', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2', date_trunc('hour', now()) + interval '1 day',
  date_trunc('hour', now()) + interval '1 day 1 hour', 'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard'
),
(
  '00000000-0000-4000-8000-00000000e503', 'RLS-2034-K003', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2', date_trunc('hour', now()) + interval '4 days',
  date_trunc('hour', now()) + interval '4 days 1 hour', 'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard'
);
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind)
VALUES ('00000000-0000-4000-8000-00000000e503', '00000000-0000-4000-8000-00000000c505', 'gk');

-- 1. only the organiser posts
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT throws_ok(
  $$SELECT * FROM public.gk_post('00000000-0000-4000-8000-00000000e501')$$,
  '42501', 'GK_NOT_ORGANISER',
  'gk_post: not a stranger'
);

-- 2–3. three days out, a full game reaches the pool only (K1); posting twice is one request
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
CREATE TEMP TABLE t_r1 AS SELECT * FROM public.gk_post('00000000-0000-4000-8000-00000000e501');
GRANT SELECT ON t_r1 TO anon, authenticated;
SELECT is((SELECT audience FROM t_r1), 1, 'gk_post: three days out, only the pool');
SELECT is(
  (SELECT request_id FROM public.gk_post('00000000-0000-4000-8000-00000000e501')),
  (SELECT request_id FROM t_r1),
  'gk_post: one open request per fixture'
);

-- 4. inside 48 hours the reserve hears it too
CREATE TEMP TABLE t_r2 AS SELECT * FROM public.gk_post('00000000-0000-4000-8000-00000000e502');
GRANT SELECT ON t_r2 TO anon, authenticated;
SELECT is((SELECT audience FROM t_r2), 2, 'gk_post: inside 48 hours, the pool and the reserve');

-- 5–9. who sees what
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c501'::uuid);
SELECT is((SELECT count(*) FROM public.v_keeper_requests), 2::bigint, 'v_keeper_requests: the pool sees both');
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c502'::uuid);
SELECT is(
  (SELECT array_agg(booking_id) FROM public.v_keeper_requests),
  ARRAY['00000000-0000-4000-8000-00000000e502'::uuid],
  'v_keeper_requests: the reserve sees only the one inside 48 hours'
);
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c503'::uuid);
SELECT is((SELECT count(*) FROM public.v_keeper_requests), 0::bigint, 'v_keeper_requests: never the unwilling');
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c504'::uuid);
SELECT is((SELECT count(*) FROM public.v_keeper_requests), 0::bigint, 'v_keeper_requests: not another city');
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c503'::uuid);
SELECT throws_ok(
  format('SELECT public.gk_claim(%L)', (SELECT request_id FROM t_r1)),
  'P0001', 'GK_NOT_IN_POOL',
  'gk_claim: the unwilling cannot claim'
);

-- 10–13. first claim wins
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c501'::uuid);
SELECT is(
  public.gk_claim((SELECT request_id FROM t_r1)),
  '00000000-0000-4000-8000-00000000e501'::uuid,
  'gk_claim: K1 takes the gloves'
);
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c502'::uuid);
SELECT throws_ok(
  format('SELECT public.gk_claim(%L)', (SELECT request_id FROM t_r1)),
  'P0001', 'GK_ALREADY_TAKEN',
  'gk_claim: the second claim is too late'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT slot_kind || '/' || keeper_free::text FROM public.v_fixture_roster
   WHERE booking_id = '00000000-0000-4000-8000-00000000e501' AND user_id = '00000000-0000-4000-8000-00000000c501'),
  'gk/true',
  'roster: the pool keeper is in goal and plays free'
);
SELECT is(
  (SELECT status || '/' || claimed_by_name FROM public.gk_request_for('00000000-0000-4000-8000-00000000e501')),
  'claimed/Kleanthis',
  'gk_request_for: the organiser sees who took it'
);

-- 14–15. a keeper handing his seat over is replaced through the swap
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c505'::uuid);
SELECT public.ask_replacement('00000000-0000-4000-8000-00000000e503');
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
CREATE TEMP TABLE t_r3 AS SELECT * FROM public.gk_post('00000000-0000-4000-8000-00000000e503');
GRANT SELECT ON t_r3 TO anon, authenticated;
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c501'::uuid);
SELECT lives_ok(
  format('SELECT public.gk_claim(%L)', (SELECT request_id FROM t_r3)),
  'gk_claim: takes the seat of a keeper who asked to be replaced'
);
RESET ROLE;
SELECT is(
  (SELECT string_agg(user_id::text || ':' || status, ',' ORDER BY status) FROM public.booking_participants
   WHERE booking_id = '00000000-0000-4000-8000-00000000e503' AND slot_kind = 'gk'),
  '00000000-0000-4000-8000-00000000c501:in,00000000-0000-4000-8000-00000000c505:out',
  'gk_claim: Pavlos out, Kleanthis in goal'
);

-- 16–22. after the match, both sides
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  format('SELECT public.gk_feedback_give(%L, TRUE, TRUE)', (SELECT request_id FROM t_r1)),
  'P0001', 'GK_NOT_PLAYED_YET',
  'gk_feedback_give: not before the final whistle'
);
RESET ROLE;
UPDATE public.bookings
SET starts_at = date_trunc('hour', now()) - interval '2 days',
    ends_at = date_trunc('hour', now()) - interval '2 days' + interval '1 hour'
WHERE id = '00000000-0000-4000-8000-00000000e501';
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT role || '/' || other_name FROM public.gk_feedback_due('00000000-0000-4000-8000-00000000e501')),
  'organiser/Kleanthis',
  'gk_feedback_due: the organiser owes the keeper''s record'
);
SELECT throws_ok(
  format('SELECT public.gk_feedback_give(%L, NULL, TRUE)', (SELECT request_id FROM t_r1)),
  'P0001', 'GK_ANSWER_MISSING',
  'gk_feedback_give: the organiser must say whether he showed up'
);
SELECT lives_ok(
  format('SELECT public.gk_feedback_give(%L, TRUE, TRUE)', (SELECT request_id FROM t_r1)),
  'gk_feedback_give: showed up, would have him back'
);
SELECT is(
  (SELECT count(*) FROM public.gk_feedback_due('00000000-0000-4000-8000-00000000e501')),
  0::bigint,
  'gk_feedback_due: nothing owed once given'
);
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c501'::uuid);
SELECT lives_ok(
  format('SELECT public.gk_feedback_give(%L, NULL, FALSE)', (SELECT request_id FROM t_r1)),
  'gk_feedback_give: the keeper would not play for them again'
);
SELECT is(
  (SELECT games || '/' || showed || '/' || no_shows || '/' || wanted_back FROM public.my_keeper_record()),
  '1/1/0/1',
  'my_keeper_record: one game, showed, wanted back'
);
SELECT is(
  (SELECT keepers_would_return || '/' || keepers_played FROM public.v_keeper_requests
   WHERE booking_id = '00000000-0000-4000-8000-00000000e502'),
  '0/1',
  'v_keeper_requests: the team''s record travels with its next request'
);

-- 23–24. the organiser withdraws
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT public.gk_withdraw((SELECT request_id FROM t_r2));
SELECT is(
  (SELECT count(*) FROM public.gk_request_for('00000000-0000-4000-8000-00000000e502')),
  0::bigint,
  'gk_withdraw: the request is gone'
);
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c502'::uuid);
SELECT is((SELECT count(*) FROM public.v_keeper_requests), 0::bigint, 'v_keeper_requests: and nobody sees it');

SELECT * FROM finish();
ROLLBACK;
