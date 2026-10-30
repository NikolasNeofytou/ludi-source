-- tests/owner_column_privileges.sql
-- Column-level authorisation for venue owners (M6 #41e prerequisite).
-- Runs in CI after migrations + seed. Plain PL/pgSQL asserts, matching
-- tests/get_available_slots.sql — no pgtap dependency.
--
-- RLS is row-level. These triggers are the column-level half, and this file
-- asserts both directions: an owner cannot escalate, and the server-side
-- writers that legitimately touch the same columns still can.

BEGIN;

DO $$
DECLARE
  v_city_id  uuid;
  v_user_id  uuid := '00000000-0000-4000-8000-00000000c001';
  v_venue_id uuid;
  v_pitch_id uuid;
BEGIN
  SELECT id INTO v_city_id FROM public.cities WHERE code = 'larnaca';
  IF v_city_id IS NULL THEN
    INSERT INTO public.cities (code, name_en, name_gr, is_enabled)
    VALUES ('larnaca', 'Larnaca', 'Λάρνακα', TRUE) RETURNING id INTO v_city_id;
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user_id) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, first_name, last_name, city_id, role)
  VALUES (v_user_id, 'Venue', 'Owner', v_city_id, 'player')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.venues (
    name, address, city_id, coords, stripe_account_id, stripe_account_status,
    take_rate_bps
  ) VALUES (
    'Column Guard Venue', '2 Test St', v_city_id,
    ST_SetSRID(ST_MakePoint(33.632, 34.916), 4326)::geography,
    'acct_colguard', 'pending', 1000
  ) RETURNING id INTO v_venue_id;

  INSERT INTO public.pitches (
    venue_id, name, type, surface, price_per_hour_cents, is_verified
  ) VALUES (
    v_venue_id, 'Column Guard Pitch', '5-a-side', 'turf', 4000, FALSE
  ) RETURNING id INTO v_pitch_id;

  INSERT INTO public.venue_owners (venue_id, user_id, role)
  VALUES (v_venue_id, v_user_id, 'owner');

  CREATE TEMP TABLE _cg AS
  SELECT v_user_id AS user_id, v_venue_id AS venue_id, v_pitch_id AS pitch_id;
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- As the venue owner: escalation must fail, legitimate edits must pass.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_user_id  uuid;
  v_venue_id uuid;
  v_pitch_id uuid;
  v_rate     smallint;
  v_name     text;
