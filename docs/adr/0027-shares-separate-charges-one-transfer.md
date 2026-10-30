# ADR-0027 — Split-fixture shares are separate platform charges with one transfer at confirm

**Status:** Accepted — reversible until W3 ships real share PIs; expensive
after real fixtures have collected money under it
**Date:** 2026-08-29
**Deciders:** Solo founder (mechanics recommended by the C2 plan; product
shape decided by the founder 2026-08-29 — anchor, T-24h, cover-or-die)
**Supersedes:** —
**Superseded by:** —

## Context

ADR-0026 committed Ludi to destination charges for single-payer bookings
and explicitly left one door open: how split-fixture *shares* move.
A split fixture is N payers whose dominant failure mode is **never
filling** — the T-24h deadline kills it and every paid share refunds
100% ([plans/split-payment.md](../plans/split-payment.md)). Whatever
mechanics are chosen get exercised hardest by that unwinding path, not
the happy path.

Two candidates, both compatible with one platform account:

- **Destination charge per share** — every share PI carries its slice of
  `application_fee_amount` and `transfer_data.destination`. The venue
  receives money share by share, and a dying fixture unwinds as N
  refunds *each with its own transfer reversal*.
- **Separate charges and transfers (SCT)** — share PIs are plain
  platform charges; nothing reaches the venue until the fixture
  confirms, when **one Transfer** moves `total_cents −
  platform_fee_cents`.

## Decision

**SCT.** Shares (`payments.kind IN ('share','cover')`) are plain
platform charges with no `transfer_data`; the webhook's confirm branch
verifies the sum invariant (`Σ succeeded shares + cover =
total_cents`) and creates one Transfer, idempotency key
`transfer:{booking_id}`. Before that Transfer exists, every refund in
the fan-out table is a plain platform refund — no reversal, no venue
involvement, no partial-reversal arithmetic. After confirm,
cancellation is N pro-rata share refunds plus **one** proportional
transfer reversal (the ADR-0026 semantics, once).

The venue's experience also argues for it: one payout-shaped Transfer
per fixture rather than a dribble of ten small transfers with
occasional claw-backs.

## Consequences

### Positive
- The failure mode that will actually happen (fixture dies collecting)
  is the trivially-safe path: platform-balance refunds only.
- One Transfer per fixture = one reconciliation line per fixture, for
  Ludi and for the venue.
- `application_fee_amount` machinery is not stretched across N PIs;
  the fee is implicit in transferring `total − fee`, and
  `bookings.platform_fee_cents` (stored, frozen) remains the ledger.

### Negative
- Ludi holds collected shares on its balance during `collecting` —
  custodial exposure bounded by `share_amount × slots × live fixtures`
  and by the T-24h clock. Accepted at current scale.
- The earnings views must not count a `collecting` fixture as venue
  revenue (already excluded by construction; pinned in the census).
- Two mechanics coexist on the platform account (destination charges
  for single-payer, SCT for shares). `payments.kind` is the
  discriminator; the webhook branches on it.

### Neutral
- Stripe processing fees are per-PI, so N small charges cost slightly
  more in fees than one big one. That is the price of per-head
  payment, not of this ADR.

## Alternatives considered

### Destination charge per share
Rejected on the unwinding path: a dying fixture becomes N refunds ×
N reversals with proportional arithmetic on each, and the venue
watches money arrive and leave repeatedly for a booking that never
confirmed. Strictly worse at the exact moment correctness matters
most.

### One PI, N payment methods
Does not exist in Stripe's model; a PI has one payer.

## Follow-ups
- W3 implements `claim-share` + the confirm branch against this ADR.
- W5's cancellation fan-out cites the post-confirm posture above.
- If custodial exposure ever matters (regulatory or scale), revisit
  with Stripe's on_behalf_of/settlement guidance — the SCT shape is
  the one Stripe documents for exactly that evolution.
- Related: ADR-0026 (funds flow), ADR-0022 (money moves in functions).
