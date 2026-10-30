# `stripe-webhook`

Signature-verified receiver for Stripe events. See [`docs/api-contract.md`](../../../../../docs/api-contract.md) §5.3 for the contract.

## Request

```
POST /functions/v1/stripe-webhook
Stripe-Signature: <Stripe's HMAC header>
Content-Type: application/json

{ "id": "evt_...", "type": "...", "data": { ... }, ...}
```

`verify_jwt = false` in `config.toml` — Stripe doesn't send a Supabase JWT. Authentication happens via the `Stripe-Signature` header, verified against `STRIPE_WEBHOOK_SECRET`.

## Handled event types

| Event | What we do |
|---|---|
| `payment_intent.succeeded` | Flip booking `pending` → `paid` → `confirmed`. If booking was auto-cancelled before PI settled, **refund in full** (orphan-PI path). |
| `payment_intent.payment_failed` | Record failure code/message on payments row. Booking stays `pending` — cleanup cron eventually expires it. |
| `charge.refunded` | Update `payments.refunded_amount_cents`; if fully refunded, flip booking to `refunded`. |
| `account.updated` | Update `venues.stripe_account_status`. The DB trigger cascades `pitches.is_verified = false` if the venue leaves active. |

Any other event type gets logged in `stripe_events` with `notes = 'unhandled-type'` and returns 200 (so Stripe doesn't retry).

## Responses

Always 2xx when we've handled (or deliberately ignored) the event. Stripe retries on 5xx. The body is informational — Stripe only inspects the status code.

| HTTP | When |
|---|---|
| 200 | Event handled successfully, or duplicate, or unknown type |
| 401 | Missing or invalid `Stripe-Signature` header |
| 405 | Non-POST request |
| 500 | Handler threw — Stripe will retry, we logged the error |

## Dedup

Every processed event.id lands in `public.stripe_events`. Second delivery of the same id returns 200 immediately without re-running the handler. Handlers are also individually idempotent (state checks before transitions), so even if dedup fails open, the system stays correct.

`stripe_events` is pruned by `cleanup_old_stripe_events()` (default 30 days, must be ≥ 7). Scheduled via pg_cron in M1 #4.

## Environment variables

| Name | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | DB writes bypass RLS |
| `STRIPE_SECRET_KEY` | yes | For refunds (orphan-PI path) |
| `STRIPE_WEBHOOK_SECRET` | yes | The signing secret for the platform-account destination — different per environment |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | no | Signing secret for the connected-accounts destination (payout.paid/failed, account.updated) delivering to the same URL. Stripe fixes a destination's events-from scope at creation, so connected-account events need a second destination with its own secret. Verification tries the platform secret first, then this one. |

`STRIPE_WEBHOOK_SECRET` in local dev comes from `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook`. In production both secrets come from their destination's settings in the Stripe dashboard (Workbench → Webhooks).

## Local invocation

```bash
cd packages/supabase
supabase functions serve stripe-webhook --env-file supabase/functions/.env.local

# In another terminal:
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
# Copy the `whsec_...` it prints into STRIPE_WEBHOOK_SECRET in .env.local, restart serve.

# Trigger a test event:
stripe trigger payment_intent.succeeded
```

## Integration test plan (manual — CI runs unit-level only)

- [ ] Happy path: create booking via `create-booking`, pay test card, webhook receives `payment_intent.succeeded` → booking state `confirmed`, payments `succeeded`.
- [ ] Orphan-PI: create booking, wait 16 min for cleanup to cancel it, complete payment — webhook triggers refund, payments `refunded`, `stripe_events.notes` starts with `orphan-refunded:`.
- [ ] Duplicate delivery: `stripe events resend <event_id>` twice — second response has `duplicate: true`, handler doesn't re-run.
- [ ] Tampered body: replay a stored event with an extra whitespace in the body — 401 Unauthorized.
- [ ] Wrong secret: point at a webhook configured with a different secret — 401.
- [ ] Partial refund: refund half the booking via admin-refund in Stripe dashboard → payments `partially_refunded`, booking stays `confirmed`.
- [ ] Full refund: refund the rest → payments `refunded`, booking `refunded`.
- [ ] `account.updated` → status `restricted`: venue updates, `tg_venues_cascade_stripe_status` drops pitch verification.
