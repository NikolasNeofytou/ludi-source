-- tests/rls/_bootstrap.sql
-- Loaded once before pg_prove runs the per-table RLS test files.
--
-- Sets up:
--   1. A pgtap-friendly auth.uid() that reads a session GUC, so tests can
--      switch identity inside a transaction without touching auth.users.
--   2. Helper functions set_test_user(uuid) / set_test_anon() that flip
--      both the GUC and the active role atomically.
--   3. A self-contained fixture graph (admin / owner / manager / other
--      players, two venues with mismatched active/Stripe state, three
--      pitches across verified/unverified/parented-by-inactive-venue,
--      a schedule + override, two bookings, a payment, a booking addon,
--      one admin_actions row) that covers every policy branch.
--
-- The bootstrap is destructive — it inserts deterministic UUIDs that must
-- not collide with seed.sql (which uses the 0…0100+ namespace). Test
-- fixtures live in 0…00a1+ to keep the two clearly separated. Tests
-- themselves run inside transactions that ROLLBACK, so per-test mutations
-- never leak into other test files.

-- ────────────────────────────────────────────────────────────────────
-- 0. auth.users columns, and the grants (there are almost none)
-- ────────────────────────────────────────────────────────────────────
-- The CI image's auth.users is the base table; GoTrue adds the rest of its
-- columns when it boots, and CI never boots GoTrue. The
-- admin_owner_access functions (20260827000001) read phone + created_at
-- at RUNTIME — plpgsql bodies aren't column-checked at CREATE, so the
-- migration applies against the thin table and only a test call would
-- explode. Complete it here; IF NOT EXISTS makes it a no-op anywhere the
-- real columns exist.
-- Same story for email / invited_at / last_sign_in_at, added 2026-08-29 for
-- ADR-0024: admin_lookup_user_by_email and the widened
-- admin_list_venue_owners read them at RUNTIME, so the migration applies
-- happily against a thin table and only a test CALL explodes — which is
-- exactly how this was found (one assertion silently stopped running).
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS invited_at timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;

-- anon and authenticated get no grant from this file on any table, view or
-- function a migration made (the test helpers in section 2 are this file's
-- own). The suite runs on the grants the migrations leave, which are prod's:
-- Supabase's default privileges hand every table, view, sequence and
-- function a migration creates to anon, authenticated and service_role at
-- CREATE time, and the migration's own REVOKEs and column GRANTs are the
-- last word. A local stack has those defaults with the schema; the CI
-- dry-run restores them after it recreates `public` (.github/workflows/
-- ci.yml). So a test that reads a revoked view as anon gets the 42501 prod
-- gives anon, and a test that asserts a revoke fails when the migration
-- forgot it.
--
-- Until 2026-10-20 this file ran `GRANT SELECT, INSERT, UPDATE, DELETE ON
-- ALL TABLES IN SCHEMA public TO anon, authenticated` and the same for
-- EXECUTE on functions. Both re-granted whatever a migration had revoked,
-- so every revoke a test asserted had to be restated here by hand
-- (v_open_fixtures, the two venue views, venues' and users' column lists),
-- and every one nobody restated was invisible: the 2026-10-19 audit found
-- four definer functions open to anon, and 13_* read v_fixture as anon
-- through a grant prod does not have. tests/rls/59 holds the allowlist of
-- definer functions anon may call.
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;

-- service_role, added 2026-08-22 for tests/owner_column_privileges.sql.
--
-- Real Supabase ships this role with full table privileges AND BYPASSRLS —
-- it is what the Edge Functions connect as. Its table grants come from the
-- default privileges above (no migration revokes a table from it), so this
-- file no longer grants them (2026-10-20); function EXECUTE stays.
--
-- Grants only. We deliberately do NOT `ALTER ROLE service_role BYPASSRLS`
-- here even though real Supabase has it: the role is reserved on a real
-- Supabase instance ("only superusers can modify it"), so the statement
-- aborts this whole file when the suite is run against a local stack
-- rather than the CI stub — taking the auth.uid() override below with it,
-- which makes every RLS test silently run as nobody.
--
-- Tests that need to prove a server-side write path works should assert
-- the property directly rather than impersonate service_role under RLS.
-- See tests/owner_column_privileges.sql.
GRANT USAGE ON SCHEMA public, auth TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- 1. CI-only auth.uid() override
-- ────────────────────────────────────────────────────────────────────
-- The CI workflow stubs auth.uid() to always return NULL (Supabase ships
-- the real one). For RLS testing we need it to reflect the "current test
-- user", which we store in a session GUC. Wrapping the cast in NULLIF
-- handles the anon case where the GUC is empty/unset.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('test.current_user_id', true), '')::uuid;
$$;

