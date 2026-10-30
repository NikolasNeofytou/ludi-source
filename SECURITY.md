# Security Policy

Ludi handles payments, personal data, and authentication for a real-money
booking platform. We take vulnerability reports seriously and we'd rather
hear about a problem from you than read about it later.

This policy explains how to report a vulnerability, what to expect from us,
and what is in and out of scope. The reasoning behind it lives in
[ADR-0009](docs/adr/0009-responsible-disclosure-policy.md); the assets we
care most about are mapped in [docs/threat-model.md](docs/threat-model.md).

## Reporting a vulnerability

**Please report privately. Do not open a public GitHub issue for a security
problem.**

- **GitHub Private Vulnerability Reporting** (preferred): the **Report a
  vulnerability** button under this repository's **Security** tab opens a
  confidential advisory thread that only you and the maintainer can see.
- **Email:** `security@ludi.football`, a monitored inbox.

When you report, please include:

- A description of the issue and the impact you believe it has.
- Steps to reproduce, or a proof-of-concept, if you have one.
- The affected component (mobile app, admin app, an API/Edge Function, a
  specific RLS policy).

We don't publish a PGP key. If your report contains something sensitive,
use the GitHub advisory thread above, which stays private.

## What to expect

Ludi is currently maintained by a single developer. The timelines below are
honest commitments for one person, not enterprise marketing:

| Stage | Target |
|---|---|
| **Acknowledgement** of your report | within **72 hours** (calendar) |
| **Triage decision** (in scope / out of scope / duplicate) | within **7 days** |
| **Fix** for High / Critical severity | target **30 days** |
| **Fix** for Medium severity | target **90 days** |
| **Fix** for Low severity | best effort |

Severity is assessed using CVSS v3.1 as a guide. If we expect to miss a
target, we will tell you why and give you a new date — the promise is to keep
communicating, not to hit a calendar bar regardless of circumstances.

We'll let you know when the issue is fixed, and — with your consent — credit
you in this file's hall of fame below.

## Scope

### In scope

- The Ludi mobile app (iOS and Android) as published in the stores.
- The website at `ludi.football` and the venue dashboard at
  `ludi-admin.vercel.app`.
- The Supabase backend: its REST and RPC API, Edge Functions, and
  Row-Level Security policies.
- Source code in this repository.

### Out of scope

- **Social engineering** of the founder or any contact.
- **Physical attacks** against people or property.
- **Denial-of-service** testing (volumetric or application-layer).
- **Third-party services** we depend on — report these to the vendor
  directly: Supabase, Stripe, Twilio, Meta (WhatsApp), Resend, Apple,
  Expo, Vercel, Sentry, PostHog. A flaw in how *Ludi* uses one of them is
  in scope.
- **Any test that would expose real user personal data.** If your research
  requires touching real PII to proceed, stop and contact us first.
- **Automated scanners against production** without prior written agreement.

## Safe harbour

If you make a good-faith effort to follow this policy, we will not pursue or
support legal action against you for your research, including under the EU
Directive 2013/40 on attacks against information systems or its Cyprus
transposition. Good faith means: you report privately, you don't access or
modify more data than necessary to demonstrate the issue, and you give us a
reasonable chance to fix it before any public disclosure.

Public disclosure of an unpatched vulnerability before we've had a
reasonable chance to remediate is **not** covered by this safe harbour.

## No bug bounty (yet)

We do not currently run a paid bug bounty program. We're a small project and
can't staff the triage a bounty deserves. What we can offer is a prompt,
respectful response and public credit. We'll revisit paid bounties as the
project grows.

## Hall of fame

Researchers who have responsibly disclosed valid issues to Ludi will be
listed here, with their permission.

_(None yet — be the first.)_
