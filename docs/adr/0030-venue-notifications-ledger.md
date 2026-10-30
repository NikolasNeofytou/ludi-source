# ADR-0030 — Venue notifications are a ledger minted by a database trigger and drained asynchronously

**Status:** Proposed (reversible — the ledger is additive; the trigger and the cron job can be dropped without touching a booking)
**Date:** 2026-09-11
**Deciders:** Nikolas Neofytou
**Supersedes:** —
**Superseded by:** —

## Context

Nothing tells a venue that an app booking landed or was cancelled. This
was verified in code on 2026-09-05 and again on 2026-09-11 across every
writer of `bookings.state`. The gap matters because the first real venue
owner keeps the book on paper ([owner-v2.md](../plans/owner-v2.md) finding
2): a booking the owner does not know about is a double booking waiting
to happen, and the money flip's precondition — owner approval
([booking-approval.md](../plans/booking-approval.md)) — needs a way to
reach the owner at all before it can ask them anything.

The forces that shape *how* the venue is told:

- **The writers are many and unalike.** A booking becomes real in the
  Stripe webhook handler; it stops being real in `cancel-booking`, in the
  `expire-collecting` sweeper, in `admin-refund-booking`, in the split
  settlement RPC, and in the walk-in un-book path. Four Edge Functions and
  two SQL functions, written across five months. Any design that asks each
  writer to remember to send will miss one, and the one it misses will be
  the sweeper nobody watches.
- **The money path must not wait on email.** The webhook handler has to
  answer Stripe fast and idempotently. A Resend outage inside that handler
  would turn into Stripe retries against a booking that is already
  confirmed.
- **Retries must be safe.** Stripe delivers events at least once; the
  sweeper re-runs every five minutes; an admin can refund twice by
  accident. A notice must be minted exactly once per (booking, kind,
  recipient) no matter how many times the transition is observed.
- **Transports will multiply.** Email now; WhatsApp when a Business API
  account exists; SMS if Twilio's compliance profile ever clears. The
  approval version adds kinds with buttons. The player's own confirmation
  email is still unbuilt. Whatever ships first will be extended, so its
  shape is the decision.
- **CI runs vanilla Postgres** with neither pg_cron nor pg_net. Whatever
  the design is, the migration must apply there and the interesting logic
  must be testable there.

The project already has one asynchronous job in production:
`expire-collecting`, driven by pg_cron → pg_net → Edge Function with a
Vault-held secret, spike-proven in
[spikes/scheduled-edge-function.md](../spikes/scheduled-edge-function.md).

## Decision

**A notice is a row.** A `venue_notifications` table is the ledger and
the queue: an `AFTER UPDATE OF state` trigger on `bookings` mints one row
per recipient for the transitions that mean "this slot became real" or
"this slot was released", with a UNIQUE on `(booking_id, kind, channel,
recipient)` and `ON CONFLICT DO NOTHING`. A pg_cron job calls a
`notify-venue` Edge Function every minute, which selects unsent rows `FOR
UPDATE SKIP LOCKED`, renders, sends through Resend, and marks each row
sent or failed. Nothing is ever sent from inside a booking's own
transaction or from inside the function that changed its state.

The shape in one line: **the database decides *that* the venue is told;
a sweeper decides *when*; a transport decides *how*.** Each can change
without the others knowing.

## Consequences

### Positive
- Every writer of `bookings.state` — present and future — notifies
  correctly without knowing that notifications exist. The trigger sees
  the row, not the caller.
- Exactly-once minting is a constraint, not a convention. Retried
  webhooks, re-run sweepers and double-clicked refunds cannot duplicate.
- The money path is untouched: the webhook handler's latency and failure
  modes do not change by a byte.
- The ledger is the audit and the measurement. "Did the owner get told,
  when, and did it fail" is one query — the same query the approval
  version's time-to-decision metric will run against.
- A second transport is a `channel` value and a branch in the sender. A
  new kind is a CHECK edit and a template.
- CI covers the important half. Minting is pure SQL and runs under pgtap
  without pg_net; the render is a pure function and runs under Deno
  without a database. Only the last hop (Resend) needs a live key.

### Negative
- Latency is a minute plus drain time, not milliseconds. Fine for a
  notice; too slow for an approval request whose deadline clock is
  running. The approval version will add a trigger-side `net.http_post`
  kick when pg_net is present (see Follow-ups) — the ledger shape does not
  change for that, only the wake-up.
