# ADR-0006 — TypeScript strict mode + Zod for runtime validation

**Status:** Accepted
**Date:** 2026-04-21
**Deciders:** Solo founder

## Context

Ludi's data crosses multiple trust boundaries: mobile app → Supabase → Edge Functions → Stripe webhooks → back. Each hop is a potential source of malformed data. TypeScript types at compile time don't protect us from:

- A Stripe webhook payload with an unexpected field shape (Stripe adds fields silently).
- A user entering emoji in their name field (iOS keyboard supports them by default).
- A malformed row in the DB from a manual migration.
- A race condition producing a null where we expected a value.

Solo dev, 3-month deadline. I cannot afford runtime bugs in payments code. But I also cannot afford to write defensive code around every variable access.

## Decision

Two complementary rules:

1. **TypeScript `strict: true`** across the monorepo (already enabled in `tsconfig.base.json`, plus `noUncheckedIndexedAccess` and `noImplicitOverride`). No `any` in committed code; explicit `unknown` where type is genuinely unknown.

2. **Zod for every data boundary**:
   - User input (forms, URL params).
   - Supabase query results (parsed via `.parse()` after the `.select()`).
   - Stripe webhook payloads (before touching `event.data.object`).
   - Env vars (validated at module load, fail fast).

Domain types live in `@ludi/ui/src/types.ts`; Zod schemas colocated or in a future `packages/schemas/`.

## Consequences

### Positive
- Compile-time safety covers ~80% of bugs; Zod covers the remaining runtime surface.
- Zod errors are structured — easy to surface as user-facing messages ("name required, 2–50 chars").
- `z.infer<typeof schema>` gives us types for free; one source of truth per boundary.
- Stripe payload evolution doesn't silently break us — we'll see the schema violation before we read a stale field.

### Negative
- Small runtime cost per `.parse()` call. Irrelevant at our scale; skip for hot paths if profiler says so.
- Schema duplication risk if we define both a TypeScript interface AND a Zod schema — convention: **Zod first, infer the type**.
- Some Supabase query types are awkward to Zod-ify (generic joins). Accept raw types there, Zod at the API / UI boundary.

### Neutral
- `strict: true` is non-negotiable in 2026 — anything less is professional negligence.

## Alternatives considered

### Valibot
Similar to Zod, smaller bundle. Rejected: Zod has bigger community, richer ecosystem (e.g. `zod-to-openapi`, `@hookform/resolvers/zod`). Revisit if bundle size becomes a constraint.

### io-ts
Battle-tested, functional style. Rejected: steeper learning curve, `fp-ts` dependency is overkill for our needs.

### No runtime validation, trust TypeScript + tests
Rejected: TypeScript types evaporate at runtime. A Stripe webhook with a changed field will typecheck fine and crash in production.

### `yup` or `joi`
Older validation libraries. Rejected: weaker TypeScript integration than Zod.

## Follow-ups

- Add a pre-commit hook that fails on `any` in staged files (`eslint --rule '@typescript-eslint/no-explicit-any: error'`).
- Write a Zod schema for the env vars at `apps/mobile/src/lib/env.ts` and import it from `supabase.ts`.
- Consider a `packages/schemas/` package in Stage 2 when schemas start to be shared between mobile, edge functions, and admin web.
