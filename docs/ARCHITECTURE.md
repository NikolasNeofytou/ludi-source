# ARCHITECTURE.md — Ludi system architecture

**Status:** Stage 2 (MVP) — accurate as of 2026-05-27. The 8 ADRs in
`docs/adr/` carry the binding individual decisions; this document is
the single picture of how those decisions fit together.

**Companion documents:**
- `VISION.md` — what Ludi is and who it's for.
- `data-model.md` — entities, invariants, RLS intent.
- `api-contract.md` — every operation the client performs, with Zod schemas.
- `infra.md` — environments, CI/CD, secrets, monitoring.
- `threat-model.md` — STRIDE per flow.
- `CONVENTIONS.md` — code/SQL/migration authoring rules.

---

## § The shape in one paragraph

Ludi is a thin mobile client talking to a fat Supabase backend. The
mobile app is a TypeScript React Native (Expo) bundle that calls
Supabase three different ways — direct table queries governed by RLS,
named Postgres RPC functions, and Edge Functions (Deno) for anything
that touches Stripe or holds a transactional invariant. Postgres is
the system of record for everything except payments (Stripe is the
merchant-of-record). The boundary between "what the client may do
directly" and "what the server must mediate" is drawn at: *anything
that changes money, creates a booking, or touches multiple rows
atomically goes through an Edge Function; everything else is RLS-gated
direct Postgres access.*

---

## § Layered overview

```
┌──────────────────────────────────────────────────────────────────┐
│                          Mobile App                              │
│   Expo SDK 54 · React Native 0.81 · expo-router 6                │
│   apps/mobile · iOS + Android from one codebase                  │
│   Tokens, primitives, copy from packages/ui · i18n EN/EL         │
└──────────────────────────────────────────────────────────────────┘
                             │
              ┌──────────────┼─────────────────┐
              │              │                 │
       direct table    Postgres RPC     Edge Function
       (Supabase JS)    (rpc('fn'))      (functions.invoke)
              │              │                 │
              ▼              ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Supabase (managed)                          │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                Auth (GoTrue)                             │   │
│   │   phone OTP · Apple · Google · email magic link          │   │
│   │   JWT in expo-secure-store; auth.uid() everywhere        │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                Edge Functions (Deno)                     │   │
│   │   create-booking · cancel-booking · stripe-webhook ·     │   │
│   │   venue-connect-onboard · admin-refund-booking ·         │   │
│   │   admin-toggle-pitch · anonymize-me                      │   │
│   │   Service role key; bypass RLS; mediate Stripe           │   │
│   └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                Postgres 15 + PostGIS + pg_cron           │   │
│   │   11 tables · EXCLUDE-USING-gist no-double-book ·        │   │
│   │   uuid7() PK · RLS policies · views for reporting        │   │
│   │   triggers: updated_at, role-change block, total derive  │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                Storage (S3-backed)                       │   │
│   │   Pitch hero images · user uploads (Stage 4)             │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│   Region: eu-west-2 (Frankfurt) · GDPR proximity                 │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                          Stripe                                  │
│   Connect (Express) · PaymentIntents · application_fee_amount    │
│   destination charges → venue accounts · webhooks → Edge Fn      │
└──────────────────────────────────────────────────────────────────┘
```

---

## § Dependency rules

The layers above are not a polite suggestion. The arrows are one-way.

- **Mobile → Supabase only.** The app never talks to Stripe directly
  except for the Stripe Payment Sheet's own call to Stripe (which is
  Stripe's own SDK, not our code). Mobile never talks to Postgres
  except through Supabase. Mobile never talks to the service-role key.

- **Mobile → direct Postgres requires RLS coverage.** Any
  `supabase.from(...).select/update/insert/delete` is reachable from a
  hostile client. There must be an RLS policy that defines exactly who
  may do what; the absence of a policy means absence of permission
  (because RLS is enabled on every user-visible table — see
  `data-model.md`). If a write needs server-side invariants, it is not
  a direct write — it is an Edge Function.

- **Edge Functions → service role.** Edge Functions hold the only
  copy of `SUPABASE_SERVICE_ROLE_KEY` outside the dashboard. They
  bypass RLS deliberately, which means **they must enforce the
  authorization themselves** — verify `auth.uid()` from the request
  token, check admin role via `is_admin()`, snapshot pricing
  server-side, never trust client-sent amounts.

