-- 59_function_acl.sql — who may call what (20261020000002, the 2026-10-19 audit)
-- Under test:
--   function ACLs: every SECURITY DEFINER function in public that anon or
--     PUBLIC can execute is on the allowlist below, and everything on the
--     allowlist still can be (the public site and the app's signed-out
--     screens call them). Trigger functions are out of scope: they cannot
--     be called, only fired.
--   materialise_booking_series: no EXECUTE for anon, authenticated or
--     PUBLIC; the gate inside no longer trusts current_user; the horizon is
--     clamped to 120 days
--   end_booking_series / load_cfa_round / venue_display_token /
--     join_fixture: signed-in only
--   users: a signed-in user updates the profile columns, nothing else; a
--     self-insert is a player
--   v_venue_booking_roster / v_venue_earnings_daily: no grant for anon
--
-- Why the ACL checks see what prod sees: the bootstrap no longer
-- blanket-grants functions, and the CI dry-run restores Supabase's default
-- privileges, so a function a migration forgot to revoke from anon is
-- executable by anon here exactly as on prod. The PUBLIC check reads the
-- ACL itself (aclexplode, grantee 0), which no role-specific grant can mask.
--
-- Adding a definer function anon must call? Add it to t_anon_ok. Otherwise
-- its migration needs `REVOKE ALL ON FUNCTION … FROM public, anon` (and
-- `authenticated` too if it is service-only): `FROM public` alone leaves
-- anon its default grant, `FROM anon` alone leaves it PUBLIC's.
--
-- Fixtures: a2 owns venue_a (b1) with pitch c1; a4 is a player; a5 a
-- stranger. Dates are Cyprus dates (see 32_*).
BEGIN;
SELECT plan(22);

CREATE TEMP TABLE t_anon_ok (fn regprocedure PRIMARY KEY);
INSERT INTO t_anon_ok VALUES
  ('public.fixture_preview(text)'),
  ('public.get_available_slots(uuid,date,date)'),
  ('public.invite_recorded(text)'),
  ('public.is_admin()'),
  ('public.is_booking_organiser(uuid)'),
  ('public.is_participant_of_booking(uuid)'),
  ('public.pitch_blockers(uuid)'),
  ('public.pitch_has_camera(uuid)'),
  ('public.pitch_units(uuid)'),
  ('public.public_venue_schedule(text,date)'),
  ('public.venue_open_games(text)'),
  ('public.venue_page(text)'),
  ('public.venue_pins()'),
  ('public.venue_slugs()');

CREATE TEMP VIEW t_definer AS
SELECT p.oid, p.oid::regprocedure AS fn, coalesce(p.proacl, acldefault('f', p.proowner)) AS acl
FROM pg_proc AS p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.prosecdef
  AND p.prokind = 'f'
  AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend AS d
    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
  );

-- ── The allowlist ───────────────────────────────────────────────────

-- 1. PUBLIC (which anon inherits) executes no definer function off the list
SELECT is_empty(
  $$SELECT d.fn::text FROM t_definer AS d
    WHERE EXISTS (
      SELECT 1 FROM aclexplode(d.acl) AS a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    )
    AND d.fn NOT IN (SELECT fn FROM t_anon_ok)$$,
  'acl: no definer function off the allowlist is executable by PUBLIC'
);

