-- 11_admin_actions.sql — RLS for public.admin_actions
-- Policies under test:
--   admin_actions_admin_select
--   admin_actions_admin_insert (WITH CHECK admin AND admin_user_id = auth.uid())
-- Plus the implicit append-only stance: no UPDATE / no DELETE policies.
BEGIN;
SELECT plan(5);

-- 1. admin SELECT sees the fixture row
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT cmp_ok(
  (SELECT count(*)::int FROM public.admin_actions),
  '>=',
  1,
  'admin_actions_admin_select: admin reads admin_actions'
);

-- 2. non-admin sees no admin_actions
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.admin_actions),
  0,
  'admin_actions_admin_select: non-admin sees nothing'
);

-- 3. non-admin INSERT denied
SELECT throws_ok(
  $$INSERT INTO public.admin_actions (
      admin_user_id, action_type, target_type, target_id, reason
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a4'::uuid,
      'other', 'user',
      '00000000-0000-4000-8000-0000000000a2'::uuid,
      'rogue insert'
    )$$,
  '42501',
  NULL,
  'admin_actions_admin_insert: non-admin INSERT denied'
);

-- 4. admin INSERT with own admin_user_id succeeds
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT lives_ok(
  $$INSERT INTO public.admin_actions (
      admin_user_id, action_type, target_type, target_id, reason
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a1'::uuid,
      'verify_pitch', 'pitch',
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      'admin self-attributed action'
    )$$,
  'admin_actions_admin_insert: admin INSERTs with own admin_user_id'
);

-- 5. admin INSERT attributing the action to a different admin_user_id is denied.
-- WITH CHECK forbids admin_user_id != auth.uid() — prevents log forgery.
SELECT throws_ok(
  $$INSERT INTO public.admin_actions (
      admin_user_id, action_type, target_type, target_id, reason
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a2'::uuid,
      'verify_pitch', 'pitch',
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      'admin forging another admin id'
    )$$,
  '42501',
  NULL,
  'admin_actions_admin_insert: admin cannot forge admin_user_id'
);

SELECT * FROM finish();
ROLLBACK;
