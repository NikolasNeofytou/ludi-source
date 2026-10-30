-- 14_admin_owner_access.sql — admin-only lookups behind the owner-grant UI
-- Functions under test (20260827000001_admin_owner_access.sql):
--   admin_lookup_user_by_phone   (SECURITY DEFINER, is_admin() gate)
--   admin_list_venue_owners      (SECURITY DEFINER, is_admin() gate)
-- Both are DEFINER because auth.users.phone is unreachable from PostgREST,
-- so the is_admin() gate INSIDE the function is the entire boundary —
-- which is exactly what these tests pin down.
BEGIN;
SELECT plan(10);

-- Give one fixture account a phone. GoTrue stores bare digits, no '+'.
-- Done as superuser before any set_test_user role switch.
UPDATE auth.users
SET phone = '35799000772'
WHERE id = '00000000-0000-4000-8000-0000000000a2'::uuid;

-- 1. admin resolves a human-typed spelling (+, spaces) to the account
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT l.user_id FROM public.admin_lookup_user_by_phone('+357 99 000 772') l),
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  'admin_lookup_user_by_phone: admin resolves +/spaced spelling'
);

-- 2. international 00-prefix spelling resolves too
SELECT is(
  (SELECT l.user_id FROM public.admin_lookup_user_by_phone('0035799000772') l),
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  'admin_lookup_user_by_phone: 00-prefixed spelling resolves'
);

-- 3. unknown number returns no rows (not an error)
SELECT is(
  (SELECT count(*)::int FROM public.admin_lookup_user_by_phone('+357 99 999 999')),
  0,
  'admin_lookup_user_by_phone: unknown number returns empty'
);

-- 4. non-admin caller is refused outright
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$SELECT * FROM public.admin_lookup_user_by_phone('+35799000772')$$,
  '42501',
  NULL,
  'admin_lookup_user_by_phone: non-admin denied'
);

-- 5. non-admin caller cannot list a venue''s owners either
SELECT throws_ok(
  $$SELECT * FROM public.admin_list_venue_owners('00000000-0000-4000-8000-0000000000b1'::uuid)$$,
  '42501',
  NULL,
  'admin_list_venue_owners: non-admin denied'
);

-- 6. admin sees the membership rows with the phone joined on
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT l.phone FROM public.admin_list_venue_owners('00000000-0000-4000-8000-0000000000b1'::uuid) l
   WHERE l.user_id = '00000000-0000-4000-8000-0000000000a2'::uuid),
  '35799000772',
  'admin_list_venue_owners: admin sees members with phone'
);

-- ── the email half (ADR-0024, migration 20260829000002) ─────────────
-- Give the owner fixture an address to be found by. RESET ROLE first: the
-- test is still impersonating `authenticated` from the assertions above,
-- and that role has no write on auth.users (nor should it). Inside the
-- test's transaction, so it rolls back with everything else.
RESET ROLE;
UPDATE auth.users SET email = 'Owner.Fixture@Piacere.CY'
 WHERE id = '00000000-0000-4000-8000-0000000000a2'::uuid;

-- 7. admin resolves an address to the account, case-insensitively.
--    The invite flow depends on this: GoTrue lowercases what it stores,
--    humans type what they like, and a case-sensitive match would invite
--    a second account for a person who already has one.
SELECT is(
  (SELECT l.user_id FROM public.admin_lookup_user_by_email('owner.fixture@piacere.cy') l),
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  'admin_lookup_user_by_email: resolves an address regardless of case'
);

-- 8. an unknown address returns no rows rather than raising — "invite a
--    new person" is a normal outcome, not an error
SELECT is(
  (SELECT count(*)::int FROM public.admin_lookup_user_by_email('nobody@nowhere.cy')),
  0,
  'admin_lookup_user_by_email: unknown address returns no rows'
);

-- 9. non-admin denied
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$SELECT * FROM public.admin_lookup_user_by_email('owner.fixture@piacere.cy')$$,
  '42501',
  NULL,
  'admin_lookup_user_by_email: non-admin denied'
);

-- 10. the widened listing carries email and sign-in state — the two
--     columns the access card reads to say "invite pending" vs "signed in"
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT (l.email, l.last_sign_in_at IS NULL)::text
     FROM public.admin_list_venue_owners('00000000-0000-4000-8000-0000000000b1'::uuid) l
    WHERE l.user_id = '00000000-0000-4000-8000-0000000000a2'::uuid),
  '(Owner.Fixture@Piacere.CY,t)',
  'admin_list_venue_owners: carries email and pending-invite state'
);

SELECT * FROM finish();
ROLLBACK;