-- 2. nor does anon, by any route (its own grant or PUBLIC's)
SELECT is_empty(
  $$SELECT d.fn::text FROM t_definer AS d
    WHERE has_function_privilege('anon', d.oid, 'EXECUTE')
      AND d.fn NOT IN (SELECT fn FROM t_anon_ok)$$,
  'acl: no definer function off the allowlist is executable by anon'
);

-- 3. and everything on the list still is (the signed-out surfaces need it)
SELECT is_empty(
  $$SELECT fn::text FROM t_anon_ok
    WHERE NOT has_function_privilege('anon', fn, 'EXECUTE')$$,
  'acl: every allowlisted function is still executable by anon'
);

-- ── materialise_booking_series ──────────────────────────────────────

-- 4. the scheduler's function: service_role only
SELECT is(
  ARRAY[
    has_function_privilege('anon',          'public.materialise_booking_series(uuid,integer)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.materialise_booking_series(uuid,integer)', 'EXECUTE'),
    has_function_privilege('service_role',  'public.materialise_booking_series(uuid,integer)', 'EXECUTE')
  ],
  ARRAY[FALSE, FALSE, TRUE],
  'materialise_booking_series: EXECUTE for service_role only'
);

-- 5. a signed-in owner calling it directly is refused at the door
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$SELECT public.materialise_booking_series(NULL, 7)$$,
  '42501',
  NULL,
  'materialise_booking_series: a signed-in caller has no EXECUTE'
);

-- 6. the owner's own path still works: create_booking_series (a definer)
--    materialises the new series from inside
SELECT lives_ok(
  $$SELECT public.create_booking_series(
      '00000000-0000-4000-8000-0000000000b1', 'Audit Academy', NULL,
      ARRAY['00000000-0000-4000-8000-0000000000c1']::uuid[],
      ARRAY[0,1,2,3,4,5,6]::smallint[],
      '07:00', 60, (now() AT TIME ZONE 'Europe/Nicosia')::date, NULL)$$,
  'create_booking_series: the owner still creates and materialises a series'
);

RESET ROLE;
CREATE TEMP TABLE t_series AS
SELECT id FROM public.booking_series WHERE name = 'Audit Academy';
GRANT SELECT ON t_series TO anon, authenticated;

-- 7. creation filled the default 56 days, today included
SELECT is(
  (SELECT count(*)::int FROM public.bookings WHERE series_id = (SELECT id FROM t_series)),
  57,
  'materialise: creation fills today + 56 days'
);

-- 8–9. the horizon is clamped: 4000 days asked, 120 made
SELECT is(
  public.materialise_booking_series((SELECT id FROM t_series), 4000),
  64,
  'materialise: a 4000-day horizon is clamped to 120 (64 more days)'
);
SELECT is(
  (SELECT max((starts_at AT TIME ZONE 'Europe/Nicosia')::date) FROM public.bookings
    WHERE series_id = (SELECT id FROM t_series)),
  (now() AT TIME ZONE 'Europe/Nicosia')::date + 120,
  'materialise: the furthest instance is 120 days out'
);

-- 10–12. the gate inside, reached with a grant this test makes and ROLLBACK
--     drops. Before 20261020000002 it read current_user, which is postgres
--     inside the definer body, so any caller passed. A request through the
--     API carries a JWT role; only service_role is the scheduler.
GRANT EXECUTE ON FUNCTION public.materialise_booking_series(uuid, int) TO authenticated;
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', TRUE);
SELECT throws_ok(
  $$SELECT public.materialise_booking_series(NULL, 7)$$,
  '42501',
  'materialise_booking_series: all-series run is for the scheduler',
  'materialise gate: an owner cannot run every series'
);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT throws_ok(
  $$SELECT public.materialise_booking_series((SELECT id FROM t_series), 7)$$,
  '42501',
  'materialise_booking_series: not your series',
  'materialise gate: a stranger cannot run someone else''s series'
);

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  public.materialise_booking_series((SELECT id FROM t_series), 7),
  0,
  'materialise gate: the owner may run their own series'
);

-- 13. the service key is the scheduler
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SELECT lives_ok(
  $$SELECT public.materialise_booking_series(NULL, 7)$$,
  'materialise gate: service_role runs every series'
);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', TRUE);

-- ── Signed-in RPCs ──────────────────────────────────────────────────

