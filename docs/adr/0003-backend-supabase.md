# ADR-0003 — Backend: Supabase (Postgres + Auth + Storage + Realtime)

**Status:** Accepted
**Date:** 2026-04-21
**Deciders:** Solo founder

## Context

Ludi needs:
- **Relational DB** for venues, pitches, users, bookings, matches. Strong consistency, ACID, unique constraints, range constraints (for no-double-booking).
- **Auth** with phone OTP + Apple OAuth + Google OAuth + email magic link (per Phase 1).
- **File storage** for pitch hero images (one per pitch in MVP, user uploads later).
- **Realtime** for live slot availability and (Stage 3) open-match fills.
- **Row-level security** so client-side queries are safe; the mobile app calls the DB directly without a custom API layer.

Constraints: solo dev, 3-month deadline, minimal ops budget. Cannot afford to run Kubernetes, write a REST API, and manage auth providers in parallel.

EU data residency is required (Cypriot users, GDPR).

## Decision

Use **Supabase** for the full backend: managed Postgres 15, Supabase Auth, Supabase Storage, Supabase Realtime. Host in the **EU-West-2 (Frankfurt)** region for GDPR proximity. Mobile app talks to Supabase directly via `@supabase/supabase-js`; RLS policies replace a hand-rolled API for 80% of operations. The remaining 20% (Stripe webhooks, admin overrides, cross-table business logic) live in Supabase Edge Functions (Deno).

## Consequences

### Positive
- Single vendor for DB + Auth + Storage + Realtime — one dashboard, one billing, one SDK.
- Postgres is _real_ Postgres, not a dialect. Portable if we ever migrate.
- RLS is genuinely production-ready when policies are written carefully.
- Free tier (500MB DB, 50K MAU Auth) covers validation phase; Pro tier ($25/mo) covers ~first year.
- Local dev via `supabase start` (Docker) mirrors production exactly.
- Migrations are plain SQL in `packages/supabase/supabase/migrations/`, committed to git.

### Negative
- RLS bugs are security bugs. Every policy needs dedicated thought and tests (see Phase 7).
- Edge Functions use Deno, not Node. Slightly different ergonomics; npm packages sometimes need adaptation.
- Vendor lock-in on Auth (users' Supabase auth IDs would need migration if we leave). Data is portable — Postgres dump.
- Supabase pricing scales per-project; multi-tenant shared DB is non-trivial if we ever need it.
- Realtime uses WAL replication under the hood; has scaling limits (~hundreds of concurrent channels on Pro). Fine for MVP.

### Neutral
- Supabase is a YC-backed Series B company (as of 2026); business risk acceptable, exit paths exist (self-host Supabase, or migrate to raw Postgres + Auth.js).

## Alternatives considered

### Firebase (Firestore + Firebase Auth)
Battle-tested, rich SDK, generous free tier. Rejected: NoSQL is a bad fit for relational booking / matching queries (joins, range constraints, transactions). Firebase Auth has weak phone OTP outside US/EU core. Google's track record of killing products is a real risk.

### Custom backend: Node + Fastify + Postgres + Auth.js + S3
Maximum control. Rejected: 4–6 weeks of plumbing before writing business logic. Not viable on a 3-month solo deadline. Revisit only if Supabase constraints actually bind.

### AWS (RDS + Cognito + S3 + AppSync)
Enterprise-grade, infinite scale. Rejected: ops overhead is an order of magnitude higher than Supabase. Cognito's DX is painful. Cost at our scale is ~5× Supabase.

### Hasura + self-hosted Postgres
GraphQL-first, good RLS. Rejected: extra abstraction layer, another service to run, no integrated auth.

### PlanetScale (MySQL) + Clerk (Auth) + UploadThing (Storage) + Pusher (Realtime)
Best-of-breed approach. Rejected: three vendors to integrate, three bills, three outage dependencies. The coherence of Supabase wins for a solo dev.

## Follow-ups

- Write RLS policy tests using `pgtap` (Phase 7).
- Set up database backups (Supabase auto-backups daily on Pro; add supplementary `pg_dump` to S3 weekly).
- Evaluate Supabase Edge Functions cold-start latency before committing critical paths to them; fallback: use Vercel/Cloudflare Workers.
- Revisit if MAU exceeds 50K (Supabase Pro limit); plan is Team tier ($599/mo) or self-host.
