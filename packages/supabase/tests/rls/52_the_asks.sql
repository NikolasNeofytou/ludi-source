-- 52_the_asks.sql — the asks are minted (20261015000002, ADR-0048,
-- plans/reach.md R4)
-- Under test:
--   keeper_wanted: on gk_post, every willing player in the venue's city
--     who is not the organiser and not on the roster — the pool now, the
--     reserve only once kickoff is inside 48 hours (the clock widens it);
--     nobody twice; a withdrawn or claimed request asks no one new
--   keeper_found: on gk_claim, the organiser, once
--   seat_offered: on ask_replacement, the crew — players who completed a
--     match with the asker or the organiser — not the roster, not twice
--   seat_taken: when the swap is done — at once for a free one — the asker
--   game_full: the organiser when the last seat is in, once; not a walk-in
--
-- Fixtures: venue_a (b1, Larnaca) with court c1; a4 organises; a5 and a2
-- are players. New: K1 (c801, 'full'), K2 (c802, 'rotation'), K3 (c803,
-- 'full' but in Nicosia), K4 (c804, 'no') — all with tokens; CREW (c805)
-- who finished a match with a4; S (c806) a stranger who never played.
BEGIN;
SELECT plan(16);

RESET ROLE;
INSERT INTO auth.users (id) VALUES
('00000000-0000-4000-8000-00000000c801'), ('00000000-0000-4000-8000-00000000c802'),
('00000000-0000-4000-8000-00000000c803'), ('00000000-0000-4000-8000-00000000c804'),
('00000000-0000-4000-8000-00000000c805'), ('00000000-0000-4000-8000-00000000c806')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (id, first_name, last_name, city_id, role, goes_in_goal) VALUES
('00000000-0000-4000-8000-00000000c801', 'Kostas', 'Pool', (SELECT id FROM public.cities WHERE code = 'larnaca'), 'player', 'full'),
('00000000-0000-4000-8000-00000000c802', 'Rota', 'Reserve', (SELECT id FROM public.cities WHERE code = 'larnaca'), 'player', 'rotation'),
('00000000-0000-4000-8000-00000000c803', 'Nikos', 'Nicosia', (SELECT id FROM public.cities WHERE code = 'nicosia'), 'player', 'full'),
('00000000-0000-4000-8000-00000000c804', 'Outfield', 'Only', (SELECT id FROM public.cities WHERE code = 'larnaca'), 'player', 'no'),
('00000000-0000-4000-8000-00000000c805', 'Crew', 'Mate', (SELECT id FROM public.cities WHERE code = 'larnaca'), 'player', 'no'),
('00000000-0000-4000-8000-00000000c806', 'Stavros', 'Stranger', (SELECT id FROM public.cities WHERE code = 'larnaca'), 'player', 'no')
ON CONFLICT (id) DO UPDATE SET city_id = excluded.city_id, goes_in_goal = excluded.goes_in_goal;
UPDATE public.users SET city_id = (SELECT id FROM public.cities WHERE code = 'larnaca')
WHERE id IN ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000a2');

-- tokens, so the rows are pending rather than skipped
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT unnest(ARRAY[
    '00000000-0000-4000-8000-00000000c801', '00000000-0000-4000-8000-00000000c802',
    '00000000-0000-4000-8000-00000000c803', '00000000-0000-4000-8000-00000000c804',
    '00000000-0000-4000-8000-00000000c805', '00000000-0000-4000-8000-00000000c806',
    '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a5'
  ]::uuid[])
  LOOP
    INSERT INTO public.push_tokens (user_id, token, platform)
    VALUES (v_id, 'ExponentPushToken[rls-asks-' || replace(v_id::text, '-', '') || ']', 'ios')
    ON CONFLICT (token) DO NOTHING;
  END LOOP;
END;
$$;

-- a completed game where a4 and CREW played together (the crew rule)
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, origin
) VALUES (
  '00000000-0000-4000-8000-00000000ea01', 'RLS-2036-A001', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', now() - interval '10 days', now() - interval '10 days' + interval '1 hour',
  'completed', 1, 4, 5000, 0, 5000, 500, 'standard', 'app'
);
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status, left_at) VALUES
('00000000-0000-4000-8000-00000000ea01', '00000000-0000-4000-8000-00000000c805', 'outfield', 'in', NULL)
ON CONFLICT (booking_id, user_id) DO NOTHING;

