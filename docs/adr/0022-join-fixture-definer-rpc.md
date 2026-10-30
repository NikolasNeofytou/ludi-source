# ADR-0022 — Joining a fixture is a `SECURITY DEFINER` RPC, not an Edge Function

**Status:** Accepted — reversible, and the trigger for reversing it is
named below
**Date:** 2026-08-24
**Deciders:** Solo founder
**Supersedes:** —
**Superseded by:** —

## Context

`booking_participants` (see
[DATA_MODEL](../plans/shared-fixture.md#data_model)) is the first child
of `bookings` that a **non-owner** writes. Everything that touches a
booking today goes through an Edge Function with the service-role key,
and the RLS migration says so in as many words:

> No INSERT/UPDATE/DELETE policies: client cannot write directly.
> Booking creation, state transitions, and cancellations flow through
> Edge Functions that use the service role key (bypassing RLS).
> **This is a deliberate security boundary, not an oversight.**

So the default answer is "another Edge Function", and this ADR exists
because the default is wrong here for reasons worth recording.

Three forces:

1. **Joining is not a money path.** The Edge Function convention in
   [CONVENTIONS.md](../CONVENTIONS.md) §Edge Functions is built around
   money: server-computed pricing, Stripe idempotency keys, the
   `idempotency_keys` cache, webhook signature verification. A join
   writes one row and moves nothing. None of that machinery applies.
2. **Capacity is a lock-then-count, and it must be atomic.** "No more
   than `gk_slots` participants with `status = 'in'`" cannot be a
   constraint. It is `SELECT … FOR UPDATE` on the booking row, then a
   count, then an insert. In SQL that is one transaction by
   construction. From an Edge Function it is either three round trips
   with a race between them, or a single call to… a SQL function.
3. **The capability is a token** ([ADR-0021](./0021-invite-token-not-booking-code.md)),
   and RLS cannot see a token that is not a column of the row being
   written. Whatever performs the join has to be trusted code that takes
   the token as an argument. The question is only *where that trusted
   code runs*.

## Decision

**Joining is `public.join_fixture(invite_token text, slot_kind text)` —
a `SECURITY DEFINER` SQL function with a pinned `search_path`, called
over PostgREST by the signed-in client. Leaving is a plain RLS-gated
UPDATE on the caller's own row, guarded by a column trigger. No Edge
Function is introduced for either.**

The security boundary the migration describes is preserved, not
breached: `booking_participants` still has no INSERT policy at all. The
only thing that can create a participant row is the definer function,
which is auditable in one place and takes exactly two arguments.

The function validates, in order, and returns a stable error code rather
than a raw SQLSTATE:

1. the token resolves to a booking;
2. the booking is joinable — `state IN ('pending','paid','confirmed')`
   and `starts_at > now()`;
3. the requested `slot_kind` has a free slot, under the booking row lock;
4. the caller is not already on the roster (a rejoin flips their existing
   row back to `in`, it does not insert a second).

Errors surface as `RAISE EXCEPTION … USING ERRCODE`, mapped to the same
`SCREAMING_SNAKE_CASE` vocabulary the Edge Functions use
(`FIXTURE_FULL`, `FIXTURE_STARTED`, `FIXTURE_CANCELLED`,
`INVALID_INVITE`, `ALREADY_IN`) so the mobile client switches on error
codes exactly as it does for `cancel-booking`. The client's error
handling does not learn a second dialect.

## Consequences

### Positive

- Capacity is enforced atomically, in the same transaction as the write,
  with no race window and no distributed-transaction hand-wringing.
- One round trip instead of two. Opening an invite link on a phone in a
  car park outside a pitch is exactly the situation where a saved
  round trip is worth having.
- No new function to deploy, warm, or hold secrets. The join path cannot
  leak a service-role key because it never has one.
- The trusted code sits next to the data it protects and is covered by
  the same pgtap suite as the policies, rather than by a Deno test that
  mocks the database.

### Negative

- It splits the "how do writes happen" story: money writes go through
  Edge Functions, roster writes go through a definer RPC. Someone
  reading the codebase cold has to learn two paths. This ADR is the
  answer to "why".
- Definer functions are the standard footgun. Mitigated the same way
  `is_admin()` was after #36: pinned `search_path` (CVE-2018-1058),
  narrow arguments, no dynamic SQL, and pgtap coverage that asserts a
  caller cannot join a fixture they were not invited to.
- Error mapping from SQLSTATE to the client vocabulary is manual, and a
  missed mapping surfaces as a generic failure. Covered by a test per
  error code.

### Neutral

- Leaving being a plain UPDATE means it is governed by RLS plus a column
  guard rather than by trusted code. That is correct — the caller is
  acting only on their own row — but it does mean the column guard is
  load-bearing, exactly as it is on `users.role` and on the owner
  columns from #41e.

### The named trigger for revisiting

**When joining costs money, this decision is reopened.** Split payment
(unit 3, behind #38) may make a join create a share and a PaymentIntent,
at which point the join is a money path, needs Stripe idempotency, and
belongs in an Edge Function like everything else that moves euros. That
is a migration we accept in advance rather than pre-building a function
for a shape we cannot yet specify — #38 is undecided, so any Edge
Function written now would be written against a guess.

## Alternatives considered

### An Edge Function `join-fixture`

Consistent with every other booking write, and already has the auth,
Zod-validation and structured-error scaffolding. Rejected because all of
that scaffolding exists to serve money paths, and because it would still
have to call into SQL to make the capacity check atomic — leaving the
Edge Function as a pass-through that costs a round trip and a deploy
target. Revisit when the trigger above fires.

### An INSERT policy on `booking_participants`

`WITH CHECK (user_id = auth.uid() AND …)`. Rejected twice over: RLS
cannot see the invite token, so the policy could not express the
capability; and capacity would have to be a trigger anyway, so the
"simple declarative policy" is not simple.

### Client-side capacity check, then insert

Read the roster, count, insert if there is room. Rejected — this is the
double-booking bug the booking flow already solved with a row lock, and
it would reintroduce it one table over. Two people opening the same
invite link at the same moment is the *expected* case, not the edge one:
that is what sending a link to a group chat does.

## Follow-ups

- [ADR-0021](./0021-invite-token-not-booking-code.md) defines the token
  this function consumes.
- The roster **read** path is not a new decision: it is
  [ADR-0013](./0013-cross-player-card-read.md)'s dedicated-definer-view
  shape, with one difference recorded in DATA_MODEL — a card is meant to
  be public and a roster is not, so the view carries a caller predicate.
  No ADR of its own; if that predicate ever loosens, that *is* a new
  decision and gets one.
- Revisit on #38 landing, per the named trigger.
