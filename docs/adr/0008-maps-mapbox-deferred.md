# ADR-0008 — Maps: Mapbox (deferred to Stage 4)

**Status:** Accepted
**Date:** 2026-04-21
**Deciders:** Solo founder

## Context

The prototype shows a stylised Cyprus island with €-priced pins. For the real app, we need actual map tiles with interactive pins, current-location awareness, search, and eventually direction deep links.

Three options dominate the mobile map market: **Apple Maps** (iOS-only), **Google Maps** (cross-platform, paid), **Mapbox** (cross-platform, free tier, heavily customisable).

The MVP scope (per Phase 1) explicitly **cuts map view**. It is a Stage 4 "Could Have". However, recording the intended choice now:
- Prevents re-debate in 6 months.
- Lets us design the data model to store coords in a map-agnostic format (WGS-84 lat/lng on pitches).
- Shapes the "address" handling on pitch onboarding.

## Decision

**Use Mapbox GL for maps in Stage 4.** Custom style sheet matching the Mediterranean palette (terracotta landmass, sea blue, olive highlights). Integrate via `@rnmapbox/maps` (the maintained RN wrapper).

Store pitch coordinates as `geography(point, 4326)` in Postgres (PostGIS-enabled via Supabase). This is decoupled from the map vendor — a future pivot to Google Maps would need zero schema changes.

## Consequences

### Positive
- Mapbox's custom style editor lets us match the Pitch Cyprus visual language precisely (the prototype's stylised island set the expectation).
- Free tier: 50K map loads/mo + 100K geocoding calls/mo. Comfortable for MVP+Stage 3.
- Cross-platform — same tiles, same look on iOS + Android + web (future admin).
- `geography(point)` + PostGIS gives us powerful spatial queries: "pitches within 5km of me", "pitches inside Larnaca boundary polygon".
- Map vendor switch is a rendering concern, not a data concern.

### Negative
- Mapbox iOS SDK is heavy (~15MB added to app size); accept this cost at Stage 4, not MVP.
- `@rnmapbox/maps` requires a config plugin and native rebuild (EAS Build); adds ~10 min to first build.
- Pricing cliff at scale: beyond free tier, $0.60 per 1,000 map loads. At 3K MAU × 10 sessions/mo with a map, we'd hit ~€18/mo — acceptable.
- Custom styles need to be designed and maintained — small asset in Mapbox Studio, but not free time-wise.

### Neutral
- Mapbox geocoding sufficient for Cyprus addresses (tested informally; OSM data in Cyprus is of reasonable quality).

## Alternatives considered

### Apple Maps (via `react-native-maps`)
Native-feel, no API cost, integrated on iOS. Rejected: Android fallback is Google Maps (which has its own pricing), introducing divergent UX between platforms. Customisation on Apple Maps is limited.

### Google Maps (via `react-native-maps`)
Most recognised, best place data globally. Rejected: free tier is small and expires after $200/mo credit; Cyprus-specific data no better than Mapbox; weak custom-styling options vs Mapbox Studio.

### OpenStreetMap raw tiles (self-hosted)
Free at scale. Rejected: infrastructure burden (tile servers, CDN), no hosted geocoding, no directions API. Not realistic for solo dev.

### Skip maps entirely, use list view forever
Actually on the table for MVP. Rejected for Stage 4+: maps drive discovery for new users who don't know pitch names; removing friction on "what's near me" is a meaningful conversion lever.

## Follow-ups

- Design `pitches` table with `coords geography(point, 4326)` from day one (Phase 3).
- During pitch onboarding, use Mapbox's geocoding API to translate an address into coords — good DX for the founder doing onboarding via admin.
- When activating map view, prototype a custom Mapbox style in the terracotta/olive/sea palette — small design project.
- If Mapbox pricing becomes painful at ~10K MAU, evaluate Protomaps (open-source self-hostable Mapbox replacement).
