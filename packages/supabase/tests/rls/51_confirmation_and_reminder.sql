-- 51_confirmation_and_reminder.sql — the player's own game is minted
-- (20261015000001, ADR-0048, plans/reach.md R5)
-- Under test:
--   tg_bookings_notify_state: pending → paid tells the organiser once;
--     paid → confirmed adds nothing; a walk-in and a standing series tell
--     nobody; confirmed → cancelled tells everyone still in, not the one
--     who left; pending → cancelled (never live) tells nobody
--   mint_reminders: every seat in a live app game inside the two-hour
--     window, once; outside the window, a walk-in, a cancelled game: nothing
--
-- Fixtures: venue_a (b1), court c1; a4 organises; a5 and a2 join. a4 and
-- a5 get a token so their rows are pending (a2 has none → skipped).
BEGIN;
SELECT plan(15);

RESET ROLE;
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT public.register_push_token('ExponentPushToken[rls-rem-a4-00000001]', 'ios');
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT public.register_push_token('ExponentPushToken[rls-rem-a5-00000001]', 'ios');
RESET ROLE;

-- ── the state trigger ──────────────────────────────────────────────
-- e911: an app booking born pending (create-booking's shape)
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, origin
) VALUES (
  '00000000-0000-4000-8000-00000000e911', 'RLS-2036-R001', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '3 days',
  date_trunc('hour', now()) + interval '3 days 1 hour', 'pending', 1, 4, 5000, 0, 5000, 500, 'standard', 'app'
);
-- 1. pending mints nothing
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e911'),
  0,
  'state: a pending booking tells nobody'
);
-- 2. pending → paid: the organiser's confirmation (push; no email, a4 has no address here)
UPDATE public.bookings SET state = 'paid' WHERE id = '00000000-0000-4000-8000-00000000e911';
SELECT is(
  (SELECT string_agg(user_id::text || ':' || kind || ':' || channel || ':' || status, ' ')
   FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e911'),
  '00000000-0000-4000-8000-0000000000a4:booking_confirmed:push:pending',
  'state: paid tells the organiser'
);
-- 3. paid → confirmed: nothing new
UPDATE public.bookings SET state = 'confirmed' WHERE id = '00000000-0000-4000-8000-00000000e911';
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e911'),
  1,
  'state: confirmed after paid adds nothing'
);
-- 4. a walk-in confirmed at the counter tells nobody
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy,
  origin, walk_in_name
) VALUES (
  '00000000-0000-4000-8000-00000000e912', 'RLS-2036-R002', '00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '4 days',
  date_trunc('hour', now()) + interval '4 days 1 hour', 'confirmed', 1, 4, 5000, 0, 5000, 0, 'standard',
  'walk_in', 'Kostas'
);
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e912'),
  0,
  'state: a walk-in tells nobody'
);
-- 5. a5 and a2 join; a2 then leaves
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status, left_at) VALUES
('00000000-0000-4000-8000-00000000e911', '00000000-0000-4000-8000-0000000000a5', 'outfield', 'in', NULL),
('00000000-0000-4000-8000-00000000e911', '00000000-0000-4000-8000-0000000000a2', 'gk', 'out', now())
ON CONFLICT (booking_id, user_id) DO NOTHING;
UPDATE public.bookings SET state = 'cancelled', cancelled_at = now()
WHERE id = '00000000-0000-4000-8000-00000000e911';
SELECT is(
  (SELECT string_agg(user_id::text, ' ' ORDER BY user_id)
   FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000e911' AND kind = 'fixture_cancelled'),
  '00000000-0000-4000-8000-0000000000a4 00000000-0000-4000-8000-0000000000a5',
  'state: cancelled tells everyone still in, organiser included, not the one who left'
);
-- 6. cancelled again (an admin refund after a cancel): nothing new
UPDATE public.bookings SET state = 'refunded_by_admin' WHERE id = '00000000-0000-4000-8000-00000000e911';
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000e911' AND kind = 'fixture_cancelled'),
  2,
  'state: a dead booking dying again tells nobody'
);
-- 7. pending → cancelled (never live): nobody
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, origin
) VALUES (
  '00000000-0000-4000-8000-00000000e913', 'RLS-2036-R003', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '5 days',
  date_trunc('hour', now()) + interval '5 days 1 hour', 'pending', 1, 4, 5000, 0, 5000, 500, 'standard', 'app'
);
UPDATE public.bookings SET state = 'cancelled', cancelled_at = now()
WHERE id = '00000000-0000-4000-8000-00000000e913';
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e913'),
  0,
  'state: a booking that was never live tells nobody when it dies'
);
-- 8. born confirmed (an app booking inserted live): the organiser is told
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, origin
) VALUES (
  '00000000-0000-4000-8000-00000000e914', 'RLS-2036-R004', '00000000-0000-4000-8000-0000000000a5',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '6 days',
  date_trunc('hour', now()) + interval '6 days 1 hour', 'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard', 'app'
);
SELECT is(
  (SELECT kind || ':' || user_id::text FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000e914'),
  'booking_confirmed:00000000-0000-4000-8000-0000000000a5',
  'state: a booking born live tells its organiser'
);

-- ── the reminder ───────────────────────────────────────────────────
-- e921: a live app game at T+1h55m with a4 (organiser), a5 in, a2 out
-- e922: a live app game at T+3h (outside the window)
-- e923: a walk-in at T+1h55m (on c3, another venue's court; c1 is taken)
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, origin, walk_in_name
) VALUES
(
  '00000000-0000-4000-8000-00000000e921', 'RLS-2036-R021', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', timestamptz '2036-06-11 20:00+03', timestamptz '2036-06-11 21:00+03',
  'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard', 'app', NULL
),
(
  '00000000-0000-4000-8000-00000000e922', 'RLS-2036-R022', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', timestamptz '2036-06-11 21:05+03', timestamptz '2036-06-11 22:05+03',
  'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard', 'app', NULL
),
(
  '00000000-0000-4000-8000-00000000e923', 'RLS-2036-R023', '00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000c3', timestamptz '2036-06-11 20:00+03', timestamptz '2036-06-11 21:00+03',
  'confirmed', 1, 4, 5000, 0, 5000, 0, 'standard', 'walk_in', 'Kostas'
);
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status, left_at) VALUES
('00000000-0000-4000-8000-00000000e921', '00000000-0000-4000-8000-0000000000a5', 'outfield', 'in', NULL),
('00000000-0000-4000-8000-00000000e921', '00000000-0000-4000-8000-0000000000a2', 'gk', 'out', now())
ON CONFLICT (booking_id, user_id) DO NOTHING;

