# ADR-0047 — The keeper pool is free, and the first claim wins

**Status:** Accepted
**Date:** 2026-10-13
**Deciders:** Nikolas Neofytou (founder)
**Supersedes:** —
**Superseded by:** —

## Context

The first venue owner named goalkeeper scarcity as his biggest problem:
games die for want of one, and the booking dies with them. The trial plan
([goalkeeper-trial.md](../plans/goalkeeper-trial.md)) settled the
mechanism on paper: widen the audience before raising the offer, first
claim wins, and a reputation that is binary and two-sided. It ran as a
concierge over WhatsApp and a spreadsheet.

The app already knows the two things the concierge did by hand: which
fixtures are short a keeper (the roster's empty gk slot, or a keeper who
asked to be replaced under ADR-0044), and who plays where (the player's
city). It did not know who will go in goal.

## Decision

**A player says on his profile whether he will go in goal. An organiser
short a keeper posts the game to the pool. Willing players in that city
see it on Community, and the first to claim it takes the gloves and plays
free. Afterwards each side says whether the other turned up.**

- **Willingness is the player's own setting:** `users.goes_in_goal` is
  `full` (the pool, a whole game), `rotation` (the reserve, 20–30
  minutes) or `no`, which is the default and never shown a request.
- **The organiser posts, with a shape:** a whole game, or twenty minutes
  each. One open request per fixture (`gk_post`), withdrawable.
- **The clock widens the audience:** the pool always sees a whole-game
  request; the reserve sees it once kickoff is inside 48 hours, and
  straight away when only twenty minutes are asked
  (`gk_audience_ok`). These are the trial's free rungs; credits and cash
  wait on money and on evidence that free stops working.
- **First claim wins, immediately** (`gk_claim`). No holding window, no
  organiser choice: with a handful of keepers per city a request draws
  one claim, and a window would buy latency for nothing. The keeper takes
  a free gk slot, or the seat of a keeper who asked to be replaced,
  through the ADR-0044 swap.
- **The keeper plays free.** He is on the roster as `keeper_free`, never
  asked for a share; the others split the pitch. On a split fixture his
  seat carries no share to collect.
- **Reputation is two yes/no questions, both ways.** The organiser says
  whether the keeper turned up and whether he would have him back; the
  keeper says whether he would play for that team again. The team's
  record ("3 of 4 keepers would come back") travels with its next
  request, so a keeper can avoid a team that treats keepers badly.
- **Privacy:** a willing player sees counts, never the roster or the
  organiser's name, until he has claimed.

## Consequences

### Positive
- A short keeper becomes a request the app routes, not a group-chat plea.
- The free norm is protected by design: nothing in this version costs the
  organiser or pays the keeper.
- The record starts from the first game, so selection has history when
  density arrives.

### Negative
- **No push notifications yet.** A willing player sees requests when he
  opens Community. Time-to-fill is the product, so "Ask on WhatsApp"
  stays beside the request until the app can ping.
- Cold start: a city with no willing players makes posting a dead end.
  The posted line says how many can see it, so the organiser knows to
  fall back.
- The reserve's 48-hour threshold is the trial's provisional number.

## Alternatives considered

### Keepers offer, the organiser picks

The trial plan's end state. Rejected for now: it needs two claims per
request and a reputation worth choosing on, and neither exists yet. The
claim table can grow a hold window later without a rebuild.

### Pay the keeper from the start

Rejected: a price makes every keeper a seller and every game a
negotiation. The trial's ladder raises the offer only after the free
rungs fail.
