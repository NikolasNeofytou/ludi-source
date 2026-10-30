# ADR-0007 — Design system lives in `@ludi/ui` as the source of truth

**Status:** Accepted
**Date:** 2026-04-21
**Deciders:** Solo founder

## Context

The Pitch Cyprus HTML prototype established a visual language: Mediterranean tokens, Fraunces + SF + JetBrains Mono typography, Chip / Button / Avatar / LevelBars / Rating / PitchIllustration primitives, a full bilingual copy set, and SVG-based icon library.

Ludi will render the same visual language across at least three surfaces:
- The mobile app (React Native, iOS + Android).
- A future admin web tool (Next.js, web DOM).
- A future pitch-owner dashboard (Next.js, web DOM).

Without a shared package, each surface would drift: tokens forked, icons redrawn, Button restyled, copy mistranslated differently.

Constraint: in 2026, React Native and React-DOM have divergent APIs (`<View>` vs `<div>`, `StyleSheet` vs CSS), but they share JSX, React, and TypeScript. Cross-platform component libraries (e.g. Tamagui, Solito) exist but come with dependency and learning-curve costs.

## Decision

Create `packages/ui` as a **React Native-first design system package**, with:

- `tokens.ts` — colour palettes, spacing scale, typography metadata. Framework-agnostic (plain TS).
- `types.ts` — domain types (`Pitch`, `Match`, `MatchResult`, `AppUser`).
- `copy.ts` — EN + GR copy strings (sources of truth for i18n resources).
- `icons.tsx` — icon set using `react-native-svg`. RN-only for now.
- `primitives.tsx` — `Chip`, `Button`, `Avatar`, `LevelBars`, `Rating` as RN components using `Pressable` / `View` / `Text`.

**When we build the admin web tool**, we will create `packages/ui-web/` with the same component API but web DOM internals, sharing `tokens.ts`, `types.ts`, and `copy.ts` verbatim from `@ludi/ui`. Not evaluating cross-platform libraries until then.

## Consequences

### Positive
- Tokens, types, and copy: one definition, ever. Zero drift.
- Mobile app and future admin web share 40% of the package for free (data layer).
- Component primitives ported once, then iterated per-surface if needed.
- Adding a new theme variant (e.g. dark mode) is a single edit to `tokens.ts`.
- `@ludi/ui` is a private workspace package — no publishing, no versioning friction.

### Negative
- **Components are RN-only for now.** When we need the web admin, we'll either:
  (a) reimplement primitives in `ui-web/` sharing tokens/types,
  (b) adopt a cross-platform stack (Tamagui / Solito / Unistyles) — requires migration.
- Design drift possible between RN and future web implementations of the same component. Mitigation: tokens + a shared visual audit checklist.

### Neutral
- Package exports use path-less barrel (`main: "./src/index.ts"`). TypeScript resolves directly; no build step needed inside the monorepo.

## Alternatives considered

### Tamagui from day one
Cross-platform from a single codebase. Rejected: heavy abstraction, steeper debugging, historical flakiness during Expo upgrades, requires a Babel plugin that conflicts with some RN tooling. The cost of running two small UI packages is lower than the cost of fighting Tamagui.

### Unistyles 2
Lightweight, no Babel plugin, cross-platform. Compelling. Rejected for MVP: too young (v2 released 2024, ecosystem still catching up); revisit when we build the web admin.

### shadcn/ui (copy-paste components)
Gold standard for web. Rejected: web-only, no RN counterpart.

### Write the whole thing inline in `apps/mobile`
Simpler now. Rejected: locks us into one-surface thinking; re-factoring cost later is much higher than the discipline cost of a shared package today.

## Follow-ups

- When starting the admin web tool, decide between:
  - `packages/ui-web/` with parallel components → lower initial cost, risk of drift
  - Migration to Tamagui / Unistyles → higher cost, true write-once
- Revisit once the admin web tool is actually needed (estimate: Stage 3, ~month 4–5).
- Document design token usage in `docs/ui/` (Phase 5).
