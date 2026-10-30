# Ludi · Infrastructure

_Phase 6. Environments, CI/CD, secrets, backups, monitoring. What it takes to run Ludi reliably without a DevOps team._

## Principle

Solo dev on a 3-month horizon. Every infrastructure choice optimizes for **time-to-diagnose-a-prod-problem**, not for scale we don't have. Paid services are preferred over self-hosting where the monthly cost is <€30.

## Environments

Three environments, promotable in one direction (local → staging → production).

### Local

- **DB/Auth/Storage:** Supabase CLI (`supabase start`), runs Postgres 15 + Auth + Storage + Studio in Docker. Fully matches production schema via the migrations in `packages/supabase/supabase/migrations/`.
- **Mobile app:** `pnpm mobile dev` launches Expo dev server. iOS Simulator + Android emulator + physical devices via Expo Go or EAS dev client.
- **Stripe:** Stripe test mode. Test API keys + test webhook endpoints. Never touches real money.
- **Cost:** €0.

### Staging

- **Supabase project:** `ludi-staging` in eu-central-1 (Frankfurt) — planned, never provisioned (see the 2026-08-29 changelog entry); no `ludi-staging` exists on the account as of 2026-10-22. Separate project, separate database, separate Stripe Connect platform account in test mode.
- **Mobile app:** EAS preview builds — one APK + one IPA per PR merged to `main`. Internal TestFlight + Play Console internal track. Points at `ludi-staging`.
- **Data:** never seeded from production. Use the staging seed + a handful of hand-onboarded test venues.
- **Cost:** Supabase free tier (staging rarely exceeds it) + Expo free tier for preview builds.

### Production

- **Supabase project:** `ludi-prod`, ref `kotigxeeigjytdtwklyu`, in eu-central-1 (Frankfurt), alone in the Supabase org **Ludi**. Postgres 17.6.1.155, GoTrue v2.195.0.
- **Supabase tier (read in the dashboard 2026-10-22):** org Ludi was on the **Free** plan until 2026-10-22, with Nano compute (shared CPU, 0.5 GB RAM, memory at 66%), **no daily backups** ("Free Plan does not include project backups"), no PITR, 1-day logs, and a project that pauses after a week of inactivity. It was **upgraded to Pro the same day**: $25/month, spend cap on, so usage beyond the included quota is refused, not billed. Pro brings daily backups kept 7 days, 7-day logs and no pausing. **PITR is not on**: it is a Pro add-on from $100/month. Compute is still Nano; on Pro, Micro (1 GB) costs the same hourly rate, but the switch restarts the database.
- **Mobile app:** EAS production builds pushed to App Store + Google Play via EAS Submit. OTA updates via `expo-updates` (enabled in Stage 3 — not MVP).
- **Stripe:** live mode. Real Stripe Connect platform account. Requires Cyprus business entity (sole trader at first, LLC when revenue justifies).
- **Cost:** Supabase Pro ($25/mo, org Ludi, since 2026-10-22), Expo paid plan when needed (€29/mo, defer until needed), domain (~€10/yr).

## Secrets management

### Categories

