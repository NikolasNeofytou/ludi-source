# ADR-0012 — Player Card profile: age-as-band minimisation + substrate-empty-state display

**Status:** Accepted — reversible-with-cost (see Consequences);
**amended 2026-09-02** (see Amendment: the reputation band is partly wired)
**Date:** 2026-05-30
**Deciders:** Solo founder
**Supersedes:** —
**Superseded by:** —

## Context

The next version after Stage 2 is the **Player Card** — a viewable
player profile that is the *substrate* for Stage 3 matchmaking (planned
in [docs/plans/profile-player-card.md](../plans/profile-player-card.md)).
No FUTURE.md trigger has fired; we build it deliberately as substrate
under the *substrate-before-manipulation* rule — *you can't matchmake
players you can't profile.*

On a user steer, the card emphasises **footballing substance** (position,
preferred foot, skill/experience, height, age, play frequency) over
social/dating cues (photos, prompts), which are deferred. That steer
surfaces two decisions that are non-obvious, cross-cutting, and awkward
to reverse once real users have entered data — so they belong in an ADR
rather than buried in a plan doc:

1. **How to capture age.** Age is genuinely useful for assessing a
   player for a match (a 17-year-old and a 50-year-old self-selecting
   into the same competitive 11-a-side is a real mismatch). But a precise
   birth date is **sensitive personal data** under GDPR. Ludi is a Cyprus
   EU consumer marketplace; [threat-model.md](../threat-model.md) and the
   pending `anonymize-me` Edge Function (#31) commit us to holding the
   *minimum* PII necessary. Storing exact DOB for every player, when the
   product only needs a coarse age signal, is data we would then have to
   protect, export, and anonymise for no proportionate benefit.

2. **How the card displays when there is no history.** Half of a good
   player profile (reliability, no-show rate, peer ratings, matches
   played, Player-of-the-Match) cannot exist until Stage 3 matchmaking
   produces match history. Competitive scan finding (Footy Addicts, Plei,
   Playtomic, Spond): a profile that renders these as **zeros** reads as
   *"bad/untrustworthy player"*, whereas an **empty state** reads as
   *"new player"*. At launch every player is new, so getting this wrong
   makes the entire user base look bad on day one.

Constraints in play: solo dev; the profile must ship complete and
credible with **zero matches played**; the consuming features
(matchmaking, ratings) stay parked in [FUTURE.md](../FUTURE.md); whatever
we store must round-trip cleanly through the future `anonymize-me` flow.

## Decision

**Store age as a coarse band, never a birth date; and render
not-yet-earnable profile sections as designed empty states ("earned as
you play"), never as zeros.**

Concretely:

1. **Age = band.** A single nullable column
   `users.age_band text CHECK (age_band IN ('u18','18_25','26_35','36_45','45_plus'))`.
   No `date_of_birth` column. The band is self-declared, optional, and
   sufficient to assess match fit. It is profile data (nulled by
   `anonymize-me`), but it is **not** the sensitive precise-DOB PII we
   would otherwise have to safeguard.

2. **Substrate-empty-state posture.** The player card is composed of two
   zones. The **substrate zone** (identity + football attributes:
   position, foot, skill tier, height, age band, play frequency, member-
   since, verification badge) is populated from self-declared data and
   must make the card look complete on its own. The **reputation zone**
   (reliability/no-show, peer ratings, matches played, badges) renders as
   an explicit *"earned as you play"* empty state with reserved slots and
   **no data plumbing** in this version. A missing optional substrate
   field hides or shows "—"; it never breaks the card. Zeros are
   forbidden as a representation of "no data yet".

Both decisions are about the same thing: the profile tells the **honest
truth** about a player without over-collecting (age) or over-claiming
(zeros that imply a track record nobody has yet).

## Consequences

### Positive
- **Minimised PII surface.** No precise birth dates to protect, export
  under a GDPR access request, or special-case in `anonymize-me` (#31).
  Smaller blast radius per [threat-model.md](../threat-model.md).
- **Day-one credibility.** Every player looks like a *new* player, not a
  *bad* player. The card is shippable before any match exists.
- **Forward-compatible.** The reserved reputation slots mean Stage 3 can
  populate reliability/ratings without redesigning the card.
- **Consistent with the GDPR posture** already set in ADR-0011 (PostHog
  consent-gating) and ADR-0010 (PII scrubbing) — collect/expose the
  minimum, deliberately.

### Negative
- **Loss of precision.** A computed-exact-age feature (e.g. an age-graded
  league, or a hard U18 safeguarding gate) cannot read a precise DOB we
  never stored. **Mitigation:** the `u18` band is a coarse safeguarding
  signal today; if a hard gate is ever needed, add verified DOB *then*,
  to the subset of users it applies to, rather than holding it for all.
- **Self-declared and unverified.** A player can mis-state band, height,
  or frequency. Accepted — these are low-stakes assessment hints, not
  trust claims; the verification badge and (future) peer signals carry
  trust.
- **Empty-state design cost.** "Earned as you play" needs real design
  attention to feel inviting rather than broken — more work than a zero.
  Accepted; it is the point of the version.

### Neutral
- `age_band`'s exact buckets may need tuning once we see the real player
  mix (e.g. splitting `45_plus`). Changing buckets later is a migration +
  a re-prompt, not a crisis — hence "reversible-with-cost".
- The band is stored as `text` + CHECK, matching the existing house
  style of `preferred_foot` / `preferred_locale`, rather than a Postgres
  enum (enums are painful to alter; CHECK lists are not).


## Amendment — 2026-09-02: matches played is real; the rest of the band is not

**Context.** Decision 2 above committed the reputation zone to "an
explicit *earned as you play* empty state with reserved slots and **no
data plumbing** in this version." That was correct on 2026-05-30, when
no match history existed anywhere in the system. It stopped being
correct on 2026-09-01, when community v2 shipped
`complete_played_bookings()` and `my_record()` — real completed-match
counts, read from real rosters.

The profile audit on 2026-09-02 caught the consequence: the profile tab
displayed **3 matches played** from `my_record()`, and the player card
opened from that tab displayed **—** for matches played plus a **NEW
PLAYER** chip. Two surfaces, one user, one number, two answers. The
no-zeros rule was written to stop the card *understating* a player; left
unamended it made the card *deny a record the player had earned*, which
is the same failure pointed the other way.

**Amendment.** The reputation band splits. `FactionsCard` takes an
optional `record` prop:

- **Matches played** renders its real value whenever a record is passed,
  in full ink, because it now has data behind it.
- **Reliability** and **peer ratings** keep the original em-dash. Those
  genuinely have no data — no no-show tracking, no ratings — and the
  ADR's promise still holds for them.
- **NEW PLAYER** is a claim about having no history, so it renders only
  while `matches_played === 0`. A player with a record is not new, and a
  card that says both contradicts itself.
- A `null` record (not loaded, or another player's card) still renders
  the em-dash. **Zeros remain forbidden as a representation of "no data
  yet"** — the original rule is untouched; what changed is that one of
  the three slots is no longer "no data yet".

`my_record()` answers only for `auth.uid()`, so the card can be backed
only on a self-view. Another player's card keeps the full empty band
until a consent-gated public record exists — that decision is still
deferred, and this amendment does not pre-empt it.

**Also amended:** the same migration
(`20260902000002_record_venues.sql`) adds `venues` to `my_record()`, so
the record is three numbers. The client treats it as nullable, so an app
running against a database that predates the migration drops the third
stat rather than showing a confident zero.

**What this does not change.** Age stays a band; no `date_of_birth`
column exists or is proposed. The substrate-empty-state posture stands
for every slot that is still unearnable.

## Alternatives considered

### Store exact `date_of_birth`
Most precise; reusable for age-graded play and a hard U18 gate. Rejected
for now: it is sensitive PII we do not yet have a proportionate use for,
and every column of sensitive PII is a standing GDPR liability (export,
deletion, breach scope). Re-introduce narrowly *when* a feature genuinely
needs verified exact age, not speculatively.

### Skip age entirely this version
Lightest. Rejected: the user explicitly flagged age as one of the
more-important assessment attributes, and a coarse band carries almost
none of the DOB risk while delivering the signal.

### Render reputation as zeros (0 matches, 0.0 rating)
Simpler — no empty-state design. Rejected: at launch it makes every
player look untrustworthy, actively harming the matchmaking substrate the
version exists to seed.

### A Postgres `enum` type for `age_band`
Type-safe. Rejected: altering an enum's members later requires migration
gymnastics; a `text` + `CHECK` constraint gives the same guard and is
trivially editable, consistent with existing columns.

## Follow-ups

- Implement the migration (`age_band`, `height_cm`, `play_frequency` on
  `users`) per [docs/plans/profile-player-card.md](../plans/profile-player-card.md)
  §DATA_MODEL; extend the pgtap `users` update test.
- When `anonymize-me` (#31) is built, add `age_band`, `height_cm`,
  `play_frequency` to its null-set (`height_cm` is the most
  quasi-identifying of the three).
- Add an "earned as you play" empty-state convention note to
  [CONVENTIONS.md](../CONVENTIONS.md) once the card screen lands, so
  future profile sections follow the same no-zeros rule. **Extend it
  with the 2026-09-02 amendment's corollary:** an empty state is a
  promise about data that does not exist, so every one of them acquires
  an expiry the moment its data ships. When a feature starts producing
  a number, grep for the surfaces still claiming it is unearned.
- Wire `reliability` and `player ratings` when (and only when) no-show
  tracking and peer ratings actually exist — and re-read this ADR then,
  because the same contradiction is waiting for both of them.
- Revisit `age_band` buckets after the first ~50 real players reveal the
  age distribution.
- Revisit the no-DOB stance if/when an age-graded league or a statutory
  U18 safeguarding gate is actually scoped (related: FUTURE.md).
