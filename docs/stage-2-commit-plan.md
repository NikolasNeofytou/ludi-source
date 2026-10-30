# Ludi · Stage 2 Commit Plan

_Operational breakdown of the [Stage 2 exit checklist](./roadmap.md#stage-2--mvp-first-paying-booking) into ~44 modular commits, grouped by milestone. Each commit is scoped to one session's worth of work (30 min – 6 h) so progress stays reviewable and revertable._

_M1–M5 (35 commits, 31 landed) build the product. **M6 (9 commits) ships it** — the deployment, distribution, and venue-admin surface that the original plan assumed away. See the 2026-08-10 changelog entry._

## How to use this doc

- **One session = one commit (ideally).** The list below is the menu; pick the next item on the critical path, or one from a parallel track.
- **Mark done by editing the file.** Replace the `⬜` in the commit line with `✅` when the commit lands on `main`, and add the commit SHA. No verbal claims of progress — same rule as `roadmap.md`.
- **Pull the plan forward, don't push it back.** If a commit doesn't work out as scoped, split it. Don't fudge the scope to claim credit.
- **Keep the size tags honest.** `S` = 30 min – 1 h, `M` = 1 – 3 h, `L` = 3 – 6 h, `XL` = multi-session. If something grows past `XL`, it's a missing milestone in disguise — re-plan.

## Critical path — shortest route to the first paying booking

If you only do these 12 commits, in this order, Andreas can book and Maria gets paid. Everything else is hardening:

1. M1 #1 `feat(supabase): stripe-webhook Edge Function`
2. M1 #2 `feat(supabase): get_available_slots RPC`
3. M1 #3 `chore(supabase): seed 3 Larnaca pitches + schedules for local dev`
4. M2 #6 `feat(mobile): phone-OTP auth + JWT storage`
5. M2 #7 `feat(mobile): Discover tab connected to Supabase`
6. M2 #8 `feat(mobile): pitch detail + availability grid`
7. M2 #9 `feat(mobile): booking flow + Stripe Payment Sheet`
8. Non-code: meet 3 Larnaca pitch owners
9. M5 #29 `feat(supabase): venue-connect-onboard Edge Function`
10. M5 #30 `feat(admin): venue Stripe Connect onboarding UI` (minimal — list + link only)
11. Non-code: register `ludi.app` + Cloudflare
12. Non-code: Stripe Connect test payout to a real Cypriot IBAN

Everything else in this doc exists to make that 12-step loop safe, observable, and re-playable — not to make it _work_ for the first time.

---

## Milestone 1 — Local end-to-end booking works (no UI yet)

**Goal:** `curl create-booking` → pay via Stripe test card → `stripe-webhook` fires → booking lands in `confirmed` state. All from `supabase start`, no cloud needed.

| # | Status | Commit | Size | Notes |
|---|---|---|---|---|
| 1 | ✅ | `feat(supabase): stripe-webhook Edge Function` | L | Handles `payment_intent.succeeded` / `.payment_failed` / `charge.refunded` / `account.updated`. Idempotent on `event.id` (de-dup table). Stripe signature verified with raw body. Orphan-PI path refunds if cleanup cancelled the booking before settle. Landed in PR #3. |
| 2 | ✅ | `feat(supabase): get_available_slots RPC` | M | Pure SQL function: schedules minus overrides minus existing bookings (`pending/paid/confirmed/completed`). Returns `(starts_at, ends_at, is_available)` including unavailable slots for struck-through UI. Timezone hardcoded to `Europe/Nicosia` (Cyprus-only MVP). Landed in PR #4. |
| 3 | ✅ | `chore(supabase): seed 3 Larnaca pitches + schedules for local dev` | S | Adds venue + 3 pitches (5/7/11-a-side) + weekly schedules + one sample override (Christmas closure) to `seed.sql`. Deterministic UUIDs so reruns are stable. Fixture venue has `stripe_account_status='active'` so the pitch verify-guard lets pitches through. Landed in PR #5. |
| 4 | ✅ | `feat(supabase): pg_cron schedules for cleanup functions` | S | Schedules `cleanup_stale_pending_bookings(15)` every 5 min, `cleanup_expired_idempotency_keys()` every 10 min, `cleanup_old_stripe_events(30)` daily at 03:00 UTC. Detects pg_cron availability and skips gracefully when absent (e.g. vanilla CI Postgres). Landed in PR #6. |
| 5 | ✅ | `test(supabase): pgtap RLS suite` | L | 12 pgtap files, ~60 assertions across all 11 user-visible tables (incl. service-role-only `stripe_events` / `idempotency_keys` regression guard). Bootstrap installs a CI-only `auth.uid()` GUC override + `set_test_user(uuid)` / `set_test_anon()` helpers so pgtap can switch identity inside a transaction. CI installs `postgresql-15-pgtap` into the postgis service container and `pg_prove` on the runner. |

**Exit:** a shell script `scripts/smoke-booking.sh` runs end-to-end against local Supabase + Stripe test keys and ticks off two checklist items (`create-booking atomic under load`, `booking code format`).

---

## Milestone 2 — Mobile happy path

**Goal:** Andreas opens a cold-installed app, signs up with phone OTP, finds a pitch in Larnaca, books it, pays with Apple Pay. You can record the whole flow as a 60-second screen video.

| # | Status | Commit | Size | Notes |
|---|---|---|---|---|
| 6 | ✅ | `feat(mobile): phone-OTP auth + JWT storage` | L | `supabase.auth.signInWithOtp({phone})` → OTP screen → `verifyOtp()`. Session persisted to `expo-secure-store`. On cold reopen, rehydrate. Landed in PR #9. |
| 7 | ✅ | `feat(mobile): Discover tab connected to Supabase` | M | Replace hardcoded list with `supabase.from('pitches').select(...)` per api-contract.md §3.1. Filter chips reduce list client-side. Loading + empty + error states. Bundled with #8 in PR #11. |
| 8 | ✅ | `feat(mobile): pitch detail + availability grid` | L | Uses `get_available_slots` RPC. 7-day horizon, slot tiles, struck-through unavailable slots. "Open in Maps" deep link. Bundled with #7 in PR #11. |
| 9 | ✅ | `feat(mobile): booking flow + Stripe Payment Sheet` | L | Calls `create-booking` with Idempotency-Key (uuid v4 per attempt). Presents Stripe Payment Sheet. Polls booking state until `confirmed` or times out with a "payment taking long" screen. Landed in PR #14. |
| 10 | ✅ | `feat(mobile): bookings list (past/upcoming)` | M | Two-segment list per api-contract.md §5.4. Pull-to-refresh. Tap → detail with cancel CTA (wired in M3). **Milestone 2 complete.** Landed in PR #21. |

**Exit:** video-recordable first-booking happy path on a physical iPhone with a Stripe test card. Ticks 4 checklist items.

---

## Milestone 3 — Cancel + admin basics

**Goal:** you can cancel bookings with correct refund math and run the business from a web dashboard instead of the Supabase Studio SQL editor.

| # | Status | Commit | Size | Notes |
|---|---|---|---|---|
| 11 | ✅ | `feat(supabase): cancel-booking Edge Function` | M | Applies cancellation policy table from api-contract.md §5.5. Stripe refund with `refund_application_fee: true`. Updates booking state + `cancellation_refund_cents`. Landed in PR #18. |
| 12 | ✅ | `feat(mobile): cancellation flow + policy UI` | M | Detail screen surfaces refund amount before confirm. Policy snapshot on booking, not venue, so mid-booking policy changes don't affect users. Landed in PR #23. |
| 13 | ✅ | `feat(admin): scaffold Next.js app at apps/admin` | M | New workspace package per ADR-0007. Server-side auth via Supabase SSR helper. Landed in PR #24. |
| 14 | ✅ | `feat(admin): auth + admin role gate` | M | Redirects non-admins to a locked page. Relies on `users.role = 'admin'` set manually via SQL (or seed). Landed in PR #25. |
| 15 | ✅ | `feat(admin): bookings list + filtering` | M | Server-rendered table. Filter by state, date range, venue. RLS lets admins see all. Landed in PR #26. |
| 16 | ✅ | `feat(supabase): admin-refund-booking Edge Function` | M | Wraps Stripe refund + `admin_actions` audit row in one server flow. Reason field required (min 10 chars). Landed in PR #27. |
| 17 | ✅ | `feat(admin): refund booking UI` | S | Confirmation modal calling #16. Landed in PR #28. |
| 18 | ✅ | `feat(admin): verify/deactivate pitch UI` | M | Promoted from S → M when shipped as Edge Function (`admin-toggle-pitch`) + UI for atomic audit-row + boolean flip. Three actions: verify / activate / deactivate. Idempotency-key support. Landed in PR #31. |
| 19 | ✅ | `feat(admin): daily GMV dashboard` | M | Uses views from api-contract.md §7.4 (`v_gmv_daily`). View migration shipped alongside. `/gmv` page with 7/30/90-day pills, totals strip, pure-SVG stacked bar chart (no recharts dep). Europe/Nicosia bucketed, DST-safe via tz name. **Milestone 3 complete.** Landed in PR #32. |

**Exit:** admin web deployed behind Cloudflare Access or an IP allowlist. You can cancel + refund a test booking from the admin UI and see the audit row.

---

## Milestone 4 — Production-ready posture

**Goal:** every Stage 2 security, observability, and compliance bullet is tickable.

| # | Status | Commit | Size | Notes |
|---|---|---|---|---|
| 20 | ✅ | `feat(mobile): Apple + Google + magic-link auth` | L | `expo-apple-authentication` + `expo-auth-session` + email magic-link with `ludi://auth/callback` scheme. All flows persist the same session. Magic-link fully wired; Apple code-complete pending Apple Developer entitlement; Google `useAuthRequest` hook lift is a follow-up. Landed in PR #34. |
| 21 | ✅ | `feat(mobile): profile edit screen` | M | Name, locale, city (chip picker of enabled cities), positions (10-position chip multi-select), preferred foot (3 chips, tap-to-clear), skill level (1–5 chips + LevelBars). Locale toggle re-renders without restart via `setLocale()`. Handle deferred. Landed in PR #TBD. |
| 22 | ✅ | `feat(mobile): GDPR consent modal on first launch` | S | Two-tier consent: AsyncStorage is the binding record (gates the app via `ConsentGate` in `_layout.tsx`, sits outside StripeProvider + SessionProvider so no data-flow inits before consent). `auth.users.raw_user_meta_data.{gdpr_consent_at,gdpr_consent_version}` is the server-side audit copy, synced best-effort on `SIGNED_IN`/`TOKEN_REFRESHED`. Versioned (`v1`) so policy bumps re-prompt. Landed in PR #TBD. |
| 23 | ✅ | `feat(m4): Sentry integration` | M | Three surfaces per [ADR-0010](adr/0010-sentry-error-tracking.md): `@sentry/deno` Edge Functions (+ shared `scrub()` + Deno contract test), `@sentry/react-native` mobile, `@sentry/nextjs` admin. Legitimate-interest posture, source-level PII scrub, opaque-user-id tagging, DSN-guarded no-op. Edge + Apple-enablement landed in PR #56; mobile + admin clients in PR #TBD. |
| 24 | ✅ | `feat(mobile): PostHog — MVP events from infra.md` | M | Seven events per [ADR-0011](adr/0011-posthog-product-analytics.md): `app_opened`, `auth_completed`, `pitch_viewed`, `booking_started`, `booking_confirmed`, `booking_failed`, `booking_cancelled`. Mobile-only, EU cloud, **consent-gated** (held behind M4 #22, opts out on revocation), autocapture off, no PII in properties, key-guarded no-op when `EXPO_PUBLIC_POSTHOG_API_KEY` absent. Funnel-visible in PostHog. Wiring verified on-device (consent-gated, 7 events fire); ships dormant until the EU key is set. Landed in PR #64 (`5163a88`). |
| 25 | ✅ | `chore(ci): sqlfluff + pgtap in CI` | S | `sqlfluff lint` migrations + seed + tests against `packages/supabase/.sqlfluff` (CP01/CP02/CP04/CP05 only — alignment rules deliberately ungated). pgtap was already wired by M1 #5 (PR #8); this commit auto-fixed 30 pre-existing case violations (`false`→`FALSE`, `EXCLUDED`→`excluded`) and added the new `sql-lint` CI job. Landed in PR #TBD. |
| 26 | ✅ | `chore(deps): Dependabot config` | S | Weekly, grouped. npm across the whole pnpm workspace (`/`, `/apps/*`, `/packages/*`) + github-actions. Deno/Edge-Function deps **not** covered — Dependabot has no native ecosystem for Supabase import-map deps; gap documented in `.github/dependabot.yml`. Landed in PR #42 (`95095bf`); actions-grouping refined in PR #49. |
| 27 | ✅ | `chore(security): publish SECURITY.md` | S | Root `SECURITY.md` — reporting channels, 72h ack SLA, 30/90-day fix targets, scope, safe harbour, no-bounty. Operationalizes [ADR-0009](adr/0009-responsible-disclosure-policy.md). Per docs/threat-model.md posture. Landed in PR #41 (`7a0d258`). |
| 28 | ⬜ | `chore(legal): privacy + terms pages at ludi.football/privacy` | M | Static pages in new **`apps/site`** (public Next.js app — not `apps/admin`, which is access-gated behind Cloudflare/IP allowlist and can't host public legal pages). Reference DPA with Supabase, data retention 7 years (Cyprus tax), EU data residency. Scaffolded 2026-08-12 with draft content on [PR #84](https://github.com/NikolasNeofytou/Ludi/pull/84) (merged 2026-08-18); needs a legal-content review pass before this ticks ✅. |

**Exit:** Stage 2 "Security" (4), "Compliance" (3), and "Infrastructure" bullets 3–5 are all green.

---

## Milestone 5 — Ready for first real user

**Goal:** close the loop with a real Larnaca pitch owner and a real payout.

| # | Status | Commit | Size | Notes |
|---|---|---|---|---|
| 29 | ✅ | `feat(supabase): venue-connect-onboard Edge Function` | L | Creates Stripe Express account, returns onboarding link. Handles `account.updated` webhook (already in M1 #1) to flip `venues.stripe_account_status`. Admin-authed (Stage 2; owner self-serve is a Stage-4 broadening). `deno check` clean; runtime onboarding **verified live via #30** (real Stripe test account + hosted link + `account.updated` webhook flip). Landed in PR #65 (`c48a952`). |
| 30 | ✅ | `feat(admin): venue Stripe Connect onboarding UI` | M | `/venues` list + "Onboard with Stripe" modal that invokes `venue-connect-onboard` with the admin JWT and surfaces the hosted link (copy / open) for founder-mediated onboarding; status badges reflect `venues.stripe_account_status`, auto-updated by the `account.updated` webhook. Verified live on the local stack: real Stripe **test** Express account created + link minted + persisted; webhook flipped the venue status. Built with localhost return URLs (ludi.app registration not required for the link to generate). Live *booking/payout* demo deferred — see JOURNAL 2026-06-09. Landed in PR #68 (`3cd1609`). |
| 31 | ✅ | `feat(supabase): anonymize-me Edge Function` | M | Self-service GDPR erasure (**anonymise-and-keep**, [ADR-0018](adr/0018-account-erasure-anonymize-and-keep.md)): nulls PII in `public.users` + sets `anonymized_at` (atomic), writes an `anonymize_user` `admin_actions` row (`admin_user_id` = the user), then `auth.admin.deleteUser(id, true)` (**soft-delete**) to scrub email/phone/metadata + block login. No hard delete — the `users → auth.users` CASCADE vs child-FK RESTRICT web makes that impossible for any user who has booked (resolved a contract/data-model contradiction). Idempotent; verified end-to-end on the local stack. Landed in PR #70 (`9951292`). |
| 32 | ✅ | `feat(mobile): delete account flow` | S | Profile → "Delete account" → confirmation screen (consequences + retention copy, en/gr) → `deleteAccount()` calls #31 `anonymize-me` → `signOut({ scope: 'local' })` → root AuthGate redirects to sign-in. Apple 5.1.1(v) in-app-deletion ship-gate; the user-facing half of #31 ([ADR-0018](adr/0018-account-erasure-anonymize-and-keep.md)). Verified on-device (iPhone 16 Pro, Release): account erased + signed out + re-login blocked. Landed in PR #72 (`0789b43`). |
| 33 | ⬜ | `chore(infra): staging Supabase project + env docs` | M | Provision the project via dashboard. Document required env vars per environment in `docs/infra.md`. Wire mobile + admin staging builds. |
| 34 | ⬜ | `chore(infra): weekly pg_dump to S3 + restore smoke test` | M | Scheduled GitHub Action dumps to S3 with server-side encryption. Separate job restores the dump weekly to verify the backup is readable. |
| 35 | ⬜ | `chore(infra): uptime monitor` | S | Better Stack or UptimeRobot. Monitor public URLs; alert on Slack/email. |

**Exit:** the full 30-bullet Stage 2 checklist in `roadmap.md` is green. Andreas books, Maria gets paid, Ludi takes 10%.

---

## Milestone 6 — First live venue

**Goal:** a real Larnaca venue, onboarded by its real owner, takes a real booking from a phone that installed Ludi from TestFlight, and the money lands in a real Cypriot IBAN.

**Why this milestone exists.** M1–M5 assumed the last mile was the remaining ⬜ boxes. The 2026-08-10 eyes-on pass showed otherwise: everything ever verified was verified on a laptop, against a local Docker stack, with Stripe test keys. There is no staging or production Supabase project, no deploy workflow, no `eas.json`, no way to create a venue except hand-written SQL, and no way for a player to install the app. None of that is a Stage 2 exit bullet, and all of it stands between the code and a paying customer. M6 is the honest name for that gap.

| # | Status | Commit | Size | Notes |
|---|---|---|---|---|
| 36 | ✅ | `fix(supabase): is_admin() SECURITY DEFINER — RLS recursion` | S | `is_admin()` was `SECURITY INVOKER` reading `public.users`, whose SELECT policy calls it back — unbounded recursion, `54001 stack depth limit exceeded`. Killed the admin bookings list and any PostgREST read embedding `users`. Migration `20260810000001` + a structural pgtap regression assert. See JOURNAL 2026-08-10. Landed in PR #79 (`94fae77`). |
| 37 | ✅ | `fix(mobile): expo-crypto for idempotency keys` | S | `crypto.randomUUID()` throws under Hermes — no global `crypto`. First statement in the checkout effect, so **no booking could be created at all**. Swapped to `expo-crypto` in `booking.ts` + `cancellation.ts`. Landed in PR #80 (`6d8b16b`). |
| 38 | ⬜ | `chore(infra): reconcile Stripe Connect funds-flow` | M | **Re-framed 2026-08-22 — see [funds-flow-reconciliation.md](spikes/funds-flow-reconciliation.md).** There is no model to decide: ADR-0004 chose destination charges, api-contract §5.1 specifies them, `create-booking` implements them, and they were verified in production on 2026-08-21. The contradiction is *inside ADR-0004*, which specifies `transfer_data[destination]` and then asserts the pitch owner is merchant of record — a direct-charge property. Under destination charges **Ludi is MoR on the full booking value**. The open question is fiscal, not technical (VAT + chargeback exposure for a CY sole trader), which is why 74 days of engineering time has not moved it. **Blocks every commit below that moves money.** Open since 2026-06-09. |
| 39 | ⬜ | `chore(infra): staging + production Supabase projects` | L | Was M5 #33, promoted and widened. Provision both in eu-west-2, migrate to the same head, deploy Edge Functions, document env vars per environment in infra.md. |
| 40 | ✅ | `ci: deploy-staging + deploy-production workflows` | M | infra.md §deploy describes both; neither exists. Migrations + Edge Functions on merge to `main` for staging, manual-trigger for prod. No auto-deploy to production. **Landed 2026-08-29, gated on secrets:** both workflows exist and are syntactically live, but no-op (staging, loudly and green) / refuse (prod) until #39 provisions the projects and `SUPABASE_ACCESS_TOKEN` + per-env `*_PROJECT_REF`/`*_DB_PASSWORD` repo secrets are added — the repo currently has zero Actions secrets. EAS preview build + chat notification from the infra.md sketch deferred (no EXPO_TOKEN, EAS quota exhausted until 09-01). The first green staging deploy against a real project is the proof; until then treat this tick as "written and reviewed", not "exercised". |
| 41 | ⬜ | `feat(admin): venue + pitch + schedule CRUD` | L→**XL** | **Not previously planned, and re-scoped 2026-08-22.** Admin is read-and-filter only; creating a venue means hand-writing INSERTs. Decided 2026-08-22 that the admin becomes a **venue-owner surface**, not a founder tool — so #41 decomposes into **41a–41i** in [plans/venue-owner-admin.md](plans/venue-owner-admin.md) (~2 weeks, not one L). Ordering matters: **41a** fixes `get_available_slots` (split-window + override duplication, reproduced) and **41b** adds the `pitch_schedules` overlap constraint, both **before** 41f's schedule editor can create the rows that expose them. **41a–41f is the shippable slice**; 41g–41i (owner earnings, booking roster, owner audit rows) carry to September. |
| 42 | ⬜ | `chore(mobile): eas.json + first TestFlight build` | M | **Not previously planned.** No EAS config exists, so no build has ever left this Mac. Until this lands there is no path from "built" to "a footballer has it on their phone". Needs an Apple Developer account and the bundle id already in use locally. |
| 43 | ⬜ | `chore(admin): deploy behind access control` | M | Stage 2 already requires "admin web tool live at an access-controlled URL" and it is still unticked. Cloudflare Access or IP allowlist, on `ludi.app` DNS. **Reprioritised 2026-08-22:** with venue owners on this surface (#41 re-scope) this stops being founder convenience and becomes the precondition for anyone but the founder using any of it — land it **between 41d and 41e**. Cloudflare Access with a per-person policy also stops being the obvious answer once the users are customers rather than staff. |
| 44 | ✅ | `test(e2e): booking happy path against staging` | L | Neither blocker found on 2026-08-10 was catchable by CI — one hides from pgtap because it only appears through PostgREST, the other sits in mobile code with no test runner. One test that drives a real booking against staging would have caught both. **Landed 2026-08-29, retargeted at the full LOCAL stack in CI** (staging still doesn't exist — #39/#40 remain open): `tests/e2e/booking_happy_path.ts` boots GoTrue + PostgREST + edge runtime via the CLI and drives OTP auth → Discover embed → `get_available_slots` → a walk-in booking write, asserting the EXCLUDE constraint, idempotency replay, RLS isolation, and cancel-frees-slot. Targets whatever `SUPABASE_URL` points at, so it becomes the staging smoke test the day #39/#40 land. The Stripe leg of `create-booking` stays on unit tests + manual rehearsal. |
| 45 | ⬜ | `fix(supabase): transition played bookings to completed` | S | **Found 2026-08-24** writing the shared-fixture DATA_MODEL — see [JOURNAL.md](../JOURNAL.md#gotchas). Six places read `state = 'completed'`; nothing writes it, so `cancel-booking`'s "slot already played" guard never fires and a played **flex** booking stays refundable at 50% forever (`refundBpsForPolicy('flex', negative)` → `5_000`). Standard and strict return 0 and no venue is on flex yet, which is the only reason it has not cost money. Needs a decision, not just code: does the `confirmed → completed` transition belong to a cron job or the payout webhook? |

**Exit:** a venue owner who has never met a terminal completes Stripe onboarding from a link you send them, a player installs from TestFlight and books a slot, the charge settles, the payout reaches a real IBAN, and you watch all of it from a deployed admin dashboard.

---

## Non-code tasks (interleaved, not commits)

These block commits but can't be done from a terminal. Schedule them into calendar, not standups.

- **Register `ludi.app`** + point DNS to Cloudflare. Block M5 #30 on this.
- **Sign Data Processing Agreement** with Supabase. Block M4 #28 on this.
- **Meet 3 Larnaca pitch owners.** Block M5 #29 on this — pointless to build venue onboarding with zero venues in the pipeline.
- **Stripe Connect payout test** to a real Cypriot IBAN. Block PR #30 "exit" claim on this.
- **Reconcile Stripe Connect funds-flow.** The Connect platform profile reads *"sellers collect payments directly"* (direct-charge model), but the payment code uses **destination charges** (platform collects, keeps `application_fee`, transfers to the venue). Fix under *platform setup* before real money flows. Also blocks the #30 "exit"/first-paying-booking claim. Now tracked as a commit — M6 #38.
- **Apple Developer account + App Store Connect app record.** Blocks M6 #42 (TestFlight). No build has ever left the dev Mac; this is the only distribution path to a real player. Operational checklist: [apple-testflight.md](apple-testflight.md) (enrol as Individual; sales friend goes on as an internal tester — no beta review).
- **Activate the Stripe platform account for live mode.** Platform-side KYC, separate from any venue's onboarding. Blocks the first real charge.

Roadmap's #1 risk is supply-side validation. **The pitch-owner meetings are the single most important Stage 2 task.** Code is blocked on that, not the other way around.

---

## Effort summary (solo, ~15 h/week)

| Milestone | Total size | Calendar estimate |
|---|---|---|
| M1 | 2×L + 2×S + 1×M = ~11 h | **1 week** |
| M2 | 4×L + 1×M = ~20 h | **2 weeks** |
| M3 | 4×M + 3×S + 2×M = ~16 h | **1.5 weeks** |
| M4 | 3×L + 4×M + 3×S + 1×M = ~22 h | **2 weeks** |
| M5 | 3×L + 3×M + 1×S = ~18 h | **1.5 weeks** |
| M6 | 3×L + 4×M + 2×S = ~28 h | **2 weeks** |
| **Total** | **~115 h** | **~12 weeks** of build time, of which ~10 are spent |

Slack is for unknowns: Stripe Connect document verification delays for Cyprus SMBs, EAS Build OTA quota, iOS device-testing surprises, burnout week.

---

## Parallel opportunities

If you're blocked on the critical path (e.g. waiting for a pitch owner's Stripe verification), these can be done anytime:

- **M1 #5** pgtap RLS suite — independent of product, high value as policies evolve
- **M4 #25 – #28** — sqlfluff, Dependabot, SECURITY.md, privacy/terms — pure chore work, can be done on a tired evening
- **M4 #23 – #24** — Sentry + PostHog — nice to have observability in place _before_ real users arrive
- **M5 #33** staging Supabase provisioning — blocks integration tests but otherwise independent

---

## Stop adding to this plan when...

- The commit count drifts above ~50 without finishing at least one milestone (scope creep).
- You find yourself editing this doc more often than committing code (meta-work trap).
- Any commit below is older than 3 months without being done (re-plan or drop).

## Changelog

- **2026-08-29** (later) — **#40 deploy workflows landed, gated on
  secrets.** `deploy-staging.yml` (after CI green on main: `db push` +
  `functions deploy`, skips loudly-but-green while the secrets are
  absent) and `deploy-production.yml` (workflow_dispatch only, requires
  typing the literal `deploy`, hard-fails without secrets). Activation
  checklist = #39: provision `ludi-staging`, then add
  `SUPABASE_ACCESS_TOKEN`, `SUPABASE_STAGING_PROJECT_REF`,
  `SUPABASE_STAGING_DB_PASSWORD` (+ `SUPABASE_PROD_*` for prod) as repo
  secrets. EAS preview + notifications deferred with reasons in the
  workflow headers.
- **2026-08-29** — **#44 e2e booking happy path landed**, retargeted at
  the full local stack after a reality check: staging (#39) and the
  deploy workflows (#40) still don't exist (the repo has no Actions
  secrets at all — every prod deploy so far was manual), so "against
  staging" as written was unrunnable. The new CI `e2e` job boots the
  real stack via the CLI (GoTrue + PostgREST + edge runtime + seed) and
  drives: OTP auth round trip, the Discover venues-embed read (the exact
  query the 08-10 `is_admin()` recursion killed), `get_available_slots`,
  a walk-in booking write (EXCLUDE constraint, idempotency replay,
  RLS isolation from an unrelated player, cancel-frees-slot). Chose the
  walk-in function over `create-booking` deliberately — same slot-lock +
  idempotency substrate, zero Stripe credentials needed, so the test
  runs anywhere. Script targets `SUPABASE_URL`, making it the staging
  smoke test the day #39/#40 land.
- **2026-08-24** — **#45 added.** A money defect found while writing the
  shared-fixture DATA_MODEL rather than by a test: nothing sets
  `bookings.state = 'completed'`, so a played `flex` booking is still
  refundable at 50%. Ledger grows 44 → 45.
- **2026-08-22** — **#41 re-scoped from one L to nine commits (41a–41i)**
  after a planning session on the admin panel. Decision: the admin is a
  **venue-owner product**, not a founder tool that owners might one day
  get. The substrate for that has existed unused since 2026-04-21
  (`venue_owners` + owner write policies on venues/pitches/schedules/
  overrides, all pgtap-tested), so the work is one surface plus seven
  gaps — not a new app. Three correctness defects were **reproduced**
  against the local stack and now gate the schedule editor: split
  windows + a date override return every slot twice, an override on a
  day with no weekly row is silently ignored, and overlapping weekly
  windows are accepted with no constraint. Also found: three
  owner-facing reads that return **empty rather than erroring**
  (`v_gmv_daily` has no venue dimension, owners can't join to the
  player who booked, owner writes aren't audited). Plan:
  [plans/venue-owner-admin.md](plans/venue-owner-admin.md); gotchas in
  [JOURNAL](JOURNAL.md) 2026-08-22; FUTURE's pitch-owner-dashboard item
  annotated as a deliberate pull-forward. No code; still **33/44**.
- **2026-08-11** — **#36 is_admin() RLS recursion** (PR #79, `94fae77`) and **#37 Hermes crypto** (PR #80, `6d8b16b`) merged — both same-day fixes from the eyes-on pass below. Alongside them, the **"Chalk & Aegean" whole-app design pass** landed (PR #81, `0aa62c1`): the Fraunces/JetBrains Mono typography ships for the first time (a `useFonts({})` empty map had silently dropped it since April — see JOURNAL), new Aegean-primary palette with WCAG-AA-passing text pairs, generated SVG pitch imagery, the always-expanded €35+addons→€43 price breakdown before payment, humanised checkout failure, and Matches/Map hidden until they do something. Design source preserved at [docs/ui/design-handoff-bundle/](ui/design-handoff-bundle/). **33/44.**
- **2026-08-10** — **Re-plan: Milestone 6 added (#36–#44); the plan is now 44 commits, not 35.** Triggered by the first venues entering closing and by an eyes-on pass over the running apps, the first since 2026-06-12 (eight weeks, Dependabot-only). Two live blockers found, both fixed the same day and both invisible to CI: **#36** `is_admin()` RLS recursion (killed the admin bookings list and any PostgREST read embedding `users`) and **#37** `crypto.randomUUID()` under Hermes (killed the entire booking flow — no booking could be created at all). Both written up in [JOURNAL](JOURNAL.md) 2026-08-10. The re-plan's substance: **31/35 overstated readiness.** Everything ever verified was verified against a local Docker stack with Stripe test keys. There is no staging or production project, no deploy workflow, no `eas.json`, no venue-creation UI, and no way for a player to install the app — none of which was a Stage 2 exit bullet, all of which stands between the code and a paying customer. Month plan: [plans/2026-08.md](plans/2026-08.md).
- **2026-04-21** — Initial plan. 35 commits across 5 milestones, 4 non-code tasks. Stage 2 target unchanged (12 weeks from 2026-04-21).
- **2026-04-23** — M1 #1 landed (`stripe-webhook`). 1/35 commits complete.
- **2026-04-23** — M1 #2 landed (`get_available_slots`). 2/35 commits complete.
- **2026-04-23** — M1 #3 landed (Larnaca seed fixtures). 3/35 commits complete.
- **2026-04-23** — M1 #4 landed (pg_cron schedules for the 3 cleanup functions). 4/35 commits complete.
- **2026-04-26** — M1 #5 landed (pgtap RLS suite covering all 11 user-visible tables + 2 service-role-only tables). Milestone 1 complete. 5/35 commits complete.
- **2026-05-04** — M2 close + M3 kickoff: #6 phone-OTP auth (PR #9), #7+#8 Discover + pitch detail bundled (PR #11), #9 booking flow + Stripe Payment Sheet (PR #14), #10 bookings list (PR #21), #11 cancel-booking Edge Function (PR #18), #12 cancellation flow + policy UI (PR #23). **Milestone 2 complete.** 12/35 commits complete.
- **2026-05-09** — M3 #13 admin Next.js scaffold (PR #24). 13/35.
- **2026-05-11** — M3 #14 admin auth + role gate (PR #25). 14/35.
- **2026-05-12** — M3 #15 bookings list + filtering (PR #26), M3 #16 admin-refund Edge Function (PR #27). 16/35.
- **2026-05-14** — M3 #17 refund booking UI (PR #28). 17/35.
- **2026-05-15** — M3 #18 admin-toggle-pitch Edge Function + UI (PR #31, S→M), M3 #19 v_gmv_daily view + dashboard (PR #32). **Milestone 3 complete.** **19/35 commits complete.**
- **2026-05-27** — Status retrofit + aristophanes-method doc set landed alongside changelog refresh. M4 begins this week with #20 (Apple+Google+magic-link auth, L) per [docs/plans/2026-05.md](plans/2026-05.md). Realistic May EOM target 27/35.
- **2026-05-27** — M4 #20 auth fan-out merged (PR #34) and doc-retrofit merged (PR #33). 20/35.
- **2026-05-27** — M4 #21 profile edit screen (PR #TBD). May stretch goal landed two days early — name + locale + city + positions + skill + preferred foot all editable; locale toggle re-renders without restart. **21/35.**
- **2026-05-30** — Status reconciliation: ledger had drifted behind `main`. M4 #22 GDPR consent modal and #25 sqlfluff CI were already ✅ in-table (now reflected in count); **#27 SECURITY.md** (PR #41, `7a0d258`) and **#26 Dependabot** (PR #42, `95095bf`) landed on main but were still marked ⬜ — now ticked. **Main is at 25/35**, not 23. #23 Sentry is code-complete on `feat/m4-23-sentry` (not yet merged). The remaining genuine M4 work is **#24 PostHog** (the only un-built item of the planned "M4 hardening" trio) + #28 privacy/terms (DPA-blocked).
- **2026-05-30** — Planned M4 #24 PostHog via [ADR-0011](adr/0011-posthog-product-analytics.md): consent-gated, mobile-only, EU cloud, autocapture-off. Reconciled the infra.md ↔ ledger event-taxonomy drift — canonical seven events now agree across [infra.md](infra.md), this ledger, and ADR-0011. Code deferred (sleep-on-it before build).
- **2026-06-09** — Shipped the Stripe Connect onboarding chain. **#24 PostHog** (PR #64, `5163a88`) verified on-device; **#29 venue-connect-onboard** (PR #65, `c48a952`) + **#30 admin onboarding UI** (PR #68, `3cd1609`) landed and verified live on the local stack: admin → `/venues` → "Onboard with Stripe" created a real Stripe **test** Express account, minted + persisted the hosted link, and `stripe listen` → `stripe-webhook` → `account.updated` drove `venues.stripe_account_status`. **29/35.** Two follow-ups parked: (1) ⚠️ Connect **platform-profile funds-flow** reads "sellers collect directly" but the code does **destination charges** — reconcile before live (see Founder non-code blockers; also gates the #30 first-paying-booking "exit"). (2) Live *booking* demo couldn't complete in-environment — the Claude app sandboxes external links, and auto-filling KYC via the Stripe API is (correctly) safety-blocked; resumable by completing the test account's KYC in a standalone browser. Neither is a code gap.
- **2026-06-12** — **#31 anonymize-me** (PR #70, `9951292`) landed and verified end-to-end on the local stack. Shipped as **anonymise-and-keep** ([ADR-0018](adr/0018-account-erasure-anonymize-and-keep.md)) after a spike found GoTrue soft-delete scrubs phone/email + keeps the row (avoiding the `users → auth.users` CASCADE that a hard delete would trip against the child-FK RESTRICTs); corrected the contradicting [api-contract.md §1.5](api-contract.md). **30/35.** Next: **#32 delete-account mobile flow** planned in [docs/plans/delete-account.md](plans/delete-account.md) — the user-facing half + an Apple 5.1.1(v) ship-gate.
- **2026-06-12** — **#32 delete-account mobile flow** (PR #72, `0789b43`) landed and **verified on-device** (iPhone 16 Pro, Release build): Profile → Delete account → confirm → `anonymize-me` → signed out → re-login blocked. en/gr copy; followed the cut list (simple destructive confirm, no typed-DELETE). Closes the GDPR erasure feature end-to-end (#31 substrate + #32 flow) and the Apple 5.1.1(v) ship-gate. **31/35.** Three follow-ups parked as background tasks: CI `deno check` coverage (2 functions), `cancellation.ts` error-code mapping, and the SecureStore >2048-byte session-persistence warning.
