-- 36_venue_access.sql — the owner sees, and closes, his own door
-- Functions under test (20260917000004_owner_sees_and_revokes_its_own_door):
--   has_venue_role         (SECURITY INVOKER, role-aware)
--   venue_people           (SECURITY DEFINER, owner-of-this-venue gate)
--   revoke_venue_person    (SECURITY DEFINER, owner-of-this-venue gate)
-- and (20261020000101_venue_access_consent, which replaced slice C's
-- venue_invite_lookup):
--   account_id_for_email   (SECURITY DEFINER, service-role JWT only)
-- Both DEFINER functions exist because venue_owners stays admin-write and
-- self-read only; the gate INSIDE each body is the entire boundary, which
-- is what these tests pin down. The manager fixture matters most: a
-- manager runs the venue's day but may not decide who holds a key.
BEGIN;
SELECT plan(18);

-- ── has_venue_role — the role-aware sibling ─────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT ok(
  public.has_venue_role('00000000-0000-4000-8000-0000000000b1'::uuid, 'owner'),
  'has_venue_role: the owner holds owner at his venue'
);
SELECT ok(
  NOT public.has_venue_role('00000000-0000-4000-8000-0000000000b1'::uuid, 'manager'),
  'has_venue_role: the owner does not also hold manager'
);
SELECT ok(
  NOT public.has_venue_role('00000000-0000-4000-8000-0000000000b2'::uuid, 'owner'),
  'has_venue_role: no role at a venue that is not his'
);

-- ── venue_people — slice A ──────────────────────────────────────────
-- 4. the owner sees everyone who can sign in, himself included
SELECT is(
  (SELECT count(*)::int FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid)),
  2,
  'venue_people: the owner sees both people at his venue'
);

-- 5. and can tell which of them is only a manager
SELECT is(
  (SELECT p.owner_role FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid) AS p
   WHERE p.user_id = '00000000-0000-4000-8000-0000000000a3'::uuid),
  'manager',
  'venue_people: the manager is listed as a manager'
);

-- 6. a manager may not see the list. This is the assertion that says
--    "who may open the door is not part of running the day".
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT throws_ok(
  $$SELECT * FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid)$$,
  '42501',
  NULL,
  'venue_people: a manager of the venue is denied'
);

-- 7. a stranger certainly may not
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$SELECT * FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid)$$,
  '42501',
  NULL,
  'venue_people: a stranger is denied'
);

-- 8. nor an admin through THIS door — admin_list_venue_owners is theirs,
--    and it keeps the founder's reads on the founder's function.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT throws_ok(
  $$SELECT * FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid)$$,
  '42501',
  NULL,
  'venue_people: an admin who is not an owner uses their own function'
);

-- ── the address lookup behind the invite — slice C ─────────────────
-- venue_invite_lookup, the owner-callable lookup this section used to
-- test, was dropped in 20261020000101: it returned the account's name to
-- any owner who asked. The invite Edge Function now resolves the address
-- itself through account_id_for_email, which answers only service-role
-- requests and returns only an id.
--
-- RESET ROLE first, as 14_admin_owner_access does: the assertions above
-- are still impersonating `authenticated`, and that role has no write on
-- auth.users (nor should it). Inside the transaction, so it rolls back.
RESET ROLE;
UPDATE auth.users SET email = 'Staff.Fixture@Kamares.CY'
 WHERE id = '00000000-0000-4000-8000-0000000000a4'::uuid;

-- 9. the owner-callable lookup is gone
SELECT hasnt_function(
  'public', 'venue_invite_lookup', ARRAY['uuid', 'text'],
  'venue_invite_lookup: dropped — no owner-callable address lookup'
);

-- 10. a server-side request resolves an address to the account behind
--     it, case-insensitively — GoTrue lowercases what it stores and humans
--     type what they like, and a case-sensitive miss would invite a
--     second account for a person who already has one
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SELECT is(
  public.account_id_for_email('  staff.fixture@kamares.cy  '),
  '00000000-0000-4000-8000-0000000000a4'::uuid,
  'account_id_for_email: the server resolves an address, trimmed and folded'
);

-- 11. an unknown address is NULL, not an error — "nobody here" is the
--     answer that sends an invite
SELECT is(
  public.account_id_for_email('nobody@nowhere.cy'),
  NULL::uuid,
  'account_id_for_email: an unknown address is NULL'
);

-- 12. the venue's own owner cannot ask it directly, even with EXECUTE
--     re-granted (the bootstrap grants every function): the guard reads
--     the JWT role, not the ACL
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', TRUE);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$SELECT public.account_id_for_email('staff.fixture@kamares.cy')$$,
  '42501',
  NULL,
  'account_id_for_email: an owner is refused'
);

-- 13. and neither can a stranger
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$SELECT public.account_id_for_email('staff.fixture@kamares.cy')$$,
  '42501',
  NULL,
  'account_id_for_email: a stranger is refused'
);

-- ── revoke_venue_person — slice B ───────────────────────────────────
-- 14. a manager cannot remove anyone, least of all the owner
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT throws_ok(
  $$SELECT public.revoke_venue_person(
      '00000000-0000-4000-8000-0000000000b1'::uuid,
      '00000000-0000-4000-8000-0000000000a2'::uuid)$$,
  '42501',
  NULL,
  'revoke_venue_person: a manager cannot revoke the owner'
);

-- 15. the owner cannot remove a grant that is not there
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$SELECT public.revoke_venue_person(
      '00000000-0000-4000-8000-0000000000b1'::uuid,
      '00000000-0000-4000-8000-0000000000a4'::uuid)$$,
  'P0002',
  NULL,
  'revoke_venue_person: no such grant'
);

-- 16. nor himself while he is the venue's only owner — the guard that
--     stops both an orphaned venue and a self-lockout
SELECT throws_ok(
  $$SELECT public.revoke_venue_person(
      '00000000-0000-4000-8000-0000000000b1'::uuid,
      '00000000-0000-4000-8000-0000000000a2'::uuid)$$,
  'P0001',
  NULL,
  'revoke_venue_person: a venue keeps at least one owner'
);

-- 17. but he may remove the manager — and then that key is gone
SELECT public.revoke_venue_person(
  '00000000-0000-4000-8000-0000000000b1'::uuid,
  '00000000-0000-4000-8000-0000000000a3'::uuid
);
SELECT is(
  (SELECT count(*)::int FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid)),
  1,
  'revoke_venue_person: the manager can no longer sign in'
);

-- 18. and the log says who did it
SELECT is(
  (SELECT count(*)::int FROM public.admin_actions AS a
   WHERE a.target_id = '00000000-0000-4000-8000-0000000000b1'::uuid
     AND a.admin_user_id = '00000000-0000-4000-8000-0000000000a2'::uuid
     AND a.payload ->> 'kind' = 'revoke_owner_access'
     AND a.payload ->> 'by' = 'owner'
     AND a.payload ->> 'user_id' = '00000000-0000-4000-8000-0000000000a3'),
  1,
  'revoke_venue_person: the removal is audited against the owner who did it'
);

SELECT * FROM finish();
ROLLBACK;
