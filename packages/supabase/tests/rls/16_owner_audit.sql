-- 16_owner_audit.sql — M6 #41i: owner writes get an audit trail
-- Policies under test (20260828000002):
--   admin_actions_owner_insert — self-attributed, own property, owner
--                                vocabulary only
--   admin_actions_actor_select — actors read their own rows
-- Plus append-only: still no UPDATE / DELETE for anyone.
BEGIN;
SELECT plan(10);

-- 1. owner audits a schedule change on their own pitch
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT lives_ok(
  $$INSERT INTO public.admin_actions (
      admin_user_id, action_type, target_type, target_id, reason, payload
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a2'::uuid,
      'schedule_change', 'pitch',
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      'closed Saturday morning window',
      '{"kind":"delete_window","day_of_week":6}'
    )$$,
  'admin_actions_owner_insert: owner audits own schedule change'
);

-- 2. …but not on somebody else's pitch
SELECT throws_ok(
  $$INSERT INTO public.admin_actions (
      admin_user_id, action_type, target_type, target_id, reason
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a2'::uuid,
      'schedule_change', 'pitch',
      '00000000-0000-4000-8000-0000000000c3'::uuid,
      'not my pitch'
    )$$,
  '42501',
  NULL,
  'admin_actions_owner_insert: denied on a pitch the owner does not own'
);

-- 3. …and not with a platform-only action_type
SELECT throws_ok(
  $$INSERT INTO public.admin_actions (
      admin_user_id, action_type, target_type, target_id, reason
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a2'::uuid,
      'refund_booking', 'pitch',
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      'owner fabricating a platform act'
    )$$,
  '42501',
  NULL,
  'admin_actions_owner_insert: owner cannot use platform action_types'
);

-- 4. …and not attributed to anyone else
SELECT throws_ok(
  $$INSERT INTO public.admin_actions (
      admin_user_id, action_type, target_type, target_id, reason
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a1'::uuid,
      'schedule_change', 'pitch',
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      'owner forging the admin id'
    )$$,
  '42501',
  NULL,
  'admin_actions_owner_insert: owner cannot forge admin_user_id'
);

-- 5. a manager is venue staff too (venue-targeted vocabulary)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT lives_ok(
  $$INSERT INTO public.admin_actions (
      admin_user_id, action_type, target_type, target_id, reason
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a3'::uuid,
      'update_venue', 'venue',
      '00000000-0000-4000-8000-0000000000b1'::uuid,
      'updated contact phone'
    )$$,
  'admin_actions_owner_insert: manager audits a venue update'
);

-- 6. a stranger still cannot write audit rows at all
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT throws_ok(
  $$INSERT INTO public.admin_actions (
      admin_user_id, action_type, target_type, target_id, reason
    ) VALUES (
      '00000000-0000-4000-8000-0000000000a5'::uuid,
      'schedule_change', 'pitch',
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      'stranger probing'
    )$$,
  '42501',
  NULL,
  'admin_actions_owner_insert: stranger denied'
);

-- 7. the owner reads their own trail…
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.admin_actions
    WHERE admin_user_id = '00000000-0000-4000-8000-0000000000a2'::uuid),
  1,
  'admin_actions_actor_select: owner sees their own audit rows'
);

-- 8. …and nobody else's (the admin fixture row stays invisible)
SELECT is(
  (SELECT count(*)::int FROM public.admin_actions
    WHERE admin_user_id = '00000000-0000-4000-8000-0000000000a1'::uuid),
  0,
  'admin_actions_actor_select: owner cannot see the admin trail'
);

-- 9. append-only survives the widening: UPDATE silently affects 0 rows
UPDATE public.admin_actions SET reason = 'tampered'
 WHERE admin_user_id = '00000000-0000-4000-8000-0000000000a2'::uuid;
SELECT is(
  (SELECT count(*)::int FROM public.admin_actions WHERE reason = 'tampered'),
  0,
  'admin_actions: owner UPDATE of own audit row has no effect'
);

-- 10. …and so does DELETE
DELETE FROM public.admin_actions
 WHERE admin_user_id = '00000000-0000-4000-8000-0000000000a2'::uuid;
SELECT is(
  (SELECT count(*)::int FROM public.admin_actions
    WHERE admin_user_id = '00000000-0000-4000-8000-0000000000a2'::uuid),
  1,
  'admin_actions: owner DELETE of own audit row has no effect'
);

SELECT * FROM finish();
ROLLBACK;
