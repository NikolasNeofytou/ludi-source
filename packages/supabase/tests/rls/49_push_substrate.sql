-- 49_push_substrate.sql — the push substrate (20261014000003, plans/reach.md R2)
-- Under test:
--   register_push_token: a token belongs to whoever registered it last,
--     revives when re-registered, keeps its shape, refuses the signed out
--   unregister_push_token: the owner drops it, nobody else can
--   push_tokens shows the app nothing, not even its own rows: no grant,
--     and RLS with no policies behind it
--   users.notify_games / notify_asks: default on, own row only
--
-- Fixtures: a4 and a5 are players.
BEGIN;
SELECT plan(13);

-- 1. a4 registers a token
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT lives_ok(
  $$SELECT public.register_push_token('ExponentPushToken[rls-test-token-0001]', 'ios')$$,
  'register_push_token: a signed-in player registers'
);
RESET ROLE;
SELECT is(
  (SELECT user_id::text || '/' || platform FROM public.push_tokens
   WHERE token = 'ExponentPushToken[rls-test-token-0001]'),
  '00000000-0000-4000-8000-0000000000a4/ios',
  'register_push_token: the row is the caller''s'
);

-- 2. the sender disabled it; registering again revives it
UPDATE public.push_tokens
SET disabled_at = now(), disabled_reason = 'DeviceNotRegistered'
WHERE token = 'ExponentPushToken[rls-test-token-0001]';
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT public.register_push_token('ExponentPushToken[rls-test-token-0001]', 'ios');
RESET ROLE;
SELECT is(
  (SELECT disabled_at IS NULL AND disabled_reason IS NULL FROM public.push_tokens
   WHERE token = 'ExponentPushToken[rls-test-token-0001]'),
  TRUE,
  'register_push_token: registering again revives a disabled token'
);

-- 3. a5 signs in on the same device: the token moves, one row
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT public.register_push_token('ExponentPushToken[rls-test-token-0001]', 'android');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.push_tokens WHERE token = 'ExponentPushToken[rls-test-token-0001]'),
  1,
  'register_push_token: one row per token'
);
SELECT is(
  (SELECT user_id::text || '/' || platform FROM public.push_tokens
   WHERE token = 'ExponentPushToken[rls-test-token-0001]'),
  '00000000-0000-4000-8000-0000000000a5/android',
  'register_push_token: the token belongs to whoever signed in last'
);

-- 4. shape and platform are checked
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$SELECT public.register_push_token('not-a-token', 'ios')$$,
  '23514',
  NULL,
  'register_push_token: a token must look like an Expo token'
);
SELECT throws_ok(
  $$SELECT public.register_push_token('ExponentPushToken[rls-test-token-0002]', 'web')$$,
  '23514',
  NULL,
  'register_push_token: platform is ios or android'
);

-- 5. signed out: refused
SELECT public.set_test_anon();
SELECT throws_ok(
  $$SELECT public.register_push_token('ExponentPushToken[rls-test-token-0003]', 'ios')$$,
  '42501',
  NULL,
  'register_push_token: not for the signed out'
);

-- 6. the app sees nothing, not even the row's owner. Two gates: no grant
-- for anon or authenticated (20261014000003), so the app gets 42501; and
-- behind it RLS with no policies.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT throws_ok(
  $$SELECT count(*) FROM public.push_tokens$$,
  '42501',
  NULL,
  'push_tokens: the app has no SELECT, not even on its own rows'
);
RESET ROLE;
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.push_tokens'::regclass)
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_tokens'
  ),
  TRUE,
  'push_tokens: RLS on and no policies, behind the missing grant'
);

-- 7. unregister: not the owner → nothing happens; the owner → gone
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT public.unregister_push_token('ExponentPushToken[rls-test-token-0001]');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.push_tokens WHERE token = 'ExponentPushToken[rls-test-token-0001]'),
  1,
  'unregister_push_token: someone else''s token is left alone'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT public.unregister_push_token('ExponentPushToken[rls-test-token-0001]');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.push_tokens WHERE token = 'ExponentPushToken[rls-test-token-0001]'),
  0,
  'unregister_push_token: the owner drops it'
);

-- 8. the switches: default on, and only the player's own row moves
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
UPDATE public.users SET notify_asks = FALSE
WHERE id IN ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a5');
RESET ROLE;
SELECT is(
  (SELECT string_agg(id::text || ':' || notify_games::text || '/' || notify_asks::text, ' ' ORDER BY id)
   FROM public.users
   WHERE id IN ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a5')),
  '00000000-0000-4000-8000-0000000000a4:true/false 00000000-0000-4000-8000-0000000000a5:true/true',
  'switches: default on; a player changes their own row and nobody else''s'
);

SELECT * FROM finish();
ROLLBACK;
