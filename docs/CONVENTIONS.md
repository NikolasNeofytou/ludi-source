# CONVENTIONS.md — Ludi authoring conventions

**Version:** v0.2 (living document)

**Status:** First codification. Most rules below were already in
practice across M1+M2+M3; this document is the place they live so
that future-us can find them without rereading PRs.

## Purpose

This document defines how to write Ludi code and SQL so it loads as
canonical data and ships safely. It is:

1. A style guide for migrations, RLS policies, Edge Functions, mobile
   code, and i18n.
2. A list of *invariants* that no PR may break without an ADR.
3. A "before you propose X, check here first" rule book — including
   the items that are not preferences but legal requirements (the
   mandatory CY addons are the canonical example).

Read it before opening a PR that touches a new area; read the
relevant section before opening a PR that touches an area you've
worked in before. Each rule has a *Why* — knowing the why lets you
judge edge cases instead of blindly following the letter.

---

## § Database — migrations

- **One file per migration**, time-prefixed `YYYYMMDDhhmmss_short_name.sql`,
  written in plain SQL, committed to `packages/supabase/supabase/migrations/`.
- **Append-only.** Never edit an applied migration. To fix a mistake,
  write a new forward migration.
- **Local-first.** `supabase db reset` wipes + reapplies + seeds.
  Always test a new migration against a clean reset before opening a
  PR.
- **CI runs `supabase db reset` against a postgis container** as the
  migration dry-run step. A migration that doesn't apply cleanly from
  scratch breaks CI.
- **No data writes in schema migrations.** Schema changes only. Seed
  data lives in `seed.sql`; production data backfills live in
  separately-flagged migrations (none yet — when the first appears,
  prefix the file `*_data_*` and document the rationale at the top).
- **SQL style:** uppercase keywords, lowercase identifiers, uppercase
  `NULL` / `TRUE` / `FALSE` literals, lowercase data-type names
  (`uuid`, `text`, `int`), semicolons at the end, no trailing
  whitespace. Enforced in CI by `sqlfluff` against the config at
  [`packages/supabase/.sqlfluff`](../packages/supabase/.sqlfluff)
  (rules CP01/CP02/CP04/CP05). Layout rules (alignment, line
  length, alias style, indentation) are deliberately not gated —
  add to this list first if we ever want them enforced. Run
  locally with `sqlfluff lint packages/supabase/supabase/migrations/
  packages/supabase/supabase/seed.sql packages/supabase/tests/`,
  or `sqlfluff fix --force …` to auto-correct.
- **`uuid7()` for all PKs.** One function, used everywhere. Time-ordered
  IDs give index locality without leaking through to clients.
- **`timestamptz` for all times, UTC in DB.** Never `timestamp`. The
  single timezone conversion is in `get_available_slots()` which
  hardcodes `Europe/Nicosia` (Cyprus-only MVP).
- **Integer cents for money. Never floats. EUR-only for now.**
  Add a `currency` column when we need it; don't anticipate.
- **Booleans named positively:** `is_active`, `is_verified` — never
  `is_disabled`.
- **`created_at` on every table; `updated_at` only where mutable**,
  maintained by `tg_<table>_updated_at` trigger.
- **FKs index the child side.** Postgres doesn't auto-index FKs.
- **Soft-delete only where audit demands it** (bookings, payments).
  Everything else is hard-delete. Users get *anonymized*, never
  deleted — see [data-model.md](data-model.md) §GDPR notes.

---

## § Database — RLS policies

- **RLS is enabled BEFORE any policy exists** on every user-visible
  table. The default deny is the safety floor; policies open access
  intentionally.
- **Policy naming:** `<table>_<verb>_<who>`, e.g.
  `bookings_select_self_or_owner_or_admin`. Verb is `select` /
  `insert` / `update` / `delete`. "who" describes the principal in
  prose, not in SQL terms.
- **One policy per (table, verb)** unless an actual scope split
  requires more. Composing within one `USING / WITH CHECK` keeps the
  audit story simple.
- **`is_admin()` is the single admin predicate.** Defined once in
  helpers; reads `public.users.role` directly with no recursion.
  Policies reference it; never inline the role check.
- **Service-role tables get no client-facing policies.**
  `stripe_events` and `idempotency_keys` are written only by Edge
  Functions; there is a regression guard in the pgtap suite that
  asserts no anon/authenticated access. If you find yourself adding
  a client-policy to these tables, you're doing the wrong thing.
- **pgtap-test every policy.** One positive + one negative case at
  minimum. CI runs the full suite (`pg_prove` against prod's Postgres
  image) on the grants the migrations leave, as on prod: the bootstrap
  grants nothing on `public`. A revoke a test asserts belongs in the
  migration, never in `_bootstrap.sql`. See [JOURNAL.md](JOURNAL.md)
  §A migration's REVOKE is not the last word in the pgtap harness.
