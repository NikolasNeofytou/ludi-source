# ADR-0021 — The fixture invite capability is a rotatable token, not the booking code

**Status:** Accepted — reversible (drop the column; no data migration, no
row rewritten)
**Date:** 2026-08-24
**Deciders:** Solo founder
**Supersedes:** —
**Superseded by:** —

## Context

The **booking as a shared fixture** version
([docs/plans/shared-fixture.md](../plans/shared-fixture.md)) turns a
booking into something other people join. The organiser sends one link
into a WhatsApp group; whoever opens it takes a slot on the roster.

The obvious link is the one the product already shows: the booking code.
`LAR-2026-0009` is printed on the confirmation screen in JetBrains Mono
precisely because it is the artefact players screenshot and paste into
their group chat, and `ludi://f/LAR-2026-0009` reads well.

It is also **sequential**. `generate_booking_code()` draws from
`booking_codes_seq` per city and year, so the code is
`CITY-YEAR-NNNN` with a monotonic counter. Anyone holding one code can
enumerate every other booking in that city and year by adding one. If the
code is what authorises a join, then a single legitimate invite is a key
to every fixture Ludi has ever taken in Larnaca — not just to read them,
but to walk into a stranger's roster and be there when they turn up.

That is not a hypothetical failure mode. It is the same shape as the
finding in M6 #41e, where owner UPDATE policies were correct at the row
level and the mistake was in what the capability let you reach. The
lesson recorded there — *the policy looked right, the capability was the
bug* — is the reason this decision is being written down before the code
exists rather than after a pentest.

Constraints: pre-launch, so the shape can be set calmly; no push
notifications exist, so a link in a chat app is the only distribution
channel a fixture has; and the same link may be forwarded on by anyone
who receives it, which the design must assume rather than discourage.

## Decision

**`bookings` carries a separate `invite_token` — random, high-entropy,
rotatable, revocable — and that token, never `bookings.code`, is what
authorises reading a fixture preview or joining its roster.** The deep
link is `ludi://f/<token>`.

The code keeps the job it already has: a short human-readable reference
you can read down a phone line to a venue. It identifies a booking to
someone who already has the right to see it. It grants nothing.

Shape:

- `invite_token text NOT NULL UNIQUE DEFAULT`, generated from
  `gen_random_bytes` and base64url-encoded — not a UUID, because a v7
  UUID is time-ordered and therefore partially guessable, and this column
  exists specifically to be unguessable.
- Rotatable: regenerating the token invalidates every link previously
  shared. That is the revocation story for "the link got forwarded
  somewhere it shouldn't have", and it costs one UPDATE.
- The token is **not** shown as text anywhere in the UI. It travels
  inside a link. A code is for reading aloud; a token is not.
- Before joining, the token buys a **narrow preview only**: when, where,
  format, how many spots are open, whether a keeper is needed. Not
  names, not the roster, not the organiser's phone. A link forwarded into
  a second group chat must not publish who is playing to whoever it
  reaches next — the minimisation posture of
  [ADR-0012](./0012-player-profile-data-posture.md) applies to a roster
  at least as strongly as it applies to a card.

## Consequences

### Positive

- Enumeration is dead by construction. There is nothing to increment.
- Revocation exists and is cheap, which means a mis-forwarded link is a
  recoverable mistake rather than a permanent one.
- The booking code stops being load-bearing for anything but human
  reference, so its readability can keep being optimised for humans
  (short, unambiguous, speakable) without a security consequence.
- The preview/full split gives us a natural place to put the join gate,
  and it keeps the "who is playing" list behind having actually joined.

### Negative

- Two identifiers for one booking, which is one more thing to keep
  straight in code and in conversation. Mitigated by the naming: `code`
  is shown, `invite_token` is sent.
- The link is opaque. An organiser cannot eyeball it and tell which
  fixture it belongs to, and cannot read it out over the phone. This is
  the property we are buying, but it does cost the "just tell them the
  code" affordance for joining.
- Rotation invalidates links already sitting in a chat history, with no
  way to tell anyone (no push). The fixture screen has to be able to
  explain a dead link.

### Neutral

- The token is a bearer capability: anyone holding it can join while
  slots remain. That is the intended semantics of "one link into the
  group chat" and is not a weakening — the alternative, per-person
  invites, is a different product.
- Capacity is what bounds the damage of a leaked token, not
  authentication. A full roster cannot be joined by anyone.

## Alternatives considered

### Use the booking code

Rejected. Sequential and therefore enumerable; see Context. It would
also mean the value printed on a screenshot people share publicly is the
value that grants access, which is exactly backwards.

### Per-person invites (one token per invited user)

The organiser names who is coming and each gets a unique link. Strictly
tighter, and it makes revocation per-person. Rejected for this version:
the whole point of the slice is *one link into a group chat*, and
accounts-only already means the roster fills with real, identified
people. Per-person invites are the natural shape if fixtures ever become
public or paid-at-join, and this ADR does not block that.

### Signed link with an expiry (JWT-style)

Self-verifying, no column, no lookup, natural expiry. Rejected because
revocation before expiry requires a denylist — which is a table, which is
the thing the signed link was supposed to avoid — and because the
fixture's own lifetime already provides the expiry we want: a token is
useless once the fixture has started or filled.

### Keep the roster entirely inside the app, no links

Organiser adds people by picking them from a list. Rejected: it requires
knowing who is on Ludi before the invite, which inverts the growth path.
The link into the group chat *is* the distribution.

## Follow-ups

- The join path enforcing all of this is
  [ADR-0022](./0022-join-fixture-definer-rpc.md).
- Revisit if fixtures ever become public (open matches, Stage 3+): a
  publicly listed match wants a stable shareable identity, which is a
  different object from a bearer capability and should not be solved by
  loosening this one.
- Rotation has no UI in this version. If a "the link leaked" support
  request ever arrives, that is the trigger to add one.