- **Edge Functions → Stripe is the only Stripe path.** Mobile never
  holds `STRIPE_SECRET_KEY`. The Stripe **publishable** key is
  embedded in the mobile bundle and is, by design, public.

- **Stripe → Supabase via webhook only.** The
  `account.updated` / `payment_intent.*` / `charge.refunded` events
  hit `stripe-webhook` and are reconciled into our state. Signature
  verification is non-negotiable (see `threat-model.md` §Stripe
  webhook).

- **Postgres → nothing.** Postgres is a leaf. Triggers may call
  pure SQL functions (`uuid7()`, `is_admin()`, `tg_bookings_*`) but
  not external services. Outbound calls happen in Edge Functions,
  never in triggers. (pg_cron is in-DB scheduling, not outbound calls.)

---

## § Components

### Mobile (`apps/mobile`)

- **Runtime:** Expo SDK 54, React Native 0.81, expo-router 6 (file-based
  routing). Targets iOS + Android from one TypeScript codebase. See
  [ADR-0002](adr/0002-mobile-expo-rn-expo-router.md).
- **Layout:**
  ```
  apps/mobile/
  ├── app/
  │   ├── (auth)/      # signin, OTP entry, magic-link callback
  │   ├── (tabs)/      # discover, bookings, profile
  │   └── _layout.tsx  # root provider tree
  └── src/
      └── lib/         # supabase client, booking helpers, idempotency keys
  ```
- **Auth:** `supabase.auth` owns identity. Session token persisted in
  `expo-secure-store` (Keychain on iOS, Keystore on Android). On cold
  reopen the session is rehydrated; expired tokens are refreshed
  automatically by the Supabase JS client.
- **i18n:** EN + ΕΛ via `packages/i18n`; locale toggle in Profile
  flips all copy without restart. See [ADR-0005](adr/0005-i18n-i18next.md).
- **Design system:** `packages/ui` carries tokens, COPY, primitive
  components. Imported as `@ludi/ui`. See [ADR-0007](adr/0007-design-system-package.md).
- **No test runner yet.** `apps/mobile/package.json` ships without
  jest/vitest. Don't write `__tests__/*.ts` files there until a
  runner lands (planned M4-ish). Pure-logic helpers are tested via
  the server-side mirror where possible.

### Web admin (`apps/admin`, planned)

- Per [ADR-0007](adr/0007-design-system-package.md), the second app
  starts as a Next.js project at `apps/admin/`. As of 2026-05-27 the
  admin app is scaffolded and ships M3 #13–#19 (bookings list, refund
  modal, pitch verify/deactivate, GMV dashboard). Behind Cloudflare
  Access or IP allowlist; no public route.
- **Shared UI package (`packages/ui-web/`)** stays unborn until ≥3
  primitives have shared usage. Until then, in-line CSS in `apps/admin/*`
  is the convention.

### Shared packages

- `packages/ui` — design tokens, COPY constants, RN primitives.
- `packages/i18n` — translation JSON files (EN, ΕΛ).
- `packages/config` — shared tsconfig, prettier, eslint.
- `packages/supabase` — schema migrations, Edge Functions, seed data,
  pgtap tests. **This is the backend.**

### Supabase project (`packages/supabase`)

```
packages/supabase/
├── config.toml                     # local CLI config; ports 64321-64329
├── supabase/
│   ├── migrations/                 # 10 plain-SQL files, time-ordered
│   ├── functions/                  # Deno Edge Functions
│   │   ├── _shared/                # shared types, Stripe client setup
│   │   ├── _tests/                 # Deno test runner
│   │   ├── create-booking/
│   │   ├── stripe-webhook/
│   │   └── ...                     # one folder per function
│   ├── seed.sql                    # 3 Larnaca pitches + schedules
│   └── snippets/                   # one-off SQL helpers
└── tests/
    └── rls/                        # pgtap suite (12 files, ~60 assertions)
```

- **Migrations** are append-only plain SQL applied lexicographically.
  `supabase db reset` wipes and re-applies; `supabase db push` ships
  to staging/prod from CI (never manually on prod). See
  [CONVENTIONS.md](CONVENTIONS.md) §Migrations.

