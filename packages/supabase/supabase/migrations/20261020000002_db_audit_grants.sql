-- 20261020000002_db_audit_grants.sql
-- Database fixes from the 2026-10-19 pre-public audit (App Store launch, the
-- repository going public). Five things, each small, all about who may call
-- or write what:
--
--   1. materialise_booking_series is the scheduler's function. Signed-in
--      callers lose EXECUTE, the gate inside stops trusting current_user,
--      and the horizon is clamped to 1..120 days.
--   2. end_booking_series, load_cfa_round and venue_display_token were
--      revoked from anon but never from PUBLIC, which anon inherits; and
--      join_fixture the other way round (revoked from PUBLIC, never from
--      anon, which keeps Supabase's default grant). Both halves now.
--   3. A participant's own UPDATE may leave a fixture, not come back into
--      one: rejoining and changing slot go through join_fixture(), which
--      checks the fixture first.
--   4. users: a signed-in user may update the profile columns the apps
--      write, and nothing else; a self-insert is always a player.
--   5. The two venue views the admin app reads are not for anon.
--
-- tests/rls/59_function_acl.sql keeps item 2 from coming back: every
-- SECURITY DEFINER function in public that anon or PUBLIC can execute must
-- be on its allowlist.

-- ════════════════════════════════════════════════════════════════════
-- 1. materialise_booking_series — the scheduler's function
-- ════════════════════════════════════════════════════════════════════
-- The gate read public.is_privileged_writer(), which checks current_user.
-- Inside a SECURITY DEFINER body current_user is the owner (postgres), so
-- the check was true for every caller — 20260829000002 already says so.
-- The function was granted to authenticated and only revoked from anon,
-- so PUBLIC (anon included) kept EXECUTE too.
--
-- Nothing signed-in calls it directly. The nightly pg_cron job runs as
-- postgres; create_booking_series calls it from inside its own definer
-- body, where the EXECUTE check is against the owner. So EXECUTE goes back
-- to the owner and service_role only, and the gate now asks who opened the
-- session (postgres for cron and psql) or what the request's JWT says
-- (service_role) — neither of which a signed-in caller can change.
--
-- The per-series branch keeps its owner/admin check: that is the path
-- create_booking_series takes, as the owner who just made the series.
--
-- The horizon is clamped to 1..120 days (default 56, unchanged): a
-- standing booking is a season, not a decade.
--
-- Body otherwise 20260915000002 verbatim.
CREATE OR REPLACE FUNCTION public.materialise_booking_series(
  p_series_id    uuid DEFAULT NULL,
  p_horizon_days int  DEFAULT 56
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'Europe/Nicosia')::date;
  v_horizon   int  := least(greatest(coalesce(p_horizon_days, 56), 1), 120);
  v_role      text;
  v_scheduler boolean;
  v_series    record;
  v_pitch     record;
  v_date      date;
  v_from      date;
  v_to        date;
  v_starts    timestamptz;
  v_ends      timestamptz;
  v_code      text;
  v_booking   uuid;
  v_made      int := 0;
BEGIN
  -- The same claim read settle_split_booking uses (20260830000001). A
  -- request through the API always carries one, and then only the service
  -- key is the scheduler. No claim means no request: a direct session
  -- (pg_cron, psql, the SQL editor), which must be postgres's own.
  BEGIN
    v_role := (current_setting('request.jwt.claims', true))::jsonb->>'role';
  EXCEPTION WHEN others THEN
    v_role := NULL;
  END;
  v_scheduler := CASE
    WHEN v_role IS NOT NULL THEN v_role = 'service_role'
    ELSE session_user IN ('postgres', 'supabase_admin')
  END;

  IF p_series_id IS NULL THEN
    IF NOT v_scheduler THEN
      RAISE EXCEPTION 'materialise_booking_series: all-series run is for the scheduler'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT (
      v_scheduler
      OR public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.booking_series AS s
        WHERE s.id = p_series_id AND public.is_venue_owner_of_venue(s.venue_id)
      )
    ) THEN
      RAISE EXCEPTION 'materialise_booking_series: not your series'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_series IN
    SELECT
      s.id, s.venue_id, s.name, s.phone, s.weekdays, s.starts_time,
      s.duration_minutes, s.starts_on, s.ends_on, s.created_by,
      v.cancellation_policy,
      upper(left(c.code, 3)) AS city_prefix
    FROM public.booking_series AS s
    INNER JOIN public.venues AS v ON v.id = s.venue_id
    INNER JOIN public.cities AS c ON c.id = v.city_id
    WHERE (p_series_id IS NULL OR s.id = p_series_id)
      AND (s.ends_on IS NULL OR s.ends_on >= v_today)
  LOOP
    v_from := greatest(v_series.starts_on, v_today);
    v_to   := least(coalesce(v_series.ends_on, v_today + v_horizon), v_today + v_horizon);

    FOR v_pitch IN
      SELECT p.id, p.price_per_hour_cents
      FROM public.booking_series_pitches AS sp
      INNER JOIN public.pitches AS p ON p.id = sp.pitch_id
      WHERE sp.series_id = v_series.id AND p.is_active
    LOOP
      v_date := v_from;
      WHILE v_date <= v_to LOOP
        IF EXTRACT(DOW FROM v_date)::smallint = ANY (v_series.weekdays) THEN
          v_starts := (v_date + v_series.starts_time) AT TIME ZONE 'Europe/Nicosia';
          v_ends   := v_starts + make_interval(mins => v_series.duration_minutes);

          IF NOT EXISTS (
            SELECT 1 FROM public.bookings AS b
            WHERE b.series_id = v_series.id
              AND b.pitch_id = v_pitch.id
              AND (b.starts_at AT TIME ZONE 'Europe/Nicosia')::date = v_date
          ) AND NOT EXISTS (
            SELECT 1 FROM public.booking_series_skips AS k
            WHERE k.series_id = v_series.id AND k.pitch_id = v_pitch.id AND k.on_date = v_date
          ) THEN
            BEGIN
              v_code := public.generate_booking_code(v_series.city_prefix, EXTRACT(YEAR FROM v_starts)::int);
              INSERT INTO public.bookings (
                code, user_id, pitch_id, starts_at, ends_at, state, origin,
                walk_in_name, walk_in_phone,
                base_price_cents, addons_price_cents, total_cents, platform_fee_cents,
                cancellation_policy, series_id
              ) VALUES (
                v_code, v_series.created_by, v_pitch.id, v_starts, v_ends, 'confirmed', 'walk_in',
                v_series.name, v_series.phone,
                greatest(1, round(v_pitch.price_per_hour_cents * v_series.duration_minutes / 60.0)::int),
                0,
                greatest(1, round(v_pitch.price_per_hour_cents * v_series.duration_minutes / 60.0)::int),
                0,
                v_series.cancellation_policy, v_series.id
              )
              RETURNING id INTO v_booking;

              INSERT INTO public.payments (
                booking_id, stripe_payment_intent_id, amount_cents, application_fee_cents,
                status, payment_method
              ) VALUES (
                v_booking, 'offline_' || v_booking::text,
                greatest(1, round(v_pitch.price_per_hour_cents * v_series.duration_minutes / 60.0)::int),
                0, 'succeeded', 'offline'
              );

              v_made := v_made + 1;
            EXCEPTION
              WHEN exclusion_violation THEN
                INSERT INTO public.booking_series_skips (series_id, pitch_id, on_date, reason)
                VALUES (v_series.id, v_pitch.id, v_date, 'already booked')
                ON CONFLICT DO NOTHING;
            END;
          END IF;
        END IF;
        v_date := v_date + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN v_made;
