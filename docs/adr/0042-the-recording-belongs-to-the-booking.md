# ADR-0042 — The recording belongs to the booking

**Status:** Accepted
**Date:** 2026-10-13
**Deciders:** Nikolas Neofytou (founder)
**Supersedes:** —
**Superseded by:** —

## Context

The founder chose game recording for the players over a live view of the
courts (2026-10-12, [plans/court-cameras.md](../plans/court-cameras.md)).
A camera at a venue is the easiest thing in this product to get wrong: it
can become CCTV for the owner, a feed for strangers, or footage of
children. FUTURE.md's *live streaming / spectator features* stays *never*.

No camera has been bought and counsel has not answered. The plan puts a
spike (C0) before any build; the founder asked for the build now. So the
software is built and kept dark: nothing is offered until a court has a
camera row, and only the founder can create one.

## Decision

**A fixed camera records a booking only when that booking's organiser
switched recording on before kickoff, and only the players in on that
booking can watch it, for thirty days.**

- **A camera belongs to a court** (`court_cameras`, one working camera a
  court). Ludi registers it and gets a device token, shown once; only its
  SHA-256 is kept. Health is derived from the recorder's heartbeat. The
  owner sees his cameras' health, never footage.
- **Consent is the organiser's switch** (`bookings.recording_consented`).
  It moves only through `set_recording`, only before kickoff; the
  organiser column guard freezes it against direct writes. The pitch
  screen offers it and remembers his last answer; off means no file is
  ever made.
- **Everyone is told before they join**: the invite preview (app and
  web) and the fixture screen say the game is recorded and how to ask for
  it off. The venue carries a sign (drafts in
  [docs/legal/court-cameras](../legal/court-cameras/README.md), for
  counsel).
- **Never recorded, enforced in the model**: walk-ins, standing bookings,
  CFA matches, a court without a working camera, and a roster with a
  player whose age band is under 18 (`recording_blocked_reason`, checked
  when switching on, when arming, and when the camera starts).
- **The camera runs only inside the booking.** The recorder at the venue
  syncs every few seconds; the sync arms consented bookings starting
  within two hours. `recorder_mark` refuses a start more than fifteen
  seconds before kickoff or after the end, so back-to-back games are
  never caught. The recorder plans on the server's clock.
- **The roster watches; nobody else.** Players with a seat in on the
  booking get a one-hour signed link (`recording` function). Not the
  owner, not a player who left. Ludi staff can reach footage only with a
  written reason, and every read lands in `recording_access`.
- **It expires.** Thirty days after the game a daily sweep removes the
  file; the organiser can delete it for everyone sooner.
- **Storage** is a private Supabase bucket reached only through signed
  URLs minted with the service role. The spike may move it to an object
  store without egress fees; the database does not care where the key
  points.

## Consequences

### Positive
- A reason to book through Ludi at a Ludi venue that a phone call cannot
  give, without becoming a camera on the owner's customers.
- The whole consent path is in the database, where pgtap tests it
  (`46_court_cameras.sql`).
- Dark by default: shipping this changes nothing until a camera row
  exists.

### Negative
- **Age is self-declared** (the profile's age band) and optional. A
  player under 18 who left it blank is not caught. Counsel must say
  whether that is enough, or whether recording needs every participant's
  own yes.
- **A signed link can be forwarded for its hour.** Clips (the plan's C4)
  are the sanctioned way to share; they are cut from this version.
- **Hosted storage limits.** The bucket allows 4 GB files; the project's
  global upload limit must be raised (Pro plan) before a full match
  uploads in one piece.
- **One file at the end.** Players see the match minutes after the final
  whistle, not during it; the venue's uplink sets how many.

## Alternatives considered

### The venue's camera, the venue's footage
Rejected: the owner would hold footage of his customers, which is CCTV
with extra steps, and every access rule would be his.

### A vendor camera (Veo, Pixellot, Spiideo)
Not rejected — the spike compares. None found that arms per booking by
API, and none lists futsal. A plain camera and a small recorder is the
working assumption.

### Every participant must agree
Stronger, and possibly what counsel will require. Not built yet because
a single refusal would need to switch off a game others want recorded,
which is the organiser's call today. Revisit with counsel's answer.
