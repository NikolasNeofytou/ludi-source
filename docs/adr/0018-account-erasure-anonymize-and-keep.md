# ADR-0018 — Account erasure: anonymise-and-keep via GoTrue soft-delete

**Status:** Accepted
**Date:** 2026-06-12
**Deciders:** Nikolas
**Supersedes:** —
**Superseded by:** —

> Numbering note: ADR-0014…0017 are reserved by the in-flight
> `plan/match-fit-card` branch (Player Card visual language). This ADR
> takes the next free number on `main` to avoid a collision when that
> branch lands.

## Context

Stage 2 ships GDPR self-service account deletion via the `anonymize-me`
Edge Function (commit #31). Two canonical docs disagreed on what
"deletion" means:

- **`data-model.md` §GDPR** — erasure is *anonymisation*: null the PII
  columns, set `users.anonymized_at`, **keep the row** so
  `bookings`/`payments` survive for the 7-year Cyprus tax-audit
  retention and FK integrity holds.
- **`api-contract.md` §1.5** — flow ended with
  `auth.admin.deleteUser(userId)` (a hard delete).

These cannot both hold. `public.users.id` is
`REFERENCES auth.users(id) ON DELETE CASCADE`, while the child FKs
(`bookings.user_id`, `venue_owners.user_id`,
`admin_actions.admin_user_id`) are `ON DELETE RESTRICT` with the data
model's own note *"can't delete a user with bookings — must anonymise."*
A hard `deleteUser` therefore **fails for any user who has booked** (the
RESTRICT children block the cascade) and, for a childless user, deletes
the profile row outright.

Per the JOURNAL rule "when docs disagree, the more load-bearing one
wins," `data-model.md` (the schema's source of truth) governs. The open
question — *can we scrub auth-side PII without deleting the row?* — was
resolved by [a spike](../spikes/anonymize-me-auth-scrub.md): GoTrue's
**soft-delete** (`deleteUser(id, true)`) obfuscates email + phone, clears
metadata, and sets `deleted_at` (blocking login) **without** `DELETE`-ing
the row, so the cascade never fires.

## Decision

`anonymize-me` implements **anonymise-and-keep**: null the profile PII in
`public.users` (placeholders for the `NOT NULL` name columns) and set
`anonymized_at`; write an `admin_actions` audit row with
`admin_user_id = <the user themselves>`, `action_type = 'anonymize_user'`;
then call `auth.admin.deleteUser(id, true)` (soft-delete) to scrub the
auth identity and block re-login. No hard delete, **no schema change**.
`api-contract.md §1.5` is corrected to match.

Idempotency: an atomic `UPDATE … WHERE anonymized_at IS NULL` claims the
transition; the soft-delete (idempotent per the spike) runs on every
call so a retry after a partial failure self-heals; the audit row is
written only on the first transition.

## Consequences

### Positive
- Works uniformly whether or not the user has financial history — never
  blocked by RESTRICT.
- FK integrity + 7-year retention preserved with zero migration.
- `admin_user_id = self` needs no seeded "system" user (the original
  contract's `= system` had no such row, and the FK is `NOT NULL`).

### Negative
- The `auth.users` row physically remains (soft-deleted, PII-obfuscated)
  rather than being removed. Acceptable: it holds no PII post-scrub, and
  the financial-retention legal basis covers retaining the linkage.
- Erasure does **not** delete the Stripe customer object;
  `stripe_customer_id` is kept to reconcile retained `payments`. Parked
  as a follow-up.

### Neutral
- First use of the `auth.admin` API in an Edge Function; the service
  client already exists for it.

## Alternatives considered

### Hard-delete with a migration to decouple the cascade
Drop/relax `public.users.id → auth.users` so `deleteUser` removes only
the auth row. Rejected: a schema change with RLS + signup-trigger blast
radius, contradicting the data model's "row kept for FK integrity," and
it still needs a seeded system user for the audit FK.

### Hybrid (hard-delete childless users, anonymise the rest)
Two code paths keyed on whether the user has children. Rejected as
gold-plating a Stage-2 chore: more branches, more tests, and still needs
a system user for the delete branch.

## Follow-ups

- Delete the Stripe customer object on erasure (park in FUTURE).
- Revisit if a future table referencing `users` needs different
  on-delete semantics.
- Related: [ADR-0012](0012-player-profile-data-posture.md) (the profile
  PII columns this nulls), the
  [spike](../spikes/anonymize-me-auth-scrub.md).
