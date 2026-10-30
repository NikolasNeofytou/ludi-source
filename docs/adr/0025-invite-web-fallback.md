# ADR-0025 — The invite link's web fallback is a server-rendered preview, not a client app

**Status:** Accepted — reversible (delete one route and one lib file; the
share string reverts in one line)
**Date:** 2026-08-29
**Deciders:** Solo founder
**Supersedes:** —
**Superseded by:** —

## Context

The shared fixture (#118) made the invite link the product's only viral
mechanism: `ludi://f/<token>`, shared into a WhatsApp group. A scheme
URL is a dead, unlinkified string for anyone without the app installed —
which in a Cypriot group chat is nearly everyone. C1
([plans/invite-landing.md](../plans/invite-landing.md)) moves the shared
capability to `https://ludi.football/f/<token>`, which needs a page for
the case where the app is absent.

Three forces shape that page. First, the token is a bearer capability
(ADR-0021): whoever holds it can preview a fixture and, in the app, take
a slot — so where the page runs and what it exposes are security
decisions, not implementation details. Second, the preview is already
minimised by the database (`fixture_preview()` — time, venue, format,
open spots; never names, ADR-0012), and the page must not widen it.
Third, `apps/site` has deliberately shipped with no backend calls and no
client JS talking to anything — the keeper form composes a WhatsApp
message precisely to avoid collecting data. This page is the site's
first backend read, and the posture it sets is the one every later read
will cite.

## Decision

The invite landing is a **server component that calls
`fixture_preview()` server-side with the anon key held in server-only
env, renders exactly the preview fields, and is excluded from every
index — with no deferred deep linking, by design.**

Four commitments, made together:

1. **The anon key never ships to the browser.** `SUPABASE_URL` /
   `SUPABASE_ANON_KEY` are plain env vars, not `NEXT_PUBLIC_*`; the RPC
   call happens in the server component (`lib/fixture.ts`). The key is
   only an identifier, but keeping it server-side gives abuse one throat
   to choke — host-level rate limiting in front of one route — and
   keeps the site's no-client-backend line intact.
2. **`/f/*` is not a page in the site's own sense.** Per-page
   `robots: noindex, nofollow`, a `disallow` in robots.txt, absent from
   `ROUTES`, the sitemap and the nav. An invite is reached by being
   sent it. A revoked token and a made-up one render the same apology,
   which offers nothing — a dead link must not leak whether it ever
   existed.
3. **The OG card says what the preview says, no more.** WhatsApp's
   servers will fetch the URL to unfurl it; that is acceptable — the
   token already transits WhatsApp in plaintext and is rotatable
   (ADR-0021) — and the card carries venue, time, format, spots. Never
   names, never the booking code.
4. **No deferred deep linking.** The token does not survive an App
   Store install, and we do not add a third-party attribution SDK
   (Branch or similar) to make it. The page says so in words:
   *"Already installed? Tap your invite link again."* One extra tap,
   zero new dependencies holding our users' link graph.

## Consequences

### Positive

- The invite loop reaches people without the app — the page previews
  the fixture and funnels to the install, closing the gap C1 exists for.
- Privacy posture is inherited, not re-argued: the page can only render
  what the definer function returns, and the function was already
  minimised under ADR-0012.
- The site's first backend read sets a citable precedent: server-side,
  server-only env, definer-function-shaped surface.

### Negative

- The freshly-installed user must return to WhatsApp and tap again —
  measurable drop-off at the exact hop the funnel cares about. Accepted
  over an SDK dependency; the tap-again line mitigates in words.
- `force-dynamic` means every hit is a live RPC. Fine at current volume;
  a 30-second revalidate is the pre-agreed fallback if it ever is not.

### Neutral

- WhatsApp's unfurl bot fetches invite URLs; so will any link scanner in
  the chat's path. They see the preview fields, which is the preview's
  own threat model.
- The page renders the app's `ludi://f/<token>` link as a secondary
  button until universal links land (W2/W3), then becomes largely
  decorative for installed users.

## Alternatives considered

### Client-side fetch with `NEXT_PUBLIC_` anon key

The default Supabase-on-Next shape. Rejected: it publishes the key,
scatters the abuse surface across every browser, and breaks the site's
no-client-backend posture for no benefit — the page has no interactivity
to justify it.

### A dedicated Edge Function instead of the anon RPC

A `fixture-preview` function with its own rate limiting. Rejected as
gold-plating: the RPC is already `SECURITY DEFINER`, already minimised,
already granted to `anon` by the fixture version, and the site's server
is the choke point. If abuse materialises, the function slot is where
the mitigation goes — nothing about this page precludes it.

### Deferred deep linking (Branch.io or similar)

Carries the token through the App Store install, saving the second tap.
Rejected: a third-party SDK in both the app and the page, holding every
invite link's graph, to remove one tap from a flow whose drop-off we
have not yet measured. Revisit only if instrumentation shows the
tap-again hop is where the funnel actually dies.

## Follow-ups

- W2/W3 (AASA + associated domains) make the https link open the app
  directly when installed; this ADR covers the fallback page.
- Android App Links (`assetlinks.json`) parked to the C1 cut list; the
  page serves Android users the beta APK link meanwhile.
- If a second server-side read lands on the site, extract the env
  handling in `lib/fixture.ts` into a shared client — not before.
- Related: ADR-0012 (minimisation), ADR-0021 (token capability),
  ADR-0022 (join stays a definer RPC, in-app only).
