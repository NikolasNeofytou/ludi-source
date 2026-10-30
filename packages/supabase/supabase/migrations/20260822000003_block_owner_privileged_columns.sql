-- 20260822000003_block_owner_privileged_columns.sql
-- Stop a venue owner from editing the columns that decide what Ludi earns,
-- whether they can take money, and whether the platform has vetted them.
--
-- ────────────────────────────────────────────────────────────────────
-- The hole
-- ────────────────────────────────────────────────────────────────────
-- Postgres RLS is ROW-level, not column-level. `venues_owner_or_admin_update`
-- and `pitches_owner_or_admin_update` (20260421000005) decide *which rows* a
-- venue owner may update; neither can say *which columns*. So a signed-in
-- owner, hitting PostgREST directly with the public anon key and their own
-- JWT, could until now run all three of these successfully:
--
--   UPDATE venues SET take_rate_bps = 0            -- set their own commission
--   UPDATE venues SET stripe_account_status='active' -- skip Connect KYC
--   UPDATE pitches SET is_verified = true          -- self-verify, skip #18
--
-- Verified against the local stack on 2026-08-22: all three returned
-- "1 row updated".
--
-- The second is the sharpest. `is_pitch_bookable()` gates on
-- `venues.stripe_account_status = 'active'`, so flipping it by hand makes a
-- venue's pitches publicly bookable without a Stripe account that can
-- actually receive a payout — players would pay for slots at a venue that
-- cannot be paid.
--
-- ────────────────────────────────────────────────────────────────────
-- Why it matters NOW
-- ────────────────────────────────────────────────────────────────────
-- These policies have been in `main` since 2026-04-21 and the exposure was
-- nil, because no venue owner had credentials: `apps/admin` was founder-only
-- and the mobile app never authenticates anyone as an owner.
--
-- M6 #41d (ADR-0019) gives venue owners a login. That turns three
-- theoretical holes into reachable ones, so this lands before the #41e forms
-- that would otherwise be a UI over an already-open door.
--
-- ────────────────────────────────────────────────────────────────────
-- The fix
-- ────────────────────────────────────────────────────────────────────
-- A BEFORE UPDATE trigger per table, matching the house pattern already used
-- by `tg_users_block_role_change` for exactly this reason (a player must not
-- be able to `UPDATE users SET role='admin'`). Column-level GRANTs were the
-- alternative and are rejected below.
--
-- Session: 2026-08-22 M6 #41e prerequisite.

-- ────────────────────────────────────────────────────────────────────
-- Who is allowed past the guard
-- ────────────────────────────────────────────────────────────────────
-- Not just admins. Two server-side writers must keep working:
--
--   * the stripe-webhook Edge Function, which is the ONLY legitimate writer
--     of `venues.stripe_account_status` (`account.updated`);
--   * `tg_venues_cascade_stripe_status`, which fires AFTER that update and
--     sets `pitches.is_verified = false` when a venue leaves active — it
--     runs as whoever performed the update, i.e. service_role.
--
-- Both connect as `service_role`, which has no `auth.uid()`, so `is_admin()`
-- is false for them. Checking the effective role is what keeps the payment
-- path alive. `postgres`/`supabase_admin` are here so migrations, psql and
-- the seed keep working.
CREATE OR REPLACE FUNCTION public.is_privileged_writer()
RETURNS boolean
LANGUAGE sql STABLE
SECURITY INVOKER
AS $$
  SELECT current_user IN ('postgres', 'service_role', 'supabase_admin')
      OR public.is_admin();
$$;

COMMENT ON FUNCTION public.is_privileged_writer() IS
  'True for the platform admin and for server-side writers (service_role, '
  'postgres). Used by the column guards below — service_role has no '
  'auth.uid(), so is_admin() alone would lock out the Stripe webhook.';

