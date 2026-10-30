# ADR-0020 — Venue coordinates: a map picker on Leaflet + OpenStreetMap

**Status:** Accepted
**Date:** 2026-08-22
**Deciders:** Solo founder
**Relates to:** [ADR-0008](0008-maps-mapbox-deferred.md) (Mapbox for the
player map view, Stage 4) — this does **not** supersede it, see §Scope.

## Context

M6 #41e shipped venue creation and editing in `apps/admin`, and #41d gave
venue owners their own logins (ADR-0019). The form asked for **latitude and
longitude as two number fields**.

That is the wrong control for the job, for two reasons.

A venue owner does not know their coordinates. Asking for them is asking a
question the person cannot answer, which pushes them to guess or to leave it
to us — and "leave it to us" is what happened: Camares Futsal, the first real
venue, was created on 2026-08-22 with coordinates an agent had inferred from
the phrase "Kamares near the aqueduct". They were **~700 m out**.

And the error is silent. `34.9186` and `34.8186` are both plausible-looking
numbers 11 km apart. There is no validation that can catch it, because both
are valid coordinates in Cyprus. Meanwhile *Open in Maps* is a shipped Stage 2
feature, so a wrong pin does not surface as a data-quality problem — it
surfaces as a player standing outside the wrong building.

## Decision

**Replace the two number inputs with a map picker: Leaflet + OpenStreetMap
tiles, with Nominatim for address search.**

Three ways to set the same value, all writing the same two form fields:

1. **Drag the pin**, or click anywhere on the map.
2. **Search an address** — results come from Nominatim, restricted to Cyprus.
   On the edit page the search box is pre-filled from the venue's own address,
   so correcting a location is one click.
3. **Type the numbers**, unchanged, for when someone has exact coordinates.

The `lat` / `lng` inputs are **kept, not replaced** — same names, same
validation, same server action. The map is a better way to set existing
fields, so `createVenue` and `updateVenue` did not change at all.

## Scope — why this is not ADR-0008

ADR-0008 chose **Mapbox** and it stands. It decided the **player-facing map
view**: brand-styled tiles matching the Mediterranean palette, pins,
user-location, "pitches near me". That is Stage 4, its trigger has not fired
(≥5 pitches per city AND user demand AND a second city), and nothing here
changes it.

This is a different surface with different requirements:

| | Player map (ADR-0008) | This picker |
|---|---|---|
| Audience | every player | Ludi team + venue owners |
| Surface | React Native app | Next.js admin |
| Volume | every session | a handful per venue, once |
| Cares about brand styling | yes, heavily | no |
| SDK | `@rnmapbox/maps` | would be Mapbox GL JS — a different integration anyway |

So the ADR-0008 decision does not transfer for free: the RN wrapper is not the
web library, and adopting Mapbox here would mean an account, an API token in
the admin's environment, and what ADR-0008 itself calls *"the only paid-tier
external service we'd add"* — for an internal data-entry aid used a few times
per venue.

Leaflet + OSM needs no account, no token, no billing relationship, and no
secret in `apps/admin`. For a tool whose entire job is "put the pin on the
building", that is the right trade.

## Consequences

### Positive
- The question becomes answerable: an owner recognises their building on a map
  even when they cannot produce coordinates.
- Errors become visible. A pin in the sea is obvious; `33.5` versus `33.6` is
  not.
- No credential, no cost, no vendor account. Nothing to provision before the
  admin works on a new machine.
- The server action, validation and schema are untouched, so the change is
  contained to one component and the form that renders it.

### Negative
- **Nominatim is a free community service** with a usage policy: roughly one
  request per second, and it asks for identification. Search is therefore
  on-submit rather than as-you-type, and results are capped at 5 and
  restricted to Cyprus. If this ever runs at volume it needs either a
  self-hosted instance or a paid geocoder — but venue onboarding is not a
  high-volume path.
- **OSM coverage of small Cypriot businesses is thin.** Searching "Camares
  Futsal" returns nothing; searching "Kamares, Larnaca" returns the district.
  So search gets you the neighbourhood and the drag gets you the building —
  which is why both exist and why neither alone would have been enough.
- Two mapping stacks if ADR-0008's player map is ever built: Mapbox in the app,
  Leaflet in the admin. Acceptable — they share no code and no styling, and
  the alternative is paying for a vendor in a tool that does not need one.
- `leaflet` + `react-leaflet` are new dependencies in `apps/admin`. Both are
  browser-only, so the picker is a dynamic import with `ssr: false`.

### Neutral
- Coordinates remain `geography(point, 4326)` per ADR-0008 — vendor-agnostic,
  and unchanged by this decision. PostGIS stores X as longitude, the reverse of
  how the numbers are spoken; the picker's round-trip was verified against
  Camares Futsal so a transposition would have been caught.

## Alternatives considered

### Mapbox GL JS
Consistent with ADR-0008's vendor. Rejected for this surface: needs an account
and a token for an internal tool, and the ADR's own reasoning for choosing
Mapbox — brand-matched styling for players — does not apply to a data-entry
aid.

### Google Maps Places autocomplete
The best geocoding of the three, and most likely to actually know where
"Camares Futsal" is. Rejected: needs a billing account and an API key, and the
Places API is the expensive one. Worth revisiting if owner-entered locations
prove consistently wrong.

### Keep the number fields, add a "preview on map" link
Cheapest. Rejected: it verifies a value the owner already had to invent. The
problem is producing the coordinate, not checking it.

## Follow-ups

- ~~Camares Futsal sits on the Kamares district centroid, not the building.~~
  **Done 2026-08-22.** The pin was dragged onto the building and saved through
  the picker, moving it **615 m** to `34.920880, 33.604131`. Read back from
  production afterwards: the value persisted and `lat`/`lng` came back the
  right way round, so the `geography(point, 4326)` round-trip is confirmed on
  real data and not just on the create path.

  Worth recording *why* the drag was the only route. Neither search nor any
  amount of tooling could place this pin: Nominatim returns nothing for
  "Camares Futsal", and an Overpass sweep of the area found **19 mapped
  facilities within 1.5 km — none named Camares, none tagged `sport=futsal`**,
  with a wider 4 km search for the name or the tag returning zero. The venue is
  simply not in OpenStreetMap. That is the negative consequence above meeting
  its first real case, and it argues the picker's three input paths are not
  redundancy: for this venue, two of the three could not have worked.
- If owners routinely land the pin badly, revisit Google Places rather than
  adding validation — there is no rule that distinguishes a wrong coordinate
  from a right one.
