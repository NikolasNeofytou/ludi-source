# ADR-0002 — Mobile stack: Expo SDK 54 + React Native + expo-router

**Status:** Accepted
**Date:** 2026-04-21
**Deciders:** Solo founder

## Context

Ludi must ship for iOS **and** Android. Players in Cyprus split roughly 60/40 iOS/Android (higher iOS skew than EU average due to purchasing power). Shipping native-only for either platform excludes half the market.

Solo developer, 3-month MVP deadline. No team to split by platform. Design exists as a React prototype (Pitch Cyprus.html) — reusing that investment is a multi-week head start.

The mobile toolchain must also give us:
- Over-the-air JS updates (bug fixes without App Store review)
- Push notifications (Stage 3)
- Deep links (Stage 3)
- Apple Pay and Google Pay (MVP requirement)
- App Store submission without learning native build chains

## Decision

Use **Expo SDK 54** + **React Native 0.81** + **expo-router 6** (file-based navigation). Managed workflow, not bare. EAS Build for binary builds; EAS Submit for store uploads.

_(Initially scaffolded on SDK 52 during Stage 1; upgraded to SDK 54 on the same day to match current Expo Go on the App Store. pnpm monorepo required `node-linker=hoisted` in `.npmrc` so Expo's transitive imports — whatwg-fetch, @babel/runtime helpers — resolve correctly.)_

## Consequences

### Positive
- Single JS/TS codebase for iOS + Android.
- Direct reuse of the HTML prototype's tokens, copy, and primitive components.
- Expo Router gives file-based routing + typed routes, matching our `app/(tabs)/` structure.
- `expo-secure-store`, `expo-localization`, `expo-font`, `expo-notifications` handle the platform integrations we need.
- EAS Build is one command to ship a signed IPA / AAB; no Xcode config spelunking.
- OTA updates via `expo-updates` (not used in MVP to keep scope tight, but available).
- New Architecture (Fabric + TurboModules) enabled from day one — future-proof.

### Negative
- React Native has visual and performance gaps vs SwiftUI / Jetpack Compose; most matter less than the solo-dev velocity gain.
- Some native SDKs (Stripe, Mapbox) need config plugins; debuggable but adds friction.
- Expo-managed means no arbitrary native modules without an EAS dev client build — unlikely to bite us in MVP.
- Expo upgrades (quarterly) require coordinated dep bumps; not free.

### Neutral
- Fonts (Fraunces, JetBrains Mono) load via `expo-font` at app start. Splash screen hides until fonts + i18n ready.

## Alternatives considered

### Flutter
Strong candidate. Single codebase, excellent performance, rich widget library. Rejected: design already exists in React (not Dart); RN has the richer ecosystem for Stripe / Supabase / Mapbox; switching cost not justified.

### Native iOS (SwiftUI) + Native Android (Kotlin)
Best user experience possible. Rejected: 2× the work for a solo dev on a 3-month deadline; 2× the release process; no way to reuse the React prototype.

### Bare React Native (no Expo)
More control, no Expo constraints. Rejected: you pay for that control with Xcode + Gradle + pod install time every week. Expo handles 95% of config correctly; the 5% you lose is not worth losing for MVP.

### React Native + React Navigation (not expo-router)
RN's historical navigation choice. Rejected: expo-router is the future direction of the Expo/RN community, gives us typed routes + file-based structure + web-compatible same-codebase at ~zero extra cost.

### Progressive Web App
Zero app-store friction. Rejected: iOS PWA support is still second-class (no push, no Apple Pay, no home-screen install prompt). For a payments-driven app in 2026, native shell wins.

## Follow-ups

- Revisit on each Expo SDK release (quarterly); SDK 53 expected mid-2026.
- If Stage 3 matchmaking needs live chat, evaluate Expo + Supabase Realtime vs a dedicated messaging vendor.
- Bare workflow migration path stays open; we're not locked in.
