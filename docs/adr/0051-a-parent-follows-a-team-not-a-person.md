# ADR-0051 — A parent follows a team, not a person: a private subscription to its fixtures, told through the player's ledger

**Status:** Accepted
**Date:** 2026-10-15
**Deciders:** Nikolas Neofytou (founder)
**Supersedes:** —
**Superseded by:** —

## Context

The CFA's grassroots Saturdays put several hundred adults into the
first venue every week. Campeone hosted 21 of the 156 Nicosia matches on
the last round of 2025–26, 19 of them with one of two academies at
home. Ludi already holds those matches as walk-ins on courts, in the
competitions model (ADR-0050), and on the venue's TV. The founder asked
for them *inside Ludi*
([plans/cfa-in-the-app.md](../plans/cfa-in-the-app.md)), and the one
question every product for these parents answers first is *where and
when does my child's team play next* — Dribl, Spond, Heja and TeamSnap
all start from a followed team.

Four forces:

- **FUTURE.md says *never* to followers.** *Social feed / followers /
  stories* is an explicit non-goal: Ludi is not a social network.
  fixtures-and-scores.md also parks *following a team with push* until a
  venue league's players ask.
- **The child must not appear.** The CFA publishes team names and times
  and nothing about children; FA guidance and GDPR put names, photos and
  profiles of children off limits. The user has to be the parent.
- **A follow says something about the parent.** Following *ΟΜΟΝΟΙΑ U9
  Lions B* says this adult has a child of eight at that academy. Shown
  to anyone, it is a map of where children are on Saturday.
- **The notices already exist.** Reach (ADR-0048) built a ledger, a
  sender, quiet hours and two switches, all assuming a notice is about a
  booking the player is in or an ask they opted into.

## Decision

**A follow is a private subscription from a player to a team's
fixtures. It is never a relation between people and never visible to
anyone but the player who made it. Its notices go through the player's
ledger as a fourth kind of cause.**

- **What is followed is a team, as the CFA defines it:** academy, age,
  Eagles/Lions and group, for one season (`competition_teams` gains
  `category` and `group_label`). The follow points at a team row; reads
  expand to every row with the same key (season, name, category, group),
  so one team playing at two Ludi venues is one follow. A new season
  means a new follow, which is right: the child moves up an age group.
- **Nobody sees a follow but its player.** `team_follows` is readable by
  its own player only, written through definer functions, and deleted
  with the account. No follower count, no list, no owner view; an
  aggregate per venue, with a floor, is the most the owner may ever get,
  and only on a trigger.
- **No child data enters.** No child account, name, age, photo, roster
  or attendance. The parent is a normal player account.
- **Notices about a followed team are ledger rows** (ADR-0048), minted by
  the database: the programme is out, a change (kick-off, court,
  status), one hour before. `player_notifications.booking_id` becomes
  nullable only for these kinds, which carry the match or the change in
  `ref_id`. They obey `notify_games` and the phone's permission, and the
  programme notice keeps the asks' quiet hours.
- **The parents' game is an ask, not a broadcast.** Only a parent who
  said *I play too* for that venue can be asked, once per fixture, under
  the R4 rules.
- **No CFA score leaves the database** through any read a follow uses,
  whatever `scores_public` says.

## Consequences

### Positive
- The question parents actually have is answered in the app the venue
  already points them at, with the court only Ludi knows.
- FUTURE's *never* holds: there are no followers, only subscriptions;
  nothing about a person is published.
- The notices cost one widening of a column and three kinds; the sender,
  quiet hours and skipped-with-a-reason are reused whole.
- Parents become Ludi accounts at the venue, which is the acquisition
  channel 2026-10.md says Ludi has.

### Negative
- The loader has to keep match identity across re-loads (diff, not
  delete), or every Wednesday re-load reads as a cancellation; it is the
  only change to code that works today.
- `player_notifications.booking_id` is no longer NOT NULL; a CHECK
  carries the old guarantee for every booking kind, and the R3 sender's
  copy must render a notice with no booking.
- A follow made at one Ludi venue sees only Ludi venues (and, if the
  founder agrees, the away matches of their teams); a team that never
  comes to a Ludi venue is not followable.

### Neutral
- A follow lasts one season by construction; carrying it to the next age
  group is a later convenience, not a model change.
- Venue leagues can use the same follow when their trigger fires; this
  ADR does not switch it on for them.

## Alternatives considered

### A child profile under the parent's account
What Spond and TeamSnap do (a guardian manages each child's invites).
Brings a child's name, age and team into Ludi's data, Article 8
questions and a privacy page Ludi does not have. A team needs none of
it. Rejected.

### Followers as a social feature (counts, "parents who follow")
Turns a schedule into a map of children and contradicts FUTURE's
*never*. Rejected.

### No follow — the venue screen only
Answers *what is on here today* but not *where is my child next
Saturday*, and nobody can be told when a court moves. Kept as K2, the
first slice, not as the whole version.

### A web page or calendar feed per team
Reaches parents without the app and without a build, and was the
research pass's first ranking. The founder narrowed the version to
inside Ludi; parked with a trigger in the plan.

## Follow-ups

- K1: the team key and the stable round, before the first real round
  (Wed 28 Oct).
- Amend ADR-0050 if the founder locks CFA scores off (plan § Questions 3).
- The per-venue aggregate for owners, on its trigger.
- Revisit for venue leagues when their players ask.