- **Every `SECURITY DEFINER` function states its callers.** End it with
  `REVOKE ALL ON FUNCTION … FROM public, anon` (add `authenticated` when
  it is service-only) and an explicit `GRANT EXECUTE … TO` the roles that
  call it. Both halves: anon inherits PUBLIC's grant, and Supabase's
  default privileges give anon its own. A definer function anon really
  must call goes on the allowlist in `tests/rls/59_function_acl.sql`.
  Never gate a definer body on `is_privileged_writer()` or `current_user`
  — inside it `current_user` is the owner, so every caller passes; read
  the request's JWT role instead (`settle_split_booking`,
  `materialise_booking_series`).
- **Triggers enforce role-change protection:** `tg_users_block_role_change`
  refuses any role update unless `is_admin()` returns true. Fires
  even for psql superuser (auth.uid() is NULL there) — bypass with
  `SET LOCAL session_replication_role = 'replica'` inside a
  transaction. See [JOURNAL.md](JOURNAL.md) §Local-dev admin promotion.

---

## § Edge Functions (Deno)

- **One folder per function** at `packages/supabase/supabase/functions/<name>/`.
  Each has an `index.ts` exporting `serve(handler)`.
- **Shared code lives in `_shared/`** — Stripe client setup, Zod
  schemas, error response builder, structured logger. Imported with
  the import_map.
- **Auth-first.** The first lines of any function:
  1. Verify the caller. For user-called functions, parse the bearer
     token and resolve `auth.uid()`. For webhook functions, verify
     signature. Reject early.
  2. Validate input with a Zod schema. Reject with `VALIDATION_FAILED`
     and the Zod issue list (sanitised — no raw payload echo).
- **Server-computes pricing.** Client never sends amounts. Function
  reads the pitch, computes `base_price_cents`, sums `addons`,
  computes `platform_fee_cents` from `venues.take_rate_bps`,
  snapshots `cancellation_policy` from the venue onto the booking.
- **Stripe calls use scoped idempotency keys.** For `create-booking`,
  the key is the request `Idempotency-Key` header (passed through to
  Stripe). For `cancel-booking`, the Stripe-side key is scoped
  `cancel:${booking.id}` regardless of the client key — double-refund
  is worse than double-create, so the server-side dedup is
  conservative. See [JOURNAL.md](JOURNAL.md) §Stripe idempotency keys.
- **Idempotency cache.** Each function that mutates external state
  records a row in `idempotency_keys` (per-(user, action, key))
  before the Stripe call and updates the row with the response.
  Repeat requests with the same key short-circuit to the cached
  response. pg_cron cleans expired keys every 10 minutes.
- **Webhook handlers are idempotent on `event.id`** — first action
  is `INSERT INTO stripe_events (id) ON CONFLICT DO NOTHING`. If 0
  rows inserted, return 200 without doing anything.
- **Errors are structured.** Every non-200 response is
  `{ error: 'ERROR_CODE', message: string, details?: unknown }`.
  `ERROR_CODE` is `SCREAMING_SNAKE_CASE` and stable — the mobile
  client switches on it.
- **Structured logs, no PII.** `console.log(JSON.stringify({ level,
  request_id, event, ...context }))`. Never log full Stripe payloads,
  full booking rows, phone numbers, or emails. User ID first 8 chars
  is OK for correlation.
- **Failure fast on missing env.** If `STRIPE_SECRET_KEY` etc. is
  unset at module load, throw — don't let the function run and
  surface the failure at request time.

---

## § Mobile (React Native / Expo)

- **TypeScript strict everywhere.** No `any`, no `// @ts-ignore`
  without a JIRA-style comment explaining why. See
  [ADR-0006](adr/0006-typescript-strict-zod.md).
- **Zod at every boundary.** API responses (even RLS-gated direct
  queries), AsyncStorage / SecureStore reads, deep-link payloads.
  If it crossed a wire or a process boundary, it gets validated.
- **Auth session in `expo-secure-store`.** Never `AsyncStorage` for
  tokens. The Supabase JS client is configured with the
  secure-store adapter at construction time.
- **Idempotency keys in `useRef`, not in submit-handler closures.**
  Generate once per user-action, hold across retries, clear on
  success or terminal failure. The cancel-booking flow is the
  exemplar. See [JOURNAL.md](JOURNAL.md) §Stripe idempotency keys.
- **i18n via `packages/i18n`.** No bare strings in JSX — always
  `t('key')`. EN is the source-of-truth language; ΕΛ ships in
  parity. If a key doesn't have an ΕΛ translation, the build fails
  (planned check; for now, manual review).
