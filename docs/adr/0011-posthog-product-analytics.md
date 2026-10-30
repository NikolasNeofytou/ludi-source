# ADR-0011 — PostHog for product analytics (consent-gated)

**Status:** Accepted
**Date:** 2026-05-30
**Deciders:** Solo founder
**Supersedes:** — (resolves a stale event list in [infra.md](../infra.md) §Product analytics)
**Superseded by:** —

## Context

M5 puts real users in front of the booking loop. Before they arrive we
want the **conversion funnel already instrumented** — app open → auth →
pitch view → booking started → confirmed — so the first real attempts
are measured, not lost. This is the analytics half of the observability
pair whose error half landed in [ADR-0010](./0010-sentry-error-tracking.md);
that ADR's own follow-up names this one: *"#24 PostHog next —
consent-gated, reusing the same `scrub()` and consent plumbing from
M4 #22."*

The shape was pre-decided across docs ([infra.md §Product analytics](../infra.md),
[stage-2-commit-plan.md #24](../stage-2-commit-plan.md),
[plans/2026-06.md](../plans/2026-06.md)): PostHog, EU cloud, seven MVP
events. What those docs *don't* settle — and what this ADR fixes — are
the decisions that are expensive to walk back once an analytics
processor is handling EU behavioural data: the **consent posture**, the
**canonical event taxonomy** (infra.md and the commit ledger disagreed),
and the **no-PII property discipline**.

Constraints:

- **GDPR — this is behavioural analytics, not service stability.** Unlike
  Sentry (legitimate interest, [ADR-0010](./0010-sentry-error-tracking.md) §3),
  product analytics is exactly the processing the M4 #22 consent modal
  exists to gate. It must be **consent-gated**, not legitimate-interest.
- **Consent plumbing already exists** (M4 #22): `apps/mobile/src/lib/consent.ts`
  + `ConsentScreen.tsx`, with `ConsentGate` in `_layout.tsx` sitting
  *outside* StripeProvider/SessionProvider so nothing data-bearing inits
  before consent. AsyncStorage is the binding record;
  `auth.users.raw_user_meta_data.gdpr_consent_*` is the audit copy.
- **Free tier:** PostHog EU cloud, 1M events/mo ([infra.md](../infra.md)).
  Generous at MVP volume — the lever is *what* we send, not sampling.
- **Solo dev, do-it-once.** Key read from env, never committed; the code
  must ship and run safely *without* a key present (parity with the
  Sentry DSN guard).
- **Mobile-only.** The funnel is a client journey. No Edge Function or
  admin analytics in this slice — those surfaces have Sentry for health
  and Supabase for business metrics (`v_gmv_daily`).

## Decision

**Adopt PostHog on mobile only, EU cloud, initialized strictly behind the
M4 #22 consent gate, emitting an explicit fixed event set with no PII in
any property.**

1. **SDK:** **`posthog-react-native`** in `apps/mobile`. **Autocapture
   disabled** — explicit `capture()` calls only. Autocapture's
   screen/touch events are both a privacy surface (uncontrolled property
   capture) and quota noise; the funnel needs seven named events, not a
   firehose.

2. **Host:** PostHog **EU cloud (Frankfurt)**, `https://eu.i.posthog.com`,
   for GDPR proximity ([infra.md](../infra.md)).

3. **Consent-gated init (the key contrast with Sentry).** PostHog does
   **not** initialize until M4 #22 consent is granted, and **opts out +
   stops sending** if consent is later revoked (`posthog.optOut()` /
   re-`optIn()` driven by the same `consent.ts` state). No event —
   including `app_opened` — fires before consent. The consent state, not
   a separate analytics toggle, is the single source of truth.

4. **Canonical event taxonomy — seven events** (this supersedes the
   infra.md list and reconciles it with the commit ledger). No-PII
   properties only: ids, enums, counts, cents, timestamps — never phone,
   email, or name.

   | Event | Properties | Fires when |
   |---|---|---|
   | `app_opened` | `locale`, `city` | app foregrounded (post-consent) |
   | `auth_completed` | `method`, `is_new_user` | OTP/Apple/Google/magic-link session established |
   | `pitch_viewed` | `pitch_id`, `city`, `price_cents` | pitch detail screen opens |
   | `booking_started` | `pitch_id`, `slot_starts_at` | Payment Sheet presented |
   | `booking_confirmed` | `booking_id`, `total_cents` | booking reaches `confirmed` |
   | `booking_failed` | `error_code` | payment/booking fails |
   | `booking_cancelled` | `refund_cents`, `hours_to_slot` | cancellation confirmed |

   Naming rationale: `auth_completed` (not `signup_completed`) because
   M4 #20 shipped a four-way auth fan-out + returning-user login —
   `{method, is_new_user}` carries the signup-vs-login distinction
   accurately. `booking_confirmed` (not `booking_completed`) because
   `completed` is already a booking *state* (after the match is played);
   the event names the paid-and-booked terminal state. `booking_failed`
   is kept (from infra.md) so the funnel has its drop-off path.
   Cancellation is a single outcome event (from infra.md), not a
   two-step funnel — it isn't a conversion we optimize.

5. **Identity:** anonymous `distinct_id` before auth; `posthog.identify(user.id)`
   (UUID only) after `auth_completed`. **No PII in person properties** —
   same denylist discipline as the Sentry `scrub()` ([ADR-0010](./0010-sentry-error-tracking.md) §3).

6. **Safe-without-key:** absent `EXPO_PUBLIC_POSTHOG_API_KEY` → the
   analytics module **no-ops** (no init, no crash). Local dev, CI, and PR
   builds need no real key; analytics goes live when the founder pastes
   the key into env/EAS secrets.

7. **Env keys** (PostHog project API key is public by design,
   [infra.md](../infra.md)): `EXPO_PUBLIC_POSTHOG_API_KEY`,
   `EXPO_PUBLIC_POSTHOG_HOST` (defaults to the EU host).

## Consequences

### Positive
- The conversion funnel is populated *before* M5 users arrive; the first
  real bookings are measured.
- Consent-gating + explicit events + no-PII properties make PostHog a
  clean GDPR story: a user who declines generates zero analytics events,
  full stop.
- Key-guarded init means zero friction for contributors/CI and a "flip
  the switch" go-live, identical to the Sentry pattern.
- One reconciled event taxonomy across infra.md, the ledger, and code —
  the drift that prompted this ADR is closed.

### Negative
- **No automated test for the consent gate or event wiring** (no RN test
  runner, per project memory). Mitigated: manual verification that (a) no
  event fires pre-consent, (b) revocation stops events — recorded in the
  PR. Automated test the day a runner lands.
- Disabling autocapture means every future event must be wired by hand.
  Accepted — explicitness is the point at MVP; autocapture's noise/PII
  cost outweighs its convenience here.
- `app_opened` under-counts true opens by exactly the consent-decliner
  population. Accepted — that's the correct GDPR behaviour, not a bug.

### Neutral
- Free tier is comfortable at MVP volume; if we approach 1M events/mo the
  lever is event volume, not a paid tier decision yet.
- Funnel/dashboard definitions live in the PostHog UI, not in code.

## Alternatives considered

### Legitimate interest, like Sentry (no consent gate)
Simpler, higher capture. Rejected: product analytics is precisely the
behavioural processing the M4 #22 consent modal was built to gate. Using
legitimate interest here would make the consent modal partly theatre.

### Autocapture on
Zero wiring, automatic coverage. Rejected: uncontrolled property capture
is a PII surface we can't audit, and it burns quota on touch/screen noise
the funnel doesn't need.

### Follow infra.md's event list verbatim
`signup_completed` + `booking_completed`. Rejected: both names collide
with shipped reality (the auth fan-out; the `completed` booking state).
Kept its good parts (`booking_failed`, single cancel event).

### Follow the commit ledger's list verbatim
Two-step `cancellation_started`/`_confirmed`, no `booking_failed`.
Rejected: cancellation isn't a conversion funnel worth a two-step
measure, and dropping `booking_failed` blinds the funnel to payment
drop-off.

### Mixpanel / Amplitude / GA4
Comparable analytics. Rejected: PostHog has an EU-hosted free tier, a
first-class React-Native SDK, and was already named in infra.md and the
threat model. No reason to diverge.

### Reverse-proxy PostHog through our own domain
Defeats ad-blockers, cleaner first-party story. Rejected: needs
`ludi.app` (June pre-work) and a proxy worker — premature. Revisit if
event loss to blockers proves material post-launch.

## Amendment 2026-09-13 — analytics is its own choice (consent v2)

The gate above keyed PostHog to "consent given", but the M4 #22 screen
gave only one button, "Accept and continue", with analytics bundled into
the same bullets as what the app needs to run. No refusal, no in-app
withdrawal: not freely given consent under GDPR, and it contradicted the
published privacy policy ("you opt in explicitly and can withdraw consent
at any time in the app"). Found in the 2026-09-13 launch audit.

Now the consent record carries `analytics: boolean` separately from
`accepted_at`:
- **Consent screen:** the notice (accounts, bookings, payments, crash
  reports: contract / legitimate interest) stays, and product analytics is
  a switch that **starts off**. Continue without touching it = nothing
  sent.
- **Settings:** the same switch, any time. Off calls `optOut()`
  immediately (`setAnalyticsChoice`); the audit copy gains
  `gdpr_analytics` / `gdpr_analytics_at`.
- **`ConsentGate`:** calls `setAnalyticsConsent(record.analytics)`, so
  `app_opened` and everything else fire only on an explicit yes.
- **`CONSENT_VERSION` → `v2`:** every v1 user is asked once more, with a
  real choice. Expect the opt-in rate, and so event volume, to drop; the
  funnel reads relative rates, which still hold.

Verified on the simulator from the Metro log: v1 record → re-prompt;
Continue with the switch off → `consent revoked` and no `app_opened`; an
opted-in record → `consent granted` + `app_opened`.

## Follow-ups

- **Founder action (account already exists):** create the `ludi` PostHog
  project on EU cloud, paste `EXPO_PUBLIC_POSTHOG_API_KEY` into mobile
  `.env` + EAS secrets. Until then the integration ships dormant
  (key-guarded).
- Wire the seven events at their call-sites; gate init on `consent.ts`;
  `optOut()` on revocation.
- Manually verify pre-consent silence + post-revocation stop; record in
  the PR. Add the automated consent-gate test when a React-Native runner
  lands (tracked separately — the "no mobile test runner" item).
- Build the funnel + conversion dashboard in the PostHog UI; sanity-check
  `booking_confirmed` count against the booking table.
- Update [infra.md](../infra.md) (done in this slice — canonical event
  list), [roadmap](../roadmap.md) tick, and the ledger #24 row.
