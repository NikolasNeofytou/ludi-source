-- 50_player_notifications.sql — the player's notices ledger
-- (20261014000004, ADR-0048, plans/reach.md R3)
-- Under test:
--   notice_send_after: asks wait for 08:00 in the night unless the game is
--     early; a player's own game is never held
--   mint_player_notice: pending with a token, skipped with the reason
--     without one or with the switch off, an email row for the kinds a
--     player wants in writing, once per cause, nothing for the erased
--   RLS: a player reads their own rows and nobody else's, writes nothing
--   the sender's helpers: service role only; a claim flips to sending and
--     carries the render context; sent / failed-with-retry / skipped;
--     receipts after fifteen minutes; a dead token is disabled
--
-- Fixtures: venue_a (b1) with court c1 (Larnaca); a4 organises; a5 is a
-- stranger. a4 gets a token and an email; a5 has neither.
BEGIN;
SELECT plan(30);

RESET ROLE;
UPDATE auth.users SET email = 'a4@ludi.test' WHERE id = '00000000-0000-4000-8000-0000000000a4';

INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, is_open
) VALUES (
  '00000000-0000-4000-8000-00000000e901', 'RLS-2036-N001', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '3 days',
  date_trunc('hour', now()) + interval '3 days 1 hour', 'pending', 1, 4, 5000, 0, 5000, 500, 'standard', TRUE
);
-- (pending on purpose: since 20261015000001 a booking born live mints its
-- own booking_confirmed, and this file tests the minting function directly;
-- the bootstrap's live bookings minted rows of their own, so every count
-- below is scoped to this booking)

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT public.register_push_token('ExponentPushToken[rls-notify-a4-0001]', 'ios');
RESET ROLE;

-- ── quiet hours ────────────────────────────────────────────────────
-- 1. an ask at 23:30 Cyprus waits for 08:00 the next day
SELECT is(
  public.notice_send_after(
    'keeper_wanted',
    timestamptz '2036-06-12 20:00+03',
    timestamptz '2036-06-10 23:30+03'
  ),
  timestamptz '2036-06-11 08:00+03',
  'notice_send_after: an ask in the night waits for 08:00'
);
-- 2. an ask at 06:00 waits for 08:00 the same day
SELECT is(
  public.notice_send_after(
    'seat_offered',
    timestamptz '2036-06-12 20:00+03',
    timestamptz '2036-06-11 06:00+03'
  ),
  timestamptz '2036-06-11 08:00+03',
  'notice_send_after: an ask before eight waits for eight'
);
-- 3. an ask in the afternoon goes now
SELECT is(
  public.notice_send_after(
    'keeper_wanted',
    timestamptz '2036-06-12 20:00+03',
    timestamptz '2036-06-11 15:00+03'
  ),
  timestamptz '2036-06-11 15:00+03',
  'notice_send_after: an ask by day goes now'
);
-- 4. an ask in the night for a 09:00 game goes now
SELECT is(
  public.notice_send_after(
    'keeper_wanted',
    timestamptz '2036-06-11 09:00+03',
    timestamptz '2036-06-10 23:30+03'
  ),
  timestamptz '2036-06-10 23:30+03',
  'notice_send_after: an early game is not held'
);
-- 5. the player's own game is never held
SELECT is(
  public.notice_send_after(
    'reminder',
    timestamptz '2036-06-12 20:00+03',
    timestamptz '2036-06-11 02:00+03'
  ),
  timestamptz '2036-06-11 02:00+03',
  'notice_send_after: a reminder in the night goes now'
);

