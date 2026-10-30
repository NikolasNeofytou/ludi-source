# Ludi · Threat Model

_Phase 7. STRIDE-lite on the assets that matter: payments, PII, auth, authorization. Not paranoid; just honest about where an actual attacker or a buggy line of code could cause real damage._

## Assets and blast radius

| Asset | What it is | If compromised |
|---|---|---|
| **Payments** | Stripe customer tokens, PaymentIntents, refund flows | Real money loss, chargebacks, Stripe account restriction |
| **PII** | user names, phone numbers, emails, booking history | GDPR fine up to 4% of global revenue, reputation, legal |
| **Auth tokens** | Supabase access + refresh tokens in `expo-secure-store` | Account takeover, fraud via victim's cards |
| **Pitch owner payouts** | `venues.stripe_account_id`, booking splits | Diverted payouts, owner fraud |
| **Admin role** | `users.role = 'admin'` | Full DB access via RLS bypass, refund issuing |
| **Service role key** | The DB superkey, lives in Edge Function env | Catastrophic: read/write any table |
| **RLS policies** | The client authorization layer | Data leak, unauthorized bookings |
| **SECURITY DEFINER functions** | RPCs that run as the table owner, reachable at `/rest/v1/rpc/*` | Anything RLS protects, if the function trusts its caller or is executable by PUBLIC |
| **WhatsApp desk** | Meta Cloud API number per venue, `WHATSAPP_TOKEN` / `WHATSAPP_APP_SECRET` | Messages sent as the venue, inbox read |
| **Email + push senders** | Resend key, Expo push (`EXPO_ACCESS_TOKEN`), APNs | Phishing or spam from Ludi's own senders |
| **Wallet pass signing** | `APPLE_PASS_CERT_PEM` / `APPLE_PASS_KEY_PEM` | Forged member passes |
| **Court camera recordings** | Private `recordings` bucket, per-camera tokens | Footage of identifiable people |
| **Backups** | Weekly encrypted `pg_dump` (public + auth) in the private `ludi-backups` repo | Every user's PII, if the artifact or `BACKUP_PASSPHRASE` leaks |

## Threat actors we care about

1. **Competent random attackers** — scraping, credential stuffing, API poking. Well-documented techniques.
2. **Insiders with weak op-sec** — me, leaving a service key in a public gist by accident. The most likely source of a real incident.
3. **Fraudulent users** — fake account, stolen card, no-show booking, chargeback claim.
4. **Fraudulent pitch owners** — onboard a venue that doesn't exist, collect payouts, disappear.
5. **Nation-state / highly targeted** — **out of scope.** If MI6 is after us, we have bigger problems and a different threat model.

## STRIDE per flow

### Flow: Create booking (the money path)

| Threat | Risk | Mitigation (shipped ✅ / planned 🟡 / accepted ⚪) |
|---|---|---|
| **S**poofing — user claims to be another user | Booking charged to wrong card | ✅ Supabase Auth owns identity; Edge Function uses `auth.uid()` from the session |
| **T**ampering — client inflates discount or zeroes out fee | Lost revenue per booking | ✅ All pricing computed server-side in `create-booking` Edge Function. Client never sends amounts — only `pitch_id`, `starts_at`, `ends_at`, add-on codes. `platform_fee_cents` derived from venue take rate. |
| **R**epudiation — user claims "I didn't book that" | Chargeback, dispute | ✅ Stripe is merchant-of-record for card side; the PaymentIntent flow records IP, device, 3DS step. Booking row has `user_id`, `created_at`, and `payments.stripe_payment_intent_id` for paper trail. |
| **I**nformation disclosure — leaking other users' bookings | PII + GDPR | ✅ RLS `bookings_select_self_or_owner_or_admin`. Enabled BEFORE any policies exist so accidental policy drop defaults to deny. |
| **D**enial of service — booking spam, slot hoarding | Legitimate users can't book | 🟡 Rate-limit `create-booking` to 5/min/user. Auto-expire `pending` bookings after 15 min (a cron job) so abandoned PaymentIntents free the slot. |
| **E**levation of privilege — user promotes self to admin | Full DB access | ✅ `tg_users_block_role_change` trigger blocks non-admin role changes. Admin promotion requires service role. |

