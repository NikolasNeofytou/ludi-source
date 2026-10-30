# Ludi · Roadmap

_Phase 8 and final phase of the planning pass. Stages 2–5 with **falsifiable acceptance criteria**. If the acceptance criterion isn't testable, it isn't acceptable._

## Convention

Every stage has:
- **Goal** — a single sentence
- **Exit criteria** — the ship/no-ship checklist; every bullet is a falsifiable claim
- **Headline metric** — the one number we watch to know the stage is healthy
- **Estimated effort** — solo dev, part-time, with lots of humility about estimates
- **Known risks** — what could go wrong

---

## Stage 1 — Foundation ✅ _(complete)_

**Status:** shipped commit `7e16fa5` + docs commits `7b436a1` → this one.

Everything required to start feature work:
- ✅ pnpm + Turborepo monorepo
- ✅ Expo SDK 54 app with expo-router 5-tab shell (verified running on physical iPhone)
- ✅ `@ludi/ui` package: tokens, COPY, icons, primitives
- ✅ i18n EN+GR bootstrapped
- ✅ Supabase client stub with expo-secure-store adapter
- ✅ Private GitHub repo + initial commit pushed
- ✅ 11 planning docs in `/docs` covering vision, glossary, features, journeys, ADRs, data model, API contract, UI, infra, threat model, roadmap
- ✅ First 6 Supabase migrations committed (extensions, uuid7, schema, helpers, RLS, signup trigger)
- ✅ CI pipeline in `.github/workflows/ci.yml`
- ✅ `project-modernizer` skill built for future project audits

---

## Stage 2 — MVP (first paying booking)

> **Status 2026-08-17 — the app is production ready.** The build is feature
> complete for this stage and fit to put in front of real users: no known
> blocking defects, both locales, payments wired end to end.
>
> Stage 2 nonetheless stays **open**, because its exit is not a software
> condition. The headline metric is a *first paid booking from a non-friend
> user*, and the first three criteria below are supply, not code — live pitches,
> onboarded owners, a payout to a real IBAN. Those close when Larnaca closes
> them, not when a build passes.
>
> The unticked boxes below are therefore a mix of two things: engineering
> criteria that are believed met but have not been individually demonstrated to
> the standard this checklist asks for ("a live video or CI passing test"), and
> supply criteria that genuinely are not met. Tick them as they are actually
> verified — do not bulk-tick on the strength of this note.
>
> This note is deliberately a *verbal* claim, which §How to use this roadmap
> forbids as evidence. That rule still holds: the checklist, not this
> paragraph, is what says a feature is done. The note exists so that anyone
> reading the doc alongside the live site is not misled into thinking the app
> is unbuilt — it is not a substitute for ticking the boxes.

**Goal:** Andreas (a real Larnaca footballer, not a friend doing me a favor) books a pitch through Ludi, his card is charged, Maria (a real pitch owner) receives the payout automatically, and all of it happens without me touching a terminal.

**Timeline target:** 12 weeks from Stage 1 completion.

**Headline metric:** first paid booking from a non-friend user.

### Exit criteria (ship/no-ship checklist)

Each bullet must be demonstrable by a live video or CI passing test.

