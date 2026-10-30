# ADR-0041 — A manager runs the day; an owner decides what the venue is

**Status:** Accepted
**Date:** 2026-09-17
**Deciders:** Nikolas Neofytou (founder)
**Supersedes:** —
**Superseded by:** —

## Context

`venue_owners.role` has been `CHECK (role IN ('owner','manager'))` since the
initial schema on 2026-04-21. For seventeen months it meant almost nothing.

[data-model.md](../data-model.md) scoped it in one line — *"manager =
limited scope: everything an owner does in the venue app except the venue's
money — Stripe onboarding and the Express dashboard are owner-only"* — and
that one line has been honoured in exactly two places,
`venue-connect-onboard` and `venue-express-login`, with `canManageMoney()`
mirroring them in the UI. Everywhere else the gate is
`is_venue_owner_of_venue()`, which matches on `user_id` and **never reads
`role`**. At the RLS boundary a manager has always been an owner.

That was harmless because there were no managers. Nobody could create one
but the founder, by hand
([venue-staff.md](../plans/venue-staff.md) documents all four gates), so
the only `manager` rows that ever existed were test accounts.

Slice C changed that on the same day this ADR is written. An owner now adds
his own staff from `/access`, manager-only, and the first real managers are
a matter of when an owner opens the page rather than whether. The default
that has been standing in for a decision is about to be load-bearing, and
what it currently says is:

- a person hired to stand at a counter reads `/earnings` in full — daily
  gross, **Ludi's commission**, net, and the payouts mirror;
- and reads `v_venue_private`, which carries `take_rate_bps` outright;
- and may change `pitches.price_per_hour_cents`;
- and may rename the venue, or a court, or change its surface.

The first two are the ones that decide whether staff accounts get used at
all. A venue that will not give the evening shift a login **because the
login shows the commission** is a venue whose workers keep using paper —
and paper is what [owner-calendar.md](../plans/owner-calendar.md) and the
printed day sheet were built to get out from under.

The honest caveat: §The questions in
[venue-staff.md](../plans/venue-staff.md) has not been put to the two
venue owners yet. Question 3 is exactly *"would he show a worker what Ludi
takes?"* This ADR answers it without them, because slice C ships first and a
default is worse than a decision. If an owner says otherwise, the line moves
— see §Reversibility.

## Decision

**A manager runs the day. An owner decides what the venue is, what it
charges, and sees what it earned.**

That single sentence resolves every case seen so far, and it is drawn at
the boundary between *operations* and *terms of business* rather than at a
list of screens:

| A manager may | A manager may not |
|---|---|
| take, move and cancel bookings and walk-ins | see what the venue earned, or what Ludi took |
| run standing series and booking notes | set a price |
| set opening hours, and close a day | rename the venue or a court, or change its surface |
| read the roster, with ADR-0023's phone window | reach the venue's bank details or payouts |
| read prices, to quote at the counter | decide who else holds a key |
| — | see the venue's onboarding checklist |

*When you are open* is operations, so a manager sets it — a burst pipe at
08:00 is precisely what the person on site must be able to act on, and the
schedule editor's collision guard already stops them stranding a booking.
*What you charge* is terms, so it is not theirs.

**It is enforced in RLS and in view predicates, not in the app.** Six
objects change from owner-or-manager to owner-only:

| Object | What it protects |
|---|---|
| `v_venue_earnings_daily` (predicate) | what the venue earned, and the fee |
| `venue_payouts` (SELECT policy) | what has been paid out |
| `v_venue_private` (predicate) | `take_rate_bps`, the Stripe account, contacts |
| `venues` (UPDATE policy) | what the venue is |
| `pitches` (INSERT + UPDATE policies) | what a court is and costs |
| — already owner-only — | Stripe onboarding / Express dashboard, and
`venue_people` / `revoke_venue_person` / the grant |