-- the game under test: a4's, in 5 days (the reserve is out of range),
-- 1 keeper + 2 outfield; a5 in
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, origin, is_open
) VALUES (
  '00000000-0000-4000-8000-00000000ea02', 'RLS-2036-A002', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '5 days',
  date_trunc('hour', now()) + interval '5 days 1 hour', 'confirmed', 1, 2, 5000, 0, 5000, 500, 'standard', 'app', TRUE
);
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status, left_at) VALUES
('00000000-0000-4000-8000-00000000ea02', '00000000-0000-4000-8000-0000000000a5', 'outfield', 'in', NULL)
ON CONFLICT (booking_id, user_id) DO NOTHING;
DELETE FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000ea02';

-- ── keeper wanted ──────────────────────────────────────────────────
-- 1. the organiser posts: the pool (K1) is asked; the reserve (K2, five
--    days out), Nicosia (K3), the unwilling (K4), the crew and the
--    stranger are not; nor the organiser
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
CREATE TEMP TABLE t_req AS
SELECT request_id FROM public.gk_post('00000000-0000-4000-8000-00000000ea02', 'full');
RESET ROLE;
SELECT is(
  (SELECT string_agg(user_id::text, ' ' ORDER BY user_id) FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000ea02' AND kind = 'keeper_wanted'),
  '00000000-0000-4000-8000-00000000c801',
  'keeper_wanted: the pool in the city, not the reserve out of range, not Nicosia, not the unwilling'
);
SELECT is(
  (SELECT status || '/' || (ref_id = (SELECT request_id FROM t_req))::text FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000ea02' AND kind = 'keeper_wanted'),
  'pending/true',
  'keeper_wanted: pending, about the request'
);
-- 2. the clock ticks: nobody new while the reserve is out of range
SELECT is(public.mint_keeper_asks(), 0, 'keeper_wanted: the clock asks nobody twice');
-- 3. kickoff moves inside 48 hours: the reserve comes into range
UPDATE public.bookings
SET starts_at = date_trunc('hour', now()) + interval '40 hours', ends_at = date_trunc('hour', now()) + interval '41 hours'
WHERE id = '00000000-0000-4000-8000-00000000ea02';
SELECT is(public.mint_keeper_asks(), 1, 'keeper_wanted: the reserve is asked once kickoff is inside 48 hours');
SELECT is(
  (SELECT string_agg(user_id::text, ' ' ORDER BY user_id) FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000ea02' AND kind = 'keeper_wanted'),
  '00000000-0000-4000-8000-00000000c801 00000000-0000-4000-8000-00000000c802',
  'keeper_wanted: the pool and now the reserve'
);
-- 4. the pool keeper claims: the organiser is told the keeper is found;
--    the clock then asks nobody (the request is claimed)
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c801'::uuid);
SELECT public.gk_claim((SELECT request_id FROM t_req));
RESET ROLE;
SELECT is(
  (SELECT user_id::text || '/' || status FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000ea02' AND kind = 'keeper_found'),
  '00000000-0000-4000-8000-0000000000a4/pending',
  'keeper_found: the organiser, once the keeper claims'
);
SELECT is(public.mint_keeper_asks(), 0, 'keeper_wanted: a claimed request asks nobody');
-- 5. game full: K1 in goal, a4 + a5 outfield = 1 + 2 → the organiser
SELECT is(
  (SELECT user_id::text || '/' || status FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000ea02' AND kind = 'game_full'),
  '00000000-0000-4000-8000-0000000000a4/pending',
  'game_full: the organiser when the last seat is in'
);

-- ── seat offered / seat taken ──────────────────────────────────────
-- 6. a5 asks to be replaced: the crew (CREW, who played with a4) is told;
--    the stranger, the organiser, the roster are not
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT public.ask_replacement('00000000-0000-4000-8000-00000000ea02');
RESET ROLE;
SELECT is(
  (SELECT string_agg(user_id::text || '/' || status, ' ' ORDER BY user_id) FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000ea02' AND kind = 'seat_offered'),
  '00000000-0000-4000-8000-00000000c805/pending',
  'seat_offered: the crew who played with the organiser, nobody else'
);
SELECT is(
  (SELECT (ref_id = bp.id)::text FROM public.player_notifications AS n
   INNER JOIN public.booking_participants AS bp
     ON bp.booking_id = n.booking_id AND bp.user_id = '00000000-0000-4000-8000-0000000000a5'
   WHERE n.booking_id = '00000000-0000-4000-8000-00000000ea02' AND n.kind = 'seat_offered'),
  'true',
  'seat_offered: about the seat'
);
-- 7. asked again (keep then ask): the crew is not told twice
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT public.keep_my_seat('00000000-0000-4000-8000-00000000ea02');
SELECT public.ask_replacement('00000000-0000-4000-8000-00000000ea02');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000ea02' AND kind = 'seat_offered'),
  1,
  'seat_offered: once per seat'
);
-- 8. the stranger takes the seat (free fixture: the swap is born done):
--    a5 is told their seat was taken. The token is read as postgres — a
--    stranger cannot read the booking row, only the invite preview.
CREATE TEMP TABLE t_tok AS
SELECT invite_token FROM public.bookings WHERE id = '00000000-0000-4000-8000-00000000ea02';
GRANT SELECT ON t_tok TO anon, authenticated;
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c806'::uuid);
SELECT public.take_seat((SELECT invite_token FROM t_tok), 'outfield');
RESET ROLE;
SELECT is(
  (SELECT user_id::text || '/' || status FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000ea02' AND kind = 'seat_taken'),
  '00000000-0000-4000-8000-0000000000a5/pending',
  'seat_taken: the one who asked, when the swap is done'
);
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000ea02' AND kind = 'game_full'),
  1,
  'game_full: refilling after a swap tells the organiser nothing new'
);

-- ── the asks obey the switch and the quiet hours ───────────────────
-- 9. K1's asks switch off: a new request at another game reaches K1 as a
--    skipped row with the reason
UPDATE public.users SET notify_asks = FALSE WHERE id = '00000000-0000-4000-8000-00000000c801';
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, origin, is_open
) VALUES (
  '00000000-0000-4000-8000-00000000ea03', 'RLS-2036-A003', '00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '8 days',
  date_trunc('hour', now()) + interval '8 days 1 hour', 'confirmed', 1, 2, 5000, 0, 5000, 500, 'standard', 'app', TRUE
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT public.gk_post('00000000-0000-4000-8000-00000000ea03', 'full');
RESET ROLE;
SELECT is(
  (SELECT status || '/' || error FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000ea03' AND kind = 'keeper_wanted'
     AND user_id = '00000000-0000-4000-8000-00000000c801'),
  'skipped/switched_off',
  'keeper_wanted: the asks switch off is a skip with the reason'
);
-- 10. a walk-in that fills tells nobody
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, origin, walk_in_name
) VALUES (
  '00000000-0000-4000-8000-00000000ea04', 'RLS-2036-A004', '00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000c3', date_trunc('hour', now()) + interval '9 days',
  date_trunc('hour', now()) + interval '9 days 1 hour', 'confirmed', 1, 1, 5000, 0, 5000, 0, 'standard', 'walk_in', 'Kostas'
);
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status, left_at) VALUES
('00000000-0000-4000-8000-00000000ea04', '00000000-0000-4000-8000-00000000c806', 'outfield', 'in', NULL),
('00000000-0000-4000-8000-00000000ea04', '00000000-0000-4000-8000-00000000c801', 'gk', 'in', NULL);
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000ea04'),
  0,
  'game_full: a walk-in tells nobody'
);
-- 11. an ask minted in the night waits for the morning (send_after)
SELECT is(
  (SELECT bool_and(send_after >= now()) FROM public.player_notifications
   WHERE kind IN ('keeper_wanted', 'seat_offered') AND status = 'pending'),
  TRUE,
  'asks: send_after is now or later (quiet hours apply through the minter)'
);

SELECT * FROM finish();
ROLLBACK;
