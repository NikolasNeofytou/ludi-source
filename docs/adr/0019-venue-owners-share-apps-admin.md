# ADR-0019 — Venue owners share `apps/admin` behind a second gate

**Status:** Accepted — reversible (extracting a second app later is a file move, no data migration)
**Date:** 2026-08-22
**Deciders:** Solo founder
**Supersedes:** —
**Superseded by:** —

## Context

`apps/admin` is a founder tool. Every page calls `requireAdmin()`, which
gates on `users.role = 'admin'`, and the only person who has ever held
that role is the founder. Stage 2 assumed it stayed that way: a venue
owner who wants Saturday's hours changed emails the founder, who edits
the row.

On 2026-08-22 we decided the admin becomes a **venue-owner surface as
soon as possible** rather than at Stage 4
([plans/venue-owner-admin.md](../plans/venue-owner-admin.md)). That
decision is a deliberate pull-forward — the FUTURE.md trigger (≥3 venue
partners *and* the founder spending >1h/week on schedule edits) has not
fired; there is one partner, on trial.

[FUTURE.md](../FUTURE.md) planned this as **`apps/dashboard/`**, a second
Next.js app, sized at *"~4 weeks — the single largest Stage 4 line
item"*. That sizing is what forces this decision now, because it turns
out to be an estimate of the wrong thing.

Two facts change the shape:

1. **The owner substrate already exists, unused, since 2026-04-21.**
   `venue_owners`, `is_venue_owner_of_venue()`,
   `is_venue_owner_of_pitch()` and owner write policies on `venues`,
   `pitches`, `pitch_schedules` and `pitch_schedule_overrides` all ship
   in `20260421000005_rls_policies.sql`, with pgtap coverage in
   `tests/rls/04`–`07`. **Postgres already knows what a venue owner may
   see and do.** Nothing about that is per-app.
2. **A second app adds no security boundary.** Both apps would hold the
   same anon key, talk to the same PostgREST, and be filtered by the same
   RLS policies. The isolation a separate deployment *looks* like it
   provides is cosmetic.

Constraints: solo founder; ~15h/week; `apps/admin` is not yet deployed
anywhere (M6 #43 is still open), so whatever we choose is also what we
deploy for the first time.

## Decision

**Venue owners use `apps/admin`, gated by a second server-side guard
(`requireVenueAccess()`) alongside `requireAdmin()`, on the same routes
scoped by role — not a second application.**

`requireVenueAccess()` resolves the signed-in user to a *viewer*: an
admin (scope = every venue) or an owner (scope = the venues in their
`venue_owners` rows), redirecting anyone else to `/locked`. Pages render
the same route for both audiences; what differs is the scope of the data
and which actions appear.

**RLS remains the enforcement boundary. The gate is navigation and
affordance, not security.** Every page must be written so that a bug in
`requireVenueAccess()` leaks nothing an owner could not already read via
the anon key.

## Consequences

### Positive

- One shell, one auth setup, one token source, one deploy, one place to
  fix a bug. At 15h/week that is the difference between shipping this
  quarter and not.
- **Unblocks M6 #43 instead of forking it.** There is one
  access-controlled URL to stand up, not two.
- The owner surface inherits the #41c phone-first shell for free.
- Reversible. If the owner experience earns its own product identity, the
  pages move to `apps/dashboard/` later; the RLS, the guard and the
  primitives all travel unchanged.

### Negative

- **`apps/admin` is now customer-facing.** Its internal-tool habits —
  dense tables, raw state strings like `refunded_by_admin`, Stripe
  account IDs, `take_rate_bps` — are one guard bug away from a customer.
- **The blast radius of an auth bug changes character.** Today a
  `requireAdmin()` failure shows platform data to a non-admin, who is
  almost certainly the founder. After this, the equivalent failure shows
  **venue A's data to venue B** — a customer-visible breach between two
  businesses who may know each other in a market as small as Larnaca.
  This is the real cost of the decision, and the reason the rule above is
  a rule and not a preference.
- Two audiences in one codebase invites `isAdmin && …` sprawl. Left
  unchecked it becomes a worse mess than two apps would have been.
- The in-line-CSS convention this app carried under ADR-0007 stops being
  defensible for a customer surface. (#41c already retired it.)

### Neutral

- Venue *creation* and `venue_owners` membership stay admin-only, per the
  existing `venues_admin_insert` and `venue_owners_admin_write` policies.
  A venue joins Ludi because the founder signed it; access is granted,
  not requested. That is correct for a money surface and is not revisited
  here.
- Owner sign-in is phone-OTP, so owner access is gated on live Twilio —
  an external dependency, not an architectural one.

## Alternatives considered

### `apps/dashboard/` — a separate Next.js app (the FUTURE.md plan)

Rejected. The ~4-week estimate assumed building the owner substrate as
part of the work; that substrate has existed since April. What is left is
one surface. The separation it appears to buy is illusory: both apps
share a database, an anon key and one RLS policy set, so a policy bug is
equally fatal in either topology while the duplication cost is real and
permanent. Worth revisiting if the owner experience diverges enough that
shared pages become mostly conditionals — that is the signal to extract,
and it is a file move when it comes.

### Separate `/admin/*` and `/venue/*` route trees in one app

Considered seriously; it makes the audience of each page obvious and lets
the two densities diverge freely. Rejected because it duplicates every
page for a difference that is currently *scope of rows*, which RLS
already applies — and duplicated pages drift. Revisit alongside the
extraction question above.

### Owner access through the mobile app

Rejected. Owners plausibly already have Ludi installed, but the schedule
editor is not a phone-only artefact, and adding an owner role to the
player app burdens every player's bundle with a surface almost none of
them can reach.

### Keep owner access founder-mediated (status quo)

Rejected by the 2026-08-22 decision, though it remains the honest
fallback for venue #1 if the surface is not ready — see the month plan's
manual-onboarding note. It is not acceptable by venue #3.

## Follow-ups

- **The rule needs teeth.** Any page added to `apps/admin` must state
  which audience it serves and must not rely on nav absence to hide an
  admin-only action. Worth a CONVENTIONS.md line once #41e/#41f show what
  the pattern actually looks like in practice.
- **First concrete instance of the "internal-tool habits" risk, found
  while testing #41d:** the bookings state filter shows a venue owner the
  raw enum — `refunded_by_admin`, `cancelled_no_refund`. Those are
  database values written for the founder, and one of them names an
  internal actor. Owner-facing labels are presentation work, not a guard
  bug, so it is not fixed in #41d — but it is exactly the class of thing
  this ADR predicted, appearing on the very first page shared between the
  two audiences. Fix with the owner-facing copy pass in #41e/#41h.
- **`pitches` and `venues` allow public reads** of bookable/active rows,
  so RLS alone does NOT scope those pages to a venue owner — the pages
  must filter by `viewer.venues` themselves (`scopeToViewer()`).
  Verified in #41d: without the filter, an owner sees every active
  venue's pitches. Any new page listing either table inherits this
  obligation.
- **Three owner-facing reads currently return empty rather than
  erroring** (`v_gmv_daily` has no venue dimension; owners cannot join to
  the player who booked; owner writes are unaudited). Gaps 1–3 in
  [plans/venue-owner-admin.md](../plans/venue-owner-admin.md), commits
  #41g–#41i. Until those land, the owner surface is deliberately narrower
  than the owner's needs.
- **#43's access-control choice is now a customer question.** Cloudflare
  Access with a per-person policy is priced and shaped for staff, not for
  venue owners. Decide before deploying.
- Revisit this ADR when a second city ships or when shared pages become
  mostly role conditionals, whichever comes first.
