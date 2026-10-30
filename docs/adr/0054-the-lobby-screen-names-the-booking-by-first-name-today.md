# ADR-0054 — The lobby screen names each booking by its first name, today only

**Status:** Accepted
**Date:** 2026-10-16
**Deciders:** Nikolas Neofytou (founder)
**Supersedes:** — (amends the privacy rule in [plans/cfa-grassroots-saturday.md](../plans/cfa-grassroots-saturday.md) §"The public screen")
**Superseded by:** —

## Context

The lobby screen (`/tv/<token>`) has been on Campeone's 60-inch TV since
2026-09-19. Since it was built it has shown every booking that is not a
CFA match as *Κρατημένο*: booked, never who. The rule was written before
the screen hung in a lobby, from the posture of ADR-0012 (expose the
minimum) and ADR-0023 (names reach the owner, not the public).

On 2026-10-16, at the first on-site test, the founder watched it fail at
its job: *"whoever booked the court can't see their court with ease."* The
screen drew a row per court with booked blocks on the hours. A group
walking in at 19:00 knows two things: the time, and whose name the
booking is in. Tonight's real booking was *Σώζος, 19:00–21:00, courts 4
and 5*. To find it, Σώζος's group had to scan seven rows for blocks at
19:00 and look across to the court name. When two groups book the same
hour, time alone cannot tell them apart. So they ask the counter, which
the screen was meant to save.

The way people ask is the key the screen withheld: «είμαστε στο όνομα
του Σώζου». Venues that put bookings on a lobby screen (padel clubs,
bowling lanes, five-a-side centres) show the name the booking was made
under for the same reason.

Two forces limit how far this goes:

- **The link is public.** `public_venue_schedule(token, date)` is granted
  to `anon`, the screen's own QR (*Σκανάρετε για το κινητό*) puts the link
  on any phone, and it reads yesterday to a month ahead. A name on every
  day would hand a month of who-plays-where to anyone who scanned once.
- **The lobby needs very little.** A first name, for the hours people are
  standing there, is enough to find a court. A surname, a phone or a
  price adds nothing to that and is never shown.

## Decision

**Each booking on the screen carries `who`: the first word of the name
on the booking, on today's date only.** Any other day reads `who` as
NULL. For a walk-in that is the name as the counter typed it; for an app
booking, the player's first name; for an anonymised account, NULL. CFA
matches keep their teams and get no `who`.

The screen is reorganised around that key: a board with one row per
booking still to come, soonest first, showing name, court numbers (large)
and hours, with *Τώρα* or a countdown. Courts booked in one name for the
same hours are one row (`Σώζος · 4 5 · 19:00–21:00`). Beside it, every
court now. The first word is computed in the database, so a full name
never reaches the page.

Built in `20261016000006_tv_first_name.sql`, test
`55_tv_first_name.sql`, and `apps/admin/components/tv-screen.tsx`.

## Consequences

### Positive
- A group finds its court from the door, in one look, without the
  counter.
- Two groups booked at the same hour can tell their courts apart.
- The rule fits in one sentence an owner can repeat to a player: "the
  screen shows your first name on the day, nothing else".

### Negative
- A first name sits on a public screen and behind a public link for the
  day of the booking. In a small town, a first name plus a time can be
  enough to know who is playing. Accepted for the day only, since the
  booking itself puts the group in that lobby at that hour.
- No opt-out yet. A player who does not want their name shown has to ask
  the counter. For a walk-in the owner can type another word; for an app
  booking there is no control yet (see follow-ups).
- What the counter types is what shows. «Σώζος Π.» shows «Σώζος», but
  a nickname or a club name shows as typed (its first word).

### Neutral
- Previews of other days (`?day=`) show *Κρατημένο* rows, as before.
- The phone view of the same link shows the same rows.

## Alternatives considered

### Time and courts only, no name

The board with no name. It answers *where do I play* when a group is
the only one at its hour, but not when two groups booked 19:00. That is
the common case on a busy evening, so it was rejected.

### Booking-code tail («#0049»)

The booking code is not a credential (`/f/<token>` uses the invite
token, never the code), so it would be safe to show. But app bookers
rarely remember it, and phone and walk-in bookers never see theirs. It
answers the question for almost nobody.

### Court tiles

One tile per court with its booking inside. It is still court-first:
the group has to scan for its time. The founder picked the board.

## Follow-ups

- An opt-out for app players ("don't show my name on venue screens"),
  if anyone asks. Until then, the counter handles it.
- Greek court names on prod (*Γήπεδο 1…7*): the chips read the number
  either way, and the rail shows the name.
- Amend [plans/cfa-grassroots-saturday.md](../plans/cfa-grassroots-saturday.md)
  §"The public screen": its privacy rule now points here.
