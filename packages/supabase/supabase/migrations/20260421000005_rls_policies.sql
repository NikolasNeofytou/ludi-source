-- 20260421000005_rls_policies.sql
-- Row-Level Security policies. One policy block per table, read top-to-bottom
-- the same as docs/data-model.md.
--
-- Conventions:
--   - Every policy has TO authenticated OR TO anon OR TO authenticated, anon.
--   - Policies for writes via Edge Functions (bookings, payments, booking_addons,
--     admin_actions writes by non-admin) are intentionally ABSENT — the service
--     role key bypasses RLS, client role cannot reach those tables.
--   - USING clauses govern SELECT and row visibility for UPDATE/DELETE.
--   - WITH CHECK clauses govern what INSERT/UPDATE can *produce*.

-- ────────────────────────────────────────────────────────────────────
-- cities — public read, admin write
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY cities_select_public ON public.cities
  FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY cities_admin_write ON public.cities
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ────────────────────────────────────────────────────────────────────
-- users — self-read, self-update (restricted columns), admin all
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY users_select_self_or_admin ON public.users
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_admin());

-- Self-insert happens via the signup trigger running as the user.
-- Allow INSERT only for the user's own id.  Admin inserts happen via service role.
CREATE POLICY users_insert_self ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Self-update: row must remain your own.  Role escalation is blocked by the
-- trigger tg_users_block_role_change below (column-level RLS via trigger —
-- Postgres does not support column-level WITH CHECK in pure policies).
CREATE POLICY users_update_self_or_admin ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

-- Block self-promotion to admin.  Admin-elevation must happen via service role.
CREATE OR REPLACE FUNCTION public.tg_users_block_role_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'role change not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_users_block_role_change
  BEFORE UPDATE OF role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_users_block_role_change();

CREATE POLICY users_admin_delete ON public.users
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ────────────────────────────────────────────────────────────────────
-- venues — public-read-if-active, owner-limited-update, admin-all
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY venues_select_public_or_owner_or_admin ON public.venues
  FOR SELECT
  TO anon, authenticated
  USING (
    (is_active AND stripe_account_status = 'active')
    OR public.is_venue_owner_of_venue(id)
    OR public.is_admin()
  );

CREATE POLICY venues_admin_insert ON public.venues
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY venues_owner_or_admin_update ON public.venues
  FOR UPDATE
  TO authenticated
  USING (public.is_venue_owner_of_venue(id) OR public.is_admin())
  WITH CHECK (public.is_venue_owner_of_venue(id) OR public.is_admin());

CREATE POLICY venues_admin_delete ON public.venues
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ────────────────────────────────────────────────────────────────────
-- venue_owners — self-read, admin write
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY venue_owners_select_self_or_admin ON public.venue_owners
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY venue_owners_admin_write ON public.venue_owners
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ────────────────────────────────────────────────────────────────────
-- pitches — public-read-if-bookable, owner/admin manage
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY pitches_select_bookable_or_owner_or_admin ON public.pitches
  FOR SELECT
  TO anon, authenticated
  USING (
    (is_verified AND is_active)
    OR public.is_venue_owner_of_venue(venue_id)
    OR public.is_admin()
  );

CREATE POLICY pitches_owner_or_admin_insert ON public.pitches
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_venue_owner_of_venue(venue_id) OR public.is_admin());

CREATE POLICY pitches_owner_or_admin_update ON public.pitches
  FOR UPDATE
  TO authenticated
  USING (public.is_venue_owner_of_venue(venue_id) OR public.is_admin())
  WITH CHECK (public.is_venue_owner_of_venue(venue_id) OR public.is_admin());

CREATE POLICY pitches_admin_delete ON public.pitches
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ────────────────────────────────────────────────────────────────────
-- pitch_schedules — public read (needed for slot rendering), owner writes
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY pitch_schedules_select_public ON public.pitch_schedules
  FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY pitch_schedules_owner_write ON public.pitch_schedules
  FOR ALL
  TO authenticated
  USING (public.is_venue_owner_of_pitch(pitch_id) OR public.is_admin())
  WITH CHECK (public.is_venue_owner_of_pitch(pitch_id) OR public.is_admin());

-- ────────────────────────────────────────────────────────────────────
-- pitch_schedule_overrides — same shape
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY pitch_schedule_overrides_select_public ON public.pitch_schedule_overrides
  FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY pitch_schedule_overrides_owner_write ON public.pitch_schedule_overrides
  FOR ALL
  TO authenticated
  USING (public.is_venue_owner_of_pitch(pitch_id) OR public.is_admin())
  WITH CHECK (public.is_venue_owner_of_pitch(pitch_id) OR public.is_admin());

-- ────────────────────────────────────────────────────────────────────
-- bookings — self/owner/admin read.  ALL WRITES VIA SERVICE ROLE (Edge Functions).
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY bookings_select_self_or_owner_or_admin ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_venue_owner_of_pitch(pitch_id)
    OR public.is_admin()
  );

-- No INSERT/UPDATE/DELETE policies: client cannot write directly.
-- Booking creation, state transitions, and cancellations flow through
-- Edge Functions that use the service role key (bypassing RLS).
-- This is a deliberate security boundary, not an oversight.

-- ────────────────────────────────────────────────────────────────────
-- booking_addons — inherit visibility, no client writes
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY booking_addons_select_inherits ON public.booking_addons
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_addons.booking_id
        AND (
          b.user_id = auth.uid()
          OR public.is_venue_owner_of_pitch(b.pitch_id)
          OR public.is_admin()
        )
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- payments — self (via booking), admin.  Service role writes via webhook.
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY payments_select_self_or_admin ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = payments.booking_id
        AND (b.user_id = auth.uid() OR public.is_admin())
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- admin_actions — admin-only, read + insert.  No update/delete (append-only).
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY admin_actions_admin_select ON public.admin_actions
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY admin_actions_admin_insert ON public.admin_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND admin_user_id = auth.uid());

-- No UPDATE or DELETE policies = append-only by construction.
