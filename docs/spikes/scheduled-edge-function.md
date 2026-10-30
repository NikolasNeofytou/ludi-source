# Spike — a scheduled job that can call Stripe (pg_cron + pg_net → Edge Function)

> C2 W1 ([plans/split-payment.md](../plans/split-payment.md)). The
> split-payment expiry sweeper needs something that fires on a clock
> and can talk to Stripe — which means invoking an Edge Function,
> because ADR-0022's line holds: money moves in functions, never in
> the database. Run 2026-08-29 against the local stack; ~30 minutes.

## Verdict: **PASS** — Plan A works; no external scheduler needed.

## What was proven, leg by leg

1. **DB → HTTP → edge runtime.** `net.http_post()` from Postgres
   reached Kong at its in-network address and the response landed in
   `net._http_response`: a 401 `Missing authorization header` — Kong's
   JWT gate answering, which is the transport working.
2. **Authenticated invocation reaches function code.** The same call
   with the local `SERVICE_ROLE_KEY` as Bearer returned
   `{"error":"UNAUTHORIZED","message":"Missing or invalid token"}` —
   *the function's own typed error* (cancel-booking wants a user JWT),
   not Kong's. The request passed the platform gate and executed
   function code. That is the whole invocation path.
3. **pg_cron fires the combination.** A 1-minute job wrapping the
   same `net.http_post` ran on its first tick
   (`cron.job_run_details.status = 'succeeded'`), its HTTP response
   arrived, and `cron.unschedule()` removed it cleanly. pg_cron 1.6.4
   and pg_net 0.20.4, the versions the local stack ships.
4. **Hosted support is documented, not hoped.** Supabase's own guide
   ("Schedule Edge Functions") prescribes exactly this: pg_cron +
   pg_net, with the auth token stored in **Supabase Vault**
   (`vault.create_secret()` / `vault.decrypted_secrets`) rather than
   inline in the cron command.

## What the real `expire-collecting` function inherits from this

- **`verify_jwt = false` + its own shared secret**, the
  stripe-webhook precedent — the sweeper authenticates with a
  dedicated header the function checks itself, so no service-role JWT
  sits in a cron command. The secret lives in **Vault** on hosted
  (per the guide) and in `config.toml`-adjacent env locally.
- **The function must be idempotent per tick** — pg_net is
  fire-and-forget (the response lands in a table nobody reads at
  runtime), so a tick that dies mid-sweep is retried blind by the
  next tick. Same discipline as the webhook handlers.
- **Cadence: every 5 minutes**, joining the three existing jobs in
  `20260423000003_pg_cron_cleanup_schedules.sql` — the T-24h/T-22h
  boundaries tolerate five minutes of slack; nothing here needs the
  1-minute tick the spike used.
- Local URL is `http://supabase_kong_ludi:8000/functions/v1/…`;
  hosted is the project URL from Vault. The migration takes the URL
  from a setting, not a literal.

## The `state IN` ledger — every site that must learn `collecting`

The shared-fixture version found `completed` read in six places with
no writer; `collecting` gets its census *before* the migration. Sites
that enumerate booking states, grouped by the decision each must make
(hold-the-slot? revenue? cancellable? joinable?):

**Database — must change in the W2 migration:**

| Site | Decision for `collecting` |
|---|---|
| `20260421000003` bookings CHECK | join the list |
| `20260421000003` + `20260421000007` EXCLUDE predicate | **holds the slot** — the anchor decision made real |
| `20260421000007` `cleanup_stale_pending_bookings` | must **not** sweep `collecting` (its clock is T-24h, not 15 min) |
| `20260423000002` + `20260822000001` `get_available_slots` | blocks availability |
| `20260822000005` schedule-change collision checks (×3) | counts as a collision |
| `20260824000001` `fixture_preview` joinable + `join_fixture` allowed states | preview says joinable; **`join_fixture` refuses it** (claim-share owns paid joins) |
| `20260828000001` + `20260829000001` earnings CASEs | **not revenue** until confirmed |
| `20260421000003` `bookings_pending_idx` | extend or add partial index for the sweeper's scan |

**Edge Functions:**

| Site | Decision |
|---|---|
| `cancel-booking:168` allowed states | add `collecting` → the 100%-fan-out path, not policy math |
| `admin-refund-booking:43` `ALLOWED_PRIOR_STATES` | stays out — share-level refunds have their own path |
| `payment-intent-succeeded` | the branch point: `kind`-aware, flips pending→collecting→confirmed |
| `charge-refunded:51` | share refunds must not flip a `collecting` booking to `refunded` wholesale |
| `create-walk-in-booking` conflict states | a `collecting` fixture blocks a walk-in |
| `_shared/schemas/booking.ts` | response schema learns the state |

**Clients:**

| Site | Decision |
|---|---|
| `apps/mobile/src/lib/booking.ts` + `booking/[id]/index.tsx` | the fixture screen's collecting/short/covering/dead vocabulary (W6) |
| `apps/admin/lib/booking-states.ts` + `PAID_STATES` / `REFUNDABLE_STATES` + badges | visible, **not** in paid/refundable sets until confirmed |

Fifteen sites. W2's migration and its pgtap cover the database rows of
this table; the function and client rows are pinned to W3–W6 and this
ledger is the checklist each of those PRs closes against.

## Spike hygiene

Throwaway SQL only — the cron job is unscheduled, no repo code was
written, and the one persistent local effect (`CREATE EXTENSION
pg_net` on the dev database) is the extension W2's migration will
create for real.
