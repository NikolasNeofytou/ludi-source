# ADR-0031 — Venue enrolment state derives from rows; there is no wizard table

**Status:** Accepted (reversible — it adds no schema, so reversing it is a UI change)
**Date:** 2026-09-15
**Deciders:** Nikolas Neofytou
**Supersedes:** —
**Superseded by:** —

## Context

The admin app's create path was built for the founder seeding one test
venue from a desk: a venue form, a separate pitch form, a schedule page
per pitch, an owner-access card on the venue's edit page. At the third
venue's counter (Campeone, 2026-09-14) that shape failed in front of the
owner — five pages, a wrong-venue default, one window per submit across
a dozen courts. [plans/venue-enrol.md](../plans/venue-enrol.md) replaces
it with one five-step flow.

A multi-step flow on a phone at a counter has one hard requirement:
losing the page (a call comes in, the browser reloads, the battery
dies) must not lose the work. The usual answer is a draft — a
`venue_enrolments` row holding half-typed courts as JSON, promoted to
real rows at the end. That is a second representation of the same
facts, a second set of validation, and a migration for a flow whose
whole point is to use the existing rows.

Two facts about the existing schema make the draft unnecessary.
`venues.is_active` already gates public visibility:
`venues_select_public_or_owner_or_admin` shows an inactive venue to its
owners and to admins only, and the pitches policy hides every pitch of
an inactive venue from players. And every table the flow writes —
`pitches`, `pitch_schedules`, `venue_owners` — is already resumable on
its own: a pitch with no windows is a legal state the Today checklist
already describes ("Set weekly hours"), and a venue with no owner is
the state every venue starts in.

## Decision

**The inactive venue row is the draft.** Step 1 creates the `venues`
row with `is_active = false`. Every later step writes ordinary rows
through the existing RLS policies, one statement per step so a step is
all-or-nothing. The flow's position is a URL (`/venues/[id]/enrol/<step>`);
"where am I" is answered by reading the rows (does the venue have
pitches? do the pitches have windows? does it have an owner?), never by
a stored step counter. Publishing is `is_active = true`.

No new table, no new column, no new audit vocabulary: each row created
audits exactly as it would from the standalone forms (`create_venue`,
`create_pitch`, `schedule_change`, `update_venue`), so the trail cannot
tell a wizard-made venue from a hand-made one — which is right, because
there is no difference.

## Consequences

### Positive
- Zero schema change; the version ships with the admin deploy only.
- A venue created by the old form, or by SQL, can be picked up at any
  step — the flow is a view over state it does not own.
- Validation lives in one place (the zod schemas the standalone forms
  already use, widened to arrays), and the database constraints
  (`EXCLUDE` on overlapping windows, the type/surface CHECKs, the
  verify guard) protect the wizard exactly as they protect the forms.
- An abandoned enrolment is an inactive venue with some rows — visible
  on the admin's venues list as "(inactive)", deletable by hand, never
  a stale draft blob nobody remembers the shape of.

### Negative
- A partially enrolled venue is real data: an inactive venue with three
  courts and no owner exists in `pitches` and shows to admins. This is
  accepted; it is the same state the standalone forms produce today.
- "Which step am I on" is derived on every page load (three small
  reads). Cheap at this scale; would want a view if venues numbered in
  the hundreds.
- Step 3 applies hours only to courts that have none. Re-running it
  after editing one court's hours does not overwrite — by design, but
  it means the grid is a setup tool, not the hours editor.

### Neutral
- `is_active = false` at creation changes the old form's default
  (`true`). The old form redirects to the flow, so nothing else sees it.

## Alternatives considered

### A draft table (`venue_enrolments` with a JSON payload)

One row per in-progress enrolment, promoted at the end. Rejected: a
second representation of every fact with its own validation, a
migration, and a promotion step that can half-fail. The existing rows
already carry every intermediate state as a legal state.

### Client-side state only (one long form, submit at the end)

Simplest to write. Rejected because it fails the one hard requirement:
a reload at step 4 loses steps 1–3, at a counter, in front of the owner.

### A `venues.enrolment_step` column

Cheap, but it stores a fact derivable from the rows and drifts the
moment anyone edits outside the wizard (the founder adding a court from
`/pitches/new`). Derivation cannot drift.

## Follow-ups

- If a second wizard-shaped flow appears (the owner-side version of
  this, or a Stripe-onboarding walkthrough), extract the stepper and the
  `rowsFromFormData()` helper; until then they live under
  `apps/admin/components/enrol/`.
- Numbering: ADR-0030 is claimed by both the owner-ping branch and the
  booking-approval plan; whichever merges second takes 0032.
- Related: ADR-0019 (one app, RLS is the boundary), ADR-0024 (owner
  sign-in is an email magic link — the invite is the account).
