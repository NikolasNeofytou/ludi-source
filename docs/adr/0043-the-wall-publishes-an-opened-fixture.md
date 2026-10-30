# ADR-0043 — The venue's screen carries an opened fixture's invite

**Status:** Accepted
**Date:** 2026-10-13
**Deciders:** Nikolas Neofytou (founder)
**Supersedes:** —
**Superseded by:** —

## Context

The lobby screen (`/tv/<token>`, [cfa-grassroots-saturday.md](../plans/cfa-grassroots-saturday.md))
has been on Campeone's 60-inch wall since 2026-09-19. It shows every booking
as *booked*, never who, through `public_venue_schedule(token)`, which is
granted to `anon`: the token is the only thing between the internet and a
venue's day.

The community board (ADR-0028) lists fixtures whose organiser opened them,
and publishes each one's invite token to **signed-in** users only. ADR-0028
withheld `anon` on purpose: "keeping whole-board scraping one credential
more expensive". The anon funnel for a single fixture is the invite link
itself, `/f/<token>`, read through `fixture_preview()`.

The bet in [FUTURE.md](../FUTURE.md) *The venue's wall* is that the people
standing in a venue at 19:40 are the likeliest to fill an open seat there at
21:00. The screen is anon. Putting a join QR on it means the screen's
function hands an invite token to anyone who holds the screen's link.

## Decision

`public_venue_schedule` carries, on each item, the open-seat counts and the
invite token **only where `v_open_fixtures` would list the same fixture**:
organiser opened it, the booking is live (`collecting`/`paid`/`confirmed`),
it has not kicked off, and it is short at least one player. Every other item
reads exactly as it did. The screen renders a QR to
`https://ludi.football/f/<invite_token>`, the same link a WhatsApp forward
carries.

The organiser's `is_open` is already consent to strangers joining. The
screen widens *which* strangers from "anyone signed in to Ludi" to "anyone in
this venue's lobby, or holding this venue's screen link" — one venue's open
games, not the island's.

## Consequences

### Positive
- A walk-in group at the counter can see and join tonight's short game
  without the app's Community tab.
- No new table, no new grant: one function re-stated; the predicate is the
  board's, so the two can never disagree about what is open.
- Closing the fixture takes it off the wall within the screen's one-minute
  refresh.

### Negative
- A holder of a venue's screen link can read that venue's open invite tokens
  without signing in. Rotating the screen link (`Νέος σύνδεσμος`) or closing
  the fixture is the revoker, the same posture as un-sharing an invite.
- Counts on a public page are slightly more than before: "court 3, 21:00,
  one keeper missing" was only visible to signed-in users.

### Neutral
- Names never appear: the same minimisation as the board and
  `fixture_preview()`; the pgtap suite asserts no user id reaches the wall.

## Alternatives considered

### A per-screen short link that resolves to the invite server-side

A `/w/<screen>/<n>` redirect that hides the invite token. It hides nothing:
the redirect lands on `/f/<token>`. Rejected as indirection without privacy.

### A separate "show on the venue's screen" switch for the organiser

A second consent. Rejected for now: the board and the wall are the same
audience in kind (strangers who would play), and a second switch nobody
knows about would leave the wall empty. Revisit if an organiser asks for his
game off the screen but on the board.

## Follow-ups

- The monthly, team-based venue table on the same screen waits on a
  competition existing ([fixtures-and-scores.md](../plans/fixtures-and-scores.md), PR #247).
- ADR-0028 is unchanged; this ADR names the one surface where its anon rule
  is relaxed and why.