**Additional invariants enforced at DB level** (defense in depth):
- `EXCLUDE USING gist (pitch_id, time_range)` — prevents double-booking even if Edge Function has a bug
- `CHECK (total_cents > 0)` — prevents zero/negative bookings
- `CHECK (platform_fee_cents >= 0)` — prevents negative fees

### Flow: Stripe webhook

| Threat | Risk | Mitigation |
|---|---|---|
| **S**poofing — attacker POSTs a fake `payment_intent.succeeded` | Free bookings | ✅ Signature verification over the raw body with `STRIPE_WEBHOOK_SECRET` (platform) and `STRIPE_CONNECT_WEBHOOK_SECRET` (Connect) via `constructEventAsync`; fails closed. Since 2026-10-20 (#336) a single-payer booking is confirmed only when our `payments` row exists, names the same booking and matches the PI's amount and currency, and connected-account events are ignored. |
| **T**ampering — replay a real event | Duplicate state changes | ✅ Idempotent handler keyed by `event.id` — if we've already processed that ID, return 200 without state change. Use a `webhook_events` table (add in Stage 2) to record processed IDs. |
| **I**nformation disclosure — logs leak PaymentIntent details | PCI scope creep | ✅ Structured logs carry request_id only; never log full payloads. |
| **D**enial of service — flood of events | Function over-invocation | ⚪ Accept: Stripe caps outbound; Supabase Functions have rate protection. Revisit if incidents occur. |

### Flow: Auth (phone OTP in particular)

| Threat | Risk | Mitigation |
|---|---|---|
| **S**IM swap / number reuse | Victim's account taken over | 🟡 Re-challenge on new device (Supabase session rotation already does this). Add a "you were signed in on a new device" email notification (Stage 3). |
| **Phone OTP toll fraud** | Attacker sends OTPs to premium numbers, Ludi pays SMS costs | ✅ Supabase has a per-phone rate limit. 🟡 Set a project-level SMS cap in dashboard. Monitor Twilio bill alerts. |
| **Credential stuffing on email magic link** | Mass signup attempts | 🟡 CAPTCHA on email-link path (hCaptcha via Supabase). Implement when first attack is observed, not pre-emptively. |
| **Token theft from device** | Full session hijack | ✅ Tokens in `expo-secure-store` (Keychain/Keystore). Device lock screen required for access. 🟡 Add device fingerprint to session, re-auth if mismatched (Stage 3). |
| **Apple/Google OAuth code interception** | Account hijack | ✅ Native flows use PKCE. No fallback to implicit flow. |
| **Session swap via a crafted sign-in link** — a link carrying someone else's session or `token_hash` | Victim's phone silently signed into the attacker's account | 🟡 Fixed in code (#341, 2026-10-20): a link only completes a sign-in this phone started (SecureStore nonce, 15 min), never replaces an existing session, never accepts raw tokens; magic links go to a universal link with PKCE. **Live once the next store build ships** — builds ≤ 1.0.0 (41) still accept any `ludi://callback` session. |

### Flow: Authorization (RLS)

| Threat | Risk | Mitigation |
|---|---|---|
| **RLS bypass via privileged role** | Any user reads all bookings | ✅ Anon key has `authenticator` role, not `service_role`. Service role never shipped to client. Verified in `EXPO_PUBLIC_*` convention. |
| **Broken policy** — `USING (true)` ship | Data leak | 🟡 `pgtap` test suite asserting specific RLS behavior (Stage 2). Test cases: "user A cannot see user B's booking", "anon cannot read `users`", "non-admin cannot update own `role`". |
| **Policy drift** — migration removes a policy accidentally | Security regression | 🟡 CI job: dump policy list post-migration and diff against a committed snapshot. Alert on deletion. |
| **Recursive policy via function** — `is_admin()` loops | DB runaway | ✅ Fixed — `is_admin()` was `SECURITY INVOKER` reading `public.users`, whose SELECT policy calls it back; unbounded recursion killed the admin bookings list. Now `SECURITY DEFINER` (M6 #36, migration `20260810000001`) with a structural pgtap assert. The original "no recursion possible" claim here was wrong. |
| **Column-level escalation by a venue owner** — RLS is row-level, so an owner permitted to UPDATE their own venue row could set *any* column on it | Owner zeroes `take_rate_bps`; or sets `stripe_account_status='active'` to make pitches bookable without a payout account; or self-sets `pitches.is_verified` | ✅ Fixed — verified exploitable on 2026-08-22 (all three returned "1 row updated"). Guarded by `tg_venues_block_privileged_columns` / `tg_pitches_block_privileged_columns` (migration `20260822000003`), the same trigger pattern as `tg_users_block_role_change`. Exposure had been nil since 2026-04-21 because no venue owner had credentials; **M6 #41d/ADR-0019 is what makes it reachable.** Regression test: `tests/owner_column_privileges.sql`. |

### Flow: Pitch-owner payouts

| Threat | Risk | Mitigation |
|---|---|---|
| **Fake venue onboarding** — I onboard a venue I don't own | Payouts diverted | ✅ In MVP, onboarding is manual — founder physically meets each owner. Not scalable but not wrong. When self-serve (Stage 4), add: proof of venue ownership (utility bill, lease), small hold on first payout. |
| **Payout redirection after onboarding** — owner changes bank details maliciously | Funds to attacker | ✅ Stripe Connect handles bank changes — re-verification required. Stripe notifies us via webhook (`account.updated`). |
| **No-show collusion** — owner and fake user split a booking then "no show" for chargeback | Double-payout fraud | 🟡 Velocity checks: flag > 5 bookings by same user at same venue within 7 days. Stripe Radar handles classic card fraud. |
| **Chargeback liability** — card disputed after payout | Platform eats the loss | 🟡 Rolling reserve per owner via Stripe Connect (hold last 7 days of payouts) — configure via Stripe Dashboard when onboarding first real partner. |

### Flow: Admin actions

| Threat | Risk | Mitigation |
|---|---|---|
| **Admin account compromise** | Full access, arbitrary refunds, data deletion | 🟡 Enforce 2FA on the founder's Supabase account. Rotate admin `users.id` if compromise suspected. No "admin team" for MVP — just one admin (me). |
| **Missing audit trail** | Forensic dead-end | ✅ `admin_actions` table enforced append-only. Every admin write through Edge Function includes mandatory audit row. |
| **Admin console exposure** | Anyone with the URL can try | ✅ The dashboard is public at `ludi-admin.vercel.app` (no Cloudflare Access): every page and server action re-checks the session with `getUser()` and the caller's venue role, and RLS / definer-function checks repeat it in the database. The service-role key is never in the web apps. Clickjacking blocked (`X-Frame-Options: DENY`, `frame-ancestors 'none'`); a nonce-based script CSP since the 2026-10-21 hardening. Sign-in shows the same message whether or not an account exists. |

## PII & GDPR

**What we collect:**
- Name (first, last), phone number or email, city, optional handle, skill level, positions, preferred foot
- Booking history (timestamps, pitches, totals)
- Payment references (Stripe customer + PaymentIntent IDs — no raw PAN, ever)
- IP address (in Supabase + Stripe logs, for fraud analysis)

**Legal bases:**
- Contract performance (bookings, payments) → necessary
- Consent (marketing emails, push notifications) → explicit opt-in, auditable via `auth.users.raw_user_meta_data`

**Subject rights and how we fulfill them:**
- **Access** — user can view their profile + bookings in-app; full JSON export on request via support ticket (Edge Function `export-me` in Stage 3)
- **Rectification** — user edits their profile in-app
- **Erasure** — `anonymize-me` Edge Function nulls PII, retains financial rows 7 years (Cyprus tax law)
- **Portability** — export same JSON as "access"
- **Restriction / objection** — manual handling via support in MVP

**Data retention:**
- `users` with `anonymized_at IS NULL` — until user requests deletion or 3 years of inactivity
- `bookings`, `payments`, `admin_actions` — 7 years (Cyprus tax + Stripe dispute window)
- Stripe data — indefinite (Stripe's retention)
- PostHog analytics — 1 year

**Data processing agreement (DPA):**
- Supabase — signed by default with their Pro tier (EU DPA)
- Stripe — signed with their standard agreement
- Sentry — signed via their online DPA
- PostHog EU — signed with their standard agreement
- Resend — signed

All processors are in the EU or have SCCs (Standard Contractual Clauses).

## Security hygiene baseline

- ✅ TypeScript strict + Zod validation at every boundary (ADR-0006)
- ✅ No secrets in repo (`.gitignore` + `.env.example`)
- ✅ **Secret scanning: GitGuardian**, installed as a GitHub App (no workflow, no in-repo config — findings and their resolution live only at `dashboard.gitguardian.com`). Guards the asymmetric case: `STRIPE_SECRET_KEY`, the Supabase **service-role** key, and — once provisioned — Twilio. A key committed to history is permanent; it survives deletion, and this repo being private only means exposure needs repo access, not that it is safe.

  **It is detection, not prevention.** By the time a check fails, the secret is already on GitHub's servers and must be rotated regardless. The pre-commit hook below is the control that actually prevents the incident — GitGuardian is the net under it.

  Recorded here 2026-08-22 because it was an **undocumented** control: installed, load-bearing, and mentioned in neither this file nor `SECURITY.md`. It had four findings in a day — all the same false positive on `PGPASSWORD: postgres` in `.github/workflows/ci.yml` — and came close to being uninstalled out of irritation. Measured record over the preceding 25 PRs: 21 pass, 4 fail, **0 true positives**, which is what a smoke alarm that has not gone off looks like, not a broken one.

  The noise itself was treated as the bug: that variable is now declared once at the `migrations` job level instead of ten times per step, so a future PR adding a database step introduces no credential-shaped line and nothing to dismiss. That matters more than the tidiness — four identical false alarms in a day is precisely how "resolve without reading" becomes a habit, and a scanner nobody reads is worse than none.
- 🟡 `pnpm audit` is **not** in CI yet (this line used to claim it was). Run `pnpm audit --prod` by hand before a release; most open advisories are Expo / Metro dev tooling that never ships in the app bundle.
- ✅ Dependabot version updates (`.github/dependabot.yml`: npm workspace + GitHub Actions, grouped). Expo-managed packages are ignored there and move with `expo install`, so one SDK-incompatible bump can't stall the digest again. Dependabot **alerts and security updates** are repository settings: on for the public source copy (free there), and for this private repo where the plan allows.
- 🟡 GitHub secret scanning + push protection — free on public repositories, so on for the public source copy; this working repo stays private, where GitGuardian remains the net. Push protection blocks a recognised key before it lands, which is the prevention half the GitGuardian entry asks for.
- 🟡 Pre-commit hook blocking committed `.env`-like files (add `lint-staged` config). **Still open, and the more valuable half** — see the GitGuardian entry above: a pre-commit block prevents the leak, whereas a CI finding only tells you to rotate.
- ✅ Security audit before first paid user — done 2026-10-19, before the public launch (see the changelog below). Repeat before the money flip and after any new definer function, Edge Function or public route.
- ✅ Responsible-disclosure policy: public [`SECURITY.md`](../SECURITY.md) + monitored reporting inbox, per [ADR-0009](adr/0009-responsible-disclosure-policy.md). Reports go to GitHub private vulnerability reporting or `security@ludi.football`.

## Incident response (lightweight for solo dev)

**If a suspected breach is detected:**

1. **Contain** — rotate whatever could be exposed, then redeploy. The full set, by where it lives:
   - **Supabase function secrets:** `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `RESEND_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `EXPO_ACCESS_TOKEN`, `APPLE_PASS_CERT_PEM` / `APPLE_PASS_KEY_PEM`, `APPLE_SIWA_PRIVATE_KEY`, and the cron secrets `EXPIRE_COLLECTING_SECRET`, `NOTIFY_PLAYERS_SECRET`, `RECORDINGS_SWEEP_SECRET` (each paired with a Vault secret the pg_cron jobs read — rotate both together). Camera tokens rotate per camera.
   - **Database password:** Dashboard → Database → reset; then update `SUPABASE_PROD_DB_URL` in the private `ludi-backups` repo.
   - **GitHub:** the `supabase-production` environment secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROD_DB_PASSWORD`, `SUPABASE_PROD_PROJECT_REF`); `ludi-backups`' `BACKUP_PASSPHRASE` (re-encrypts future dumps only).
   - **Sessions:** invalidate refresh tokens in the Supabase dashboard.
2. **Assess** — check Supabase logs, Sentry, Stripe Dashboard for suspicious activity. Snapshot relevant data to an incident folder.
3. **Notify** — if PII is confirmed leaked, legal obligation to notify affected users within 72 hours (GDPR Article 33/34). Template email in `docs/runbooks/breach-notice.md` (to be written when needed, never before).
4. **Recover** — Supabase Pro keeps a daily backup for 7 days (no point-in-time recovery: that add-on is off), and the weekly encrypted dump in the private `ludi-backups` repo is the copy that lives outside Supabase ([infra.md §Backups](infra.md), [restore runbook](runbooks/restore-from-backup.md)). Coordinate with Stripe on any affected transactions.
5. **Post-mortem** — blameless write-up in `docs/incidents/YYYY-MM-DD.md`. Every incident gets one; no exceptions.

## What's explicitly out of scope

- **Formal penetration test** — not until ~500 users or first paying owner. Too expensive for no discovered vulnerability likelihood justification.
- **SOC 2 / ISO 27001** — not needed. Cyprus is not a regulated sector like healthcare or finance where customers demand these. Revisit if selling to enterprise or gov.
- **DDoS protection beyond Supabase's defaults** — Supabase runs behind Cloudflare; solo consumer app; fine.
- **HSM-backed key management** — service role key in Supabase dashboard is fine for our scale. Revisit at ~€100K/mo revenue.
- **Bug bounty** — adds triage load we can't staff. Defer to post-Series A.

## Open accepted risks

- **Solo admin + single founder** — if I'm incapacitated, Ludi is down. Acceptable risk for a side project; real company problem later.
- **No hot failover** — Supabase goes down → Ludi goes down. 99.9% SLA on Pro tier is OK for MVP.
- **Manual cancellation fraud investigation** — users will try patterns. Acceptable until volume justifies rules automation.
- **iOS/Android OS-level compromise** — out of Ludi's hands. Trust the platform.

## Changelog

- **2026-10-21** — **Pre-public audit (2026-10-19) closed out.** A five-way
  review (secrets + history, database, Edge Functions, web apps, mobile +
  dependencies) before the App Store launch and the public repo. History was
  clean: no secret in any commit on any ref. Classes found and fixed, so they
  stay fixed:
  - *Definer functions open to PUBLIC.* `REVOKE … FROM anon` leaves Postgres'
    default PUBLIC grant in place, and the RLS test bootstrap's blanket
    `GRANT` hid it. Fixed in #335; `tests/rls/59_function_acl.sql` now pins
    the allowlist of anon-executable definer functions, and #339 runs the
    suite on prod's real grants.
  - *An INVOKER helper inside a DEFINER body.* `is_privileged_writer()` reads
    `current_user`, which is the owner inside a definer function, so as a
    gate it always passed. Gates now read `session_user` / the JWT role.
  - *Status changes by direct PATCH* that skipped the RPC's checks
    (rejoining a game). The trigger now routes them through the RPC.
  - *Edge-function logic:* cancel after kickoff, booking outside opening
    hours and unlimited unpaid holds, an owner attaching an account without
    its consent, webhook amounts, raw provider errors, non-constant-time
    secret compares, a refund-before-lock race (#336).
  - *Sign-in links* that completed any session (#341, live with the next
    build).
  - *Repo-public hazards:* backups uploaded as Actions artifacts (moved to a
    private repo), a `workflow_run` deploy a fork could trigger, no approval
    gate on the prod deploy (#330).
  - *Hardening:* admin CSP, neutral sign-in errors, Sentry URL scrubbing,
    TV-board name sanitising, fuller `anonymize-me`, ignore rules.
  Still open: PostGIS's `spatial_ref_sys` sits in `public` without RLS
  (Supabase-owned; needs Supabase support or moving PostGIS out of `public`).

- **2026-08-22** — Added **column-level escalation by a venue owner** to the
  RLS flow, found while planning M6 #41e and confirmed exploitable against
  the local stack. RLS is row-level; the owner UPDATE policies shipped
  2026-04-21 could not restrict *which columns* an owner wrote, so an owner
  could set their own commission to zero, declare themselves Stripe-active,
  or verify their own pitch. Closed by two BEFORE UPDATE triggers plus an
  INSERT guard. Also corrected the `is_admin()` recursion row, which claimed
  "no recursion possible" — it recursed in production and took the admin
  bookings list down until M6 #36.
- **2026-08-22** — Recorded **GitGuardian** in the hygiene baseline. It was an
  undocumented control: installed as a GitHub App, load-bearing, and named in
  neither this file nor `SECURITY.md`. Also noted the distinction that makes
  the still-open pre-commit hook the more valuable half — secret scanning in
  CI is detection, and by the time it fires the key needs rotating anyway.
- **2026-04-21** — Phase 7. Initial threat model. Planned mitigations (🟡) are Stage 2 tasks; accepted risks (⚪) revisited quarterly.
