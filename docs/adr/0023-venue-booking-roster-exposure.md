# ADR-0023 — Venue booking roster: what the owner may see, and when

**Status:** Accepted — reversible (views can be narrowed without data loss)
**Date:** 2026-08-28
**Deciders:** Solo founder
**Supersedes:** —
**Superseded by:** —

## Context

41g/41h ([plans/venue-owner-admin.md](../plans/venue-owner-admin.md))
give venue owners their first read of *people* data: "who is turning up
tonight?". Today `bookings_select_self_or_owner_or_admin` hands the
owner the booking row, but `users_select_self_or_admin` blocks the join
to the player, so the owner sees *"19:00 — booked"* and nothing else.
Closing that gap means deliberately exposing player data across the
player↔venue boundary — a privacy decision, not a query fix.

The posture already set elsewhere constrains the shape:

- **ADR-0012**: collect and expose the minimum, deliberately.
- **ADR-0013 / the `v_fixture_roster` shape**: cross-boundary reads go
  through a dedicated definer-rights view that excludes PII *by
  construction* and carries its own caller predicate — never through a
  widened base-table policy.
- **ADR-0018**: anonymised players keep their rows; name columns are
  nulled at the source, so views show what they should.

The tension: teammates see only `first_name + handle` (ADR-0013), but a
venue owner is *fulfilling a paid, in-person service* — a booking sheet
that cannot identify the payer, or reach them when the pitch floods an
hour before kickoff, fails at the venue's actual job.

## Decision

**A definer-rights view `v_venue_booking_roster`, scoped to
`is_venue_owner_of_pitch(...) OR is_admin()`, exposing per booking:
the organiser's name (first + last), the booking code, timing, state,
party size — and the organiser's phone ONLY inside an operational
window around kickoff (24 h before `starts_at` until `ends_at`), and
only for money-moved states (`paid`, `confirmed`).**

Excluded by construction, permanently: email, `stripe_customer_id`,
`platform_fee_cents` (Ludi's cut of the owner's own booking is Ludi's
business), booking `notes`, and every profile attribute (position,
skill, age band — none of it is the venue's concern).

Why each inclusion clears the ADR-0012 bar:

- **Full name** — more than teammates get, justified by the different
  relationship: the owner is a service provider identifying a paying
  customer at the door, the norm for every booking system the venue
  already uses. Anonymised players (ADR-0018) appear nulled, correctly.
- **Booking code** — already the player-facing receipt identifier;
  it is the disambiguator when two Andreases book the same evening.
- **Party size** (declared slots + confirmed participant count) —
  operational capacity data, not personal data.
- **Phone, windowed** — the sharpest item, so it gets the sharpest
  limit. Outside the window the column is NULL: an owner can never
  harvest their customer list's numbers by scrolling history, but can
  call tonight's 19:00 when the floodlights fail. The window is
  enforced in the view (`now()` predicate), not in the UI, so no
  client bug can widen it. Phone lives only in `auth.users`; the
  definer view is the sole bridge, mirroring the
  `admin_lookup_user_by_phone` precedent (20260827000001).

## Consequences

### Positive
- The owner's #1 question ("who is turning up tonight?") is answerable
  without widening any base-table policy — `users` and `payments` stay
  closed to owners.
- The phone window turns a standing PII grant into a transient
  operational one; GDPR story stays clean (purpose-limited, minimal).
- Same ADR-0013 shape as `v_fixture_roster` — one pattern to audit.

### Negative
- **The owner cannot contact a player outside the window** (e.g. to
  discuss a next-week reschedule). Accepted: that conversation routes
  through the platform (or the founder) for now; FUTURE lists owner
  messaging if it becomes real.
- `now()`-dependent visibility is untestable with frozen fixtures
  alone — tests must insert near-kickoff rows inside their
  transaction. Accepted, done in the pgtap file.

### Neutral
- The 24 h window constant is a judgement call, encoded in one place
  (the view). Tuning it is a `CREATE OR REPLACE VIEW`, not a migration
  of data.

## Alternatives considered

### Widen `users` SELECT with an `is_venue_owner_of_booking_user` branch
Rejected — the ADR-0013 failure mode: every column `users` grows is
silently granted to owners forever.

### First name only, no phone
Maximal minimisation. Rejected: fails the venue's real job — the
flooded-pitch call at 18:00 is the single scenario owners cite first,
and pushing it through the founder reintroduces the mediation this
whole surface exists to remove.

### Phone always visible for the owner's own bookings
Simpler view. Rejected: lets any owner accumulate customers' numbers
indefinitely — a customer-list harvest Ludi would be liable for, with
no operational need past the slot itself.

## Follow-ups

- When `anonymize-me` (#31) ships, verify the roster view shows nulled
  names for anonymised players (it should by construction; assert it).
- If owner messaging ever lands (FUTURE), revisit whether the phone
  window can shrink to zero.
