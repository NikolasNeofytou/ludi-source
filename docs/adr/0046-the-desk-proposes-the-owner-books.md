# ADR-0046 — The booking desk proposes; the owner books

**Status:** Accepted
**Date:** 2026-10-13
**Deciders:** Nikolas Neofytou (founder)
**Supersedes:** —
**Superseded by:** —

## Context

Every Cypriot venue in the district scans takes bookings the same way: a
WhatsApp message or a call to a number, then a line in a paper book or,
since September, the walk-in form. Playtomic's answer is to make the player
install an app. Ludi's answer so far has been the same, for app bookings,
plus the walk-in form for everything else.

The messages themselves are the gap. "Αύριο στις 8 για 5άρι;" is read by the
owner, checked against the wall, answered, and then typed into the
dashboard. Reading and checking is the part a machine can do; deciding is
not. A wrong automatic booking is worse than none: it takes a court from
someone.

Meta's Cloud API can deliver a venue's WhatsApp messages to a webhook, but
the onboarding (owner-ping's P0) is not done, and a venue's number on the
Cloud API stops working in the WhatsApp app on the owner's phone.

## Decision

**Booking messages land in a desk beside the calendar, each read into a
proposal the owner confirms with the ordinary walk-in form. Nothing is
booked without his tap.**

- **Two ways in.** The owner pastes a message (works today, keeps his own
  WhatsApp); or Ludi connects the venue's WhatsApp Business number and
  messages arrive by webhook (`whatsapp-inbound`, signed by Meta, stored
  once per message id).
- **A deterministic reader** (`apps/admin/lib/booking-request.ts`): Greek,
  Greeklish and English days, dates, hours, lengths, court numbers and
  formats; a bare hour from 1 to 11 is the evening. No language model:
  the messages are short and formulaic, a rule is explainable, and no
  customer's message leaves Ludi's processors.
- **Checked against the courts.** `desk_free_courts` answers which courts
  are free across the window; a taken court is replaced by a free one of
  the same format, and a fully taken hour shows the free hours either side.
- **Booking is the walk-in form,** opened on the proposal with the
  customer's name and number; the request is then marked booked with the
  walk-in's code. Declines and "not a booking" are one tap.
- **The reply** is written for what happened. A pasted message is
  answered from the owner's own WhatsApp (`wa.me`); a message that came on
  the connected number is answered from that number (`whatsapp-reply`,
  inside Meta's 24-hour window).
- **Owner and manager:** the desk is the day (ADR-0041). Messages are
  Venue Records, purged thirty days after they arrive.
- **Schedule B** names the desk as a purpose and Meta Platforms Ireland as
  a sub-processor for venues whose number is connected.

## Consequences

### Positive
- The owner's habit does not change; the paper book does.
- A wrong read costs a tap, never a double booking: the walk-in form and
  the database's exclusion constraint still decide.
- Works today with paste, before any Meta onboarding.

### Negative
- Paste is a copy and a paste per message: real friction until a number is
  connected.
- Connecting a number moves it off the WhatsApp app on the owner's phone;
  some owners will not want that. Paste stays for them.
- The reader will miss phrasings; the desk shows the message beside the
  proposal so the owner corrects it in the form.

## Alternatives considered

### A language model reads the messages

Better recall on odd phrasings. Rejected for now: another sub-processor for
customers' messages, cost per message, and answers the owner cannot predict.
Revisit if the reader's misses become the owner's main complaint.

### Book automatically when the read is confident and the court is free

Rejected: the owner's book has things Ludi cannot see (a regular's
standing promise, a phone call ten minutes ago), and a wrong booking
takes a real court from a real person.

## Follow-ups

- Measure: requests per week, share booked, time from arrival to answer.
- Connect the first venue's number after owner-ping's Meta onboarding.
