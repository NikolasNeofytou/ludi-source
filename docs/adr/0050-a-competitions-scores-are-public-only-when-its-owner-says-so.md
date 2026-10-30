# ADR-0050 — A competition's scores are public only when its owner says so, and a CFA grassroots competition never has a table

**Status:** Accepted
**Date:** 2026-10-15
**Deciders:** Nikolas Neofytou (founder)
**Supersedes:** —
**Superseded by:** —

## Context

The first venue hosts the CFA's grassroots Saturdays and will run its own
leagues. Since September the CFA round is loaded onto courts as walk-in
bookings with a `cfa_matches` row carrying what the programme prints
(kick-off, category, home, away), and the lobby TV shows it
([cfa-grassroots-saturday.md](../plans/cfa-grassroots-saturday.md)). The
founder then asked for fixtures and scores in the app — for venue
competitions *and* for the CFA Saturdays, entered by the owner
([fixtures-and-scores.md](../plans/fixtures-and-scores.md)).

Two facts shape the model:

- **The CFA's own rules.** For every grassroots category the 2025–26
  rules say *«χωρίς Βαθμολογίες και Προκρίσεις»* — no standings, no
  qualification — and for several, no results at all. A host venue that
  publishes children's scores and tables under the CFA's name contradicts
  the organiser it depends on.
- **One shape for two things.** A venue league and a CFA Saturday are the
  same objects — a competition, its teams, its matches on courts — with
  different publication rules. Two models would mean two loaders, two
  screens and two TV paths.

## Decision

**One model — `competitions`, `competition_teams`, `matches` — for every
competition a venue hosts, and two rules written into it:**

1. **`scores_public` is the competition's switch.** It defaults *off*
   for `cfa_grassroots` and *on* for a venue's league or tournament; the
   owner flips it in one tap. Results are always recorded; they are shown
   in the app, on the TV and on the venue's page only where the switch
   says so.
2. **A CFA grassroots competition never has a table.** `has_table` is a
   column with a CHECK that refuses it for `cfa_grassroots`, so no
   standings can be computed for those ages, whatever the switch says.

Team-level only, always: a team is a name; no rosters, no children's
names, no scorers, no photos. A match holds its court through an ordinary
walk-in booking, as the CFA rows did. The old `cfa_matches` table becomes
a view over the new model, so the loader, the programme and the TV keep
their contract while the screens move.

## Consequences

### Positive
- The founder's choice (record CFA results) and the CFA's rule (do not
  publish them) coexist: the data exists, the switch decides.
- One loader, one result-entry panel, one TV path, one app screen for
  both kinds of competition.
- Venue leagues get standings for free; CFA grassroots cannot get them by
  accident.

### Negative
- Until Giorgos or the CFA says yes, a parent sees a CFA fixture in the
  app with no score — the switch's honest default.
- The `cfa_matches` view is a transitional surface and must be dropped
  once the admin reads `matches` directly.

### Neutral
- `season` is a label (`2026-27`, August to July), not a table; the
  model gains a seasons table only if a venue runs more than one
  competition a season and needs to group them.

## Alternatives considered

### Keep `cfa_matches` and add a separate league model
Two loaders and two screens for one idea; the TV would branch. Rejected.

### Never record CFA scores
Overrules the founder's explicit choice, and loses the one thing a host
venue wants to show its own parents the moment the organiser allows it.

### Captains or parents enter results
Rejected for this version (owner only, the founder's choice); the trigger
is an owner saying entering is the bottleneck.

## Amendment — 2026-10-15: a CFA grassroots competition's scores are never public

The CFA's 2026–27 announcement says the grassroots matches are played
*«χωρίς να καταγράφονται αποτελέσματα ή βαθμολογίες»* — results are not
even recorded. The founder chose, with
[plans/cfa-in-the-app.md](../plans/cfa-in-the-app.md) § Questions 3, to
follow the organiser rather than keep the switch: **`scores_public` is
refused on a `cfa_grassroots` competition by a CHECK, and a CFA match
carries no score — a trigger refuses one, so result entry (F2) offers
status only (played, postponed, cancelled)** (migration
`20261016000001`). Rule 1 stands for a venue's own league and tournament; rule
2 (no CFA table) stands as written. The *Negative* above — a parent sees
a CFA fixture with no score — is now the design, not a default.

## Follow-ups

- F2: result entry in the calendar's booking panel and the switch; F6:
  scores where public on the TV, the programme and the venue's site page.
- F3–F5: venue leagues created in the admin, the app's competition
  screen, the standings view for leagues only.
- Drop the `cfa_matches` view when the admin reads `matches`.
