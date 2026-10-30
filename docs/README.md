# Ludi · Documentation

The thinking behind the code. Read this folder before writing features.

Every document here is versioned, PR-reviewed, and linkable from commit messages. If something in the code contradicts a doc, the doc wins or the doc gets updated — not both silently drifting.

## Index

| Status | Doc | What it answers |
|---|---|---|
| ✅ | [VISION.md](./VISION.md) | What Ludi is, who it's for, why now, what winning looks like |
| ✅ | [ARCHITECTURE.md](./ARCHITECTURE.md) | Single layered overview of mobile ↔ Supabase ↔ Stripe; dependency rules |
| ✅ | [CONVENTIONS.md](./CONVENTIONS.md) | Migration / RLS / Edge Function / mobile / i18n authoring rules (living, versioned) |
| ✅ | [FUTURE.md](./FUTURE.md) | Parking lot — WHAT / WHY-NOW / TRIGGER / PHASE for everything deferred |
| ✅ | [JOURNAL.md](./JOURNAL.md) | Techniques + gotchas + workflow patterns (the "future-us cheat sheet") |
| ✅ | [WORKFLOW.md](./WORKFLOW.md) | Morning + wrap session rituals (the `scripts/morning.sh` + `wrap.sh` companion) |
| ✅ | [GLOSSARY.md](./GLOSSARY.md) | Ubiquitous language — pitch vs venue, match vs booking, etc. |
| ✅ | [product/features.md](./product/features.md) | MoSCoW — Must (MVP) / Should (Stage 3) / Could (Stage 4) / Won't |
| ✅ | [product/user-journeys.md](./product/user-journeys.md) | 7 prose journeys (J1–J5 MVP, J6–J7 Stage 3) |
| ✅ | [adr/](./adr/) | 8 Architecture Decision Records (monorepo, Expo, Supabase, Stripe, i18n, TS+Zod, UI package, Mapbox) |
| ✅ | [data-model.md](./data-model.md) | ERD + 11 tables + RLS intent + state machine + index strategy |
| ✅ | [api-contract.md](./api-contract.md) | 7 flows + Zod schemas + 6 Edge Function signatures |
| ✅ | [ui/sitemap.md](./ui/sitemap.md) | Routes, nav flow, data dependencies per screen |
| ✅ | [ui/design-tokens.md](./ui/design-tokens.md) | When to use which token, accessibility, scale |
| ✅ | [ui/design-handoff-v1-polish.md](./ui/design-handoff-v1-polish.md) | Whole-app aesthetic polish spec — diagnosis, token additions, per-screen specs, sequencing |
| ✅ | [apple-testflight.md](./apple-testflight.md) | Apple Developer enrolment + TestFlight checklist — phases, tester routes, friend-invite template |
| ✅ | [infra.md](./infra.md) | 3 environments, CI/CD, backups, monitoring, costs |
| ✅ | [threat-model.md](./threat-model.md) | STRIDE per flow, GDPR, incident response |
| ✅ | [roadmap.md](./roadmap.md) | Stages 1–5 with falsifiable exit criteria per stage |
| ✅ | [stage-2-commit-plan.md](./stage-2-commit-plan.md) | Stage 2 broken into ~35 commits across 5 milestones (the ticking ledger) |
| ✅ | [plans/](./plans/) | Per-month plans — current month is authoritative for week-by-week targets |
| ✅ | [plans/ops-readiness.md](./plans/ops-readiness.md) | What watches prod and what restores it once strangers use the app — gates O1–O11, pairs with `scripts/smoke_prod.sh` |
| ✅ | [plans/beta.md](./plans/beta.md) | The internal-TestFlight beta cut — scope decisions, the five blockers, definition of done |
| ⬜ | metrics.md | North-star funnel, telemetry plan (rolled into infra.md PostHog section for now) |
| ⬜ | business.md | Monetization + legal (rolled into VISION.md + roadmap.md for now; split out when needed) |

Legend: ✅ shipped · 🟡 planned · ⬜ deferred

## How to use this folder

- **Before building a feature:** find the relevant doc, read it, propose changes in the same PR as the code.
- **Before making an architectural change:** write a new ADR. `docs/adr/00XX-title.md`. Never rewrite an old ADR — supersede it with a new one.
- **Before a design review:** open VISION.md. If the idea doesn't serve the vision, it doesn't ship.
- **Before opening a PR in a new area:** skim [CONVENTIONS.md](./CONVENTIONS.md) §the relevant section — it captures the rules that have already been settled.
- **Before parking an idea:** open [FUTURE.md](./FUTURE.md) and add a WHAT/WHY-NOW/TRIGGER/PHASE entry, so re-litigating it later requires a doc change.
- **Lesson-too-small-for-an-ADR:** append a short entry to [JOURNAL.md](./JOURNAL.md).

## Source

The original Phase 0–8 planning pass (2026-04-21) produced VISION, GLOSSARY, features, journeys, ADRs, data-model, api-contract, UI, infra, threat-model, roadmap. The second-wave docs (ARCHITECTURE, CONVENTIONS, FUTURE, JOURNAL) were retrofitted on 2026-05-27 to install the aristophanes-style elite-dev discipline retroactively — see [JOURNAL.md](./JOURNAL.md) for the lessons that drove each one.