- **Tokens via `@ludi/ui`.** No inline hex colors, no inline
  spacing values. If the token doesn't exist for the use case,
  add it to `packages/ui` first, then use it.
- **No JS test runner yet.** Don't write `__tests__/*.ts` in
  `apps/mobile`. Pure-logic helpers go through manual test plans
  in PR descriptions until a runner lands.
- **Error states everywhere.** No silent failures. Loading +
  empty + error are first-class states on every screen.
- **Motion through `@ludi/ui`.** New motion is Reanimated, built from
  the package's pieces — `Press` (something that opens something),
  `Pick` (a choice made in place), `Tally` (a number that changes),
  `Reveal` (content that arrives or leaves), `ROW_LAYOUT` (rows in a
  changing list), `RiseIn` (the first screenful). Spatial motion
  (position, size, scale) springs on `SPRING`; colour and opacity time
  on `MOTION`; never the other way round. No new RN core `Animated`,
  no `useNativeDriver: false`, no inline `opacity: pressed ? x : 1`.
  Haptics only through `haptic()` and only its four words — `success`
  and `error` at their named sites (ADR-0035). Every animated site has
  a Reduce Motion form on the register in
  [plans/motion-v2.md](plans/motion-v2.md). See
  [plans/motion-v3.md](plans/motion-v3.md), "The interaction contract".

---

## § i18n — EN / ΕΛ

- **Every user-facing string is a key.** Bare strings in JSX or
  in COPY constants are a bug.
- **EN is the source of truth, ΕΛ ships in parity.** A new key
  without an ΕΛ value blocks the PR.
- **Per-language authoring for prose, not translation.** Marketing
  copy, error messages, city names can differ in tone between EN
  and ΕΛ — "Nicosia" / "Λευκωσία" is the canonical example. Don't
  try to keep them word-for-word.
- **Locale toggle flips without restart.** Test this every time
  a screen is added.
- **City names live in DB rows** (`cities.name_en`, `cities.name_gr`),
  not in i18n JSON. Mobile renders the column matching
  `users.preferred_locale`.
- **The admin's dictionary is `apps/admin/lib/copy`** (ADR-0037), one
  typed interface implemented by `en` and `el`; `tsc` is its parity
  check. The owner surface reads `users.preferred_locale`; the
  founder's admin-only pages stay English and carry no entries. Zod
  messages stay English in `schemas.ts` and are mapped by sentence in
  `el.ts` — add the sentence to `validation.messages` when you add a
  message an owner can reach.

---

## § The CY mandatory addons

`bibs` and `ball_rental` are **legal requirements** on every Cyprus
pitch booking, not optional MVP features. Removing them from the
addon catalog or making them per-venue optional puts Ludi in breach
of CY consumer law.

**How to apply:**
- Never propose removing or feature-flagging either addon code.
- If we ever build an addon catalog table (Stage 4-ish), these two
  rows must always be present, ship-blocking if missing.
- Pricing is tunable (`BIBS = 500 cents`, `BALL_RENTAL = 300 cents`
  in MVP); availability is not.
- Per-venue *prices* may differ later; per-venue *availability*
  must always include these two.

---

## § Booking codes

Format: `{CITY3}-{YEAR}-{SEQ4}`, e.g. `LAR-2026-0001`.

- `CITY3` = first 3 letters of `cities.code`, uppercased
  (`LAR`, `NIC`, `LIM`, `PAF`, `AYI`).
- `YEAR` = 4-digit year of `bookings.starts_at` (not `created_at`).
- `SEQ4` = zero-padded 4-digit sequence, per-city per-year, from
  a `booking_codes_seq` table.

When the 4-digit cap is in sight (>8000/yr/city), bump to 5 digits
in a forward migration — don't anticipate.

---

## § Git / PR workflow

- **Branches:** feature work goes on a `feat/*`, `fix/*`, or
  `chore/*` branch. Long-running spike branches use `spike/*`.
- **Conventional commit subjects** in the imperative:
  `feat(supabase): get_available_slots RPC`,
  `fix(mobile): rehydrate session on cold open`, etc. The scope
  in parens is the package: `mobile`, `supabase`, `ui`, `admin`,
  `i18n`, `config`, `docs`, `ci`, `chore`.
- **One commit per session, ideally.** The
  [stage-2-commit-plan.md](stage-2-commit-plan.md) is the menu;
  each row is one PR.
- **Squash-merge.** The PR is the atomic unit; the commit history
  on `main` is one commit per merged PR.
