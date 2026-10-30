# ADR-0029 — Home mini-map ships now on react-native-maps; ADR-0008's "no client-side maps" narrows to "no map *screen*"

**Status:** Accepted — reversible; the mini-map is one leaf component and
one native dependency, and the schema was always vendor-neutral
**Date:** 2026-09-01
**Deciders:** Solo founder
**Supersedes:** — (amends the scope of [ADR-0008](0008-maps-mapbox-deferred.md))
**Superseded by:** —

## Context

ADR-0008 deferred the map *tab* — a full-screen, gesture-driven browse
surface with clustering and spatial queries — to Stage 4, and picked
Mapbox for it when it comes. That decision was about a screen we didn't
need yet, priced at a vendor integration we didn't want to carry.

What the home screen wants today is much smaller: a static-feeling
mini-map card under the filter pills that shows *where the partner
venues are* — pins only, no gestures, no clustering, no "near me". The
data side has been ready since 2026-08-22: `venues.coords` is NOT NULL
PostGIS, and the `lat`/`lng` computed columns are already granted to
the mobile roles (migration `20260822000004`). The Discover query was
even fetching `coords` and throwing it away.

## Decision

Ship the home mini-map on **react-native-maps 1.20.1** (the Expo
SDK 54-vetted version):

- **iOS renders Apple Maps** — zero API key, zero billing, works in the
  next build. `mutedStandard` keeps the tiles close to the Chalk &
  Aegean palette.
- **Android stays gated off** (`MAP_AVAILABLE` in
  `apps/mobile/src/components/HomeMapCard.tsx`) until a Google Maps
  Android SDK key lands in `app.json → android.config.googleMaps.apiKey`.
  The key is free (mobile-native map loads aren't billed) but only the
  founder can provision it in Google Cloud console.
- The card renders only when the active city's visible venues have
  coordinates; markers tap through to `/venue/[id]`. No gestures — the
  ScrollView owns scrolling.

ADR-0008 is *not* superseded: the Stage 4 map screen and its trigger in
FUTURE.md stand. What changes is its blast radius — "no client-side
maps" (ARCHITECTURE.md) becomes "no map screen". If/when the Stage 4
screen ships on Mapbox, the mini-map either migrates to the same vendor
or stays as-is; nothing in the schema or the card's props cares.

## Consequences

- **Native dependency**: every dev build after this needs the new pod —
  re-run `pod install` in `apps/mobile/ios` (the `ios/` dir is
  gitignored, so each machine regenerates it). Same cost class as
  Sentry (ADR-0010).
- Android beta users don't see the card until the key ships — the home
  screen is unchanged for them, not degraded.
- Two map vendors may briefly coexist at Stage 4 (Apple mini-map +
  Mapbox screen). Accepted: the mini-map is ~130 lines and swappable.
- The Discover query now fetches `lat, lng` instead of dead `coords`
  EWKB — strictly less wire weight.
