# Spike — does `get_available_slots` survive a schedule editor?

**Date:** 2026-08-22
**Verdict:** ❌ **FAIL — three defects reproduced.** Fix the RPC and add
the overlap constraint (commits 41a, 41b) *before* the schedule editor
(41f) exists to create the rows that expose them.
**Update 2026-08-22:** defects B and C fixed by 41a
(`20260822000001_slots_override_precedence.sql`) — re-running the repro
below now returns each slot once and opens the off-schedule Sunday.
Defect **D** is fixed by 41b
(`20260822000002_schedule_overlap_constraints.sql`), which adds a
`btree_gist` EXCLUDE to both `pitch_schedules` and
`pitch_schedule_overrides`. **All four cases in the table below now
behave as the Expected column says.** Constraint coverage lives in
`packages/supabase/tests/schedule_constraints.sql`.
**Risk tested:** *"M6 #41's schedule editor is sized L because 'a
schedule UI that produces a subtly wrong row produces a double-booked
pitch'. Is `get_available_slots` actually correct on the row shapes an
editor would produce?"*

## Why this needed a spike

`pitch_schedules` deliberately allows several rows per
`(pitch, day_of_week)` so a pitch can open "09–13 and 17–23" — the
`UNIQUE` is relaxed for exactly this. **No pitch in the seed or the
beta bootstrap has split windows**, so every existing test and every
manual check has only ever exercised the one-row-per-day case. A
schedule editor with an "add another window" button makes split
windows the normal case on day one.

## Method

One throwaway venue + pitch, split Saturday (`09:00–13:00` and
`17:00–23:00`), against the local stack (`supabase_db_ludi`, port
64322). Whole thing inside `BEGIN … ROLLBACK` — nothing persisted.

## Results

| # | Case | Expected | Actual |
|---|---|---|---|
| A | Split windows, no override | 10 distinct slots | ✅ 10 distinct |
| B | Split windows + one `10:00–12:00` override on that date | 2 slots | ❌ **2 slots, each returned twice** |
| C | Override `10:00–14:00` on a Sunday with no weekly row | 4 slots | ❌ **0 slots — silently ignored** |
| D | Insert `09:00–13:00` and `12:00–18:00` on the same `(pitch, dow)` | rejected | ❌ **accepted, no constraint** |

### Why B happens

`day_schedules` LEFT JOINs the override onto **every** matching
schedule row for the date and `COALESCE`s the hours:

```sql
COALESCE(o.opens_at,  s.opens_at)  AS opens_at,
COALESCE(o.closes_at, s.closes_at) AS closes_at,
```

Both Saturday rows collapse to `10:00–12:00`, so the LATERAL
`generate_series` runs twice over the same window. `UNIQUE (pitch_id,
override_date)` also means "close only the morning window" cannot be
expressed at all — one override per date, applied to every window.

### Why C happens

The same CTE uses `JOIN public.pitch_schedules` — an **inner** join.
An override for a date whose `day_of_week` has no weekly row matches
nothing and vanishes. "We're opening specially this Sunday" is
currently impossible, and fails silently rather than erroring.

### Why D matters

D is the input that makes B reachable without any override at all: two
overlapping weekly windows emit the overlapping slots twice, from the
plain `slot_starts` explode.

## Repro

Run against the local stack. Self-contained, rolls back.

```sql
BEGIN;

INSERT INTO public.venues (id, name, address, city_id, coords)
SELECT '00000000-0000-0000-0000-0000000000aa', 'GAP6 venue', 'x', c.id,
       ST_SetSRID(ST_MakePoint(33.6, 34.9), 4326)::geography
FROM public.cities c LIMIT 1;

INSERT INTO public.pitches (id, venue_id, name, type, surface, price_per_hour_cents)
VALUES ('00000000-0000-0000-0000-0000000000bb',
        '00000000-0000-0000-0000-0000000000aa',
        'GAP6 pitch', '5-a-side', 'turf', 3500);

INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at, slot_duration_minutes)
VALUES ('00000000-0000-0000-0000-0000000000bb', 6, '09:00', '13:00', 60),
       ('00000000-0000-0000-0000-0000000000bb', 6, '17:00', '23:00', 60);

-- B: one override, applied to both windows.
INSERT INTO public.pitch_schedule_overrides (pitch_id, override_date, is_closed, opens_at, closes_at)
VALUES ('00000000-0000-0000-0000-0000000000bb', DATE '2026-08-29', false, '10:00', '12:00');

SELECT starts_at AT TIME ZONE 'Europe/Nicosia' AS local_start, count(*) AS times_returned
FROM public.get_available_slots('00000000-0000-0000-0000-0000000000bb'::uuid,
                                DATE '2026-08-29', DATE '2026-08-29')
GROUP BY 1 ORDER BY 1;   -- each row: times_returned = 2

-- C: override on a dow with no weekly row.
INSERT INTO public.pitch_schedule_overrides (pitch_id, override_date, is_closed, opens_at, closes_at)
VALUES ('00000000-0000-0000-0000-0000000000bb', DATE '2026-08-30', false, '10:00', '14:00');

SELECT count(*) FROM public.get_available_slots('00000000-0000-0000-0000-0000000000bb'::uuid,
                                                DATE '2026-08-30', DATE '2026-08-30');  -- 0

-- D: overlapping weekly windows accepted.
INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at, slot_duration_minutes)
VALUES ('00000000-0000-0000-0000-0000000000bb', 3, '09:00', '13:00', 60),
       ('00000000-0000-0000-0000-0000000000bb', 3, '12:00', '18:00', 60);

ROLLBACK;
```

## Consequences for the plan

- **41a** — rewrite `day_schedules` so an override bounds each window
  rather than replacing it (intersect, don't COALESCE), and change the
  inner join to a FULL/LEFT shape so an override can open an otherwise
  unscheduled day. Cases A–C above become the pgtap regression suite.
- **41b** — `btree_gist` exclusion constraint on
  `(pitch_id WITH =, day_of_week WITH =, timerange WITH &&)`, killing D
  at the database rather than in TypeScript.
- **Open design question surfaced by B — now settled.** 41a chose "an
  override replaces the day"; 41b then dropped `UNIQUE (pitch_id,
  override_date)` in favour of an exclusion constraint, so a date can
  carry several non-overlapping windows after all. Both halves of the
  original question are answered: replacement is the product rule, and
  per-window exceptions are expressible.

## Not tested here

- Whether closing a window cancels the bookings inside it. It does not
  — `get_available_slots` subtracts bookings from availability, never
  the reverse — but that is a missing feature, not a defect in this
  function. Gap 7 in
  [plans/venue-owner-admin.md](../plans/venue-owner-admin.md).
- DST boundaries with split windows. The tz handling looked correct on
  inspection; not exercised.
