# `anonymize-me`

`POST /anonymize-me` — self-service GDPR account erasure. User-authed, no
body; the caller erases their own account.

- **Contract:** [`docs/api-contract.md` §1.5](../../../../../docs/api-contract.md)
- **Model:** [ADR-0018 — anonymise-and-keep](../../../../../docs/adr/0018-account-erasure-anonymize-and-keep.md)
- **Spike:** [auth-scrub verdict](../../../../../docs/spikes/anonymize-me-auth-scrub.md)

## What it does

1. Nulls profile PII in `public.users` (placeholders for the `NOT NULL`
   name columns) and sets `anonymized_at` — atomic on `anonymized_at IS
   NULL`, via the service role (the RLS path forbids writing
   `anonymized_at`). The exact column patch lives in
   [`_shared/anonymize.ts`](../_shared/anonymize.ts).
2. On first transition: writes an `admin_actions` audit row
   (`action_type='anonymize_user'`, `admin_user_id` = the user).
3. Soft-deletes the auth identity (`auth.admin.deleteUser(id, true)`) —
   GoTrue obfuscates email + phone, clears metadata, and blocks login
   **without** deleting the row, so the `ON DELETE CASCADE` to
   `public.users` never fires and `bookings`/`payments` survive for
   7-year retention.

Kept deliberately: `city_id`, `skill_level`, `preferred_locale`, `role`,
`stripe_customer_id` (Stripe-customer deletion is a parked follow-up).

## Idempotency

The soft-delete runs on every call (no-op the second time), so a retry
after a partial failure self-heals; the audit row is written only on the
first transition. Re-calling is a `200` no-op while the token is valid,
`401` once the soft-delete invalidates it (the correct terminal state).

## Required env

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
(injected automatically by `supabase functions serve`).

## Tests

- **Unit:** [`_tests/anonymize.test.ts`](../_tests/anonymize.test.ts) —
  pure profile-patch coverage (CI).
- **Integration (manual, against a live local stack):**
  1. `supabase functions serve anonymize-me --env-file supabase/functions/.env.local`
  2. Create a confirmed user, seed their `public.users` PII, obtain a
     user access token (password or magic-link).
  3. `POST` with `Authorization: Bearer <token>` → expect
     `200 { anonymized: true, already_anonymized: false }`.
  4. Assert in the DB: `public.users` PII nulled + `anonymized_at` set +
     `stripe_customer_id` kept; one `admin_actions` `anonymize_user` row;
     `auth.users.deleted_at` set with email + phone obfuscated and
     `raw_user_meta_data = {}`.
  5. A second call with the same token → `401` (not `500`).

  Last run green on 2026-06-12 (GoTrue v2.188.1, edge-runtime 1.73.3).
