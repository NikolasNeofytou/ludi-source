# ADR-0028 — Open matches are a discovery view over fixtures, joined through the invite capability

**Status:** Accepted — reversible while the board is a view + one flag;
expensive once anything writes rows the fixture substrate doesn't own
**Date:** 2026-08-31
**Deciders:** Solo founder (pulled C5 forward by overrule, recorded in
[plans/open-matches.md](../plans/open-matches.md))
**Supersedes:** —
**Superseded by:** —

## Context

FUTURE.md's open-matches entry carried an explicitly deferred decision:
*"decide against production evidence whether a shared booking **is** the
match row or precedes it"* — with a sketched five-table schema
(`matches`, `match_participants`, `match_results`, …) as the alternative.
That sketch predates the shared fixture. Since then the fixture substrate
shipped and survived contact with devices: rosters with typed slots
(`booking_participants`), a join RPC guarded by a capability token
(ADR-0021/0022), definer read views (`v_fixture*`), an anon-safe preview
(`fixture_preview()`), paid claims for split fixtures (C2 W6), and an
invite screen (`/f/[token]`) that handles sign-in survival, full/ended
states, and rejoin.

An open match differs from a shared fixture in exactly one respect:
**who is allowed to find it.** A shared fixture is discoverable by
whoever holds the link; an open match is discoverable by any signed-in
user. Everything after discovery — preview, join, pay, leave, rejoin —
is identical.

## Decision

The shared booking **is** the match row. An open match is a booking with
`is_open = TRUE`, surfaced through a definer view (`v_open_fixtures`)
granted to `authenticated` only, whose rows carry the fixture's
`invite_token`; the Community tab routes a tapped row to the existing
`/f/<token>` screen, so joining an open match *is* following an invite.

The view is preview-shaped: counts, never names — the same minimisation
`fixture_preview()` commits to (ADR-0012/0021), because a board row and
a forwarded link are the same kind of stranger-facing surface. Rows
appear only while the fixture is open, live
(`state IN ('collecting','paid','confirmed')` — never `pending`: an
unpaid checkout is not advertised), not started, and short at least one
player. The organiser's switch is a plain RLS-gated UPDATE on
`bookings.is_open` (column-level grant + self policy) — the
`leaveFixture` precedent: no RPC for a flip that moves no money
(ADR-0022 boundary).

## Consequences

### Positive
- The board inherits months of hardened machinery instead of
  reimplementing it: one migration, one screen, zero new money paths.
- One roster model. No booking↔match mirroring, no drift between "who
  is on the fixture" and "who is on the match".
- Listing is consent-based and default-off, and un-listing is
  instant (the view predicate re-evaluates per read).

### Negative
- **Opening a fixture publishes its capability.** Any signed-in user
  can read `invite_token` from the board while the row is listed, and
  closing the listing does not un-know the token for whoever already
  read it — exactly as un-sharing a WhatsApp link never revokes it.
  The token stays rotatable (ADR-0021) and every join still passes the
  RPC's own full/started/cancelled guards, so the blast radius of a
  harvested token is "could join while a spot was open", which is the
  feature. Revisit only if abuse appears (see Follow-ups).
- `is_open` is one more column the five-table sketch would not have had
  on `bookings`; if match results/ratings ever arrive, they must attach
  to bookings or reverse this ADR.

### Neutral
- `v_open_fixtures` is the third restatement site for the
  spots-open subselects (after `v_fixture` and `fixture_preview`). A
  shared SQL function would DRY it; three call sites is below the
  threshold where that indirection pays.

## Alternatives considered

### The sketched `matches` table family

A `matches` row created from (or instead of) the booking, with its own
participants. Rejected on production evidence: it duplicates the roster
model the fixture already proved out, and every real requirement so far
(rosters, gaps, money, invites) landed on the booking. Results and
ratings — the parts of the sketch that genuinely aren't booking-shaped —
stay parked with their own triggers and can still get their own tables
later without unwinding this decision.

### Board rows without the token, joined via a new `join_open_fixture(booking_id)` RPC

Keeps tokens un-harvestable, but forks the join path in two: the new RPC
must re-implement (and keep in lock-step with) `join_fixture`'s guards
*and* the claim-share money door for split fixtures — the exact
two-read-paths drift `fixture.ts` warns about. Paying that to protect a
capability whose publication is the feature's definition is backwards.

### Anon-readable board

Grant the view to `anon` like `fixture_preview()`. Nothing breaks, but
nothing needs it either — the board renders inside the signed-in app,
and the web funnel already has its surface (`/f/<token>`, ADR-0025).
Withholding the blanket grant keeps scraping the whole board at least
one credential more expensive. Cheap to widen later.

## Follow-ups

- If token harvesting is ever observed (joins from accounts that never
  viewed the board, mass reads), add rotation-on-close: flipping
  `is_open` off rotates `invite_token`. Deliberately not built now —
  it would also sever the organiser's own previously-shared WhatsApp
  links, which is a product decision to make with evidence.
- Results / scorers / ratings keep their FUTURE.md entry and triggers.
- Related: ADR-0021 (capability), ADR-0022 (RPC boundary), ADR-0025
  (web fallback), [plans/open-matches.md](../plans/open-matches.md).