- **Edge Functions** are Deno modules in `packages/supabase/supabase/functions/<name>/index.ts`.
  Each function:
  - Verifies the caller (session token or webhook signature) — bypassing RLS
    means the function carries that responsibility.
  - Validates input with a Zod schema; rejects malformed payloads as
    `VALIDATION_FAILED`.
  - Returns `{ error: 'ERROR_CODE', message, details? }` on failure;
    a typed success shape on the happy path.
  - Logs structured JSON `{ level, request_id, event, ...context }` —
    never PII. See [CONVENTIONS.md](CONVENTIONS.md) §Logging.

- **pgtap tests** run in CI. Every RLS policy gets at least one
  positive + one negative test ("user A can see own row", "user A
  cannot see user B's row"). The CI bootstrap injects an
  `auth.uid()` GUC override and the fixtures; table, view and
  function grants are the ones the migrations leave, as on prod. See
  [JOURNAL.md](JOURNAL.md) §A migration's REVOKE is not the last word
  in the pgtap harness.

### Stripe Connect

Destination-charge model. Each venue is a Stripe Connect Express
account; the platform takes `application_fee_amount` computed from
`venues.take_rate_bps` (1000 = 10%, snapshotted on the booking row at
creation time). See [ADR-0004](adr/0004-payments-stripe-connect.md).

- **Webhook events handled** (idempotent on `event.id`, recorded in
  a `stripe_events` table for de-dup):
  - `payment_intent.succeeded` → flip booking `pending → paid → confirmed`
  - `payment_intent.payment_failed` → mark payment failed; cleanup cron expires booking
  - `charge.refunded` → update `payments.refunded_amount_cents`
  - `account.updated` → update `venues.stripe_account_status`; trigger
    cascades `pitches.is_verified`

- **Webhook signature verification** uses
  `STRIPE_WEBHOOK_SIGNING_SECRET`. A failed verification returns 400;
  a missing secret in env causes the function to fail fast on startup.

---

## § The booking flow, end-to-end

This is the load-bearing flow. Every other flow is simpler.

```
1. User opens pitch detail. Mobile calls RPC get_available_slots(pitch_id, from, to).
2. User taps a slot + optional addons (bibs €5, ball_rental €3). Mobile generates an
   idempotency key (uuid v4) in a useRef — same key reused on retries.
3. Mobile invokes Edge Function create-booking with { pitch_id, starts_at, ends_at,
   addons }. The Idempotency-Key header is the ref'd uuid.
4. Edge Function: verifies session.user.id, validates Zod input, computes
   base_price_cents + addons_price_cents + total_cents + platform_fee_cents
   server-side (client never sends amounts), inserts booking row inside a
   transaction. The EXCLUDE USING gist (pitch_id, time_range) WHERE state IN
   ('paid','confirmed','completed') prevents double-booking even if two
   concurrent inserts race.
5. Edge Function creates Stripe PaymentIntent with application_fee_amount and
   transfer_data.destination = venue.stripe_account_id. Inserts payments row
   with status='requires_payment_method'. Returns client_secret to mobile.
6. Mobile presents Stripe Payment Sheet with client_secret. Stripe SDK
   handles card/Apple Pay/Google Pay. Ludi backend is not involved in the
   confirm step — the Sheet calls Stripe directly.
7. Stripe → stripe-webhook (payment_intent.succeeded). Webhook handler is
   idempotent on event.id; updates payments.status, flips booking pending→paid→
   confirmed in one transaction.
8. Mobile polls booking state (or subscribes via Realtime — Stage 4) and
   shows confirmation screen with booking code (LAR-2026-0001 format).
9. Confirmation email via Resend (transactional, in user's preferred_locale).

Failure modes:
- Slot taken between step 1 and step 4 → 409 SLOT_UNAVAILABLE, mobile re-fetches slots.
- Stripe call fails → 502 STRIPE_ERROR with code, mobile retries with the same
  idempotency key. Server returns the cached response on retry.
- User abandons after step 4 → pg_cron sweep cancels pending bookings >15min old;
  if the PI later succeeds (race), webhook detects the cancelled booking and
  issues an immediate Stripe refund.
```

---

## § State ownership

| Concern                  | Owner                | Notes |
|---|---|---|
| Identity (who is who)    | Supabase Auth        | `auth.users` is the source; `public.users` 1:1 FK adds profile |
| Authorization (who may)  | RLS + Edge Functions | RLS for direct queries; Edge Fns enforce their own checks when bypassing RLS |
| Money                    | Stripe + `payments`  | Stripe is merchant-of-record; `payments` mirrors PaymentIntent state |
| Booking invariants       | Postgres             | EXCLUDE constraint + CHECK constraints; no app-level enforcement |
| Pricing snapshot         | Edge Function        | `base_price_cents`, `platform_fee_cents` snapshotted at create-booking time |
| Cancellation policy      | `bookings` row       | Snapshotted from `venues.cancellation_policy` so mid-booking policy changes don't apply |
| Audit                    | `admin_actions`      | Every admin write through Edge Function inserts a row; append-only by RLS |
| Idempotency              | `idempotency_keys`   | Per-(user, action) key cache; pg_cron cleans expired |
| Webhook de-dup           | `stripe_events`      | Insert event.id; ON CONFLICT DO NOTHING returns 0 → already processed |
| Session                  | Mobile + Supabase JS | Token in `expo-secure-store`; refresh handled by SDK |

---

## § Non-functional posture

- **Latency budget (mobile):** Discover list < 2s on mid-range Android
  on 4G. Driven by RLS-gated direct select with `pitches!inner(venues!inner(...))`
  — one round-trip, returns ≤50 rows.

- **Throughput:** the constraint that matters is concurrent
  `create-booking` calls hitting the same pitch + slot. Verified safe
  by the EXCLUDE constraint: a load test of 100 parallel double-book
  attempts results in exactly one success. (Test is on the Stage 2
  exit checklist; M1 #5 pgtap suite is the regression backstop.)

- **Availability:** Supabase Pro tier 99.9% SLA. Stripe SLA separate.
  Mobile app must show user-visible error states on every failure
  path; the cleanup cron handles abandoned states.

- **Data residency:** eu-west-2 (Frankfurt). Required by GDPR
  proximity and Cyprus user expectations.

- **PII surface:** name + phone/email + booking history + Stripe
  customer ID. Never raw PAN; that lives in Stripe. See
  `threat-model.md` §PII & GDPR.

- **Backup:** Supabase Pro daily point-in-time + weekly `pg_dump` to
  S3, retained 90 days. Restore-test runbook lives in
  `docs/runbooks/restore-test.md` (deferred — write after first
  restore test). See [infra.md](infra.md) §Backups.

---

## § What's deliberately not in this architecture

These are recorded in [FUTURE.md](FUTURE.md) with triggers — listing
them here so re-litigation requires a doc change, not a discussion:

- **No GraphQL.** Supabase JS + RPC + Edge Functions covers the surface;
  PostgREST is implicit underneath.
- **No service mesh / API gateway.** Supabase fronts everything; one
  origin per environment.
- **No Realtime in MVP.** Polling + webhooks suffice; Realtime opens
  in Stage 3 for live match fills.
- **No custom backend service.** Edge Functions are the only place
  custom server code lives. If a flow doesn't fit Edge Functions
  (cold-start sensitivity, long-running jobs), it's a signal to
  rethink the flow, not to stand up a Node/Fastify service. See
  [ADR-0003](adr/0003-backend-supabase.md).
- **No client-side map screen.** The full map tab (gestures, clustering,
  "near me") stays deferred to Stage 4 per
  [ADR-0008](adr/0008-maps-mapbox-deferred.md). The home mini-map card
  (pins only, react-native-maps, iOS-only until an Android key ships) is
  the deliberate exception — see
  [ADR-0029](adr/0029-home-minimap-react-native-maps.md).

---

## § Open architectural questions

These have not been decided. Each will produce an ADR when answered.

1. **OTA updates (`expo-updates`).** When to flip on. Probably Stage 3,
   after the first 100 users — small fix turnarounds matter more then.
2. **Rate-limit middleware shape.** `create-booking` 5/min/user is in
   the threat model but unimplemented. Edge Function middleware vs
   Postgres `rate_limits` table is open; defer until the first abuse.
3. **Pitch-owner self-serve onboarding.** MVP is founder-mediated.
   Stage 4 needs a flow that doesn't require me physically meeting
   each owner. The trust/verification design is open.
4. **`packages/ui-web/` extraction.** Per [ADR-0007](adr/0007-design-system-package.md),
   wait until ≥3 components are shared between `apps/admin` and a
   future marketing site. Currently 0/3.

---

## § Changelog

- **2026-05-27** — Initial ARCHITECTURE.md. Consolidates the 8 ADRs,
  `infra.md`, `api-contract.md` into one layered view. Retroactive —
  written after M1+M2+M3 shipped (19/35 commits on main) — to install
  the aristophanes-style doc discipline going forward.
