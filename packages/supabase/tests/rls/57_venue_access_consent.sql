-- 57_venue_access_consent.sql — a key the person has taken
-- Under test (20261020000101_venue_access_consent):
--   venue_owners.accepted_at / invited_email
--   venue_people           — a pending grant shows only what the owner typed
--   accept_venue_access()  — the grantee accepts their own rows, nobody else's
-- Fixtures from _bootstrap.sql: venue b1, owner a2, manager a3 (both
-- accepted: inserted after the migration, so the column default applies),
-- a4 a player with an account of their own.
BEGIN;
SELECT plan(12);

-- An owner's grant of an existing account, written the way the owner-mode
-- invite writes it: pending, with the address the owner typed. a4's own
-- account carries a phone and a different-looking address.
UPDATE auth.users
SET
  email = 'other.player@example.cy',
  phone = '35799000004',
  last_sign_in_at = now() - interval '2 days'
WHERE id = '00000000-0000-4000-8000-0000000000a4'::uuid;

INSERT INTO public.venue_owners (venue_id, user_id, role, accepted_at, invited_email)
VALUES (
  '00000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-0000000000a4',
  'manager',
  NULL,
  'Other.Player@example.cy'
);

-- 1. the column default accepts every other grant
SELECT is(
  (SELECT count(*)::int FROM public.venue_owners AS vo
   WHERE vo.venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid
     AND vo.accepted_at IS NULL),
  1,
  'accepted_at: only the owner-mode grant is pending'
);

-- ── what the owner sees while it is pending ─────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);

-- 2. the address the owner typed, in place of the account's own
SELECT is(
  (SELECT p.email FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid) AS p
   WHERE p.user_id = '00000000-0000-4000-8000-0000000000a4'::uuid),
  'Other.Player@example.cy',
  'venue_people: a pending grant shows the invited address'
);

-- 3. no phone
SELECT is(
  (SELECT p.phone FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid) AS p
   WHERE p.user_id = '00000000-0000-4000-8000-0000000000a4'::uuid),
  NULL,
  'venue_people: a pending grant hides the phone'
);

-- 4. no name from the person's own profile
SELECT is(
  (SELECT p.first_name FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid) AS p
   WHERE p.user_id = '00000000-0000-4000-8000-0000000000a4'::uuid),
  NULL,
  'venue_people: a pending grant hides the name'
);

-- 5. no sign-in history
SELECT is(
  (SELECT p.last_sign_in_at FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid) AS p
   WHERE p.user_id = '00000000-0000-4000-8000-0000000000a4'::uuid),
  NULL,
  'venue_people: a pending grant hides the last sign-in'
);

-- 6. an accepted grant is unchanged: the manager's name still shows
SELECT is(
  (SELECT p.first_name FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid) AS p
   WHERE p.user_id = '00000000-0000-4000-8000-0000000000a3'::uuid),
  'Manager',
  'venue_people: an accepted grant shows the person'
);

-- ── accepting ───────────────────────────────────────────────────────
-- 7. the owner calling it accepts nothing of anyone else's
SELECT is(
  public.accept_venue_access(),
  0,
  'accept_venue_access: the owner has nothing pending and touches no one else'
);

-- 8. the grantee accepts their own pending grant
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  public.accept_venue_access(),
  1,
  'accept_venue_access: the grantee accepts their own grant'
);

-- 9. and a second call is a no-op
SELECT is(
  public.accept_venue_access(),
  0,
  'accept_venue_access: once accepted, nothing left to accept'
);

-- 10. once accepted, the owner sees the person's own details
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT p.phone FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid) AS p
   WHERE p.user_id = '00000000-0000-4000-8000-0000000000a4'::uuid),
  '35799000004',
  'venue_people: an accepted grant shows the phone'
);

SELECT is(
  (SELECT p.email FROM public.venue_people('00000000-0000-4000-8000-0000000000b1'::uuid) AS p
   WHERE p.user_id = '00000000-0000-4000-8000-0000000000a4'::uuid),
  'other.player@example.cy',
  'venue_people: an accepted grant shows the account''s own address'
);

-- 12. a request with no user behind it accepts nothing (anon has no
--     EXECUTE at all on prod; this is the guard inside, for a role that does)
RESET ROLE;
SELECT set_config('test.current_user_id', '', TRUE);
SELECT is(
  public.accept_venue_access(),
  0,
  'accept_venue_access: without a signed-in user it does nothing'
);

SELECT * FROM finish();
ROLLBACK;
