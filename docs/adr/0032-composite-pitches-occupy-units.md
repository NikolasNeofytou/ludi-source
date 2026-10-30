# ADR-0032 — A composite pitch is a pitch made of others; a booking occupies units

**Status:** Accepted (reversible at a cost — dropping `pitch_components` returns every pitch to independence, but bookings taken on composites stay real)
**Date:** 2026-09-15
**Deciders:** Nikolas Neofytou
**Supersedes:** —
**Superseded by:** —

## Context

`pitches` has been "a single playable surface, many per venue"
([data-model.md](../data-model.md)) since April. The no-double-booking
invariant is an `EXCLUDE USING gist (pitch_id WITH =, time_range WITH
&&)` on `bookings`, and both booking edge functions deliberately carry
no availability check of their own — they insert and translate `23P01`
to `SLOT_UNAVAILABLE`, which is what makes a race between two checkouts
safe.

Campeone Mini Football (the third venue, 2026-09-15) has seven 5-a-side
courts and sells 7-a-sides by joining two adjacent ones. With
independent pitch rows the app would sell a 7v7 and one of its halves
for the same hour. The owner research pass had already found this
shape — "Pitch 1 is three 5-a-sides", Bookteq's facility modelling — as
the one thing generic calendars cannot express; the founder heard it
from the operator while entering the courts.

Three shapes were on the table:

1. **Nothing in the schema; list only the leaves.** 7v7s stay phone
   bookings, logged as two walk-ins. Correct, and what the fortnight
   before this version does. Not a product.
2. **A composite is a pitch made of leaf pitches; enforcement in the
   database.** Either mirror booking rows on the members (reuses the
   GiST index verbatim, but every earnings/roster/board view assumes one
   row per real booking and each would need a filter — five views, five
   chances to forget), or a trigger that checks across the pitches that
   share a unit (single-row model kept; concurrency needs a lock).
3. **A composite is a booking-time choice** ("book courts 1 and 2 as a
   7v7"): no pitch row, two booking rows, seats and price derived. Every
   surface that lists, prices, seats, verifies or pays out a pitch would
   need to learn a second kind of thing.

## Decision

**A composite pitch is an ordinary `pitches` row that is *made of* leaf
pitches at the same venue (`pitch_components`), one level deep. A
booking occupies the units under its pitch — the leaf itself, or the
composite's members — and no two active bookings may occupy the same
unit at the same time. The database enforces it.**

Concretely:

- `pitch_units(pitch)` is the physical surfaces a pitch occupies (its
  children, else itself). `pitch_blockers(pitch)` is every pitch whose
  bookings occupy a unit this pitch needs: itself, its units, and any
  composite sharing a unit. This one predicate replaces `b.pitch_id =
  p_pitch_id` in availability and in the schedule-change guards.
- `tg_bookings_composite_guard`, BEFORE INSERT/UPDATE on `bookings`,
  takes a transaction-scoped advisory lock per unit (in id order) and
  refuses an overlap with any active booking on a blocker, raising
  `23P01` — the code both edge functions already handle. The existing
  `EXCLUDE` stays and keeps covering same-pitch races through its
  index; the trigger covers the cross-pitch ones. Pitches that take part
  in no composition skip the lock entirely.
- The composite carries its **own** name, type, price, verification and
  `pitch_schedules` rows. Nothing that lists, seats, splits or pays out
  learns anything: a 7-a-side composite gets 2 GK + 12 outfield from
  `squad_slots_for` like any other 7-a-side.
- `is_pitch_bookable` is false for a composite with an inactive member.

## Consequences

### Positive
- One new table, four functions, one trigger; no change to `bookings`,
  no change to any view, no change to either booking edge function, no
  change to the mobile app's queries.
- Race-proof in the same sense as today: a 7v7 checkout and a 5v5
  checkout for the same hour serialise on the shared unit's advisory
  lock, and the loser sees the winner's committed row.
- Schedule guards inherit it: closing court 3 refuses when the 7v7 over
  3+4 has a paid booking, because `bookings_on_date(court 3)` now
  returns it.
- An owner's walk-in on a 7v7 blocks both halves with no change to the
  walk-in function.

### Negative
- The composite's hours are a third set to keep consistent with its
  halves. Accepted: the enrolment grid sets all three at once, and an
  owner who opens the 7v7 later than its halves has said something real.
- The mobile venue card counts pitch rows (`courtCount = list.length`),
  so Campeone reads as 10 courts, not 7. A cosmetic mobile change,
  parked; it needs a build.
- Advisory locks are keyed on a 64-bit hash of the unit id; a collision
  would only over-serialise, never under-serialise.

### Neutral
- Verification stays per pitch: the composite and each member are
  verified separately, by the admin, as today.

## Alternatives considered

### Mirror booking rows on the members

Reuses the existing exclusion constraint with no trigger. Rejected:
five reporting views and the open-matches board assume one row per
real booking and would each need a `WHERE NOT mirror` — and a booking
that exists twice is a lie every future reader has to know about.

### Application-level check in the edge functions

Rejected: both functions are race-free today precisely because they
carry no check and trust the constraint. Moving the invariant into
TypeScript would regress the one place the codebase gets this for free.

### Composition at booking time (option 3 above)

Rejected for this version: it makes "the pitch" two kinds of thing
everywhere. It remains the right shape if a venue ever forms
composites from *whichever* courts are free ("any two adjacent"), which
is parked in FUTURE with an owner-ask trigger.

## Follow-ups

- FUTURE: *any two adjacent* (a pool with adjacency, composed at booking
  time); mobile `courtCount` over leaves only.
- If a second level ever appears (an 11v11 over two 7v7s), express it
  as a composite of the four leaves — the physical truth — rather than
  lifting the one-level rule.
- Related: ADR-0031 (enrolment writes real rows — the composite row is
  entered on the same courts table), ADR-0027 (seats from the pitch
  type — unchanged).
