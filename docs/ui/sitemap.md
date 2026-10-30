# Ludi · UI Sitemap

_Phase 5 of the planning pass. The prototype (`Pitch Cyprus.html`) already laid out 7 screens; this doc formalizes their routes, data dependencies, and navigation under expo-router._

## Navigation structure

Two route groups in `apps/mobile/app/`:

```
app/
├── _layout.tsx                  Root: loads fonts + i18n, StatusBar, SafeArea
├── (auth)/                      Group: unauthenticated screens, no tabs
│   ├── _layout.tsx              Stack layout
│   ├── welcome.tsx              Landing + auth choice
│   ├── phone.tsx                Phone OTP entry
│   ├── phone-verify.tsx         OTP code entry
│   ├── onboarding.tsx           Profile completion (first/last name, city)
│   └── consent.tsx              GDPR consent screen (first launch)
└── (tabs)/                      Group: authenticated shell, bottom tabs
    ├── _layout.tsx              Tabs layout (Discover, Map, Matches, Bookings, Profile)
    ├── index.tsx                Discover (pitch list)
    ├── map.tsx                  Map — MVP stub; real map in Stage 4
    ├── matches.tsx              Matches — MVP stub ("coming in Stage 3")
    ├── bookings.tsx             My Bookings (upcoming + past)
    ├── profile.tsx              My Profile + settings
    ├── pitch/
    │   └── [id].tsx             Pitch detail (modal-style push)
    ├── book/
    │   ├── [pitch_id].tsx       Booking review + add-ons
    │   └── checkout.tsx         Stripe Payment Sheet host screen
    └── booking/
        └── [id].tsx             Booking detail (from My Bookings)
```

Two things this structure enforces that matter:

- **`(auth)` and `(tabs)` never share UI chrome.** The tab bar exists only inside the authenticated shell. No logged-out tabs with empty states.
- **Modal-style routes for pitch detail and checkout** — stack pushes over the tabs, preserving scroll position on Discover.

## Route map → screen → data dependencies

| Route | Screen | Purpose | Data ops (see `api-contract.md`) |
|---|---|---|---|
| `/(auth)/welcome` | Welcome | Auth method chooser | none |
| `/(auth)/phone` | Phone input | Phone number entry | `auth.signInWithOtp({ phone })` |
| `/(auth)/phone-verify` | OTP code | 6-digit verification | `auth.verifyOtp()` |
| `/(auth)/onboarding` | Onboarding | First/last name, city | Flow 2.3 list cities + 2.2 update profile |
| `/(auth)/consent` | GDPR consent | One-time prompt | writes `auth.updateUser({ data: { gdpr_consent_at } })` |
| `/(tabs)` | Discover | Pitch list | Flow 3.1 list pitches by city |
| `/(tabs)/map` | Map | _(Stage 4)_ | _(deferred)_ |
| `/(tabs)/matches` | Matches | _(Stage 3)_ | _(deferred)_ |
| `/(tabs)/bookings` | My Bookings | Upcoming + past list | Flow 5.4 list my bookings |
| `/(tabs)/profile` | Profile | View/edit + logout + locale toggle | Flow 2.1 read profile |
| `/(tabs)/pitch/[id]` | Pitch Detail | Photos, schedule, book CTA | Flow 4.1 pitch detail + Flow 4.2 slots |
| `/(tabs)/book/[pitch_id]` | Booking Review | Confirm slot + add-ons + policy | local state until submit |
| `/(tabs)/book/checkout` | Checkout | Stripe Payment Sheet | Edge Function 5.1 `create-booking` |
| `/(tabs)/booking/[id]` | Booking Detail | Cancel / directions / share | Edge Function 5.5 `cancel-booking` |

## Navigation flow (happy path · J1)

