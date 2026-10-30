# ADR-0004 — Payments: Stripe + Stripe Connect Express

**Status:** Accepted
**Date:** 2026-04-21
**Deciders:** Solo founder

## Context

Ludi is a marketplace: players pay, pitch owners receive payouts, Ludi takes a 10% cut. This is a three-party flow ("charge and transfer" in payments lingo), not a simple checkout.

Requirements:
- Accept EUR via Visa / Mastercard, **Apple Pay**, **Google Pay**, SEPA debit (later).
- Automatic payouts to pitch-owner bank accounts (Cypriot IBANs).
- Automatic withholding of Ludi's 10% take rate.
- Handle refunds (full, partial) including clawback from already-paid-out owners (edge case).
- Strong Customer Authentication (SCA) for EU cards — non-negotiable.
- PCI-compliant without Ludi ever touching raw card data.
- Onboarding flow for pitch owners that doesn't require me to collect IBANs / ID docs myself.

## Decision

Use **Stripe Payments** with **Stripe Connect Express** for pitch-owner onboarding.

- Each venue's `venues.stripe_account_id` maps to a Stripe Connect Express account (collected during onboarding via Stripe-hosted flow).
- Bookings use `PaymentIntent` with `application_fee_amount = floor(total × take_rate_bps / 10000)` and `transfer_data[destination] = stripe_account_id`. Stripe splits funds automatically.
- Mobile SDK: `@stripe/stripe-react-native` for Payment Sheet (card, Apple Pay, Google Pay in one UI).
- Webhooks (via Supabase Edge Function) handle `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `account.updated`.

## Consequences

### Positive
- Stripe handles PCI, SCA (3D Secure 2), Apple Pay provisioning, Google Pay tokens. Ludi never sees raw PANs.
- Connect Express provides hosted onboarding — Maria does Stripe's KYC flow herself, founder never touches her IBAN.
- Automatic payouts on Stripe's schedule (default weekly); configurable per-account.
- Application fee on the same `PaymentIntent` means no separate transfer bookkeeping.
- Refund with `refund_application_fee: true` reverses Ludi's cut too — correct accounting out of the box.
- EU pricing: 1.5% + €0.25 for EEA cards (~€0.85 fee on a €40 booking, a cost we absorb).

### Negative
- Stripe Connect Express is more complex than Standard Stripe integration. Expect ~1 week of first-time implementation.
- Platform liability: if a pitch owner disputes-and-flees, Ludi is on the hook for the negative balance. Mitigation: hold a small rolling reserve per-owner (Stripe supports this).
- Cypriot SMB onboarding to Stripe can stall on document verification (ID, proof of address). Have a hand-holding playbook.
- Refunding a booking after owner payout creates a negative balance on their Stripe account; Stripe claws back from next payout. Edge case but real.
- Vendor lock-in is meaningful — migrating off Stripe means re-onboarding every pitch owner.

### Neutral
- Stripe Tax handles EU VAT for Ludi's take rate (we charge VAT on the 10% fee, not on the booking itself — pitch owner remains merchant of record on the €40).
- Requires Cyprus business entity for live mode (sole trader OK; LLC preferred for liability). Ludi starts as sole trader, flips to LLC at ~€5K MRR.

## Alternatives considered

### PayPal / Braintree
Widely trusted in Cyprus. Rejected: Connect-style marketplace flows are weak; Apple Pay / Google Pay integration is clunkier; PayPal branding at checkout increases drop-off.

### Revolut Business + manual splits
Low fees. Rejected: no platform-marketplace API — we'd have to receive all funds centrally, manually split and payout, which creates regulatory exposure (money-remittance licensing territory) and operational burden.

### Adyen
Similar feature set to Stripe. Rejected: sales-led onboarding (no self-serve), €10K+/month minimums at small scale, overkill for MVP.

### Local Cypriot acquirer (JCC)
Lowest card-present fees in Cyprus. Rejected: not a marketplace solution; would require us to be merchant-of-record for every booking, owning chargeback risk for pitch no-shows. Terrible business model fit.

### Pay pitch owners outside the platform (Ludi takes booking fee via card, owner collects cash on site)
Simple. Rejected: defeats the marketplace value prop, breaks the "frictionless booking" UX, exposes us to no-show fraud, can't scale.

## Follow-ups

- Prototype the Connect Express onboarding flow in week 1 of Stage 2 — single biggest integration risk.
- Set up Stripe webhook signing verification (critical security — any unsigned webhook is a vector).
- Write a **payments runbook** for common scenarios: failed payments, refund stuck, payout delayed, disputed charge. Live in `docs/runbooks/` (future folder).
- Monitor Stripe Balance dashboards weekly; reconcile monthly against Ludi's booking ledger.
- Stripe fees are a real cost — 1.5% of GMV at ~€55K/mo GMV = €825/mo. This is the single biggest variable cost after it scales.
