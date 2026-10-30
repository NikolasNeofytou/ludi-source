# ADR-0048 — A player's notices are a ledger, and push is the first channel

**Status:** Accepted
**Date:** 2026-10-14
**Deciders:** Nikolas Neofytou (founder)
**Supersedes:** —
**Superseded by:** —

## Context

The six bets built in October ([plans/reach.md](../plans/reach.md) §
Trigger context) all end in someone being told something: a keeper
request waits for a willing keeper, a handed-over seat waits for the
crew, a confirmed booking is a fact only its organiser's screen knows,
and nobody is told their game is in two hours. Until this version the
app had no way to reach a phone that was not open.

The forces are the ones [ADR-0030](0030-venue-notifications-ledger.md)
met for the venue's notices, plus two of the player's own:

- **The causes are many and unalike.** A booking confirms in the Stripe
  webhook; a keeper request opens in `gk_post` and closes in `gk_claim`;
  a seat changes hands through `ask_replacement` and `take_seat`; a
  fixture fills on the last join; a reminder has no writer at all, only
  a clock. A design that asks each writer to send will miss one.
- **A notice must be minted once** however often its cause is observed:
  the webhook retries, the sweepers re-run, a claim can race.
- **The audience is a query, not a list.** A keeper wanted goes to the
  willing players the pool already computes (`gk_audience_ok`); a seat
  offered to the crew `v_crew_seats` already names. The notice should
  reuse those answers, not restate them.
- **The player decides what they hear.** Two switches — their own games,
  and the asks they opted into by going in goal or playing with a crew —
  and the phone's own permission, which the app asks for at a moment
  that explains itself and never at launch
  ([R2](../plans/reach.md), migration `20261014000003`).
- **Quiet hours.** An ask at one in the morning is a bad ask; a reminder
  for a 07:00 game at 05:00 is a good one.
- **Transports will multiply.** Expo push now (one API for APNs and FCM,
  no server certificates to hold); email through Resend for the two
  notices a player wants in writing; WhatsApp when the Meta number the
  owner's desk needs exists.
- **CI runs vanilla Postgres** without pg_cron or pg_net; the migration
  must apply there and the interesting logic be testable there.

## Decision

**A notice is a row.** `player_notifications` is the ledger and the
queue: one row per player, per cause, per channel, with a
`UNIQUE NULLS NOT DISTINCT (kind, booking_id, ref_id, user_id, channel)`
and `ON CONFLICT DO NOTHING`, so the same cause observed twice mints
nothing new. The database mints (through `mint_player_notice`, which the
R4/R5 triggers call and the app never does); a pg_cron job calls the
`notify-players` Edge Function every minute; the function claims due
rows `FOR UPDATE SKIP LOCKED`, renders them from a pure module, sends
through Expo (push) or Resend (email), and marks each row sent, failed
or skipped. Nothing is ever sent from inside the transaction that
caused it.

The shape in one line, as in ADR-0030: **the database decides *that* a
player is told; the sweeper decides *when*; a transport decides *how*.**

- **Skipped is a status, not an absence.** A player with the switch off
  or no live token still gets a row, `skipped` with the reason, so "was
  this reminder sent" is always one query with an honest answer.
- **Quiet hours are a function.** `notice_send_after(kind, kickoff,
  now)` holds an ask minted between 23:00 and 08:00 Cyprus time until
  08:00, unless kickoff is before 11:00; a player's own game is never
  held. Pure, so pgtap injects the clock.
- **Push is per device, the row is per player.** A player with two
  phones gets one row and two Expo messages; the tickets are kept on
  the row. A device Expo reports gone — at send, or in the receipt
  fifteen minutes later — has its token disabled until that device
  registers again.
- **A transport failure retries, five times, with a growing wait;** then
  the row is `failed` with the last error kept. A claim older than ten
  minutes belongs to a tick that died and is released.
- **Email only where it is wanted:** a confirmed booking and a
  cancellation, when the player has an address. No key configured means
  the rows are `skipped` with `no_email_channel`, never lost.
- **The copy is one tested module** (`_shared/notices.ts`): both
  languages, the game named by kickoff, venue and code, never by who
  else is in it; an ask says what is asked and that the keeper plays
  free, never who is asking.

## Consequences

### Positive
- Every present and future cause notifies correctly without knowing
  notifications exist: a trigger sees the row, not the caller.
- Exactly-once is a constraint, not a convention.
- The ledger is the measurement reach.md asks for — time from a keeper
  request to a claim, reminders sent against fixtures played — and the
  later in-app list of notices, which the RLS already allows a player
  to read.
- A second transport is a `channel` value and a branch in the sender.

### Negative
- Up to a minute's latency on every notice, and a pg_cron job that must
  be watched (`cron.job_run_details`; ops-readiness O4).
- Two more secrets to seed on deploy day (`NOTIFY_PLAYERS_SECRET`, the
  Vault pair) and Resend's API key for the email branch.
- A player's rows accumulate; a prune (ninety days) is a follow-up.

### Neutral
- The venue's ledger (ADR-0030) and the player's are two tables with
  one shape. They stay separate: different audiences, switches and
  transports, and the venue's is not built yet.

## Alternatives considered

### Send from the writers
Each Edge Function and RPC calls Expo as it goes. Rejected for the
reason ADR-0030 gives: the writers are many, the sweeper nobody watches
is the one that forgets, and the webhook must not wait on a push API.

### A hosted notification service (OneSignal, Knock, Courier)
Would hold tokens and templates off-site, one more processor in the
privacy page and a per-MAU bill before there are MAUs. Expo's push API
is the one piece that is free and already the dependency the app has.

### Supabase Realtime / in-app only
Reaches only an open app, which is the problem being solved.

## Follow-ups

- The in-app list of notices, reading the player's own rows (a later
  version, when there is something to list).
- Prune `sent`/`skipped` rows older than ninety days.
- WhatsApp as a channel once the Meta number exists (owner-ping).
- Widen the app's tap routes to `/f/<token>` so a seat offered can open
  the invite directly (the next build after R0).