- An idle tick every minute is ~43k function invocations a month doing
  nothing. Accepted against a 500k free-tier ceiling; revisit if the count
  of scheduled jobs grows.
- One more Vault pair and one more function secret to seed on deploy day,
  and one more place a mis-seeded secret fails visibly in
  `cron.job_run_details` rather than loudly in an inbox.

### Neutral
- The recipient address is copied into the row at mint time. An owner
  who changes their sign-in email after a notice was queued gets it at
  the old address; a notice queued after gets the new one. This is the
  same posture as a posted letter.
- The trigger runs inside the state-changing transaction. It does one
  `INSERT … SELECT` against `venue_owners` and `auth.users`; measured cost
  is negligible next to the EXCLUDE check the same transaction already
  pays.

## Alternatives considered

### Send inline from each Edge Function

Each writer calls Resend after its own state change. Fastest to build for
one writer, wrong for six: the sweeper and the RPCs are SQL and cannot
call Resend at all; the webhook handler would take a network dependency
on a mail provider inside Stripe's retry window; and nothing would
prevent a retried event sending twice. Rejected on the "every writer"
force alone.

### Supabase Database Webhooks (dashboard-configured)

Supabase can fire an HTTP call on a table change from the dashboard. It
is pg_net underneath, so it is the same mechanism with the configuration
outside the migrations — invisible to CI, invisible to a fresh
environment, and with no ledger of what was sent. Rejected because the
project's rule is that everything that shapes production is a committed
file, and because a fire-and-forget hook has no exactly-once story.

### A trigger that calls `net.http_post` directly, no cron

Immediate latency, no idle ticks. But pg_net is absent on CI, so the
trigger body needs dynamic SQL guarded by an extension check, the Vault
lookup lands on the hot path of every booking transition, and a failed
send has no retry unless a sweeper exists anyway. Kept as the *wake-up*
upgrade for the approval version, layered on top of this ledger and this
cron sweeper — not as the base design.

### Realtime subscription in the dashboard

The owner is at a counter, not on our dashboard; the whole point is to
reach them where they already are. Rejected as the primary channel; a
dashboard badge may ride on the same ledger later.

## Amendment 2026-09-15 — two channels and a non-booking kind

The founder decided on 2026-09-15 that WhatsApp is not optional for the
first version: the owners live in WhatsApp, and an email read the next
morning does not stop tonight's double booking. The decision here does
not change — a notice is still a row, minted by the trigger, drained by
the sweeper — it is exercised twice per event: `channel` takes `email`
and `whatsapp` (and `sms` by CHECK, unminted), the recipient resolver
yields one row per channel an owner has consented to, and the sender
branches on `channel` (Resend; the Meta Cloud API with pre-approved
templates). WhatsApp goes **direct to Meta**, not through a BSP: Twilio's
compliance review has held SMS since August, and a second vendor between
us and Meta buys nothing but a second queue.

The morning day sheet is a `day_sheet` kind with `booking_id NULL` and
`payload.date`, minted by a daily SQL job. Same ledger, same drain, same
question answerable by one query.

Consent is a timestamp on `venue_owners` (`whatsapp_consented_at`),
taken at the counter; no timestamp, no WhatsApp row. Meta requires
opt-in and so does GDPR; a column is the honest shape of both.

## Follow-ups

- **Booking approval** (ADR-0034 — 0031–0033 were taken by enrolment, composites and standing bookings; with that version's W2) adds
  `approval_requested` / `approval_reminder` / `approval_expired` kinds and
  a trigger-side pg_net kick for sub-minute delivery. The ledger, the
  sender and the marking helpers are reused unchanged.
- **Player notices** (ARCHITECTURE step 9) — decide then whether they
  share this table with a `recipient_kind` column or get a sibling
  `player_notifications`. Lean: sibling; the venue ledger's RLS posture
  (service-role only) is wrong for rows a player should be able to read.
- **WhatsApp** — a `channel` value and a Business API account; the
  intake form already asks the owner which they prefer.
- **Owner read view** — if an owner ever asks "what did you send me", a
  view over their own venue's rows; not before.
- Revisit the every-minute cadence once a second scheduled job exists.
