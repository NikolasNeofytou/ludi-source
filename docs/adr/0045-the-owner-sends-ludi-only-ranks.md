# ADR-0045 — Fill the hour: the owner sends, Ludi only ranks

**Status:** Accepted
**Date:** 2026-10-13
**Deciders:** Nikolas Neofytou (founder)
**Supersedes:** —
**Superseded by:** —

## Context

Owners praise one thing about every platform they stay on: "it brings me
customers" ([owner-platform-research.md](../plans/owner-platform-research.md)).
An empty Tuesday 20:00 is the moment that promise is tested, and the people
most likely to take it are the venue's own regulars who played that hour
before. Since slice A of [owner-contacts.md](../plans/owner-contacts.md) every
walk-in carries a `contact_id`, so the venue's history already answers "who
plays Tuesdays at eight".

Two things stand in the way of Ludi sending the offer itself. There is no
outbound sender yet (owner-ping's WhatsApp number waits on Meta onboarding).
And Schedule B.5(a) forbids Ludi from using the Venue Records to contact or
market to the people in them: the venue is the controller, Ludi the
processor.

## Decision

**Ludi ranks the venue's contacts for an empty hour; the owner sends each
offer from his own WhatsApp.** The owner opens Fill the hour from an empty
Calendar cell, optionally types an offer price, and gets his regulars best
first — same weekday within an hour of the slot, then most games at the
venue, then most recent. Each row is a `wa.me` link with the message
written; tapping it opens his WhatsApp and records that he asked
(`fill_offer_sends`). Whoever replies, he books as a walk-in as he always
does; the offer page then says whether the hour was filled by someone he
asked.

- **Switched on per venue by Ludi** (`venue_fill_enabled`, admin only), and
  only after the venue's signed Schedule B names the use: B.2 gains "at the
  Venue Owner's request, suggesting contacts who have reserved at the Venue
  on a comparable day and time … and recording which of them it chose to
  contact".
- **Every message says how to refuse**, and a refusal is one tap
  (`offers_opt_out_at`); the ranking never suggests that person again. B.12
  makes the lawful basis and honouring refusals the venue's warranty.
- **Owner only**, like the contact list it reads (ADR-0041).
- **Ludi sends nothing and keeps no message.** The text is composed in the
  browser; only who was asked, when, is stored.

## Consequences

### Positive
- Works today, without Meta, on the owner's own number — which is the
  number his regulars already have, so the message is not from a stranger.
- The data protection posture does not move: the venue markets to its own
  customers; Ludi organises the venue's records on its instruction.
- Measurable: offers, sends, and fills by someone asked.

### Negative
- One tap per person. Twenty regulars is twenty taps; the owner will not
  broadcast. That is also a feature: it reads as a personal message.
- The fill is detected by a booking appearing on the slot, not by the reply
  itself; a regular the owner books by name without his phone is counted as
  "filled by someone else".
- The Schedule B amendment needs counsel before the first venue is switched
  on, like the rest of Schedule B.

## Alternatives considered

### Ludi sends the offers from its WhatsApp number

Rejected for now: no sender exists, and B.5(a) forbids it. When owner-ping
lands, a venue-branded send on the owner's instruction is possible under an
amended Schedule B; this ADR's ledger is ready for it.

### A public offer page with the discounted price bookable in the app

Rejected: the regulars are counter customers, mostly not Ludi users; a
discount the app does not know about would be a second price list.

## Follow-ups

- Measure fills by someone asked over the first month at the first venue.
- Revisit Ludi-side sending once owner-ping's number is live.