BEGIN
  SELECT user_id, venue_id, pitch_id
  INTO v_user_id, v_venue_id, v_pitch_id FROM _cg;

  -- Both identity channels are set on purpose. Against a real Supabase
  -- (local dev) auth.uid() reads `request.jwt.claims`; in CI, tests/rls/
  -- _bootstrap.sql replaces auth.uid() with one that reads
  -- `test.current_user_id`. Setting both means this file behaves the same
  -- in either environment instead of silently running as nobody — which
  -- would make every assertion below pass for the wrong reason.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_id::text, 'role', 'authenticated')::text,
    TRUE
  );
  PERFORM set_config('test.current_user_id', v_user_id::text, TRUE);
  RESET ROLE;
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- Guard against exactly that: if the identity did not take, `is_admin()`
  -- is false but so is ownership, and the RLS policy would reject the
  -- writes for an unrelated reason.
  IF auth.uid() IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION
      'test identity did not take: auth.uid() = %, expected %',
      auth.uid(), v_user_id;
  END IF;

  -- 1. Commission is not the owner's to set.
  BEGIN
    UPDATE public.venues SET take_rate_bps = 0 WHERE id = v_venue_id;
    RAISE EXCEPTION 'owner was able to change take_rate_bps';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- 2. Payment readiness is not the owner's to declare. This one makes
  --    pitches publicly bookable via is_pitch_bookable().
  BEGIN
    UPDATE public.venues SET stripe_account_status = 'active' WHERE id = v_venue_id;
    RAISE EXCEPTION 'owner was able to change stripe_account_status';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- 3. Nor the payout account itself.
  BEGIN
    UPDATE public.venues SET stripe_account_id = 'acct_attacker' WHERE id = v_venue_id;
    RAISE EXCEPTION 'owner was able to change stripe_account_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- 4. Refund terms are a commercial term.
  BEGIN
    UPDATE public.venues SET cancellation_policy = 'strict' WHERE id = v_venue_id;
    RAISE EXCEPTION 'owner was able to change cancellation_policy';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- 5. Verification is the platform trust gate (M3 #18).
  BEGIN
    UPDATE public.pitches SET is_verified = TRUE WHERE id = v_pitch_id;
    RAISE EXCEPTION 'owner was able to self-verify a pitch';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- 6. A pitch may not be moved into another venue.
  BEGIN
    UPDATE public.pitches SET venue_id = v_venue_id, is_active = FALSE
    WHERE id = v_pitch_id;
    RAISE EXCEPTION 'owner was able to change pitch is_active';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- 7. What an owner SHOULD be able to do still works.
  UPDATE public.venues
  SET name = 'Renamed By Owner', contact_phone = '+35799000111'
  WHERE id = v_venue_id;
  SELECT name INTO v_name FROM public.venues WHERE id = v_venue_id;
  IF v_name <> 'Renamed By Owner' THEN
    RAISE EXCEPTION 'owner could not rename their own venue (got %)', v_name;
  END IF;

  UPDATE public.pitches SET price_per_hour_cents = 4500 WHERE id = v_pitch_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.pitches
    WHERE id = v_pitch_id AND price_per_hour_cents = 4500
  ) THEN
    RAISE EXCEPTION 'owner could not change their own pitch price';
  END IF;

  -- 8. A pitch an owner creates is unverified no matter what they ask for.
  INSERT INTO public.pitches (
    venue_id, name, type, surface, price_per_hour_cents, is_verified
  ) VALUES (
    v_venue_id, 'Owner Created', '5-a-side', 'turf', 3000, TRUE
  );
  IF EXISTS (
    SELECT 1 FROM public.pitches
    WHERE venue_id = v_venue_id AND name = 'Owner Created' AND is_verified
  ) THEN
    RAISE EXCEPTION 'owner created a pre-verified pitch';
  END IF;

  RESET ROLE;

  -- Confirm the take rate never moved. Read back as the superuser: since
  -- 20260913000005 the column is not SELECTable by `authenticated` at all
  -- (owners read it through v_venue_private).
  SELECT take_rate_bps INTO v_rate FROM public.venues WHERE id = v_venue_id;
  IF v_rate <> 1000 THEN
    RAISE EXCEPTION 'take_rate_bps changed to % despite the guard', v_rate;
  END IF;

  RAISE NOTICE 'owner column guards passed';
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- The server-side writers must NOT be blocked. This is the half that
-- would break the money path if the guard checked is_admin() alone:
-- service_role has no auth.uid(), so is_admin() is false for it.
--
-- Two separate assertions, because they cover two separate things and
-- neither can stand in for the other:
--
--   a) the guard EXEMPTS service_role. Asserted by calling
--      is_privileged_writer() while set to that role. Deliberately not
--      done by impersonating service_role for a real UPDATE: on the CI
--      stub that role has no BYPASSRLS, so the write would match zero
--      rows because of RLS and the test would pass without ever reaching
--      the trigger.
--   b) the webhook + cascade path still works end to end. Run as the
--      table owner, which is RLS-exempt and also on the guard's
--      exemption list — so this exercises the trigger for real.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_exempt boolean;
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, TRUE);
  PERFORM set_config('test.current_user_id', '', TRUE);

  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT public.is_privileged_writer() INTO v_exempt;
  RESET ROLE;

  IF NOT v_exempt THEN
    RAISE EXCEPTION
      'service_role is NOT exempt from the column guard — the stripe-webhook '
      'could no longer write venues.stripe_account_status';
  END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.is_privileged_writer() INTO v_exempt;
  RESET ROLE;

  IF v_exempt THEN
    RAISE EXCEPTION 'a plain authenticated client is exempt from the guard';
  END IF;

  RAISE NOTICE 'guard exemption is correct (service_role yes, authenticated no)';
END
$$;

DO $$
DECLARE
  v_venue_id uuid;
  v_pitch_id uuid;
BEGIN
  SELECT venue_id, pitch_id INTO v_venue_id, v_pitch_id FROM _cg;

  -- Re-verify the pitch as the platform would, so the cascade has
  -- something to switch off.
  UPDATE public.pitches SET is_verified = TRUE WHERE id = v_pitch_id;

  -- The stripe-webhook path: account.updated flips the venue live.
  UPDATE public.venues SET stripe_account_status = 'active' WHERE id = v_venue_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.venues
    WHERE id = v_venue_id AND stripe_account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'privileged writer could not update stripe_account_status';
  END IF;

  -- ...and back out again, which fires tg_venues_cascade_stripe_status,
  -- itself an UPDATE on pitches.is_verified. If the column guard blocked
  -- that cascade, a venue leaving `active` would keep bookable pitches.
  UPDATE public.venues SET stripe_account_status = 'restricted' WHERE id = v_venue_id;
  IF EXISTS (
    SELECT 1 FROM public.pitches WHERE id = v_pitch_id AND is_verified
  ) THEN
    RAISE EXCEPTION
      'cascade did not unverify the pitch — the column guard blocked it';
  END IF;

  RAISE NOTICE 'webhook + cascade write path still open';
END
$$;

ROLLBACK;