-- 14. anon cannot call them; authenticated can
SELECT is(
  (SELECT array_agg(f || ':' || has_function_privilege('anon', f, 'EXECUTE')
                       || ':' || has_function_privilege('authenticated', f, 'EXECUTE')
                    ORDER BY f)
     FROM unnest(ARRAY[
       'public.end_booking_series(uuid,date)',
       'public.join_fixture(text,text)',
       'public.load_cfa_round(uuid,date,text,jsonb)',
       'public.venue_display_token(uuid,boolean)'
     ]) AS f),
  ARRAY[
    'public.end_booking_series(uuid,date):false:true',
    'public.join_fixture(text,text):false:true',
    'public.load_cfa_round(uuid,date,text,jsonb):false:true',
    'public.venue_display_token(uuid,boolean):false:true'
  ],
  'signed-in RPCs: anon has no EXECUTE, authenticated does'
);

-- 15. and anon is refused at the door
SELECT public.set_test_anon();
SELECT throws_ok(
  $$SELECT public.venue_display_token('00000000-0000-4000-8000-0000000000b1'::uuid, TRUE)$$,
  '42501',
  NULL,
  'venue_display_token: anon cannot mint or rotate a screen token'
);

-- ── users ───────────────────────────────────────────────────────────

-- 16. a player edits their profile
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT lives_ok(
  $$UPDATE public.users
       SET first_name = 'Renamed', preferred_locale = 'gr', notify_games = FALSE
     WHERE id = '00000000-0000-4000-8000-0000000000a4'::uuid$$,
  'users: a player updates their own profile columns'
);

-- 17–19. but not the columns the server owns
SELECT throws_ok(
  $$UPDATE public.users SET stripe_customer_id = 'cus_someone_else'
     WHERE id = '00000000-0000-4000-8000-0000000000a4'::uuid$$,
  '42501',
  NULL,
  'users: stripe_customer_id is not the player''s to write'
);
SELECT throws_ok(
  $$UPDATE public.users SET anonymized_at = now()
     WHERE id = '00000000-0000-4000-8000-0000000000a4'::uuid$$,
  '42501',
  NULL,
  'users: anonymized_at is not the player''s to write'
);
SELECT throws_ok(
  $$UPDATE public.users SET handle = 'taken-by-a4'
     WHERE id = '00000000-0000-4000-8000-0000000000a4'::uuid$$,
  '42501',
  NULL,
  'users: handle is not the player''s to write'
);

-- 20–21. a self-insert is a player. The signup trigger normally writes
--     the row; take it away so the client fallback is what is left.
RESET ROLE;
INSERT INTO auth.users (id) VALUES ('00000000-0000-4000-8000-00000000a561')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.users WHERE id = '00000000-0000-4000-8000-00000000a561';

SELECT public.set_test_user('00000000-0000-4000-8000-00000000a561'::uuid);
SELECT throws_ok(
  $$INSERT INTO public.users (id, first_name, last_name, city_id, role)
    VALUES ('00000000-0000-4000-8000-00000000a561', 'Self', 'Made',
            (SELECT id FROM public.cities WHERE code = 'larnaca'), 'admin')$$,
  '42501',
  NULL,
  'users_insert_self: a self-insert cannot make an admin'
);
SELECT lives_ok(
  $$INSERT INTO public.users (id, first_name, last_name, city_id)
    VALUES ('00000000-0000-4000-8000-00000000a561', 'Self', 'Made',
            (SELECT id FROM public.cities WHERE code = 'larnaca'))$$,
  'users_insert_self: a self-insert as a player still works'
);

-- ── The venue views ─────────────────────────────────────────────────

-- 22. anon has no grant on either
SELECT is(
  ARRAY[
    has_table_privilege('anon', 'public.v_venue_booking_roster', 'SELECT'),
    has_table_privilege('anon', 'public.v_venue_earnings_daily', 'SELECT')
  ],
  ARRAY[FALSE, FALSE],
  'venue views: anon has no SELECT on the roster or the earnings'
);

SELECT * FROM finish();
ROLLBACK;
