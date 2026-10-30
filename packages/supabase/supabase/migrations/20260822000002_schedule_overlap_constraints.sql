-- 20260822000002_schedule_overlap_constraints.sql
-- M6 #41b — make overlapping schedule windows impossible at the database.
-- Third defect from docs/spikes/schedule-derivation-defects.md; #41a fixed
-- the other two.
--
-- ────────────────────────────────────────────────────────────────────
-- Why this is a constraint and not a validation in the editor
-- ────────────────────────────────────────────────────────────────────
-- pitch_schedules deliberately allows several rows per (pitch,
-- day_of_week) so a pitch can open "09:00-13:00 and 17:00-23:00" — the
-- UNIQUE is relaxed for exactly this. Nothing stopped two of those rows
-- from OVERLAPPING, and get_available_slots explodes each window
-- independently, so "09:00-13:00" plus "12:00-18:00" emits the 12:00
-- slot twice. Two players can then hold what looks like two different
-- slots for one hour on one pitch.
--
-- Verified 2026-08-22 that the overlap was accepted with no complaint.
-- The #41 schedule editor puts an "add another window" button in front
-- of a venue owner, which makes this a first-mis-tap problem rather than
-- a theoretical one.
--
-- It belongs in the database because the editor is not the only writer:
-- the beta bootstrap snippets, any future import, and psql sessions all
-- write these tables. A TypeScript guard protects one of those paths.
--
-- Range representation: Postgres ships no `timerange`, so the windows
-- are projected onto a fixed arbitrary date (2000-01-01) and compared as
-- `tsrange`. Half-open '[)' bounds mean an abutting pair like
-- 09:00-13:00 and 13:00-17:00 is legal — they touch, they don't overlap.
-- btree_gist (enabled in 20260421000001) supplies the `=` operator class
-- for the scalar columns; the range comparison is native GiST.
--
-- Session: 2026-08-22 M6 #41b.

-- ────────────────────────────────────────────────────────────────────
-- Weekly template
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.pitch_schedules
  ADD CONSTRAINT pitch_schedules_no_overlap
  EXCLUDE USING gist (
    pitch_id WITH =,
    day_of_week WITH =,
    tsrange(
      date '2000-01-01' + opens_at,
      date '2000-01-01' + closes_at,
      '[)'
    ) WITH &&
  );

COMMENT ON CONSTRAINT pitch_schedules_no_overlap ON public.pitch_schedules IS
  'Split windows on one day are allowed; overlapping ones are not. '
  'Overlap would make get_available_slots emit the shared hours twice.';

-- ────────────────────────────────────────────────────────────────────
-- Per-date exceptions
-- ────────────────────────────────────────────────────────────────────
-- #41a made an override REPLACE its date's weekly windows rather than
-- amend them, and noted that UNIQUE (pitch_id, override_date) was the
-- only thing still preventing a non-contiguous exception day ("open
-- 09:00-11:00 and 19:00-21:00 on the 15th"). The derivation is already
-- row-set-shaped, so relaxing it is the whole change.
--
-- The UNIQUE is dropped and the exclusion constraint added in ONE
-- migration on purpose: there is never a moment where overlapping
-- override rows are insertable.
--
-- A closure is modelled as covering the whole day, so one constraint
-- carries three rules at once:
--   * two open windows on a date may not overlap;
--   * a closure cannot coexist with an open window on the same date
--     (they would contradict each other);
--   * a date cannot have two closures — which is what the old UNIQUE
--     was really protecting.
ALTER TABLE public.pitch_schedule_overrides
  DROP CONSTRAINT pitch_schedule_overrides_pitch_id_override_date_key;

ALTER TABLE public.pitch_schedule_overrides
  ADD CONSTRAINT pitch_schedule_overrides_no_overlap
  EXCLUDE USING gist (
    pitch_id WITH =,
    override_date WITH =,
    (CASE
      WHEN is_closed
        THEN tsrange(date '2000-01-01', date '2000-01-02', '[)')
      ELSE tsrange(
        date '2000-01-01' + opens_at,
        date '2000-01-01' + closes_at,
        '[)'
      )
    END) WITH &&
  );

COMMENT ON CONSTRAINT pitch_schedule_overrides_no_overlap
  ON public.pitch_schedule_overrides IS
  'Replaces UNIQUE (pitch_id, override_date). A closure occupies the '
  'whole day, so it excludes every other row for that date; open '
  'windows on one date may coexist as long as they do not overlap.';

-- Note for anyone re-running snippets/beta-venue-bootstrap.sql: it has no
-- DELETE before its INSERT, so a second run used to silently double every
-- window. It now fails loudly on this constraint instead, which is the
-- better outcome — delete the pitch's rows first, as the snippet's own
-- commented-out DELETE shows.