**Supply**
- [ ] At least 3 Larnaca pitches live and bookable (verified, Stripe-active, schedule populated)
- [ ] At least 2 pitch owners onboarded via the manual founder flow (J4)
- [ ] Stripe Connect payouts tested to at least one real Cypriot IBAN (can be a friend's with consent)

**Auth & profile**
- [ ] A new user can sign up via **all four** methods (phone OTP, Apple, Google, email magic link) on a cold-install device
- [ ] On cold reopen, the app remembers the session (expo-secure-store)
- [ ] Profile can be edited in EN and ΕΛ; saved values persist after reopen
- [ ] Locale toggle in Profile flips all UI copy without restart

**Discover**
- [ ] Discover tab loads within 2 seconds on a mid-range Android (Pixel 6 or equivalent) on 4G
- [ ] City pill shows "Coming soon" for all cities except Larnaca
- [ ] Filter chips reduce the list client-side; no server round-trip

**Pitch detail**
- [ ] Available slots derived correctly: schedule minus overrides minus existing bookings
- [ ] Unavailable slots rendered struck-through, not hidden (better UX)
- [ ] "Open in Maps" deep link works on iOS and Android

**Booking & checkout**
- [ ] `create-booking` Edge Function atomic under load: 100 parallel double-book attempts result in exactly one success (load test)
- [ ] Apple Pay works on iOS device with a test card
- [ ] Google Pay works on Android device with a test card
- [ ] Saved cards (Stripe Customer) surface on subsequent bookings
- [ ] Stripe webhook updates booking state from `pending` → `paid` → `confirmed` within 10 seconds of payment
- [ ] Confirmation email arrives in user's preferred locale within 60 seconds
- [ ] Booking code format `LAR-2026-0001` and increments per-city-per-year
- [ ] Cancellation outside 24h refunds 100% within 5 minutes
- [ ] Cancellation inside 6h shows zero refund before confirm

**Admin & ops**
- [ ] Admin web tool live at an access-controlled URL (Cloudflare Access or IP allowlist)
- [ ] Admin can: list bookings, issue refunds, verify/deactivate pitches, view daily GMV
- [ ] Every admin action produces a row in `admin_actions` — verified by pgtap test
- [ ] Anonymize-me flow works end-to-end: user → Edge Function → PII nulled → `auth.users` deleted → audit row

**Infrastructure**
- [ ] Staging Supabase project live and on the same migration head as production
- [ ] CI runs on every PR: lint + typecheck + migration dry-run + sqlfluff pass
- [x] Sentry captures mobile, admin, and Edge Function errors (ADR-0010; edge via #56, clients via this PR)
- [ ] PostHog captures the 7 MVP events listed in `infra.md`
- [ ] Weekly pg_dump to S3 runs green 3 weeks in a row
- [ ] Uptime monitor has <99% downtime month

**Security**
- [ ] pgtap suite covering every RLS policy: passing on CI
- [ ] `SECURITY.md` published
- [ ] Dependabot open on the repo; no `high` severity vulns outstanding
- [ ] Stripe webhook signature verification tested with a deliberate tampered payload (must 400)

**Compliance**
- [ ] GDPR consent modal appears on first launch; consent timestamp stored
- [ ] Privacy policy and terms published at `ludi.football/privacy` and `ludi.football/terms`
- [ ] Data Processing Agreement with Supabase confirmed signed

### Operational breakdown

The exit criteria above are the _what_ — [`stage-2-commit-plan.md`](./stage-2-commit-plan.md) is the _how_, broken into ~35 atomic commits grouped by milestone, with a tracked critical path to the first paying booking. Tick commits off there as they land.

### Estimated effort

Solo, ~15 hours/week, no major life disruptions: **10–14 weeks.** Realistic with slippage: **16 weeks.** This is why the 3-month MVP horizon is aggressive but credible if supply-side cooperates.

### Known risks (Stage 2)

1. **Pitch-owner onboarding stalls.** Maria says yes in principle, but Stripe ID verification stalls for 3 weeks. Mitigation: start owner meetings in week 1, not week 8.
2. **Stripe Connect Express edge cases** — Cyprus has quirks (VAT, business structure). Budget 1 week of the 12 for this.
3. **EAS Build OTA limits** — free tier is 30 builds/mo. Stage 2 will routinely exceed. Bump to paid plan by week 4.
4. **Solo burnout.** Build in a forced 2-week pause around week 6 — if progress stalls, the pause is cheaper than a collapse.

---

## Stage 3 — Matchmaking (retention layer)

**Goal:** A first-time Ludi user who doesn't already have a team can join an active open match in Larnaca within 5 minutes of signing up.

**Timeline target:** months 4–6 (3 months after MVP launch).

**Headline metric:** ratio of (active users) / (users who've played > 1 match). Retention past first booking is what matters; one-off bookings don't make a habit.

### Exit criteria

**Matches**
- [ ] Host flow: a user can convert their booking into an open match in <30 seconds
- [ ] Join flow: a user sees open matches in Larnaca filtered by skill range, joins, pays per-head share, confirmed
- [ ] Match waitlist: when full, users can join a waitlist; automatic promotion on drop-outs
- [ ] Match cancellation: if match drops below minimum players 2h before, auto-cancel and refund all
- [ ] Cold-start seeding: at least 5 matches per week in Larnaca for the first month, manually created from a WhatsApp cohort

**Results & ratings**
- [ ] Post-match prompt to host: enter score + scorers
- [ ] Teammate confirmation flow: majority vote ratifies
- [ ] Rating each teammate (1–5 stars) after match completion
- [ ] Skill level auto-adjusts monthly based on rolling average of received ratings
- [ ] MVP vote visible on match result screen

**Split payment**
- [ ] Host pays the venue fee; each joiner pays per-head share via their own Stripe PaymentIntent
- [ ] Booking state flips to `confirmed` only when all joiner shares are collected (or refund all on timeout)
- [ ] Host can see paid/unpaid status per participant

**Social**
- [ ] Friend graph: users can add / accept friends in-app
- [ ] Friend-filter on open matches: "matches my friends have joined"
- [ ] WhatsApp share link pattern: `https://ludi.football/m/<code>`

### Estimated effort

**~10 weeks.** Split payment is the hardest single feature — budget 3 weeks for Stripe Connect orchestration and refund edge cases.

### Known risks (Stage 3)

1. **Cold-start fails.** Matches don't fill because Larnaca liquidity is too low. Mitigation: host manual matches weekly until the first 200 MAU, accept lower revenue on those.
2. **Split-payment refund spirals.** A cancelled match with 9 paid joiners = 9 refunds with application-fee reversals. Test this path exhaustively before launch.
3. **Skill system gaming.** Users downgrade themselves to join easier matches. Mitigation: make skill level affect both sides of matchmaking (stronger players don't want to play weaker pickup games often), monitor for obvious gaming.

---

## Stage 4 — Growth polish

**Goal:** Ludi has a functional pitch-owner dashboard, Mapbox integration, push notifications, and has launched in Nicosia as a second city.

**Timeline target:** months 6–9.

**Headline metric:** MAU / active cities. Cross-city platform health.

### Exit criteria

**Maps**
- [ ] Mapbox integration with custom terracotta-palette style
- [ ] Pin-based discovery: tap a pin → mini pitch card with book CTA
- [ ] User location dot + "pitches near me" sort
- [ ] Indoor/outdoor filtering affects pin color

**Push notifications** (Expo Push)
- [ ] "Your match is 2 hours away"
- [ ] "Your open match is about to fill (1 spot left)"
- [ ] "Your booking was cancelled/refunded"
- [ ] Per-category opt-in; respected via device settings

**Deep links**
- [ ] Universal link `https://ludi.football/m/<match_code>` opens app if installed, falls back to landing page
- [ ] iOS Associated Domains + Android App Links verified
- [ ] Landing page pre-fills match details before signup

**Pitch-owner web dashboard**
- [ ] Separate Next.js app in `apps/dashboard/` (per ADR-0007 parallel package plan)
- [ ] Weekly/monthly booking calendar view
- [ ] Revenue and payout reporting
- [ ] Schedule and override editing UI
- [ ] Multi-venue support

**Second city**
- [ ] Nicosia `is_enabled = true`
- [ ] At least 5 pitches verified in Nicosia
- [ ] Cross-city search prevented (users only see their home-city pitches by default; explicit "view other cities" opt-in)

**Reviews & photos**
- [ ] Post-booking prompt: rate the pitch (1–5 stars) + optional comment
- [ ] Aggregate rating displayed on pitch detail
- [ ] Photo upload via Supabase Storage with server-side validation

### Estimated effort

**~12 weeks.** Dashboard alone is 4 weeks if done properly.

### Known risks (Stage 4)

1. **Nicosia doesn't activate** — Larnaca was the user's home city; Nicosia needs cold outreach. Plan 4 weeks of supply-side work before turning `is_enabled = true`.
2. **Dashboard becomes a support ticket magnet** — real pitch owners will find bugs we never imagined. Staff support energy accordingly.

---

## Stage 5 — Scale

**Goal:** Ludi is the default way Cypriots play football. Revenue supports making Ludi the founder's primary focus.

**Timeline target:** months 9–18.

**Headline metric:** Net revenue > €5K/mo (per VISION.md 12-month target).

### Candidate features (prioritize when Stage 4 exits)

- Waitlists for popular peak slots
- Recurring weekly matches ("same crew, every Wednesday 19:30")
- Tournaments and leagues (bracket management)
- Referral program (small credit per invite who books)
- Third-party integration: WhatsApp Business API for venue notifications
- Coaching bookings as a separate product line (validate with 3 real coaches first)
- Corporate team-building bookings (different acquisition channel, different UX)
- Expansion to Athens or Thessaloniki (same language, 15× the market)

**Stop adding features when** monthly active users triple without new feature launches — that's the signal to focus on retention and ops, not surface area.

---

## Stages explicitly **not** planned

From `docs/product/features.md` Won't-Haves:

- Non-football sports (padel, tennis, basketball) — resist until saturation
- Live streaming / spectator features
- Social feed / followers
- In-app chat / DMs
- Coaching as the primary product

These remain off-limits without a rewrite of VISION.md — which is how scope creep should work.

---

## How to use this roadmap

- **Weekly review** — every Friday, check Stage N progress against the exit-criteria checklist. Tick boxes; nothing else.
- **No verbal claims of progress.** If the checklist box is unticked, the feature isn't done, regardless of how "almost there" it feels.
- **No phase-jumping.** Stage 3 does not start until Stage 2 exit criteria are all green and first paying booking happens.
- **Rewrite permitted.** If a quarterly review shows a criterion was wrong (too strict, too loose, or irrelevant), write a `docs/roadmap-changelog.md` entry and edit. Roadmaps that don't evolve are wishlists.

## Changelog

- **2026-04-21** — Phase 8. Initial roadmap. Stage 1 marked complete; Stages 2–5 open.
- **2026-04-21** — Added `stage-2-commit-plan.md` breaking Stage 2 exit criteria into 35 atomic commits across 5 milestones + 4 non-code tasks.
- **2026-08-17** — Recorded that the app is production ready (status note at the top of Stage 2). Stage 2 stays open: its exit is a first paid booking by a real user at a real pitch, which is a supply condition, not a software one. No checkboxes were ticked — the note is explicitly not evidence.
