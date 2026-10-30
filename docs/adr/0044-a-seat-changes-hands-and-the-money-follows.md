# ADR-0044 — A seat changes hands, and the money follows it

**Status:** Accepted
**Date:** 2026-10-13
**Deciders:** Nikolas Neofytou (founder)
**Supersedes:** —
**Superseded by:** —
**Amends:** ADR-0027 (one row added to its refund table), ADR-0028 (the board's open count)

## Context

"Andreas can't make it, who's in?" is the weekly message in every 5-a-side
group. Ludi already had the pieces around it: a roster with leave and
rejoin (ADR-0022), an invite capability (ADR-0021), an open board
(ADR-0028), split payment with one Transfer to the venue (ADR-0027). It did
not have the act itself. Leaving freed the seat at once, so a squad found
out it was a man short when it looked; the leave sheet's "ask for a
replacement" only shared the invite link.

The money made the gap worse on split fixtures. Split-payment.md drew two
rules: while `collecting`, a paid leaver is refunded 100%; after
`confirmed`, a single leaver gets nothing ("the fixture is bought;
replacement is the invite's job"). The first rule was never built — leaving
is a bare status flip, so the share stayed, the next claimant over-collected,
`settle_split_booking` refused, and a fixture that had filled died at its
deadline. The second rule is right for a leaver nobody replaces and wrong
for one somebody does: the replacement joined free while the leaver's money
paid for their seat.

Building this also exposed that `charge.refunded` flipped the whole booking
to `refunded` on any full refund of any of its payments. On a split fixture
a single share refund — a late surplus, a leaver, now a swap — would have
freed a confirmed slot.

## Decision

**A seat changes hands in one step, and on a paid split seat the taker's
share replaces the leaver's.** The leaver asks (`replacing_since`) and keeps
the seat. Whoever takes it — through the invite, the board or the crew
shelf — moves in as the leaver moves out, in one transaction under the
booking lock (`_swap_seat`), recorded in `seat_swaps`.

- **Free fixture, or a split seat nobody paid for:** `take_seat` RPC, swap
  `done` at once.
- **Confirmed split seat the leaver paid for:** the seat moves first
  (claim-share's order), the taker pays the frozen `share_amount_cents`
  through `take-seat`, and when that share settles the webhook refunds the
  leaver's share and marks the swap `done`. A taker who walks away from the
  card sheet has 15 minutes; then the sweeper reverts the swap and the
  leaver is back on the seat, still asking.
- **Collecting split fixture:** no replacement. Leaving refunds the share
  (`leave-share`), and the database refuses the bare flip on a seat with
  money on it (`LEAVE_NEEDS_REFUND`). The seat reopens to the ordinary claim.
- **The venue is untouched.** It was paid once, at confirmation; the
  taker's charge funds the leaver's refund on the platform balance. Earnings
  leave a swapped-out share out of both gross and refunds.
- **Who sees the seat:** anyone holding the invite (as before); the board
  and the venue's screen when the organiser opened the fixture (an asked-for
  seat counts as open); and `v_crew_seats` — players who finished a match
  with the asker or with the organiser — whether or not it is on the board.
- **`charge.refunded` flips a booking only for a `kind='booking'` payment.**

## Consequences

### Positive
- A squad is never silently a man short: the seat is held until it is
  filled, and the roster says who can't make it.
- The paid leaver is made whole exactly when someone else pays, so the
  venue and the other players are unaffected and nobody chases anyone.
- Two latent money defects in split payment are closed before split goes
  live: the paid leaver on a collecting fixture, and the whole-booking flip
  on a share refund.

### Negative
- Ludi pays the Stripe fee on the taker's charge and does not recover the
  leaver's original fee (~€0.40 on an €8 share). Accepted as the cost of the
  feature; revisit if swaps become a way to resell seats.
- `v_crew_seats` publishes an invite token to past teammates of the asker
  and of the organiser, without the organiser opening the fixture. The
  asker's ask is consent for their own teammates; the organiser's past
  squads are the people the invite link is normally forwarded to.
- The paid path needs the functions runtime and Stripe; it was verified end
  to end against Stripe test mode locally, not yet on a device.

### Neutral
- `fixture_preview` keeps `gk_open`/`outfield_open` as free seats
  (join_fixture's arithmetic) and adds the handed-over counts beside them;
  the board and the screen fold the two together.

## Alternatives considered

### Refund the leaver from the venue's transfer

Reverse part of the Transfer and re-transfer on the taker's payment.
Rejected: two Stripe movements touching the venue for what is a change of
name on a seat, and a reversal a venue would see on its statement.

### Money first, seat after (a pending swap with nobody moved)

Keep the leaver in until the taker pays. Rejected: the taker would sit on a
card sheet for a seat that is not theirs, and a second taker could pay for
the same seat. claim-share already proved seat-first with a compensating
sweep.

### Offer the seat to the crew first, the board after a delay

The FUTURE.md sketch. Rejected for now: at today's density a delay only
keeps the seat empty longer; both surfaces show it at once.

## Follow-ups

- Keeper seats to the goalkeeper pool first, once the pool exists in
  product (FUTURE.md *Position-scarce supply*).
- A push or WhatsApp to the crew when a seat is asked for, once a sender
  exists (owner-ping).
- Measure: `seat_swaps` per week, and time from ask to take.