| Secret | Lives where | Scope |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `.env` + EAS secrets | embedded in app bundle; safe |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `.env` + EAS secrets | embedded in app bundle; safe (anon key limited by RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function env only, NEVER client | bypasses RLS; full DB access |
| `STRIPE_SECRET_KEY` | Edge Function env only | Stripe API access |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | Edge Function env only | webhook signature verification |
| `SENTRY_DSN` (mobile) | `.env` + EAS secrets | public, OK in client |
| `SENTRY_AUTH_TOKEN` | CI only | source map uploads |
| `POSTHOG_API_KEY` (mobile) | `.env` + EAS secrets | public |
| `RESEND_API_KEY` | Edge Function env only | transactional email |

### Rules

- **Never commit secrets.** `.env` is gitignored; `.env.example` stays in repo with empty values and documentation.
- **Mobile public keys** (those prefixed `EXPO_PUBLIC_`) are embedded in the app bundle and therefore public — anyone can extract them. Safety comes from RLS, not from hiding the anon key.
- **Edge Function secrets** live only in Supabase project settings. Managed via `supabase secrets set NAME=value --project-ref <ref>`.
- **Rotate on compromise** — document rotation steps in `docs/runbooks/rotate-secrets.md` when we write it.

## Database migrations

Every migration is a plain SQL file in `packages/supabase/supabase/migrations/`, timestamp-prefixed. Applied in lexicographic order.

- **Local:** `supabase db reset` wipes + re-applies all migrations + seeds.
- **Staging / Prod:** `supabase db push` applies new migrations to the linked project. Run from CI on merge to `main`, never manually on prod.
- **Never edit an applied migration.** To fix a mistake, write a new forward migration.
- **Review non-trivial migrations locally against a realistic data snapshot** before applying to prod.

## CI/CD

GitHub Actions is the default (ADR-0001 monorepo ships there). Three workflows for MVP:

### `ci.yml` — on every PR and push to main

Jobs (in parallel where possible):
1. **Install** — `pnpm install --frozen-lockfile`
2. **Lint** — `pnpm turbo lint`
3. **Typecheck** — `pnpm turbo typecheck`
4. **SQL lint** — `sqlfluff` against migrations (rules: require semicolons, no trailing whitespace, uppercase keywords)
5. **Migration dry-run** — every migration, the seed and the pgtap suites applied to a service container running prod's image (`supabase/postgres`, tag in the `postgres-image` job). That job copies the image into GHCR (`ghcr.io/nikolasneofytou/supabase-postgres`) the first time a tag appears, so the dry-run never pulls from ECR Public, whose anonymous per-IP limit fails on GitHub's shared runners

Fail fast. No deploy.

### `deploy-staging.yml` — on merge to `main`

1. Run `ci.yml` to green
2. Apply migrations to staging Supabase project via `supabase db push`
3. Deploy Edge Functions via `supabase functions deploy --project-ref <staging>`
4. Trigger EAS preview build for mobile (`eas build --profile preview --non-interactive`)
5. Post Slack/Discord notification with build link + migration diff

### `deploy-production.yml` — manual trigger or on release tag

Same steps as staging but targeting `ludi-prod` and `eas build --profile production`.

**No auto-deploy to production.** Every prod release is a human decision.

## Domain and hosting (`ludi.football`)

**Status 2026-08-18: the site is live and publicly reachable at**
`https://ludi-alpha.vercel.app` **— but not at its own domain.** One
thing is outstanding: DNS. It is account-side; no code involved.

### The one blocker: DNS still points at Squarespace

The domain was registered 2026-08-12 and never connected to Vercel:

| Record | Value |
|---|---|
| Nameservers | `nsc1–4.squarespacedns.com` |
| `ludi.football` A | `198.185.159.144/145`, `198.49.23.144/145` (Squarespace) |
| `www` CNAME | `ext-sq.squarespace.com` |

So `ludi.football` serves a Squarespace **"Coming Soon"** parking page.

**Fix:** add `ludi.football` (and `www`) as domains on the Vercel `ludi`
project, then either enter the records Vercel displays into Squarespace's
DNS panel, or delegate the nameservers to Vercel. Use whatever Vercel
shows at the time — do not paste an IP from memory or from this document.

### Deployment Protection — correct as configured, do not change it

**An earlier version of this section was wrong and said the opposite.**
It claimed the site was reachable by nobody and that no `*.vercel.app`
URL could be shared. Both false. Recording the mistake because the
reasoning behind it is easy to repeat.

Vercel's Standard Protection covers **per-deployment** URLs and
**exempts production domains**. Those are two different classes of URL
and they behave differently:

| URL | Access | Why |
|---|---|---|
| `ludi-<hash>-<team>.vercel.app` | `302` → `vercel.com/sso-api` | Per-deployment. Protected, and correctly so |
| **`ludi-alpha.vercel.app`** | **`200`, public** | Production alias — exempt from Standard Protection |
| `ludi.football` | `200`, but Squarespace's parking page | DNS never pointed here — see above |

Verified 2026-08-18 by `curl` on `/`, `/keepers`, `/privacy`, `/terms`
and `/.well-known/health`: all `200` unauthenticated on the production
alias.

**How the error happened:** the only URL tested was a per-deployment one,
taken from a GitHub deployment status. It `302`d, and the conclusion was
generalised to every `*.vercel.app` address. The production alias was
never tried. **A `302` on one Vercel URL says nothing about another** —
check the alias specifically, and check it with `curl` rather than a
browser, since a signed-in browser passes SSO silently and makes a
protected URL look public.

**Do not turn Deployment Protection off.** It is doing its job: preview
and per-deployment builds stay private, production is public. There is no
change to make here.

So the practical position today:

- **`https://ludi-alpha.vercel.app/keepers` is public and shareable now.**
  The goalkeeper trial has a working link and does not need to wait for
  DNS (`docs/plans/goalkeeper-trial.md` §Phasing).
- UptimeRobot **can** watch `https://ludi-alpha.vercel.app/.well-known/health`
  today. It cannot watch it at `ludi.football` until DNS moves.
- Apple review **can** reach a privacy URL on the alias, though
  `ludi.football/privacy` is the one worth submitting.

The caveat that keeps the domain worth doing: the alias is derived from
the project name, so renaming the Vercel project breaks every link
already circulating — and `ludi.football/keepers` is a great deal better
to say out loud in a football group.

### The Vercel project

Linked from `apps/site/.vercel/project.json` (project name `ludi`).
Production deploys automatically on push to `main` via Vercel's own git
integration — not via a workflow in `.github/`, so it is not visible in
`ci.yml`.

Two production URLs, and the difference matters when handing one to
someone: the **per-deployment** URL changes on every push and is
SSO-protected, while **`ludi-alpha.vercel.app`** is a stable public alias
that always points at the latest production build. Share the alias, never
a per-deployment URL.

**This contradicts §`deploy-production.yml` above**, which states that
production is never auto-deployed and every prod release is a human
decision. That principle was written for the Supabase/EAS side and the
site quietly does the opposite: merging to `main` publishes it. Worth a
deliberate decision rather than leaving the two statements sitting next
to each other — either the site is an accepted exception (it holds no
money and no personal data, so it plausibly is), or its production
deploys move behind a manual promote.

## Backups

Database:
- **Supabase daily backups** — Pro keeps one physical backup a day for 7 days (Dashboard → Database → Backups; `supabase backups list --project-ref kotigxeeigjytdtwklyu`), restorable in place or into a new project. On only since the Pro upgrade of 2026-10-22: until then prod was on Free and had **no** Supabase backups at all, and the weekly dump below was the only copy. These are daily snapshots, not point-in-time recovery; PITR is a separate add-on (from $100/month) and is off.
- **Weekly `pg_dump`** — `backups.yml` in the private repo [NikolasNeofytou/ludi-backups](https://github.com/NikolasNeofytou/ludi-backups), every Sunday 03:00 UTC and on demand. Custom-format dump of `public` + `auth`, AES-256 encrypted with `BACKUP_PASSPHRASE`, stored as a 90-day GitHub Actions artifact on that repo (a different system from the database, which is the requirement; S3 is a one-line change if artifacts ever feel thin). Each run's job summary carries a manifest of row counts. It ran in this repo until 2026-10-20; it moved because this repo is going public and anyone can download a public repo's artifacts. The job refuses to run unless its repo is private.
- **Monthly restore rehearsal** — `scripts/restore_backup_local.sh <artifact>` into a throwaway local Postgres, counts diffed against the manifest. **Real restore** — `scripts/restore_backup_supabase.sh <new project> latest` into a new Supabase project, every table diffed against the dump; rehearsed 2026-10-22 (72 s, all 70 tables matched). Both, and the "re-point everything at the new ref" checklist: [`docs/runbooks/restore-from-backup.md`](runbooks/restore-from-backup.md).

Files (Supabase Storage):
- Hero images + future user-uploaded photos. Supabase Storage does not auto-backup in Pro tier. Add a nightly `aws s3 sync` from the Supabase bucket to an S3 bucket as a defense against accidental deletion. Deferred until we have >100 pitch images.

Stripe:
- Stripe retains transaction data indefinitely. No backup needed on our side. Export CSVs of monthly activity for accounting records (manual via Stripe Dashboard, quarterly).

## Monitoring

### Error tracking — Sentry

Three surfaces, three projects under one org (`ludi-mobile`, `ludi-edge`,
`ludi-admin`), each tagged by `environment`. See [ADR-0010](adr/0010-sentry-error-tracking.md)
for the full rationale (SDK choices, legitimate-interest posture, source-level
PII scrubbing).

- **Mobile:** `@sentry/react-native` (with the Expo config plugin) for crash
  reporting. Source maps uploaded on every EAS build via `SENTRY_AUTH_TOKEN`
  in CI. (`sentry-expo` is deprecated; it folded into `@sentry/react-native`.)
- **Edge Functions:** `@sentry/deno` via a shared `withSentry()` handler wrapper.
- **Admin:** `@sentry/nextjs` (client + server + edge runtimes), source maps on `next build`.
- **PII:** never reaches Sentry — a shared `scrub()` runs in every `beforeSend`/
  `beforeBreadcrumb`, `sendDefaultPii` is off, and only the opaque user id is tagged.
- **DSN-guarded:** absent DSN → Sentry no-ops, so local dev and CI need no DSN.
- **Alert rules:** any new error in last hour with >10 events → email; any error with `level: fatal` → immediate email.

### Uptime — UptimeRobot (free)

Monitors every 5 minutes:
- `https://<project>.supabase.co/rest/v1/cities?select=id&limit=1` (public RLS, minimal query)
- Mobile app deep link: `https://ludi.football/.well-known/health` (route added and deployed 2026-08-18; not monitorable at *this* URL until DNS moves — it answers `200` at `https://ludi-alpha.vercel.app/.well-known/health` today, see §Domain and hosting)

Alerts go to email + SMS (paid tier if/when needed).

### Product analytics — PostHog

Events to capture (MVP minimum) — canonical taxonomy per
[ADR-0011](adr/0011-posthog-product-analytics.md). No PII in any
property; ids/enums/counts/cents only:
- `app_opened` (with `locale`, `city`)
- `auth_completed` (with `method`, `is_new_user`)
- `pitch_viewed` (with `pitch_id`, `city`, `price_cents`)
- `booking_started` (with `pitch_id`, `slot_starts_at`)
- `booking_confirmed` (with `booking_id`, `total_cents`)
- `booking_failed` (with `error_code`)
- `booking_cancelled` (with `refund_cents`, `hours_to_slot`)

PostHog's EU cloud (Frankfurt) for GDPR proximity. Free tier covers 1M
events/mo. **Consent-gated** — init is held behind the M4 #22 consent
modal and stops on revocation (unlike Sentry, which runs under
legitimate interest). Autocapture is disabled; explicit events only.

### Logs

- **Supabase logs** accessible via dashboard; 7-day retention on Pro (1 day on Free, which prod was on until 2026-10-22). Sufficient.
- **Edge Function logs** go to Supabase logs by default. Use `console.log` with structured JSON: `{ level, request_id, event, ...context }`. No PII in logs ever — if you must log a user ID, use the first 8 chars.

## Runbooks (`docs/runbooks/`)

Written so far:
- [`money-flip.md`](runbooks/money-flip.md) — Stripe test mode → live: the fiscal gate, platform activation, both webhook destinations, the venue reset, the build that is not optional
- [`restore-from-backup.md`](runbooks/restore-from-backup.md) — step-by-step restore on prod

Populate the rest as incidents happen. Template incidents:
- `stripe-webhook-outage.md` — webhook not firing, how to replay events from Stripe Dashboard
- `rotate-secrets.md` — which keys to rotate and what to deploy
- `onboard-pitch-owner.md` — the manual founder checklist (Maria's flow from J4)
- `issue-admin-refund.md` — steps inside the admin dashboard
- `respond-to-gdpr-request.md` — user requests data / deletion

Writing a runbook **after** the first incident that needed it is cheaper than writing all of them upfront.

## Costs summary (steady state, MVP)

| Service | Tier | Monthly (EUR) |
|---|---|---|
| Supabase Pro (prod, org Ludi) | Pro since 2026-10-22 | 25 ($25) |
| Supabase (staging) | Free | 0 |
| Sentry | Developer | 0 (5K events/mo free) |
| PostHog EU | Free | 0 (1M events/mo) |
| UptimeRobot | Free | 0 |
| Resend (email) | Free | 0 (3K emails/mo) |
| EAS Build | Free | 0 (30 builds/mo) |
| Domain (`ludi.football`) | — | ~1 |
| `apps/site` hosting | Vercel free tier | 0 |
| **Total fixed** | | **~26/mo** |

Plus variable:
- **Stripe fees** — 1.5% + €0.25 per EEA card transaction. At €600 GMV/mo → €9/mo; at €55K GMV/mo → €825/mo.

Revenue hits breakeven on fixed costs at ~€260/mo GMV (26 bookings/mo at €10 avg commission). Falsifiable target of 20/mo at month 3 means breakeven is on the ambitious side of schedule but realistic.

## Changelog

- **2026-10-22** — Prod's tier recorded at last (O1): org Ludi was on
  **Free**, so prod had no Supabase backups, no PITR, 1-day logs and
  could pause after a week idle; the weekly encrypted dump was the only
  copy. Upgraded to **Pro** the same day ($25/month, spend cap on):
  daily backups for 7 days and 7-day logs. PITR stays off, compute
  stays Nano for now. Region corrected to eu-central-1: this file said
  eu-west-2, which is London.
- **2026-09-06** — §Monitoring and §Backups are still plans, not
  facts: no `backups.yml`, no restore rehearsed, no UptimeRobot monitor,
  Sentry alert rules unverified, `pg_cron` never checked on prod, and
  the prod project's **tier is not recorded here** (it decides whether
  PITR exists at all). Tracked as gates O1–O11 in
  [plans/ops-readiness.md](plans/ops-readiness.md). The one thing that
  did land: `scripts/smoke_prod.sh`, the post-deploy smoke test — run it
  after every prod push.
- **2026-04-21** — Phase 6. Initial infra plan. No staging env exists yet; provisioned in week 1 of Stage 2.
- **2026-08-29** — §CI/CD partially realised: `deploy-staging.yml` and
  `deploy-production.yml` exist (M6 #40), scoped to migrations + Edge
  Functions and **gated on repo secrets that do not exist yet** — the
  staging project itself (#39) was never provisioned, and every prod
  deploy to date has been manual from a laptop. Steps 4–5 of the
  §deploy sketch (EAS preview build, chat notification) deferred with
  reasons in the workflow headers. Activation: provision
  `ludi-staging`, add `SUPABASE_ACCESS_TOKEN` +
  `SUPABASE_STAGING_PROJECT_REF` + `SUPABASE_STAGING_DB_PASSWORD`
  (+ the `SUPABASE_PROD_*` pair for the manual prod workflow).
- **2026-08-18** — §Domain and hosting added. The site line merged to
  `main` and Vercel deploys production on every push, but `ludi.football`
  still resolves to a Squarespace parking page and Deployment Protection
  makes the `*.vercel.app` URL private. Both must be cleared before any
  outside person can open `/keepers`, before UptimeRobot can watch the
  health route, and before Apple review can reach the privacy URL.
- **2026-08-18** — Correction to the entry above. It claimed the site was
  reachable by nobody and that Deployment Protection had to be turned
  off; both wrong. Standard Protection exempts production domains, so
  `ludi-alpha.vercel.app` was public the whole time — only the
  per-deployment URL that had been tested was protected, and correctly.
  DNS is the single remaining blocker, and Deployment Protection should
  be left exactly as it is.

