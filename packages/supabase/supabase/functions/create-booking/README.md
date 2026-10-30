# `create-booking`

Atomically creates a `pending` booking and a Stripe PaymentIntent (with platform fee routed via Stripe Connect). See [`docs/api-contract.md`](../../../../../docs/api-contract.md) §5.1 for the full contract.

## Request

```
POST /functions/v1/create-booking
Authorization: Bearer <user access token>
Idempotency-Key: <opaque string, 8..200 chars>      # optional but recommended
Content-Type: application/json
```

```json
{
  "pitch_id": "uuid",
  "starts_at": "2026-05-01T17:00:00Z",
  "ends_at":   "2026-05-01T18:00:00Z",
  "addons": [
    { "code": "bibs", "quantity": 1 }
  ],
  "notes": "goalkeeper will be late, unlock at 17:05"
}
```

Validation:
- `starts_at < ends_at`
- duration between 30 minutes and 8 hours
- addon codes must be unique within the list
- `bibs` and `ball_rental` are the only allowed addon codes (Cyprus law requires them to be offered)

## Responses

### 200 OK
```json
{
  "booking": {
    "id": "uuid",
    "code": "LAR-2026-0001",
    "state": "pending",
    "total_cents": 4500
  },
  "payment": {
    "payment_intent_id": "pi_...",
    "client_secret": "pi_..._secret_...",
    "publishable_key": "pk_test_..."
  }
}
```

The app initialises the Stripe Payment Sheet with `client_secret` and `publishable_key`. Stripe calls the card network directly; Ludi backend is not on that leg of the path. The booking flips to `paid` / `confirmed` via the `stripe-webhook` Edge Function.

### Errors

| HTTP | `error` | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Zod rejected input, or Idempotency-Key header malformed |
| 401 | `UNAUTHORIZED` | missing / invalid JWT |
| 404 | `PITCH_NOT_BOOKABLE` | pitch id not found |
| 409 | `PITCH_NOT_BOOKABLE` | pitch deactivated or venue Stripe not active |
| 409 | `SLOT_UNAVAILABLE` | another booking already holds this time range |
| 409 | `IDEMPOTENCY_MISMATCH` | same key used with a different body, or bound to a different user |
| 405 | `METHOD_NOT_ALLOWED` | non-POST request |
| 500 | `DB_ERROR` / `INTERNAL_ERROR` | server issue |
| 502 | `STRIPE_ERROR` | Stripe API failure (includes `details.stripe_code`) |

## Concurrency & retries

- The `bookings` table has an `EXCLUDE` constraint over `(pitch_id, time_range)` gated on `state IN ('pending','paid','confirmed','completed')`. Two concurrent calls for the same slot → one succeeds, the other gets `SLOT_UNAVAILABLE`.
- Abandoned `pending` bookings are auto-cancelled after 15 minutes by `cleanup_stale_pending_bookings()` (pg_cron, provisioning step pending).
- `Idempotency-Key` caches the exact response for 24h. Mobile app should generate one per user-initiated booking attempt (e.g. uuid v4) and resend it on network retry.

## Environment variables

| Name | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | DB writes bypass RLS |
| `SUPABASE_ANON_KEY` | yes | JWT verification |
| `STRIPE_SECRET_KEY` | yes | Stripe server calls |
| `STRIPE_PUBLISHABLE_KEY` | yes | returned in response body |

## Local invocation

After `supabase start` and `supabase functions serve create-booking --env-file .env.local`:

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/create-booking \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "pitch_id": "…",
    "starts_at": "2026-05-01T17:00:00Z",
    "ends_at":   "2026-05-01T18:00:00Z",
    "addons": [{"code": "bibs", "quantity": 1}]
  }'
```

## Integration test plan

Runs locally against `supabase start`. **Not** in CI yet.

- [ ] Happy path: returns 200 with booking + payment bodies, DB has booking (state=pending) + payments (status=requires_payment_method) + booking_addons rows.
- [ ] Concurrent double-book: 100 parallel requests → exactly one 200, 99 × `SLOT_UNAVAILABLE`.
- [ ] Retry with same Idempotency-Key returns cached response, does not create a second PI.
- [ ] Retry with same key but different body returns 409 `IDEMPOTENCY_MISMATCH`.
- [ ] Pitch with inactive venue → 409 `PITCH_NOT_BOOKABLE`.
- [ ] Unauthenticated call → 401.
- [ ] Stripe configured to fail → booking + addons rolled back, 502 returned.