- **`--delete-branch` only on standalone PRs.** Stacked PRs need
  children retargeted to `main` BEFORE squashing the parent —
  otherwise GitHub auto-closes the stack and the closed PRs can't
  be reopened. See [JOURNAL.md](JOURNAL.md) §Stacked PR merge order.
- **PR descriptions include a manual test plan.** Especially for
  mobile (no test runner yet). Each bullet should be a step a
  reviewer can run on a sim.

---

## § Logging and observability

- **Structured logs:** JSON, one line per event. Required fields:
  `level`, `request_id` (or `event_id` for webhooks), `event` (a
  stable string identifier), and any context. No PII.
- **Sentry tags user_id** (only the first 8 chars in logs; full
  ID is fine inside Sentry's protected context).
- **PostHog events** are the seven listed in [infra.md](infra.md)
  §Product analytics. Add events sparingly — every new event
  needs a clear analytical question it answers.
- **First 8 chars of a UUID** is the standard correlation token
  in logs when you must identify a row without leaking the full
  ID.

---

## § Local-dev environment

- **Supabase ports are pinned to 64xxx** in `packages/supabase/supabase/config.toml`
  so the project coexists with other local Supabase projects on
  this machine. Mapping: api 64321, db 64322, studio 64323,
  inbucket 64324, pooler 64329. `apps/mobile/.env` uses
  `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:64321`. See
  [JOURNAL.md](JOURNAL.md) §Local Supabase ports.
- **Phone OTP locally** needs BOTH `[auth.sms.test_otp]` and a
  `[auth.sms.twilio]` placeholder block in `config.toml`.
  `test_otp` alone leaves the auth container with
  `GOTRUE_EXTERNAL_PHONE_ENABLED=false`. The seeded local
  number is `+35799000000` with OTP `123456`. Never commit a
  real owner phone here. See [JOURNAL.md](JOURNAL.md) §Local phone OTP.
- **Admin promotion locally** uses the
  `SET LOCAL session_replication_role = 'replica'` bypass inside
  a transaction. See [JOURNAL.md](JOURNAL.md) §Local-dev admin promotion.
- **Stripe is always in test mode locally.** Real keys never leave
  Edge Function env on staging/prod.

---

## § Public numbers and names

Rule R4 of the Strava study ([plans/strava-study.md](plans/strava-study.md),
adopted 2026-10-20). Aggregates expose people even when "anonymised", and
Strava added each protection only after an exposure. Ludi's go in first.

1. **The floor.** A surface a stranger or the public can read — the lobby
   screen, the site, a recap, a report for a sponsor or a municipality —
   shows a number built from players' games only when it counts **at
   least five distinct players**. A smaller cell is `NULL`, never `0`, and
   the SQL that builds it enforces this, with a pgtap test at four and at
   five.
2. **Names.** First names at most on a public surface; none on a pre-join
   surface (counts never names, ADR-0012 / ADR-0021); nothing about a
   minor (CFA).
3. **Patterns need an opt-in.** Anything that reveals a player's routine
   over time — a title, a person's run of weeks, where and when they
   play — needs the player's opt-in: a `boolean NOT NULL DEFAULT false`.
   A momentary fact that forgets by itself, like today's first name on
   the lobby screen (ADR-0054), may default on with an opt-out.
4. **Corrections.** A record that can be wrong — a score, a no-show — is
   corrected through an audited definer function. Nothing disappears
   silently.

---

## § How conventions get updated

Each rule is a real decision that *can* change — but changing one
without writing it down is how a codebase becomes incoherent.

1. Open a PR that includes the doc edit alongside the code that
   exercises the new convention.
2. Bump the document version at the top (`v0.1 → v0.2 → ...`).
3. If the convention is genuinely architectural (e.g. "we now hand-
   roll a Node backend for X"), it needs an ADR first; this
   document just records the resulting rule.

A convention that's been bypassed three times in code without
being updated here is itself a signal — either the convention is
wrong (rewrite it) or the bypasses are wrong (fix them).

---

## § Changelog

- **2026-10-20** — v0.3. § Database — RLS policies: every definer
  function states its callers (both halves of the REVOKE), with an anon
  allowlist enforced by `tests/rls/59_function_acl.sql`. From the
  2026-10-19 audit.
- **2026-10-20** — v0.2. § Mobile gains *Motion through `@ludi/ui`*
  (motion-v3 slice 1: the engine and its pieces).
- **2026-05-27** — v0.1. Initial codification, retroactive. Pulls
  together rules already in practice across M1+M2+M3, plus the
  load-bearing gotchas previously held only in memory.
- **2026-10-20** — v0.2. § Public numbers and names: the five-player
  floor, first names at most, opt-in for patterns over time, audited
  corrections (rule R4, [plans/strava-build.md](plans/strava-build.md)).