```
welcome ──[Apple]──▶ onboarding ──▶ (tabs)/index
                                          │
                                          │  tap pitch card
                                          ▼
                                    pitch/[id]
                                          │
                                          │  tap "Book now"
                                          ▼
                                    book/[pitch_id]
                                          │
                                          │  tap "Pay"
                                          ▼
                                    book/checkout (Stripe Sheet)
                                          │
                                          │  success
                                          ▼
                                    booking/[id]
                                          │
                                          │  back gesture
                                          ▼
                                    (tabs)/bookings
```

## Screen-level requirements (MVP only)

### Discover (`(tabs)/index`)
- City pills: only `cities.is_enabled = true` interactive; others show "Coming soon"
- Featured pitch: top pitch by rating in current city (hardcoded to top by price DESC in MVP until ratings exist)
- Near-you list: horizontal scroll cards
- Filter chips: Tonight / 5-a-side / Indoor / Under €40 — client-side filter on loaded data
- View toggle: card ↔ list

### Pitch Detail (`pitch/[id]`)
- Hero image (from `pitches.hero_image_url`; fallback gradient from prototype's `hero` gradient strings for unverified pitches during soft launch)
- Meta: rating (hidden MVP), type, surface, distance, price
- 7-day selector: derived from schedules minus overrides minus existing bookings
- Slot grid: available (tap to select), unavailable (struck through)
- Amenities: icons from `AMENITY_ICON` map in `@ludi/ui`
- Location preview: static map image (Mapbox Static API) until Stage 4 interactive map
- Floating book CTA sticky at bottom

### Booking Review (`book/[pitch_id]`)
- Summary: pitch, date, time, base price
- Add-on toggles (bibs, ball rental)
- Total line-item breakdown
- Cancellation policy summary (derived from `venues.cancellation_policy`)
- "Pay €X" CTA triggers `create-booking` → Stripe Payment Sheet

### Checkout (`book/checkout`)
- Thin wrapper around Stripe Payment Sheet — the sheet is native modal
- On success: navigate to `booking/[id]`
- On failure: stay on page, show error, offer retry

### My Bookings (`(tabs)/bookings`)
- Two sections: "Upcoming" (starts_at >= now, state in paid/confirmed) and "Past" (starts_at < now OR state in completed/cancelled/refunded/etc.)
- Each card: pitch, date, time, total, state badge
- Cancelled bookings marked clearly, refund amount shown if any

### Booking Detail (`booking/[id]`)
- All fields from booking row
- Cancellation CTA if booking is cancellable (state = paid|confirmed, starts_at > now)
- Confirmation of cancellation policy impact before final confirm
- "Open in Maps" deep link to venue coords
- "Share" — WhatsApp share with booking code

### Profile (`(tabs)/profile`)
- Avatar + name + city + skill level
- Edit profile (goes to modal form — route `profile/edit` — not in sitemap above; add when implementing)
- Language toggle EN / ΕΛ — calls `setLocale()` from `@/lib/i18n`
- Sign out

## Data loading conventions

- **Prefer React Query / TanStack Query** for all Supabase reads. Lets us cache, deduplicate, and handle loading/error states consistently.
- **Never put secrets or logic into UI files.** Screens call hooks (e.g. `useMyBookings()`), hooks call Supabase client or Edge Functions.
- **Suspense boundaries per screen** — a loading state per screen, not per component.
- **Error boundaries per tab** — if Discover crashes, Profile still works.

## What's deliberately out of scope for MVP UI

From `docs/product/features.md`:
- No map view (placeholder screen)
- No open matches (placeholder screen)
- No friends / teams / social feed
- No in-app reviews or photos
- No admin UI in mobile app (admin uses a separate web tool — Stage 2)

## Stage 2+ screens to add (noted for route-group planning)

- `(tabs)/matches` — open matches list, match detail, host-a-match flow
- `(tabs)/profile/settings/*` — payment methods, notifications, privacy
- `(modals)/rate-teammates` — post-match rating sheet
- `(tabs)/stats` — personal stats (goals, matches, win rate)

## Changelog

- **2026-04-21** — Phase 5. Initial sitemap for MVP. Route groups locked; stubs for Stage 3+ screens live in the tabs but say "coming soon".
