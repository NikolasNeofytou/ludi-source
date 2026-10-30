# M6 #38 — Stripe Connect funds-flow: the reconciliation

**Date:** 2026-08-22
**Status:** Finding written. **Decision NOT taken** — it is not an
engineering decision, see §4.
**Blocks:** every commit that moves money, per
[stage-2-commit-plan.md](../stage-2-commit-plan.md). Open since 2026-06-09.

---

## 1. What #38 has been recorded as, and why that is wrong

The ledger says:

> Platform profile says *"sellers collect payments directly"* (direct
> charges); the code does **destination charges**. Decide the model, align
> the platform profile and the code, document it in api-contract.md.

That framing has kept this open for 74 days, and it is misleading in two
ways.

**There is no model to decide.** It was decided on 2026-04-21 in
[ADR-0004](../adr/0004-payments-stripe-connect.md), status **Accepted**:

> Bookings use `PaymentIntent` with
> `application_fee_amount = floor(total × take_rate_bps / 10000)` and
> `transfer_data[destination] = stripe_account_id`. Stripe splits funds
> automatically.

That is destination charges. It is what
[api-contract.md](../api-contract.md) §5.1 specifies, it is what
`create-booking` implements, and on 2026-08-21 it was demonstrated
working against `ludi-prod`: booking `LAR-2026-0009`, a real PaymentIntent
of €45.00 with `application_fee_amount: 450` and
`transfer_data.destination: acct_…` (the test venue's connected account), settling and driving
the booking to `confirmed` in under 8 seconds.

**And `api-contract.md` is not missing the funds flow.** It documents the
mechanism at §5.1; it simply never names the *model*, which is why
searching for "direct charge" or "destination charge" finds nothing and
the doc looks silent. It is not.

## 2. The actual contradiction

It is inside ADR-0004, not between the code and the docs.

The same ADR that specifies `transfer_data[destination]` also says, under
Consequences → Neutral:

> Stripe Tax handles EU VAT for Ludi's take rate (we charge VAT on the 10%
> fee, not on the booking itself — **pitch owner remains merchant of
> record on the €40**).

**Merchant of record sitting with the pitch owner is a direct-charge
property.** Under destination charges the charge is created on the
*platform's* account, and **Ludi is merchant of record on the full €40**.
ADR-0004 chose one mechanism and wrote down the tax consequences of the
other, in the same document, on the same day.

The Stripe platform profile — *"sellers collect payments directly"* —
agrees with the ADR's tax note and disagrees with the ADR's mechanism.

So it is three-way, and only one of the three is real:

| Source | Says | Real? |
|---|---|---|
| `create-booking` + ADR-0004 mechanism | destination charges | **yes — built, tested, verified in production** |
| ADR-0004 tax note ("owner is MoR") | direct charges | no — an assumption |
| Stripe platform profile | direct charges | no — a form field |

Note ADR-0004's *Negative* consequences are internally consistent with
destination charges — *"Platform liability: if a pitch owner
disputes-and-flees, Ludi is on the hook for the negative balance"* is
exactly the platform-as-MoR position. So the document half-knows.

## 3. What actually differs

| | Keep destination charges | Switch to direct charges |
|---|---|---|
| Merchant of record | **Ludi**, on the full €40 | The venue |
| Ludi's VAT position | Ludi is supplying pitch hire — VAT on the €40 | VAT on the ~€4.50 commission only |
| Chargeback liability | Ludi (ADR already accepts this) | Largely the venue |
| Payouts | Stripe splits automatically on one PI | Venue holds funds; Ludi's fee swept via `application_fee_amount` |
| Code change | **none** — this is what is built and verified | real, see below |
| Agrees with | the code | ADR-0004's tax note + the platform profile |

### Cost of switching to direct charges

Not a flag. The charge is created *on* the connected account:

- `create-booking` creates the PaymentIntent with a `stripeAccount`
  context rather than `transfer_data.destination`.
- The mobile Payment Sheet must be initialised against the connected
  account, so `create-booking`'s response (which already returns
  `publishable_key`) grows a connected-account id and the client changes.
- Refunds change. `cancel-booking` and `admin-refund-booking` both pass
  `refund_application_fee: true` today; under direct charges the refund is
  issued on the connected account and the fee reversal differs.
- **Webhooks change shape.** Payment events would originate from connected
  accounts, so they need a **Connected accounts**–scoped destination.
  Stripe's own console warned about exactly this on 2026-08-21 when the
  webhook destination was created — it was noted then as applying only to
  `account.updated`. Under direct charges it applies to every payment
  event, and the current destination
  (`we_1U73VNC6b9jtuxfVTpHckdku`, scope: *Your account*) would receive
  none of them.
- Connect **Express** accounts (what `venue-connect-onboard` creates,
  `type: 'express'`) support direct charges, so onboarding does not have
  to change — but the fee/liability presentation to the venue does.

## 4. Why this has not been decided in 74 days

Because it is not an engineering decision and has been filed as one.

Both options work technically. The fork is fiscal: whether Ludi is
**merchant of record on every booking** — supplying pitch hire, with the
VAT and chargeback exposure that implies for a Cyprus sole trader — or
**a commission agent on someone else's sale**. That is a question for an
accountant, and no amount of available engineering time moves it. It has
sat because it is filed in a queue that cannot answer it.

The engineering consequence is asymmetric and worth weighing: **keeping
destination charges costs nothing** — it is built, tested and verified —
while switching is a real change across four surfaces plus a webhook
re-scope. So the burden of proof sits with the tax position: if being MoR
on €40 is acceptable, the work is to correct two documents and one Stripe
form field. If it is not, the work is a version.

## 5. What to do, in order

1. **Take the fiscal question to an accountant**, framed as: *should a
   Cyprus sole trader running a pitch-booking marketplace be merchant of
   record on the full booking value, or a commission agent on the venue's
   sale?* Nothing below can start first.
2. **If destination charges stand** (the cheap path):
   - correct ADR-0004's tax note — or better, supersede it with a new ADR
     stating the model explicitly and its VAT/liability consequences;
   - change the Stripe platform profile to stop claiming sellers collect
     directly;
   - name the model in api-contract.md §5.1, so the next reader does not
     have to infer it from a parameter.
3. **If direct charges are required:** that is a version, not a chore —
   `create-booking`, the Payment Sheet, both refund paths, and the webhook
   scope. Plan it as one.

Either way #38 stops being "reconcile the funds flow" and becomes either a
documentation correction or a scoped piece of work. It should not stay a
one-line ledger row.

## 6. Bearing on the shared-fixture version

[shared-fixture.md](../plans/shared-fixture.md) names #38 as work unit 1
because split payment is N payers into one venue with refunds fanning
back out. That still holds, and this finding sharpens it: under direct
charges, N payers each paying *the venue* is a materially different
integration from N payers paying *Ludi*, which then transfers. Split
payment cannot be designed before this is answered — not because of the
code, but because the two shapes have different refund and liability
models.
