# ADR-0001 — Monorepo with pnpm + Turborepo

**Status:** Accepted
**Date:** 2026-04-21
**Deciders:** Solo founder

## Context

Ludi will have at least three deployable artifacts over its lifetime: a mobile app for players (iOS + Android), an admin web tool for the founder, and eventually a pitch-owner web dashboard. All three share: design tokens, copy (EN/GR), domain types, Supabase client config.

Two failure modes to avoid:
- **Polyrepo drift** — tokens in three repos, three definitions, three subtle divergences, one ugly rebrand.
- **Monorepo friction** — installing the mobile app's 500MB of deps just to edit a marketing page.

Team size: one. Zero budget for tooling. Needs to Just Work on macOS with minimal ceremony.

## Decision

Use a **pnpm workspace monorepo** with **Turborepo** for task orchestration and caching. Layout:

```
ludi/
├── apps/          # deployable artifacts (mobile, later: admin-web)
└── packages/      # shared code (ui, config, i18n, supabase)
```

## Consequences

### Positive
- Single `pnpm install` at root; workspace protocol (`workspace:*`) makes `@ludi/ui` a live symlink into `apps/mobile`.
- One source of truth for design tokens, copy, types.
- Turborepo caches `typecheck` / `lint` / `build` per-package; only rebuilds what changed.
- Adding the admin web app later is a new folder + `package.json`, not a new repo.

### Negative
- Metro (React Native's bundler) needs monorepo-aware config; easy to misconfigure. Already handled in `apps/mobile/metro.config.js`.
- pnpm's strict hoisting can surface peer-dep mismatches that npm's loose hoisting would hide. This is actually a feature, not a bug — forces correctness.
- Expo's managed workflow historically assumed single-package; check compatibility on every Expo SDK upgrade.

### Neutral
- CI will need a pnpm-aware cache step (trivial).
- Node version pinned via `.nvmrc` (Node 20).

## Alternatives considered

### Polyrepo (separate repos per app)
Simpler mental model, standard GitHub workflow. Rejected: at our size, coordination cost of syncing shared code across three repos exceeds the cost of monorepo tooling. Tokens would drift within a month.

### Yarn Berry workspaces
Comparable capabilities. Rejected: pnpm's strict resolution + disk efficiency (content-addressed store) + better Expo community support make it the lower-risk choice in 2026.

### npm workspaces (no Turborepo)
Simplest option. Rejected: missing build caching means CI minutes balloon as apps are added. Turborepo is ~2 hours of setup for years of saved CI time.

### Nx
More powerful than Turborepo (better graph visualisation, generators). Rejected: higher cognitive load; Nx opinions clash with Expo conventions. Over-engineered for a solo repo.

## Follow-ups

- Revisit if monorepo grows past 4 apps or 8 packages — at that scale, Nx's generators start to pay for themselves.
- If CI becomes slow, enable Turborepo remote caching (Vercel free tier supports this).