-- 9. at 18:05 (T-1h55m for e921) two seats are reminded, a2 is not, e922 and e923 are not
SELECT is(
  public.mint_reminders(timestamptz '2036-06-11 18:05+03'),
  2,
  'reminder: every seat still in, inside the window'
);
SELECT is(
  (SELECT string_agg(user_id::text || ':' || status, ' ' ORDER BY user_id)
   FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000e921' AND kind = 'reminder'),
  '00000000-0000-4000-8000-0000000000a4:pending 00000000-0000-4000-8000-0000000000a5:pending',
  'reminder: the organiser and the one who joined, pending with their tokens'
);
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications
   WHERE booking_id IN ('00000000-0000-4000-8000-00000000e922', '00000000-0000-4000-8000-00000000e923')
     AND kind = 'reminder'),
  0,
  'reminder: not for a game outside the window, not for a walk-in'
);
-- 10. the clock ticks again five minutes later: nothing twice
SELECT is(
  public.mint_reminders(timestamptz '2036-06-11 18:10+03'),
  0,
  'reminder: the overlapping window mints nothing twice'
);
-- 11. at 19:10 e922 (21:05) is inside the window: its organiser only
SELECT is(
  public.mint_reminders(timestamptz '2036-06-11 19:10+03'),
  1,
  'reminder: the later game when its time comes'
);
-- 12. the reminder is never held by quiet hours (minted at 02:00 for a 04:00 game)
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, origin
) VALUES (
  '00000000-0000-4000-8000-00000000e924', 'RLS-2036-R024', '00000000-0000-4000-8000-0000000000a5',
  '00000000-0000-4000-8000-0000000000c1', timestamptz '2036-06-12 04:00+03', timestamptz '2036-06-12 05:00+03',
  'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard', 'app'
);
SELECT public.mint_reminders(timestamptz '2036-06-12 02:05+03');
SELECT is(
  (SELECT send_after FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000e924' AND kind = 'reminder'),
  timestamptz '2036-06-12 02:05+03',
  'reminder: due at once, whatever the hour'
);
-- 13. a cancelled game in the window is not reminded
UPDATE public.bookings SET state = 'cancelled', cancelled_at = now()
WHERE id = '00000000-0000-4000-8000-00000000e922';
DELETE FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e922';
SELECT is(
  public.mint_reminders(timestamptz '2036-06-11 19:10+03'),
  0,
  'reminder: not for a cancelled game'
);

SELECT * FROM finish();
ROLLBACK;
