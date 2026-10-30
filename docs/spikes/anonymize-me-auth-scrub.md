# Spike — neutralising the auth identity for `anonymize-me`

**Date:** 2026-06-12
**Verdict:** ✅ PASS — use GoTrue **soft-delete** (`auth.admin.deleteUser(id, true)`).
**Risk tested:** *"How do we erase a user's auth-side PII (phone, email,
metadata) and block their login WITHOUT triggering the
`public.users.id → auth.users(id) ON DELETE CASCADE`, which would
delete the profile row we must keep for FK integrity + 7-year financial
retention?"*

## Why this needed a spike

`public.users.id` is `REFERENCES auth.users(id) ON DELETE CASCADE`, while
`bookings.user_id`, `venue_owners.user_id`, and
`admin_actions.admin_user_id` are all `ON DELETE RESTRICT`. A literal
`auth.admin.deleteUser(id)` (hard delete) therefore:

- **fails outright** for any user who has ever booked (RESTRICT blocks
  the cascade) — exactly the retention users we must handle; and
- for a childless user, deletes the `public.users` row entirely, making
  the careful PII-nulling pointless.

So the api-contract's original "null PII → `deleteUser(userId)`" flow is
internally inconsistent with the schema. The open question was whether
any admin-API call neutralises auth PII while *keeping* the row.

## Method

Against the live local stack (GoTrue **v2.188.1**, supabase-js
**2.45.4**), created throwaway phone+email users with metadata, applied
each candidate, then read `auth.users` directly via `psql` for ground
truth.

## Findings

| Approach | email | phone | `raw_user_meta_data` | login | row kept? |
|---|---|---|---|---|---|
| `updateUserById({ email, phone:'', user_metadata:{}, ban_duration })` | ✅ replaced | ❌ **unchanged** | ❌ **unchanged** (merge, not replace) | ✅ banned | ✅ |
| `deleteUser(id, true)` (**soft-delete**) | ✅ obfuscated → random token | ✅ obfuscated → random token | ✅ cleared to `{}` | ✅ `deleted_at` set | ✅ **row survives** |

Decisive details:

- `updateUserById({ phone: '' })` returned **no error** but left the
  phone **unchanged** — a silent PII leak on the primary OTP identifier.
  `user_metadata: {}` merges (does not replace), so it clears nothing.
- `deleteUser(id, true)` obfuscates email **and** phone to random
  tokens, clears metadata, and sets `deleted_at` (blocking login). The
  row is **not** `DELETE`d, so the `ON DELETE CASCADE` never fires —
  confirmed: the `public.users` row survived the soft-delete.
- A **second** `deleteUser(id, true)` on an already-soft-deleted user
  returns **no error** → the call is idempotent, so a retry after a
  partial failure self-heals rather than 500-ing.

## Decision (feeds ADR-0018)

`anonymize-me` nulls profile PII in `public.users` (placeholders for the
`NOT NULL` name columns), sets `anonymized_at`, then calls
`deleteUser(id, true)` to scrub the auth identity and block login — no
hard delete, no schema change. The contract (`api-contract.md §1.5`) is
corrected to match.

## Not covered (deliberately)

- **Stripe customer deletion.** `users.stripe_customer_id` is kept (an
  opaque pointer needed to reconcile the retained `payments`); deleting
  the Stripe-side customer object is a separate follow-up, parked.
- **Access-token invalidation timing.** A soft-deleted user's existing
  JWT remains valid until `exp` (1 h). Re-calling within that window is
  handled by the `anonymized_at` idempotency guard; afterwards the token
  is rejected (401) — the correct terminal state for a deleted account.