END;
$$;

REVOKE ALL ON FUNCTION public.materialise_booking_series(uuid, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialise_booking_series(uuid, int) TO service_role;

-- ════════════════════════════════════════════════════════════════════
-- 2. Signed-in RPCs that anon could still reach
-- ════════════════════════════════════════════════════════════════════
-- `REVOKE … FROM anon` does not touch PUBLIC, and anon is a member of
-- PUBLIC. `REVOKE … FROM PUBLIC` does not touch anon's own grant, which
-- Supabase's default privileges add to every new function in public.
-- A function closed to anon needs both.
REVOKE ALL ON FUNCTION public.end_booking_series(uuid, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.end_booking_series(uuid, date) TO authenticated;

REVOKE ALL ON FUNCTION public.load_cfa_round(uuid, date, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.load_cfa_round(uuid, date, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.venue_display_token(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.venue_display_token(uuid, boolean) TO authenticated;

-- join_fixture refuses anon in its body (NOT_SIGNED_IN); now its ACL does too.
REVOKE ALL ON FUNCTION public.join_fixture(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.join_fixture(text, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 3. booking_participants — leaving is an UPDATE, coming back is not
-- ════════════════════════════════════════════════════════════════════
-- booking_participants_update_self lets a participant write their own row,
-- and this trigger decides which columns. It allowed status and slot_kind
-- in both directions, so a participant who had left could put themselves
-- back 'in' with a bare UPDATE — past join_fixture()'s checks that the
-- fixture has not started or been cancelled, and that a split fixture
-- still collecting takes its seats through claim-share.
--
-- Now a non-privileged writer may still leave (in → out, unless the seat
-- holds a share: LEAVE_NEEDS_REFUND, unchanged), but status going to 'in'
-- and any slot_kind change are refused. Both are join_fixture()'s job: it
-- flips the same row back and sets the slot, and as a definer function it
-- passes the privileged early return below. Every other writer of this
-- table (ask_replacement, keep_my_seat, the seat swap, gk_claim, the
-- claim-share Edge Function on the service key) is privileged too.
--
-- The app already rejoins through join_fixture() (apps/mobile
-- src/lib/fixture.ts, rejoinFixture) and leaves with the bare UPDATE.
--
-- Body otherwise 20261013000002 verbatim.
CREATE OR REPLACE FUNCTION public.tg_booking_participants_block_identity_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id
  OR NEW.user_id    IS DISTINCT FROM OLD.user_id
  OR NEW.joined_at  IS DISTINCT FROM OLD.joined_at
  OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'a participant may change their own status and slot, not whose row it is'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Coming back in, or moving between keeper and outfield, goes through
  -- join_fixture(), which checks the fixture first.
  IF NEW.status = 'in' AND OLD.status IS DISTINCT FROM 'in' THEN
    RAISE EXCEPTION 'rejoin through join_fixture(), not an UPDATE'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.slot_kind IS DISTINCT FROM OLD.slot_kind THEN
    RAISE EXCEPTION 'change slot through join_fixture(), not an UPDATE'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The ask goes through ask_replacement()/keep_my_seat(), which check the
  -- fixture; the hand-over through the swap. Never a bare UPDATE.
  IF NEW.replacing_since IS DISTINCT FROM OLD.replacing_since
  OR NEW.replaced_by     IS DISTINCT FROM OLD.replaced_by THEN
    RAISE EXCEPTION
      'ask for a replacement through ask_replacement(), not an UPDATE'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A paid seat on a fixture still collecting leaves through leave-share,
  -- which gives the share back. A bare status flip kept the money and made
  -- the next claimant over-collect (settle_split_booking refuses, and the
  -- fixture died at its deadline although it had filled).
  IF OLD.status = 'in' AND NEW.status = 'out'
     AND public.seat_holds_collecting_share(OLD.id) THEN
    RAISE EXCEPTION 'LEAVE_NEEDS_REFUND'
      USING ERRCODE = 'P0001',
      DETAIL = 'this seat has a share on it; leave through leave-share';
  END IF;

  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 4. users — the profile columns, and a self-insert is a player
-- ════════════════════════════════════════════════════════════════════
-- users_update_self_or_admin gates the row; the table-level UPDATE grant
-- let that row's every column through, with only role (trigger) and
-- member_no (trigger) guarded. stripe_customer_id, anonymized_at, handle
-- and the timestamps were writable by their owner.
--
-- The grant is now the columns the apps write: edit-profile and the two
-- notification switches (apps/mobile/app/account), and the owner
-- dashboard's language (apps/admin/lib/locale-actions.ts). A new
-- self-editable column needs its own GRANT here. Server-side writers
-- (anonymize-me, the webhooks) use the service key and are unaffected;
-- BEFORE triggers that set updated_at write NEW, which needs no grant.
REVOKE UPDATE ON public.users FROM anon, authenticated;
GRANT UPDATE (
  first_name, last_name, city_id, skill_level, preferred_locale,
  positions, preferred_foot, goes_in_goal, height_cm, age_band,
  play_frequency, public_profile, public_profile_at,
  notify_games, notify_asks
) ON public.users TO authenticated;

-- The signup trigger (handle_new_user, definer) writes the profile row; a
-- client self-insert is a fallback, and it is always a player.
ALTER POLICY users_insert_self ON public.users
  WITH CHECK (id = auth.uid() AND role = 'player');

-- ════════════════════════════════════════════════════════════════════
-- 5. The venue views are for the admin app's signed-in owners
-- ════════════════════════════════════════════════════════════════════
REVOKE ALL ON public.v_venue_booking_roster, public.v_venue_earnings_daily FROM anon;