-- ────────────────────────────────────────────────────────────────────
-- venues
-- ────────────────────────────────────────────────────────────────────
-- Owner-editable: name, address, coords, contact_phone, contact_email.
-- Guarded: everything that is a commercial term, a payment credential, or a
-- platform decision.
--
-- `is_active` is guarded deliberately. Taking a venue offline hides every
-- pitch in it from Discover, which is a support conversation and not a
-- self-serve toggle while onboarding is founder-mediated. Revisit when
-- owners have a reason to pause themselves.
CREATE OR REPLACE FUNCTION public.tg_venues_block_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  IF NEW.city_id               IS DISTINCT FROM OLD.city_id
  OR NEW.take_rate_bps         IS DISTINCT FROM OLD.take_rate_bps
  OR NEW.stripe_account_id     IS DISTINCT FROM OLD.stripe_account_id
  OR NEW.stripe_account_status IS DISTINCT FROM OLD.stripe_account_status
  OR NEW.cancellation_policy   IS DISTINCT FROM OLD.cancellation_policy
  OR NEW.is_active             IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION
      'venue owners may not change commercial, payment or platform fields'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_venues_block_privileged_columns
  BEFORE UPDATE ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.tg_venues_block_privileged_columns();

COMMENT ON FUNCTION public.tg_venues_block_privileged_columns() IS
  'RLS is row-level; this is the column-level half. A venue owner may edit '
  'name/address/coords/contacts and nothing that decides the take rate, the '
  'payout account, the refund policy or whether the venue is live.';

-- ────────────────────────────────────────────────────────────────────
-- pitches
-- ────────────────────────────────────────────────────────────────────
-- Owner-editable: name, type, surface, price_per_hour_cents, amenities,
-- hero_image_url. A pitch's price is genuinely the owner's to set.
--
-- Guarded: `venue_id` (moving a pitch between venues is a data-integrity
-- act, and would let an owner adopt someone else's pitch), `is_verified`
-- (the platform trust gate that the admin-toggle-pitch Edge Function exists
-- to control, per M3 #18) and `is_active` (same audit path).
CREATE OR REPLACE FUNCTION public.tg_pitches_block_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  IF NEW.venue_id     IS DISTINCT FROM OLD.venue_id
  OR NEW.is_verified  IS DISTINCT FROM OLD.is_verified
  OR NEW.is_active    IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION
      'venue owners may not change pitch verification, activation or venue'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_pitches_block_privileged_columns
  BEFORE UPDATE ON public.pitches
  FOR EACH ROW EXECUTE FUNCTION public.tg_pitches_block_privileged_columns();

COMMENT ON FUNCTION public.tg_pitches_block_privileged_columns() IS
  'RLS is row-level; this is the column-level half. A venue owner may edit '
  'a pitch name, type, surface, price and amenities — not its verification, '
  'its activation, or which venue it belongs to.';

-- ────────────────────────────────────────────────────────────────────
-- INSERT is covered too
-- ────────────────────────────────────────────────────────────────────
-- `pitches_owner_or_admin_insert` lets an owner create a pitch in their own
-- venue, and the column defaults (is_verified = false, is_active = true) are
-- the safe ones — but nothing stopped an owner from passing
-- `is_verified = true` in the INSERT itself, which is the same escalation by
-- another door.
CREATE OR REPLACE FUNCTION public.tg_pitches_force_unverified_on_insert()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  -- Silently normalise rather than raise: a form that omits the field
  -- shouldn't error, and an owner asking for verification isn't hostile —
  -- it just isn't theirs to grant.
  NEW.is_verified := FALSE;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_pitches_force_unverified_on_insert
  BEFORE INSERT ON public.pitches
  FOR EACH ROW EXECUTE FUNCTION public.tg_pitches_force_unverified_on_insert();

COMMENT ON FUNCTION public.tg_pitches_force_unverified_on_insert() IS
  'A pitch created by a venue owner is always unverified. Verification is a '
  'platform decision made through admin-toggle-pitch (M3 #18).';
