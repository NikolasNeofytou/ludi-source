# ADR-0009 — Responsible disclosure policy

**Status:** Accepted
**Date:** 2026-05-29
**Deciders:** Solo founder
**Supersedes:** —
**Superseded by:** —

## Context

Ludi is approaching its first real-money flows. M3 added an admin web app with full refund powers; M4 wired phone-OTP auth in front of real users. As soon as the public app store listing carries a working booking loop, we will become a target for the everyday class of attacker outlined in [threat-model.md §Threat actors](../threat-model.md) — scrapers, credential-stuffers, and curious researchers poking at RLS.

The threat model already pre-committed to a public `SECURITY.md` and a `security@ludi.app` reporting address ([threat-model.md:130](../threat-model.md)) and to deferring a bug bounty ([threat-model.md:148](../threat-model.md)). What the threat model does *not* fix is the **policy promise we make to a researcher who finds a vulnerability**: how they reach us, how fast we respond, what counts as in-scope, and what we will not pursue legally. Those are external commitments that, once published, we cannot quietly retract.

We are writing this **ahead of public launch on purpose.** Today the repository is private and there are zero external users — so there is no live attack surface yet. But the artifact that a disclosure policy produces (`SECURITY.md` at the repo root, a reachable inbox, a stated SLA) needs to exist *before* the app store listing goes live, not scrambled together after the first report lands in a DM. Publishing now, while the stakes are zero, lets us get the shape right calmly.

Constraints in play:

- **Solo dev, ~15h/week.** Any SLA must be honest about a one-person on-call.
- **No paid security tooling** at this scale; no triage team.
- **GitHub-native** workflow already ([ADR-0001](./0001-monorepo-pnpm-turborepo.md)). The repo is currently **private**; GitHub Private Vulnerability Reporting becomes useful to outside researchers only once it is public.
- **Domain not yet registered.** `ludi.app` is June pre-work; `security@ludi.app` cannot receive mail today.
- **EU/GDPR jurisdiction** — Cyprus-based, EU processors. A confirmed PII breach triggers a 72-hour notification clock to the supervisory authority under GDPR Art. 33, separate from and additional to the researcher conversation.

## Decision

**Adopt a lightweight responsible-disclosure policy with a private email channel, a 72-hour acknowledgement SLA, a 30-day target-fix window for high-severity issues, and no bug bounty.** The policy is published as a root-level `SECURITY.md` and cross-linked from this ADR.

Concretely:

1. **Reporting channels (in order of preference):**
   - **Primary:** email. The active inbox is `nikiforialicht@gmail.com` until `ludi.app` is registered, at which point reports migrate to `security@ludi.app`. `SECURITY.md` states both and which is currently live.
   - **Fallback (activates when the repo goes public):** GitHub Private Vulnerability Reporting (PVR) on the repo, for researchers who prefer the confidential GitHub advisory flow over email.
   - **Not** GitHub Issues, social media, or DMs. Public disclosure before a fix ships is explicitly *not* coordinated and forfeits safe harbour.

2. **Service-level expectations:**
   - **Acknowledgement:** within **72 hours** of receipt (calendar, not business).
   - **Triage decision** (in-scope / out-of-scope / duplicate): within **7 days**.
   - **Target fix:** **30 days** for High/Critical, **90 days** for Medium, best-effort for Low. Severity uses CVSS v3.1 as a guide, not a contract.
   - If we miss a target, we tell the reporter why and give a new date. The SLA is a promise to *communicate*, not a promise to ship by a calendar bar a solo dev cannot guarantee.

3. **In-scope assets:** the live `ludi.app` mobile and admin endpoints, the Supabase project (Edge Functions, RLS policies), and code in this repository. Mirrors the asset table in [threat-model.md §Assets and blast radius](../threat-model.md).

4. **Out-of-scope:** social engineering of the founder, physical attacks, denial-of-service testing, third-party services we depend on (Supabase, Stripe, Twilio — report directly to them), and anything that would expose real user PII during the test. Specifically forbidden: automated scanners against the production environment without prior written agreement.

5. **Safe harbour:** good-faith research that follows this policy will not result in legal action by Ludi, nor a referral under the EU Directive 2013/40 (attacks against information systems) or its Cyprus transposition.

