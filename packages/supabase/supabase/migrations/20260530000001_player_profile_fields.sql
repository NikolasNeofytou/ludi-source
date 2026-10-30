-- 20260530000001_player_profile_fields.sql
-- Player Card profile substrate (ADR-0012): self-declared football
-- attributes on public.users. All columns are NULLABLE/optional — the
-- player card must render complete without them (no zeros, no breakage).
-- No new tables, no Storage, no child structures.
--   height_cm       self-declared height in centimetres
--   age_band        coarse age bracket — NOT a birth date (GDPR
--                   data-minimisation per ADR-0012)
--   play_frequency  how often the player plays (activity/commitment
--                   signal; reliability proxy before match history exists)
--
-- RLS: these are covered by the existing users_update_self_or_admin
-- policy (own-row, every non-role column). No policy change required.
-- Stored as text + CHECK rather than a Postgres enum, matching the house
-- style of preferred_foot / preferred_locale (CHECK lists alter cleanly;
-- enums do not).

ALTER TABLE public.users
  ADD COLUMN height_cm      smallint CHECK (height_cm BETWEEN 120 AND 230),
  ADD COLUMN age_band       text CHECK (age_band IN ('u18','18_25','26_35','36_45','45_plus')),
  ADD COLUMN play_frequency text CHECK (play_frequency IN ('casual','weekly','often'));

COMMENT ON COLUMN public.users.height_cm      IS 'Self-declared height (cm). Optional. Nulled on GDPR erasure (quasi-identifying).';
COMMENT ON COLUMN public.users.age_band       IS 'Coarse age bracket, not a birth date (GDPR data-minimisation, ADR-0012). Optional. Nulled on erasure.';
COMMENT ON COLUMN public.users.play_frequency IS 'Self-declared play frequency: casual | weekly | often. Activity/commitment signal; reliability proxy pre-match-history.';