-- ── minting ────────────────────────────────────────────────────────
-- 6. a4 (token + email, switches on): confirmed → push pending + email
SELECT is(
  public.mint_player_notice(
    '00000000-0000-4000-8000-0000000000a4', 'booking_confirmed', '00000000-0000-4000-8000-00000000e901'
  ),
  2,
  'mint: a push row and an email row for a confirmed booking'
);
SELECT is(
  (SELECT string_agg(channel || ':' || status, ' ' ORDER BY channel)
   FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'booking_confirmed'),
  'email:pending push:pending',
  'mint: both pending'
);
-- 7. the same cause again mints nothing
SELECT is(
  public.mint_player_notice(
    '00000000-0000-4000-8000-0000000000a4', 'booking_confirmed', '00000000-0000-4000-8000-00000000e901'
  ),
  0,
  'mint: once per cause and recipient'
);
-- 8. a5 (no token, no email): reminder → push skipped no_token, no email
SELECT is(
  public.mint_player_notice(
    '00000000-0000-4000-8000-0000000000a5', 'reminder', '00000000-0000-4000-8000-00000000e901'
  ),
  1,
  'mint: one row for a player without a token'
);
SELECT is(
  (SELECT status || '/' || error FROM public.player_notifications
   WHERE user_id = '00000000-0000-4000-8000-0000000000a5' AND kind = 'reminder'),
  'skipped/no_token',
  'mint: skipped, and the ledger says why'
);
-- 9. the asks switch off: keeper_wanted → skipped switched_off
UPDATE public.users SET notify_asks = FALSE WHERE id = '00000000-0000-4000-8000-0000000000a4';
SELECT public.mint_player_notice(
  '00000000-0000-4000-8000-0000000000a4', 'keeper_wanted', '00000000-0000-4000-8000-00000000e901'
);
SELECT is(
  (SELECT status || '/' || error FROM public.player_notifications
   WHERE user_id = '00000000-0000-4000-8000-0000000000a4' AND kind = 'keeper_wanted'),
  'skipped/switched_off',
  'mint: the switch off is a skip with the reason'
);
UPDATE public.users SET notify_asks = TRUE WHERE id = '00000000-0000-4000-8000-0000000000a4';
-- 10. an erased account gets nothing
UPDATE public.users SET anonymized_at = now() WHERE id = '00000000-0000-4000-8000-0000000000a5';
SELECT is(
  public.mint_player_notice(
    '00000000-0000-4000-8000-0000000000a5', 'fixture_cancelled', '00000000-0000-4000-8000-00000000e901'
  ),
  0,
  'mint: nothing for an erased account'
);
UPDATE public.users SET anonymized_at = NULL WHERE id = '00000000-0000-4000-8000-0000000000a5';
-- 11. an explicit send_after is kept
SELECT is(
  (SELECT send_after FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'game_full' AND user_id = '00000000-0000-4000-8000-0000000000a4'),
  NULL::timestamptz,
  'mint: no game_full row yet'
);
SELECT public.mint_player_notice(
  '00000000-0000-4000-8000-0000000000a4', 'game_full', '00000000-0000-4000-8000-00000000e901',
  NULL, timestamptz '2036-01-01 10:00+02'
);
SELECT is(
  (SELECT send_after FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'game_full' AND user_id = '00000000-0000-4000-8000-0000000000a4'),
  timestamptz '2036-01-01 10:00+02',
  'mint: an explicit send_after is kept'
);

-- ── RLS ────────────────────────────────────────────────────────────
-- 12. a4 reads their own rows (confirmed push + email, keeper_wanted, game_full)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e901'),
  4,
  'rls: a player reads their own rows'
);
-- 13. a5 sees only theirs
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e901'),
  1,
  'rls: and nobody else''s'
);
-- 14. nobody writes from the app
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$INSERT INTO public.player_notifications (user_id, kind, booking_id, channel)
    VALUES ('00000000-0000-4000-8000-0000000000a4', 'reminder', '00000000-0000-4000-8000-00000000e901', 'push')$$,
  '42501',
  NULL,
  'rls: the app cannot insert'
);
-- 15. the helpers are not the app's: a player has no EXECUTE
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.claim_player_notifications(integer)', 'execute'),
  'helpers: a player has no EXECUTE on claim'
);
-- 15b. and the in-body guard refuses one even with a grant (only here to
--      reach the guard; ROLLBACK drops it)
RESET ROLE;
GRANT EXECUTE ON FUNCTION public.claim_player_notifications(integer) TO authenticated;
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$SELECT * FROM public.claim_player_notifications(10)$$,
  'P0001',
  'SERVICE_ROLE_ONLY',
  'helpers: claim refuses a player'
);