6. **No bug bounty.** A hall-of-fame credit in `SECURITY.md` for valid reports, if the researcher consents. Cash bounties are deferred until post-Series-A per [threat-model.md:148](../threat-model.md) — they add triage load a solo founder cannot absorb fairly.

The companion `SECURITY.md` carries the *public-facing language* of points 1–6. This ADR records the *why*.

## Consequences

### Positive
- Researchers have a single, public, low-friction reporting path — most will use it before going to social media.
- The 72hr ack SLA is short enough to be credible (not "we'll get back to you eventually") and long enough to be honest about solo-dev reality.
- GitHub PVR gives confidential triage on a platform we already live on, with a clean path to GitHub Security Advisories / CVE issuance later — at no cost.
- The explicit out-of-scope list defuses the most common low-signal report classes (DoS, Dependabot duplicates, third-party services).
- Records the no-bounty stance loudly enough that "you should pay me" has a documented, pre-decided answer.
- Publishing pre-launch means the policy is in place the day the listing goes live — no gap.

### Negative
- The 72hr clock runs even when the founder is sick, travelling, or asleep across timezones. **Mitigation:** the reporting inbox has a phone push rule; an auto-responder confirms receipt within minutes while a human reply follows inside 72h.
- The 30-day fix target is aggressive for a solo dev if several bugs land at once. Accepted risk — if it happens, communication-over-deadline is the contract.
- Listing a personal Gmail as the security contact is slightly unprofessional and ties the address to an individual. Accepted as temporary; the `security@ludi.app` migration closes it. Until then, the personal inbox is the honest truth and beats a `security@` address that bounces.
- No bounty may reduce the volume of high-quality reports. Accepted — we are not yet at the scale where bounty-hunter attention is the binding constraint.

### Neutral
- Policy needs a v2 review when (a) revenue justifies a bounty, (b) the team grows beyond solo, or (c) Cyprus/EU publishes sector-specific disclosure guidance (e.g. the Cyber Resilience Act).
- CVSS scoring is "a guide, not a contract" — leaves room for context-aware severity adjustment, which a solo team needs.
- The PVR fallback is dormant while the repo is private; it costs nothing to document now and switches on automatically at public launch.

## Alternatives considered

### No public policy (default GitHub behaviour)
Researchers route through Issues or DMs by default; we triage ad hoc. Rejected: invites public disclosure of unpatched bugs because researchers don't know a private path exists, and looks unserious to anyone evaluating the platform.

### Bug bounty via HackerOne / Intigriti
Outsourced triage, real payouts. Rejected at this stage: the smallest managed tier (~$1K/mo all-in) exceeds the entire infra budget, and triage load even with platform filtering still lands on the solo founder. Revisit at Series A or first €100K MRR per [threat-model.md:148](../threat-model.md).

### Tighter SLA (24hr ack / 7-day fix)
Looks impressive. Rejected: not honest for one person. A missed SLA in a *public* policy is worse than a slower SLA met reliably.

### Wait until the domain and public launch to publish anything
Defer `SECURITY.md` until `security@ludi.app` works and the repo is public. Rejected: the artifact should exist before launch, not be assembled reactively after the first report. A personal inbox with a documented migration plan is a fine bridge.

### Email-only, never mention GitHub PVR
Simpler doc. Rejected: PVR is free, on a platform researchers trust, and wires into Security Advisories for later CVE issuance. Documenting it now (dormant until public) costs nothing.

### Looser scope (everything is in-scope)
Maximises researcher freedom. Rejected: invites scanner-driven DoS reports against production, and we cannot honestly safe-harbour activity that would breach real user PII regardless of intent.

## Follow-ups

- Author `SECURITY.md` at repo root in the same PR (the public artifact of this ADR).
- Register `ludi.app` (June 2026 pre-work), create the `security@ludi.app` alias, then update `SECURITY.md` to make it the live primary channel and demote the personal Gmail.
- Enable GitHub Private Vulnerability Reporting on the repo at the moment it is made public.
- Update [CONVENTIONS.md §Security hygiene](../CONVENTIONS.md) to reference this ADR once `SECURITY.md` ships.
- Write `docs/runbooks/security-report-triage.md` when the *first* real report arrives — premature to write before we know the shape of the load.
- Revisit this ADR if: (a) we add a second engineer, (b) a real incident exposes a gap in the SLA, or (c) the EU Cyber Resilience Act creates statutory disclosure timelines that override this policy. Whichever comes first.
