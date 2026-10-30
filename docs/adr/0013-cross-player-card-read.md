# ADR-0013 — Cross-player card read via a dedicated `public_player_cards` view

**Status:** Accepted — reversible (drop/replace the view; no data migration)
**Date:** 2026-05-30
**Deciders:** Solo founder
**Supersedes:** —
**Superseded by:** —

## Context

The **Shareable Player Card** version (see
[docs/plans/shareable-card.md](../plans/shareable-card.md)) lets one player
open another player's card in-app via a QR / `ludi://player/<id>` deep
link. That requires reading *another* user's profile — but
[`public.users`](../data-model.md) carries PII (phone via auth, email,
`stripe_customer_id`, `role`) and is locked to **own-row read** by the
`users_select_self_or_admin` RLS policy ([ADR-0009 threat posture],
migration `20260421000005_rls_policies.sql`). The card screen has been
self-view only for exactly this reason.

We deliberately deferred this decision in the Player Card version
("defer the hard decision to where it's load-bearing"). It is now load-
bearing: we must expose a player's **card fields** to other authenticated
players while guaranteeing PII never leaks. Constraints: solo dev; Supabase
+ PostgREST (the mobile client reads tables/views directly via the anon
key under RLS); pre-launch, so we can set the shape calmly; the read path
must be reusable by Stage 3 matchmaking (player lists/cards).

The danger is concrete: Postgres RLS is **row-level, not column-level**.
Any approach that opens `users` to broader reads has to solve "expose
these columns but not those," and getting that wrong leaks a phone number.

## Decision

**Expose a dedicated `public.public_player_cards` view that selects only
card-safe columns, readable by `authenticated`; leave the `users` base-
table RLS strictly own-row.** PII is excluded *by construction* — it is
not in the view, so it cannot leak through it, and a future PII column
added to `users` does not silently appear.

Concretely:

- The view selects: `id`, `first_name`, `last_name`, `handle`, `city_id`,
  `positions`, `preferred_foot`, `skill_level`, `height_cm`, `age_band`,
  `play_frequency`, `created_at`.
- It **excludes** `phone`/`email` (auth-owned), `stripe_customer_id`,
  `role`, `preferred_locale`, `anonymized_at`.
- `WHERE anonymized_at IS NULL` — anonymised (GDPR-erased) players are not
  discoverable through cards.
- Created with **`security_invoker = off`** (definer rights) so the view
  can read across rows even though the base table's RLS is own-row; then
  `GRANT SELECT ON public.public_player_cards TO authenticated` (and
  **not** `anon` — viewing a card requires being signed in).
- The mobile `player/[id]` screen reads `public_player_cards` for any id;
  the *verified* badge is derived from the **viewer's own** auth session
  only (we never expose another player's auth state).

## Consequences

### Positive
- **PII-safe by construction** — the leak class is eliminated, not
  guarded. New PII columns on `users` are fail-safe (absent unless
  explicitly added to the view).
- Base `users` RLS is **unchanged** — no regression risk to the existing
  own-row guarantees, refund flows, or the pgtap suite's assertions.
- Idiomatic Supabase: the client does `.from('public_player_cards')`;
  no RPC ceremony. **Reusable by Stage 3 matchmaking** for player lists.
- Anonymised players drop out automatically.

### Negative
- The view's column list must be **maintained deliberately** — adding a
  new *card* field means adding it to the view too. Accepted: explicit is
  the point; the failure mode is "field missing from card", not "PII
  leaked".
- `security_invoker = off` means the view runs with its owner's rights —
  it bypasses `users` RLS on purpose. This must be paired with the
  narrow column list + `authenticated`-only grant; documented here so a
  future reader doesn't "fix" it to `invoker = on` and break card reads.
- Any authenticated user can read any (non-anonymised) player's card
  fields. Intended — cards are meant to be shareable — but it is a
  deliberate move from "profiles are private" to "card fields are
  visible to signed-in players." Recorded so it's a decision, not drift.

### Neutral
- If we later need per-field visibility controls (e.g. hide age band),
  that's a new column + a view predicate, not a re-architecture.
- A web/public (anon) card view would need a separate, even narrower
  grant — deferred with universal links / `ludi.app`.

## Alternatives considered

### Security-definer RPC `get_player_card(player_id)`
A function returning curated fields, bypassing RLS. Equally PII-safe.
Rejected as the primary path: less ergonomic than a view for the client
and for future list/filter queries (matchmaking would prefer a
selectable relation). A view is the more reusable substrate.

### Broaden `users` RLS with a SELECT-any policy
Add a policy letting authenticated users read any `users` row. Rejected:
RLS is row-level, so PII columns would also be readable unless layered
with column `GRANT`s or a wrapper — fragile, and one missed grant leaks a
phone number. Highest-risk option for the smallest convenience.

### Keep self-only; share image only
Don't build a cross-player read at all; ship only share-as-image.
Rejected for *this* version because the chosen slice includes QR-open-in-
app. (It remains the documented cut-list floor if the view slips.)

## Follow-ups
- Migration creating the view + grant; extend pgtap with a **PII-exclusion
  test** (safe columns present; `phone`/`email`/`stripe_customer_id`/
  `role` absent; anonymised row excluded). The test is cut-list-protected.
- Update [data-model.md](../data-model.md) with the view.
- When matchmaking lands, reuse this view for player lists; revisit
  whether it needs pagination/filtering columns.
- If a public web card is ever built (universal links / `ludi.app`),
  define a separate anon-grant view — do **not** widen this one to `anon`.
