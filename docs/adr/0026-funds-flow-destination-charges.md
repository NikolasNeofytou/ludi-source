# ADR-0026 — Funds flow is destination charges; refunds reverse the transfer

**Status:** Accepted — the refund posture is reversible (one parameter);
the charge model is expensive to walk back once real venues are settling
**Date:** 2026-08-29
**Deciders:** Solo founder
**Supersedes:** —
**Superseded by:** —

## Context

M6 #38, open since 2026-06-09: the Stripe platform profile (the
dashboard questionnaire) says *sellers collect payments directly* —
direct charges — while the code has always done **destination
charges**: `create-booking` makes the PaymentIntent on the platform
account with `application_fee_amount` and
`transfer_data.destination`, verified live on 2026-08-21 when a real
PI settled with `application_fee_amount: 450`. Code and profile
actively disagreed and nobody had picked. Split payment (C2,
[plans/community.md](../plans/community.md)) is N payers fanning
refunds back out on cancellation; it cannot be designed on an
unchosen model. This ADR is that reconciliation.

Reading the docs for the reconciliation surfaced a live defect: both
refund paths (`cancel-booking`, `admin-refund-booking`) called
`refunds.create` with `refund_application_fee: true` and **no
`reverse_transfer`**. Stripe's documented behaviour for destination
charges: *"by default the destination account keeps the funds that
were transferred to it, leaving the platform account to cover the
negative balance from the refund"*, and `refund_application_fee`
*pushes the fee **to** the connected account* — the reverse of what
both call sites' comments believed. Stripe also requires the transfer
be reversed whenever the fee is refunded, so the shipped combination
may simply have been rejected. Net effect had it run with real money:
on a €45 booking refunded 50%, Ludi pays the customer €22.50 while
the venue keeps €40.50 — roughly −€25 against +€4.50 earned.

Facts that constrain the choice: venues are **Express accounts** with
no Stripe dashboard (Stripe explicitly recommends destination charges
for exactly these); the checkout is Ludi-branded, so the player
already believes they are paying Ludi; disputes debit the platform
for destination charges either way; and the destination-charge money
path is the one verified end-to-end before launch.

## Decision

**Ludi commits to destination charges.** The platform is the
settlement merchant: charges land on the platform account, the
venue's share transfers automatically, Ludi keeps
`application_fee_amount`, and Ludi carries refund/dispute liability
(recoverable from the venue by transfer reversal).

Refunds are the mirror image: `reverse_transfer: true`, and
`refund_application_fee` **absent**. Partial reversals are
proportional, so the arithmetic unwinds pro-rata for everyone with no
extra flags — on a 50% refund the customer gets half back, the
venue's payout halves via the reversal, and Ludi's fee halves through
the balance math (−refund +reversal against +fee).

The code was already the decision; what changes is one parameter in
two refund calls, and the **platform profile questionnaire**, which
the founder corrects in the Stripe dashboard to say the platform
collects payments.

## Consequences

### Positive

- Zero rewrite of the verified money path before launch; the fix is
  two one-line edits.
- Refunds now cost each party their proportional share instead of
  Ludi funding 100% while venues keep everything.
- Split payment inherits a settled model: shares are platform
  charges; how the venue's total moves is C2's DATA_MODEL question.

### Negative

- Ludi eats chargebacks first and must reverse transfers to recover —
  the price of being settlement merchant, mitigated by the small
  ticket sizes.
- The platform-profile correction is a founder dashboard action this
  repo cannot verify; until clicked, Stripe's guidance to us is tuned
  to the wrong model.

### Neutral

- `on_behalf_of` stays unset: platform and venues are both EU/Cyprus,
  so no cross-region settlement-merchant requirement applies, and the
  statement descriptor stays Ludi's.

## Alternatives considered

### Direct charges (match the questionnaire instead)

Charges on each venue's Express account; venue is merchant of record
and eats refunds/disputes — with no dashboard to manage them. A
rewrite of the verified checkout/webhook/refund path days before
launch, to arrive at a model Stripe recommends against for
dashboard-less accounts. Rejected.

### Separate charges and transfers

Collect platform charges with no `transfer_data`, move the venue's
money later with explicit Transfers. Strictly more flexible — and
plausibly the right mechanics for split-payment *shares* (collect N
shares, one transfer when the fixture confirms). **Deliberately not
decided here**: it is a C2 DATA_MODEL question, and single-payer
bookings today have no need for the extra moving part. Nothing in
this ADR blocks adopting it for shares later; both models coexist on
one platform account.

