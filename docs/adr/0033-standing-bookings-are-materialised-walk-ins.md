# ADR-0033 — A standing booking is a series whose instances are ordinary walk-ins

**Status:** Accepted (reversible — dropping the series tables leaves the instances as plain walk-ins, which is what they are)
**Date:** 2026-09-15
**Deciders:** Nikolas Neofytou
**Supersedes:** —
**Superseded by:** —

## Context

Real football venues' books are mostly standing bookings — the academy
on courts 1–3 every weekday afternoon, the same team every Tuesday at
20:00 — and Ludi's walk-in was one-off, so a regular group had to be
logged every week or not at all
([plans/owner-v2.md](../plans/owner-v2.md) finding 1, slice B). On
2026-09-15 Campeone's owner asked for exactly this: events "we know for
sure will be there", academies, certain courts, before 18:00.

Two ways to represent recurrence:

1. **Virtual** — a rule that every reader expands at read time:
   availability, the exclusion constraint, the composite guard, the
   calendar, the day sheet, Today, Earnings, the schedule-change guards.
   Nine places to teach, and the constraint cannot see a rule at all.
2. **Materialised** — the rule is stored once, and its instances are
   written as real booking rows ahead of time. Every reader already
   understands a booking row.

The second is the same shape the last three versions took (ADR-0028,
0031, 0032): make it real rows, so nothing downstream learns anything.

## Decision

**A `booking_series` (venue, courts, weekdays, kick-off, duration,
name, `starts_on`, optional `ends_on`) whose instances are ordinary
walk-in bookings carrying `series_id`, materialised eight weeks ahead
by a nightly job and immediately on creation.**

- An instance is a walk-in in every respect: `origin = 'walk_in'`, no
  fee, seats nobody, the venue's own rate for its duration, an offline
  payments row — the same columns `create-walk-in-booking` writes.
  `bookings_series_is_walk_in` makes that a constraint.
- **Skipping a week is un-booking the instance.** The cancelled row
  stays, and the materialiser never re-creates a (series, court, day)
  that has a row in any state — the cancelled row *is* the memory.
- **A collision skips one instance and records why**
  (`booking_series_skips`), never fails the run. Exclusion and the
  composite guard raise `23P01`; the materialiser catches it per
  instance.
- **Ending** sets `ends_on` and cancels the instances after it, with
  their offline payments; earlier instances stay as history.
- Creation and ending are `SECURITY DEFINER` RPCs gated on venue
  ownership, because owners cannot write `bookings` directly; the
  nightly all-series run is for the scheduler only
  (`is_privileged_writer()`).

## Consequences

### Positive
- Zero change to any reader. The app cannot sell the academy's hours
  because a booking row holds them; closing a day over one is refused
  by the guard that already exists; the day sheet prints them because
  they are walk-ins.
- The 7v7-over-two-halves rule holds for series (test 15 in
  `32_booking_series.sql`).
- The audit trail reads `series_created` / `series_ended` plus, per
  instance, nothing new — it is a walk-in.

### Negative
- Eight weeks of rows per court per weekday. Campeone's academy on three
  courts five days a week is ~120 rows at any time; trivial, but a
  venue with many series will have many rows — that is what the book is.
- The horizon is a policy: a booking beyond eight weeks is not yet held.
  An app booking taken in week nine collides when the series reaches
  it, becomes a skip, and the owner sees it — acceptable, and honest.
- Editing a series (time, courts) is "end it and make another" in this
  version.

### Neutral
- `weekdays` is an array on the series, not one row per weekday: the
  owner thinks "Mon–Fri", and the materialiser expands.
- The instance's `user_id` is the series creator, as the walk-in's is
  the acting owner.

## Alternatives considered

### A recurrence rule expanded at read time

Rejected: every reader changes, and the exclusion constraint — the one
thing that makes double booking impossible — cannot see a rule.

### Materialise the whole season at once

Simpler mentally; rejected for the same reason the horizon exists at
all: a season is 40 weeks of rows created before anyone knows the
academy will still be there, and every one of them blocks the app.
Eight weeks rolling is what the owner would write on paper.

### One series row per (court, weekday)

Cleaner relationally, worse for the human: "courts 1–3, Mon–Fri" is one
thought and one form. The array keeps it one row.

## Follow-ups

- Editing a series in place (change the time, add a court) once an owner
  asks — today it is end + create.
- Surfacing a series' skips on Today ("the academy's Tuesday is taken
  by LAR-2026-0042"), if the list on the Standing page is not enough.
- Related: ADR-0032 (composite guard applies to instances), ADR-0023
  (the walk-in name is what the roster shows).
