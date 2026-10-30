-- 20260828000002_owner_audit_actions.sql
-- M6 #41i — owner writes get an audit trail. Plan: venue-owner-admin.md
-- gap 3 (re-plan 2026-08-28).
--
-- The gap: admin_actions is admin-insert-only, so an owner closing a
-- Saturday — at least as consequential as an admin toggling a pitch —
-- leaves no trace. The fix is the cheap one the plan recommended: widen
-- admin_actions rather than build an actor_actions table. The table name
-- and admin_user_id column keep their (now slightly misnomered) names —
-- renaming would break the admin app and the fixture tests for zero
-- behavioural gain; the comments carry the truth instead.
--
-- Append-only stays absolute: still no UPDATE or DELETE policies for
-- anyone. An audit row an actor could edit is not an audit row.

-- ────────────────────────────────────────────────────────────────────
-- 1. New action vocabulary for owner-shaped writes
-- ────────────────────────────────────────────────────────────────────
-- Named after what the owner did, not which form they used, so one
-- action_type covers add/edit/delete of a window (the payload records
-- which). 'create_pitch'/'update_pitch'/'update_venue' also become
-- available to admin sessions — those writes were previously audited
-- as 'other' or not at all.
ALTER TABLE public.admin_actions
  DROP CONSTRAINT admin_actions_action_type_check;

ALTER TABLE public.admin_actions
  ADD CONSTRAINT admin_actions_action_type_check CHECK (action_type IN (
    'refund_booking','verify_pitch','deactivate_pitch','activate_pitch',
    'create_venue','deactivate_venue','anonymize_user','other',
    'update_venue','create_pitch','update_pitch',
    'schedule_change','override_change'
  ));

COMMENT ON COLUMN public.admin_actions.admin_user_id IS
  'The acting user — a platform admin OR a venue owner/manager '
  '(widened 2026-08-28, M6 #41i). Kept its historical name to avoid a '
  'rename cascade through the admin app.';

COMMENT ON TABLE public.admin_actions IS
  'Append-only audit log of consequential writes: platform acts by '
  'admins, and (since 2026-08-28) venue/pitch/schedule acts by owners. '
  'No UPDATE/DELETE policies by construction.';

-- ────────────────────────────────────────────────────────────────────
-- 2. Owners may insert audit rows — for their own acts, on their own
--    property, from the owner vocabulary only
-- ────────────────────────────────────────────────────────────────────
-- Three guards, each load-bearing:
--   * admin_user_id = auth.uid()      — you can only audit yourself
--   * target is a venue/pitch you own — no writing rows about others'
--                                       property (which would also be a
--                                       probe for valid target ids)
--   * owner-shaped action_types only  — an owner cannot fabricate a
--                                       'refund_booking' or
--                                       'anonymize_user' row and muddy
--                                       the platform audit trail
-- Policies are OR'd with admin_actions_admin_insert, so admin sessions
-- are unaffected.
CREATE POLICY admin_actions_owner_insert ON public.admin_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    admin_user_id = auth.uid()
    AND action_type IN (
      'update_venue','create_pitch','update_pitch',
      'schedule_change','override_change'
    )
    AND (
      (target_type = 'venue' AND public.is_venue_owner_of_venue(target_id))
      OR
      (target_type = 'pitch' AND public.is_venue_owner_of_pitch(target_id))
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- 3. Actors read their own trail
-- ────────────────────────────────────────────────────────────────────
-- An owner can see what they (and their managers cannot — only their own
-- rows) did; the platform-wide view stays admin-only via the existing
-- admin_actions_admin_select. Harmless and honest: you may always see
-- what the log says you did.
CREATE POLICY admin_actions_actor_select ON public.admin_actions
  FOR SELECT
  TO authenticated
  USING (admin_user_id = auth.uid());