-- ── the sender ─────────────────────────────────────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
-- 16. the claim: the two pending rows of a4 come back with context;
--     game_full is not due; the skipped ones are not pending
SELECT is(
  (SELECT string_agg(c.channel || ':' || c.code || ':' || c.locale || ':' || coalesce(c.email, '-')
                     || ':' || array_length(c.tokens, 1)::text || ':' || c.venue_name, ' ' ORDER BY c.channel)
   FROM public.claim_player_notifications(10) AS c),
  'email:RLS-2036-N001:en:a4@ludi.test:1:RLS Fixture Venue A push:RLS-2036-N001:en:a4@ludi.test:1:RLS Fixture Venue A',
  'claim: due rows come back rendered-ready'
);
SELECT is(
  (SELECT string_agg(status, ' ' ORDER BY channel) FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'booking_confirmed'),
  'sending sending',
  'claim: the rows are sending'
);
-- 17. a second claim finds nothing
SELECT is((SELECT count(*)::int FROM public.claim_player_notifications(10)), 0, 'claim: nothing twice');
-- 18. sent
SELECT public.player_notification_sent(
  (SELECT id FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'booking_confirmed' AND channel = 'push'),
  '[{"token": "ExponentPushToken[rls-notify-a4-0001]", "id": "t-1"}]'::jsonb
);
SELECT is(
  (SELECT status || '/' || (expo_tickets -> 0 ->> 'id') FROM public.player_notifications
   WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'booking_confirmed' AND channel = 'push'),
  'sent/t-1',
  'sent: status and tickets'
);
-- 19. failed once → pending again, later
SELECT public.player_notification_failed(
  (SELECT id FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'booking_confirmed' AND channel = 'email'),
  'resend 500'
);
SELECT is(
  (SELECT status || '/' || attempts::text || '/' || (send_after > now())::text || '/' || error
   FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'booking_confirmed' AND channel = 'email'),
  'pending/1/true/resend 500',
  'failed: back to pending with a wait and the error kept'
);
-- 20. failed on the fifth attempt → failed for good
UPDATE public.player_notifications SET attempts = 5, status = 'sending'
WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'booking_confirmed' AND channel = 'email';
SELECT public.player_notification_failed(
  (SELECT id FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'booking_confirmed' AND channel = 'email'),
  'resend 500 again'
);
SELECT is(
  (SELECT status FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'booking_confirmed' AND channel = 'email'),
  'failed',
  'failed: five attempts and it stops'
);
-- 21. a stale claim is released
UPDATE public.player_notifications SET status = 'sending', claimed_at = now() - interval '11 minutes'
WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'game_full';
UPDATE public.player_notifications SET send_after = now() - interval '1 minute' WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'game_full';
SELECT is(
  (SELECT string_agg(c.kind, ' ') FROM public.claim_player_notifications(10) AS c),
  'game_full',
  'claim: a claim older than ten minutes is released and taken again'
);
-- 22. receipts: only sent pushes older than fifteen minutes, unread
SELECT is((SELECT count(*)::int FROM public.player_notification_receipts(10)), 0, 'receipts: nothing is old enough yet');
UPDATE public.player_notifications SET sent_at = now() - interval '16 minutes'
WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'booking_confirmed' AND channel = 'push';
SELECT is(
  (SELECT r.expo_tickets -> 0 ->> 'token' FROM public.player_notification_receipts(10) AS r),
  'ExponentPushToken[rls-notify-a4-0001]',
  'receipts: a sent push after fifteen minutes'
);
-- 23. a dead token is disabled and the receipt marked read
SELECT public.disable_push_token('ExponentPushToken[rls-notify-a4-0001]', 'DeviceNotRegistered');
SELECT public.player_notification_receipt_checked(
  (SELECT id FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'booking_confirmed' AND channel = 'push'),
  'DeviceNotRegistered'
);
SELECT is(
  (SELECT (t.disabled_reason || '/' || (n.receipt_checked_at IS NOT NULL)::text)
   FROM public.push_tokens AS t, public.player_notifications AS n
   WHERE t.token = 'ExponentPushToken[rls-notify-a4-0001]'
     AND n.booking_id = '00000000-0000-4000-8000-00000000e901' AND n.kind = 'booking_confirmed' AND n.channel = 'push'),
  'DeviceNotRegistered/true',
  'receipts: the dead token is disabled and the row marked read'
);
-- 24. with the token gone, a new mint is skipped
SELECT public.mint_player_notice(
  '00000000-0000-4000-8000-0000000000a4', 'seat_taken', '00000000-0000-4000-8000-00000000e901'
);
SELECT is(
  (SELECT status || '/' || error FROM public.player_notifications WHERE booking_id = '00000000-0000-4000-8000-00000000e901' AND kind = 'seat_taken'),
  'skipped/no_token',
  'mint: a disabled token counts as none'
);

SELECT * FROM finish();
ROLLBACK;