## Amendment 2026-09-13 — refunds also refund the application fee

The refund posture above was wrong in one parameter. "Ludi's fee halves
through the balance math" holds only if the venue's transfer is the
charge **net** of the fee. With `application_fee_amount`, Stripe
transfers the **full** amount to the connected account and collects the
fee back as a separate ApplicationFee. So `reverse_transfer` alone takes
the whole refund out of the venue, and Ludi keeps its whole fee.

Measured in Stripe test mode (Express account, €43.00 charge, €4.30
fee, 50% refund of €21.50, `transfer.amount` = 4300):

| Refund flags | Venue net | Ludi net | Agreement clause 6.4 |
|---|---|---|---|
| `reverse_transfer` | €17.20 | €4.30 | — |
| `reverse_transfer` + `refund_application_fee` | €19.35 | €2.15 | €19.35 / €2.15 |

On a full refund the first row leaves the venue **€4.30 out of pocket**
and Ludi's fee intact, which contradicts the signed agreement ("no
Commission is payable on Bookings that are fully refunded… Commission
applies to the amount retained").

`refund_application_fee` does push the fee to the connected account, as
quoted above. That is the point: the venue funded the full reversal, so
the fee has to go back to it. The original defect this ADR fixed
(`refund_application_fee` without `reverse_transfer`) was wrong for the
opposite reason: Ludi funded the refund.

**Decision, amended:** single-payer refunds pass **both**
`reverse_transfer: true` and `refund_application_fee: true`
(`cancel-booking`, `admin-refund-booking`; the webhook's orphan refund
already did). Split fixtures (ADR-0027) are unaffected: their one
Transfer is already net of the fee, so a pro-rata reversal scales the
fee correctly with no fee refund. `v_venue_earnings_daily` scales
single-payer fees by the un-refunded fraction to match (migration
`20260913000002`).

## Amendment 2026-09-16 — the platform is Greek, and the descriptor is not Ludi's

Two factual claims in *Consequences → Neutral* are wrong. Audited against
the live-mode-identical account record on 2026-09-16
(the platform's Stripe account):

> `on_behalf_of` stays unset: platform and venues are both EU/Cyprus, so no
> cross-region settlement-merchant requirement applies, and the statement
> descriptor stays Ludi's.

- **The platform account is registered in `GR`, not CY.** Its connected
  accounts are CY. The premise "both EU/Cyprus" is false, so the reasoning
  for leaving `on_behalf_of` unset does not hold as written. The
  *conclusion* may still be correct — a GR platform serving CY connected
  accounts works, and has been settling Piacere's charges — but it now needs
  confirming with Stripe support rather than asserting.
- **The statement descriptor is `NIKOLASNEOFYTOU.SUBSTA`.** It is the
  account-level descriptor of a personal Stripe account shared with
  unrelated projects, and `create-booking` sets no per-PaymentIntent
  descriptor, so it rides every destination charge. Every player would see
  it on their card statement. As settlement merchant under this ADR, Ludi
  absorbs the resulting chargebacks first.

**What does not change:** the funds-flow decision. Destination charges
stand, the refund posture stands, the arithmetic stands. Only the supporting
facts were wrong.

**What must change before a live charge:** the descriptor is set to `LUDI`
and Connect branding is filled in, both in live mode (per-mode settings; the
test values do not carry over). Whether the live platform is this account at
all is the entity question in
[runbooks/money-flip.md](../runbooks/money-flip.md) §0 and §1.0 — an
account's country is immutable, so "move Ludi to a Cyprus entity" means a
new Stripe account and re-onboarding every venue.

## Follow-ups

- Founder: correct the platform profile in the Stripe dashboard.
- Founder: ask Stripe support whether a GR individual platform may serve CY
  connected accounts under a Cyprus-law contract (2026-09-16 amendment).
- Founder: set the live statement descriptor to `LUDI` and fill in Connect
  branding before any live onboarding link is sent.
- C2 DATA_MODEL: decide share mechanics (destination charge per share
  vs separate charges + one transfer) against this ADR.
- The `completed`-state defect (#45) still leaves played flex
  bookings 50%-refundable — unrelated to this ADR but adjacent on the
  same path; it keeps its own ledger line.
- Related: ADR-0022 (nothing that moves money hides in an RPC),
  [JOURNAL.md](../JOURNAL.md) entry of 2026-08-29.
