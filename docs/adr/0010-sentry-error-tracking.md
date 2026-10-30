# ADR-0010 — Sentry for error & crash tracking

**Status:** Accepted
**Date:** 2026-05-30
**Deciders:** Solo founder
**Supersedes:** — (resolves a stale detail in [infra.md](../infra.md) §Error tracking)
**Superseded by:** —

## Context

M5 puts real users and real money in front of Ludi. Before that, we want to be *already watching* when something breaks in prod — not scrambling to add instrumentation after the first silent failure. [JOURNAL.md](../JOURNAL.md) already records one such ghost: "pitches… forever, no error, no Sentry breadcrumb." That's the gap this closes.

The observability shape was pre-decided across several docs ([infra.md §Monitoring](../infra.md), [stage-2-commit-plan.md #23](../stage-2-commit-plan.md), [plans/2026-06.md](../plans/2026-06.md)): Sentry for errors, PostHog for analytics (#24, next). What those docs *don't* settle — and what this ADR fixes — is the cross-cutting set of decisions that, once shipped to a data processor handling EU PII, are expensive to walk back: which SDKs, how many projects, the GDPR/consent posture, and how PII never reaches Sentry's servers.

Constraints:

- **Three surfaces, three runtimes:** Expo/React-Native (mobile), Deno (Edge Functions), Next.js (admin). No single SDK covers them.
- **GDPR.** Sentry is a signed DPA processor ([threat-model.md](../threat-model.md)), EU region. Even so, the cheapest PII incident is the one whose data never left the device — scrubbing at source beats relying on the processor.
- **Free Developer tier:** 5K events/mo, shared org-wide ([infra.md](../infra.md)). Sampling must stay conservative.
- **Solo dev.** Setup should be do-it-once-then-forget. DSNs are read from env and never committed (per-environment, and PR forks must not spam our Sentry) — so the code must ship and run safely *without* a DSN present.
- **No mobile test runner** (per project memory) — the PII scrubber's automated contract test can only run where a runner exists today: the Edge Functions' Deno suite.

## Decision

**Adopt Sentry across all three surfaces, initialized under legitimate interest with PII scrubbed at source before any event leaves the client.**

1. **SDKs, one per surface:**
   - Mobile → **`@sentry/react-native`** with the Expo config plugin. *(Resolves the stale `sentry-expo` reference in [infra.md](../infra.md) — `sentry-expo` is deprecated and folded into `@sentry/react-native`.)*
   - Edge Functions → **`@sentry/deno`**, via a shared `_shared/sentry.ts` `withSentry()` handler wrapper.
   - Admin → **`@sentry/nextjs`** (client + server + edge configs).

2. **Project topology:** **three separate Sentry projects** (`ludi-mobile`, `ludi-edge`, `ludi-admin`) under one org, each tagged with `environment` (`development` / `staging` / `production`). This supersedes infra.md's "same project, different environment tag" — separate projects keep source-map pipelines, alert tuning, and SDK noise from colliding. Events still share the one free-tier quota.

3. **GDPR posture — legitimate interest, scrub at source.** Sentry initializes **independently of the M4 #22 consent modal** (crash reporting is service-stability, not analytics — the plan only ever scoped consent-gating to PostHog). The trade is that we scrub hard:
   - `sendDefaultPii: false` everywhere (no IP, no cookies, no auto-captured request bodies).
   - A shared pure **`scrub()`** function (phone — CY `+357…` and international — + email regex, plus a context-key denylist: `phone`, `email`, `password`, `token`, `authorization`, `first_name`, `last_name`) runs inside each surface's `beforeSend` / `beforeBreadcrumb`.
   - **User identity:** full `user.id` (UUID) into Sentry's protected context only; logs still carry first-8 only (per [CONVENTIONS §observability](../CONVENTIONS.md)). No name/phone/email on the Sentry user object.

4. **Source maps** uploaded in CI via `SENTRY_AUTH_TOKEN` (CI-only secret): per EAS build (mobile), per `next build` (admin). Edge Functions ship readable stack traces from Deno directly.

5. **Sampling:** `tracesSampleRate: 0.1`, `profilesSampleRate: 0` — errors always captured, performance sampled lightly to protect the 5K/mo quota.

6. **Safe-without-DSN:** every `init` is guarded — **absent DSN → Sentry no-ops** (no init, no crash). So local dev, CI, and PR builds need no real DSN; Sentry goes live the moment the founder pastes DSNs into env/secrets.

7. **DSN env keys** (DSNs are public by design, [infra.md](../infra.md)): `EXPO_PUBLIC_SENTRY_DSN` (mobile), `NEXT_PUBLIC_SENTRY_DSN` (admin), `SENTRY_DSN` (Edge Functions).

## Consequences

### Positive
- Crashes on the booking happy path surface within ~2 min, across all three surfaces, *before* M5 users arrive.
- PII never reaches Sentry — scrubbing at source makes the DPA a backstop, not the primary control. A scrubber bug is caught by the Deno contract test in CI.
- DSN-guarded init means zero friction for contributors/CI and a clean "flip the switch" go-live.
- Admin coverage means a crash mid-refund (real money) is visible, not silent.

### Negative
- **Native rebuild required** for `@sentry/react-native`'s config plugin (like Mapbox in [ADR-0008](./0008-maps-mapbox-deferred.md)) — adds an EAS build step; `expo prebuild` needed locally.
- **Mobile scrubber has no automated test yet** (no RN test runner). Mitigated: the scrubber is an isolated pure function, identical in shape to the Deno-tested one; manual verification now, automated test the day a runner lands.
- Three projects = three DSNs to provision and rotate. Accepted for the cleaner separation.
- Legitimate-interest posture is a defensible-but-arguable GDPR call; documented here so it's a decision, not an accident. Revisit if a DPA/regulator pushes back.

### Neutral
- Free tier is comfortable at MVP volume; the 0.1 trace sample is the lever if we approach 5K/mo.
- Alert rules ([infra.md](../infra.md): >10 events/hr → email; `fatal` → immediate) are configured in the Sentry UI, not in code.

## Alternatives considered

### `sentry-expo`
The path infra.md originally named. Rejected: **deprecated** — Sentry merged it into `@sentry/react-native`, which is now the supported Expo path.

### One Sentry project for all surfaces
Fewer DSNs. Rejected: mixes RN/Deno/Next source maps and SDK noise in one issue stream; alert tuning becomes coarse. The per-surface separation is worth three DSNs.

### Gate Sentry behind the consent modal (like PostHog)
Most conservative. Rejected: you lose visibility into the very crash that made a user decline, and crash reporting is genuinely service-stability (legitimate interest), not behavioral analytics. We compensate with source-level scrubbing.

### Bugsnag / Rollbar / self-hosted GlitchTip
Comparable error trackers. Rejected: Sentry has first-class SDKs for all three of our runtimes, a signed EU DPA already noted in our threat model, and a free tier that fits. No reason to diverge.

### Console logs + Supabase log search only
Zero new processor. Rejected: no client-side crash capture, no aggregation, no alerting, no source-mapped stack traces. This is exactly the JOURNAL ghost we're fixing.

## Follow-ups

- **Founder action (account already exists):** create the three projects (`ludi-mobile`, `ludi-edge`, `ludi-admin`), paste DSNs into mobile/admin `.env` + EAS/Vercel secrets and the Edge Function env, add `SENTRY_AUTH_TOKEN` to CI. Until then the integration ships dormant (DSN-guarded).
- Configure the two alert rules in the Sentry UI once projects exist.
- Add the **mobile** scrubber contract test when a React-Native test runner lands (tracked separately — the "no mobile test runner" item).
- **#24 PostHog** next — consent-*gated*, reusing the same `scrub()` and the consent plumbing from M4 #22.
- Update [infra.md](../infra.md) (SDK fix + admin surface + three-project topology), [CONVENTIONS §observability](../CONVENTIONS.md), [roadmap](../roadmap.md) tick, and [threat-model](../threat-model.md) if the scrub denylist becomes a named control.
