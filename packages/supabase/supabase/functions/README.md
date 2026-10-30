# Ludi Edge Functions

Deno-based Supabase Edge Functions. One directory per function, shared helpers under `_shared/`.

See [`docs/api-contract.md`](../../../../docs/api-contract.md) for the full inventory and contracts.

## Current functions

| Function | Auth | Purpose |
|---|---|---|
| [`create-booking`](./create-booking/) | user JWT | Atomically create booking + Stripe PaymentIntent |
| [`cancel-booking`](./cancel-booking/) | user JWT | Apply cancellation policy + Stripe refund |
| [`stripe-webhook`](./stripe-webhook/) | Stripe signature | Reconcile payment/charge events into Postgres |
| [`admin-refund-booking`](./admin-refund-booking/) | admin JWT | Staff-initiated refund with audit trail |
| [`venue-connect-onboard`](./venue-connect-onboard/) | admin JWT | Create Stripe Express account + onboarding link |
| [`admin-toggle-pitch`](./admin-toggle-pitch/) | admin JWT | Verify / activate / deactivate a pitch with audit trail |
| [`anonymize-me`](./anonymize-me/) | user JWT | GDPR self-service erasure (anonymise-and-keep, ADR-0018) |

## Local development

Requires Deno 1.44+ and the Supabase CLI. All commands below run from `packages/supabase/`.

```bash
cd packages/supabase

# Start local Postgres + gotrue + functions runtime
supabase start

# Apply migrations + seed
supabase db reset

# Serve a single function with file watching
supabase functions serve create-booking --env-file supabase/functions/.env.local
```

## Environment variables

Every function reads from the Deno runtime env. Required vars per function are documented in each function's README. Globally required:

| Name | Source | Used by |
|---|---|---|
| `SUPABASE_URL` | Supabase project settings | all |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings — **never ship client-side** | all (DB writes) |
| `SUPABASE_ANON_KEY` | Supabase project settings | JWT validation in `_shared/auth.ts` |
| `STRIPE_SECRET_KEY` | Stripe dashboard, restricted key preferred | functions that call Stripe |
| `STRIPE_PUBLISHABLE_KEY` | Stripe dashboard | returned in responses so the mobile app can init Stripe SDK |

A [`.env.example`](./.env.example) lists these with placeholder values. Copy to `.env.local` and fill in.

## Tests

```bash
cd packages/supabase/supabase/functions
deno task test
```

Unit tests live in `_tests/` and cover pure logic (pricing, schemas). Integration tests that need a live Supabase run manually for now — spec them in each function's README.

## Deployment

Not automated yet (Stage 2 roadmap item). Manual deploy: `supabase functions deploy <name> --no-verify-jwt=false`.
