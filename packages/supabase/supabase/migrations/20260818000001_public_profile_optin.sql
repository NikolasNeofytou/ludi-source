-- 20260818000001_public_profile_optin.sql
-- Consent to publish a player card at ludi.football/p/<handle>.
--
-- A public profile puts a player's name, position, city and skill on the open
-- internet, indexable, plus height and age band on some share-card crops. The
-- existing consent record covers marketing and product analytics only, so it
-- is not a lawful basis for publication. This is a separate, explicit consent.
--
--   public_profile     opt-in flag. DEFAULT FALSE, and that default is the
--                      point: publishing someone's data because they signed
--                      up is not consent. Existing rows stay private.
--   public_profile_at  when consent was given, so it can be evidenced and
--                      audited. NULL whenever public_profile is false.
--
-- Deliberately NOT in this migration: an anon SELECT policy. Nothing serves
-- /p/<handle> yet, and widening read access before the route exists would
-- expose profiles with nothing rendering them. That policy lands with the
-- route, scoped to rows where public_profile IS true and to the published
-- columns only — never the whole row.
--
-- RLS today: covered by the existing users_update_self_or_admin policy
-- (own-row, every non-role column), so a player can grant and withdraw their
-- own consent. No policy change required for the opt-in itself.

ALTER TABLE public.users
  ADD COLUMN public_profile    boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN public_profile_at timestamptz;

-- Consent and its timestamp must agree: a granted consent is always dated,
-- and a withdrawn one never is. Enforced rather than trusted to callers,
-- because "when did they agree" is the question a regulator asks.
ALTER TABLE public.users
  ADD CONSTRAINT users_public_profile_at_matches_flag
  CHECK ((public_profile IS TRUE AND public_profile_at IS NOT NULL)
      OR (public_profile IS FALSE AND public_profile_at IS NULL));

COMMENT ON COLUMN public.users.public_profile IS
  'Explicit consent to publish a player card at /p/<handle>. Default false; separate from the marketing/analytics consent record. Withdrawable at any time.';
COMMENT ON COLUMN public.users.public_profile_at IS
  'When public_profile consent was given. NULL when withdrawn. Evidence of consent under GDPR Art. 7(1).';