-- ────────────────────────────────────────────────────────────────────
-- 2. Role/identity switch helpers
-- ────────────────────────────────────────────────────────────────────
-- pgtap tests run inside a transaction; SET LOCAL scopes role + GUC to
-- that transaction so they get rolled back automatically. RESET ROLE
-- first because we may already be in `anon`/`authenticated` from an
-- earlier helper call within the same test, and SET ROLE requires
-- membership which non-superusers lack.
CREATE OR REPLACE FUNCTION public.set_test_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('test.current_user_id', p_user_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END;
$$;

CREATE OR REPLACE FUNCTION public.set_test_anon()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('test.current_user_id', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_test_user(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_test_anon()        TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 3. Fixtures
-- ────────────────────────────────────────────────────────────────────
-- Disable the signup trigger while we hand-build profiles. The trigger
-- defaults role='player' and we need one admin; the role-change trigger
-- (tg_users_block_role_change) blocks UPDATE OF role so we have to set
-- the right role at INSERT time, which means going around the auto-
-- profile path. Re-enable at the end so anything later that exercises
-- signup still flows through it.
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

DO $bootstrap$
DECLARE
  v_city_id    uuid;
  v_admin      uuid := '00000000-0000-4000-8000-0000000000a1';
  v_owner      uuid := '00000000-0000-4000-8000-0000000000a2';
  v_manager    uuid := '00000000-0000-4000-8000-0000000000a3';
  v_other      uuid := '00000000-0000-4000-8000-0000000000a4';
  -- v_stranger has no venue_owners row, no bookings — the only fixture
  -- user with zero relation to any test-visible row. Needed by tests
  -- that assert "an authenticated user with no path sees nothing".
  v_stranger   uuid := '00000000-0000-4000-8000-0000000000a5';
  v_venue_a    uuid := '00000000-0000-4000-8000-0000000000b1';
  v_venue_b    uuid := '00000000-0000-4000-8000-0000000000b2';
  v_pitch_a1   uuid := '00000000-0000-4000-8000-0000000000c1';
  v_pitch_a2   uuid := '00000000-0000-4000-8000-0000000000c2';
  v_pitch_b1   uuid := '00000000-0000-4000-8000-0000000000c3';
  v_override   uuid := '00000000-0000-4000-8000-0000000000e1';
  v_book_other uuid := '00000000-0000-4000-8000-0000000000f1';
  v_book_admin uuid := '00000000-0000-4000-8000-0000000000f2';
  v_payment    uuid := '00000000-0000-4000-8000-000000000091';
  v_action     uuid := '00000000-0000-4000-8000-000000000081';
  -- 2030-01-07 is a Monday; future-dated so EXCLUDE constraint never
  -- fights us against existing seed bookings if any get added later.
  v_monday     date := '2030-01-07';
BEGIN
  SELECT id INTO v_city_id FROM public.cities WHERE code = 'larnaca';
  IF v_city_id IS NULL THEN
    RAISE EXCEPTION 'larnaca city missing — seed.sql must run before bootstrap';
  END IF;

  -- auth.users stubs (no metadata required since the trigger is off)
  INSERT INTO auth.users (id) VALUES
    (v_admin), (v_owner), (v_manager), (v_other), (v_stranger)
  ON CONFLICT (id) DO NOTHING;

  -- Profiles. role='admin' on v_admin set at INSERT to dodge the
  -- column-level role-change trigger.
  INSERT INTO public.users (id, first_name, last_name, city_id, role) VALUES
    (v_admin,    'Admin',    'User', v_city_id, 'admin'),
    (v_owner,    'Owner',    'User', v_city_id, 'player'),
    (v_manager,  'Manager',  'User', v_city_id, 'player'),
    (v_other,    'Other',    'User', v_city_id, 'player'),
    (v_stranger, 'Stranger', 'User', v_city_id, 'player')
  ON CONFLICT (id) DO NOTHING;

  -- venue_a is active + Stripe-active so its verified pitches are bookable.
  INSERT INTO public.venues (
    id, name, address, city_id, coords,
    stripe_account_id, stripe_account_status, is_active
  ) VALUES (
    v_venue_a,
    'RLS Fixture Venue A',
    '1 Test St, Larnaca',
    v_city_id,
    ST_SetSRID(ST_MakePoint(33.6, 34.9), 4326)::geography,
    'acct_rls_fixture_a',
    'active',
    true
  )
  ON CONFLICT (id) DO NOTHING;

  -- venue_b is inactive AND not Stripe-active — exercises the
  -- public-visibility predicate of the venues SELECT policy.
  INSERT INTO public.venues (
    id, name, address, city_id, coords,
    stripe_account_id, stripe_account_status, is_active
  ) VALUES (
    v_venue_b,
    'RLS Fixture Venue B (inactive)',
    '2 Test St, Larnaca',
    v_city_id,
    ST_SetSRID(ST_MakePoint(33.62, 34.92), 4326)::geography,
    'acct_rls_fixture_b',
    'pending',
    false
  )
  ON CONFLICT (id) DO NOTHING;

  -- v_owner owns venue_a; v_manager is a manager of venue_a.
  -- Membership set is what is_venue_owner_of_venue() reads.
  INSERT INTO public.venue_owners (venue_id, user_id, role) VALUES
    (v_venue_a, v_owner,   'owner'),
    (v_venue_a, v_manager, 'manager')
  ON CONFLICT DO NOTHING;

  -- pitch_a1 is verified+active → publicly visible.
  -- pitch_a2 is unverified → only owner/admin should see it.
  -- pitch_b1 sits under inactive venue_b. tg_pitches_verify_guard
  -- silently flips is_verified=false because venue_b is not Stripe-active,
  -- so we don't need to set it explicitly.
  INSERT INTO public.pitches (
    id, venue_id, name, type, surface,
    price_per_hour_cents, is_verified, is_active
  ) VALUES
    (v_pitch_a1, v_venue_a, 'Pitch A1 (verified)',   '5-a-side', 'turf',  4000, true,  true),
    (v_pitch_a2, v_venue_a, 'Pitch A2 (unverified)', '5-a-side', 'turf',  4000, false, true),
    (v_pitch_b1, v_venue_b, 'Pitch B1 (inactive venue)', '5-a-side', 'turf', 4000, true, true)
  ON CONFLICT (id) DO NOTHING;

  -- Mon 09:00–17:00, 60 min slots = 8 slots/Monday.
  INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at, slot_duration_minutes)
  VALUES (v_pitch_a1, 1, '09:00', '17:00', 60);

  -- One Christmas-style override.
  INSERT INTO public.pitch_schedule_overrides (id, pitch_id, override_date, is_closed, reason)
  VALUES (v_override, v_pitch_a1, '2030-12-25', true, 'Test override')
  ON CONFLICT (id) DO NOTHING;

  -- v_other has a paid booking on pitch_a1 (visible to self, venue owner, admin).
  INSERT INTO public.bookings (
    id, code, user_id, pitch_id, starts_at, ends_at, state,
    base_price_cents, addons_price_cents, total_cents,
    platform_fee_cents, cancellation_policy
  ) VALUES (
    v_book_other,
    'RLS-2030-0001',
    v_other,
    v_pitch_a1,
    (v_monday + time '10:00') AT TIME ZONE 'Europe/Nicosia',
    (v_monday + time '11:00') AT TIME ZONE 'Europe/Nicosia',
    'paid',
    4000, 0, 4000, 400, 'standard'
  )
  ON CONFLICT (id) DO NOTHING;

  -- v_admin has a separate booking on the same pitch, different time slot.
  INSERT INTO public.bookings (
    id, code, user_id, pitch_id, starts_at, ends_at, state,
    base_price_cents, addons_price_cents, total_cents,
    platform_fee_cents, cancellation_policy
  ) VALUES (
    v_book_admin,
    'RLS-2030-0002',
    v_admin,
    v_pitch_a1,
    (v_monday + time '12:00') AT TIME ZONE 'Europe/Nicosia',
    (v_monday + time '13:00') AT TIME ZONE 'Europe/Nicosia',
    'paid',
    4000, 0, 4000, 400, 'standard'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Booking addon hung off v_other's booking (legally required per
  -- Cyprus rules, but we only need ONE row to test the inheritance
  -- policy on booking_addons).
  INSERT INTO public.booking_addons (booking_id, addon_code, quantity, unit_price_cents)
  VALUES (v_book_other, 'bibs', 1, 500)
  ON CONFLICT DO NOTHING;

  -- One payment row hung off v_other's booking.
  INSERT INTO public.payments (
    id, booking_id, stripe_payment_intent_id,
    amount_cents, application_fee_cents, status
  ) VALUES (
    v_payment,
    v_book_other,
    'pi_rls_fixture_001',
    4000, 400, 'succeeded'
  )
  ON CONFLICT (id) DO NOTHING;

  -- One admin_actions row authored by the admin user (so the SELECT
  -- policy has something to return).
  INSERT INTO public.admin_actions (
    id, admin_user_id, action_type, target_type, target_id, reason
  ) VALUES (
    v_action,
    v_admin,
    'verify_pitch',
    'pitch',
    v_pitch_a1,
    'fixture admin action for RLS tests'
  )
  ON CONFLICT (id) DO NOTHING;
END
$bootstrap$;

ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