`has_venue_role(venue, 'owner')` (added by slice A, `20260917000004`) is
the predicate throughout. `is_venue_owner_of_venue()` is **not** changed:
it still means "has any access to this venue", it is used by dozens of
policies that genuinely mean that, and redefining it to mean `owner` would
silently move every one of them. Two functions with two honest names beat
one function with a changed meaning.

Reads that a manager needs in order to do the day are untouched —
`venues` and `pitches` SELECT, schedules, overrides, bookings,
`booking_series`, `booking_notes`, the roster. So is `venue_contacts` when
[owner-contacts.md](../plans/owner-contacts.md) lands: that table *is* the
booking form's typeahead, and withholding it from the counter would defeat
the feature. Its export and delete-all buttons are the owner's.

## Consequences

### Positive

- The sentence a founder can say to an owner in one breath — *"they can run
  the day, they can't see the money or change your prices"* — is now true,
  rather than true of two Edge Functions.
- The objection that kills staff accounts is removed. The commission is not
  counter-desk knowledge.
- Slice E ("who took the €60") becomes worth building: staff can be given
  their own login without the owner weighing it against showing them the
  books.
- The boundary is in the database, so it holds for anything that reaches
  PostgREST with a manager's JWT — not only for screens we remembered.

### Negative

- **A manager cannot fix a typo in a court's name, or nudge a price**, and
  will have to ask. At a two-person venue that is friction for no gain, and
  it is the most likely thing to be asked to relax.
- **An owner who is his own counter staff sees no change**, so the venues
  live today feel none of the benefit — the cost lands before the value.
- `v_venue_private` going owner-only means the Today page's setup checklist
  reads nothing for a manager, so it is skipped for them. Correct, but it
  is a second rule to remember when adding a step to that checklist.
- Two view bodies had to be restated verbatim to change one predicate
  line each, which is the `CREATE OR REPLACE VIEW` tax and a transcription
  risk every time.

### Neutral

- No change for platform admins, for `service_role`, or for any owner.
- `venue_owners.role` keeps its two values. A third (a read-only
  "accountant", say) is a decision for a venue that has one, and none does.

## Alternatives considered

### Make `is_venue_owner_of_venue()` read `role`

One line, and every policy in the system moves with it. Rejected: the
function is used by policies that mean "has access to this venue" — the
roster, bookings, schedules — and tightening all of them to `owner` would
lock managers out of the day, which is the opposite of the decision. The
blast radius is also invisible at the call sites, which is how a
security change becomes an outage.

### Column-level guards, like `tg_venues_block_privileged_columns`

The house pattern for "RLS is row-level and we need column-level"
(`20260822000003`). Rejected here because the line is not per-column: a
manager may not edit the venue row or a pitch row **at all**, so a
table-level policy says it more plainly than a trigger enumerating
columns. The existing triggers stay — they guard a different thing (what
no non-privileged writer may touch, owner included).

### Keep it in the app layer only, as `canManageMoney()` does

Rejected. `canManageMoney()` is an affordance with an Edge Function behind
it; there is no Edge Function behind `/earnings`, so the app layer would be
the whole boundary and a manager with the anon key and their own JWT could
read the view directly. ADR-0019 tolerates affordance-before-gate for the
*nav*; it does not tolerate it for the money.

### Ask the two owners first, and ship nothing meanwhile

The honest option, and it is what [venue-staff.md](../plans/venue-staff.md)
originally proposed. Rejected because slice C ships in the same pass: the
managers arrive now, and they arrive under whichever rule is in the
database. Shipping a decision that can be relaxed beats shipping a default
that cannot be noticed.

## Reversibility

Deliberately cheap, because §The questions is still unanswered. Each of the
six objects is one predicate. Relaxing any of them back to
`is_venue_owner_of_venue()` is a one-line migration per object, and the app
reads `viewer.venues[].role` in one helper. The expensive direction would
have been the other one — shipping managers with access to the books and
taking it away after they had it.
