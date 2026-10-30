# Ludi

> _Ludi_ — Latin for "games". A Playtomic-style app for discovering and booking football pitches across Cyprus, with matchmaking, results, and teammate ratings.

Cities: Nicosia · Limassol · Larnaca · Paphos · Ayia Napa.
Pitch types: 5-a-side, 7-a-side, 11-a-side.
Languages: English + Ελληνικά.

## Status

**Stage 2 — MVP (in flight).** Booking loop is live end-to-end on local + staging. As of 2026-05-27:

- **M1 — Local end-to-end booking** ✅ stripe-webhook + get_available_slots RPC + Larnaca seed + pg_cron cleanup + pgtap RLS suite (5/5).
- **M2 — Mobile happy path** ✅ phone OTP + Discover + pitch detail + booking flow + bookings list (5/5).
- **M3 — Cancel + admin basics** ✅ cancel-booking + admin Next.js app + refund Edge Function + UI, pitch verify/deactivate, GMV dashboard (9/9).
- **M4 — Production posture** in flight — #20 Apple/Google/magic-link auth this week.
- **19/35 commits landed.** See [docs/stage-2-commit-plan.md](docs/stage-2-commit-plan.md) for the ledger and [docs/plans/2026-05.md](docs/plans/2026-05.md) for the active month.

Stage 2 ship target: 2026-06-30 stretch / early July realistic.

## Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Mobile**: React Native 0.81 + Expo SDK 54 + expo-router 6 (iOS + Android from one codebase)
- **Backend**: Supabase (Postgres + Auth + Storage + Realtime)
- **Payments**: Stripe (Stage 2+)
- **Maps**: Mapbox (Stage 4+)
- **Language**: TypeScript everywhere

## Layout

```
ludi/
├── apps/
│   ├── mobile/          # Expo app — iOS + Android
│   └── admin/           # Next.js app — internal admin dashboard (Stage 2)
├── packages/
│   ├── ui/              # Design tokens, icons, primitives (React Native)
│   ├── config/          # Shared tsconfig, prettier, eslint
│   ├── i18n/            # Translation JSON (future split from ui/COPY)
│   └── supabase/        # DB schema, migrations, seed
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Develop

Prereqs: Node 20+, pnpm 9+ (`corepack enable`), Xcode (iOS sim) or Android Studio.

```sh
pnpm install
cp apps/mobile/.env.example apps/mobile/.env
pnpm mobile dev
```

- Press `i` for iOS simulator, `a` for Android, or scan the QR with Expo Go.
- Toggle EN/ΕΛ inside the Discover screen.

### Admin (Next.js)

```sh
cp apps/admin/.env.example apps/admin/.env.local
pnpm admin dev
```

- Runs on `http://localhost:3001`.
- `/` requires a Supabase session, otherwise redirects to `/login`.
- Admin role enforcement (M3 #14) and real admin features (#15+) build on this scaffold.

## Roadmap

- **Stage 1 — Foundation** ✅ (this commit)
  Monorepo + design system + Expo shell + i18n
- **Stage 2 — MVP**
  Real Supabase schema, auth (phone OTP + Apple/Google), Discover + Pitch Detail + Stripe checkout
- **Stage 3 — Social & matchmaking**
  Open matches, join flow, results entry, teammate ratings, split payment
- **Stage 4 — Growth**
  Mapbox, deep-link invites, push notifications, pitch-owner dashboard
- **Stage 5 — Scale**
  Reviews, waitlists, recurring matches, tournaments

## Origins

The visual design originates from `Pitch Cyprus.html`, an HTML/React prototype exported from Claude Design. Tokens, copy, and primitive components here are ports of that prototype.

## License

Private. All rights reserved until further notice.
