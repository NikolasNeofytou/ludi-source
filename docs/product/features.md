# Ludi · Features (MoSCoW)

> The most important list in this repo. If a feature is not here, it's not being built. If it's in **Won't Have**, suggesting it costs you a coffee.

Prioritisation method: **MoSCoW** (Must / Should / Could / Won't).

- **Must** = MVP. Ship without these and there's no app.
- **Should** = Stage 3. Build the week after first paying booking.
- **Could** = Stage 4. Growth-phase features, not survival-phase.
- **Won't** = explicitly out of scope — scope creep prevention.

---

## User Roles (MVP)

| Role | How they get in | What they can do |
|---|---|---|
| **Player** | Phone OTP, Apple OAuth, Google OAuth, email magic link | Discover, book, pay, manage own bookings, edit own profile |
| **Pitch Owner** | Invite link from founder → Stripe Connect Express onboarding | Manage own venue's pitches, view own bookings, receive payouts |
| **Platform Admin** | Seeded in DB (you) | Verify pitches, issue refunds, view GMV/revenue, resolve disputes |

**Not in MVP:** guest/anonymous browsing — every screen requires auth. Reduces ~30% of UI state complexity.

---

## Must Have (MVP · Stage 2 · 3-month target)

### M1 · Authentication
- Phone OTP sign-up and sign-in via Supabase Auth
- Sign in with Apple (iOS requirement for App Store)
- Sign in with Google (Android convention)
- Email + magic link fallback
- Session persistence via expo-secure-store
- Sign out
- _Not_: password reset (no passwords), 2FA, account deletion (support ticket only in MVP)

### M2 · Player Profile
- Required fields at sign-up: first name, last name, city, preferred language
- Optional: handle, skill level (default 3), positions, preferred foot
- Edit own profile
- View own profile
- _Not_: public profile pages, followers, friends, photos

### M3 · Pitch Discovery
- Home/Discover screen with city pills (only launch city selectable)
- Featured pitch (editorially curated in MVP — hardcoded top pitch per city)
- Near-you pitch list sorted by distance (uses device location + pitch lat/lng)
- Filter chips: pitch type, indoor/outdoor, price bucket
- Search by pitch name
- _Not_: map view, advanced filters (amenities, surface), saved favourites

### M4 · Pitch Detail
- Hero image (one photo per pitch, provided by owner at onboarding)
- Name, city, type, surface, rating (rating hidden in MVP until we have reviews)
- Amenities list (static data from onboarding)
- Location address + "Open in Maps" deep link
- Date + time-slot selector (7-day window, 1-hour slots)
- Available slots visible, unavailable slots disabled
- "Book now" CTA
- _Not_: photo gallery, reviews, Q&A, similar pitches

### M5 · Booking & Checkout
- Confirm selected slot on booking review screen
- Optional add-ons (bibs €3, ball rental €2) with toggles
- Payment via Stripe Payment Sheet (card, Apple Pay, Google Pay)
- Saved payment methods (Stripe customer)
- Server-side idempotent booking creation (prevent double-bookings on retry)
- Confirmation screen with booking code
- Confirmation email (Resend) in user's language
- _Not_: promo codes, gift cards, recurring bookings, split payment

### M6 · My Bookings
- List of own bookings: upcoming and past
- Booking detail: pitch, date, time, total, payment method, cancellation policy
- Cancel booking (free > 24h before, 50% refund 6–24h, no refund < 6h)
- _Not_: rescheduling (cancel + rebook), sharing with friends, calendar export

### M7 · Admin Tools (founder-only web)
- Minimal Next.js admin at `/admin` behind allowlist:
  - List venues + pitches + their `is_verified` status
  - Flip `is_verified` toggle
  - List bookings, issue full/partial refund (calls Stripe)
  - View GMV / take-rate revenue / bookings-per-day
- _Not_: full CRUD, embedded in mobile app, role-based admin

### M8 · Pitch Owner (minimal viable)
- Dedicated onboarding flow: founder creates owner record, sends magic link
- Stripe Connect Express onboarding
- View own pitch's bookings (read-only list)
- Receive weekly automated payouts via Stripe
- _Not_: self-serve pitch creation, calendar management (founder edits via admin), disputes, analytics dashboard

### M9 · Platform Hygiene
- EN + GR i18n across all screens (already scaffolded)
- Error states and loading states on every screen (no silent failures)
- Crash reporting (Sentry)
- Basic analytics: screen views + conversion events (PostHog)
- Privacy policy + terms of service pages
- GDPR: explicit consent modal on first launch, data export on request (manual for MVP)

---

## Should Have (Stage 3 · post-MVP · month 4–6)

### S1 · Open Matches
- Host a match: book a pitch → open N spots → set skill range → publish
- Join an open match: browse by city + date + skill → tap Join → pay per-head price
- Match detail screen with participant avatars, level, time, price
- Close a match (fill remaining spots from waitlist or cancel)
- Cancel a match (initiates refunds to all participants)

### S2 · Match Results
- Post-match prompt to host: enter score + scorers with minutes
- Teammate confirmation (majority vote to ratify score)
- Match history visible on profile
- MVP vote: each participant votes once; tally displayed

### S3 · Teammate Ratings
- After a match, rate each teammate (1–5 stars) on skill, fair play
- Aggregate rating updates user's skill level monthly (moving average)
- Private to the user being rated — never public per-rating

### S4 · Split Payment
- Host books a pitch → optionally splits total among participants
- Each player pays their share via their own card (one Stripe PaymentIntent per player)
- Match doesn't confirm until all shares collected (or 24h timeout → refund)
- Host sees paid/unpaid status

### S5 · Deep Links & Invites
- WhatsApp share link: `https://ludi.app/m/<match_code>`
- Landing page pre-fills match details, deep-links into app if installed

### S6 · Push Notifications
- Match filling up (host)
- 2h before match (participants)
- Match cancelled / refunded
- Expo Push Notifications

---

## Could Have (Stage 4 · month 6–12)

- **C1** — Map view with Mapbox custom style matching Mediterranean palette
- **C2** — Pitch owner web dashboard (calendar view, manual bookings, revenue)
- **C3** — Reviews + pitch photo uploads (user-generated)
- **C4** — Friend graph + friend-match invites
- **C5** — Rich activity feed on Discover tab
- **C6** — City #2 launch (Nicosia, based on M6 validation)

---

## Won't Have (explicitly out of scope)

- ❌ **Tournament / league management** — niche, complex, distraction from marketplace
- ❌ **Team / club pages** — deferred indefinitely; single-match coordination is enough
- ❌ **Coaching / lessons marketplace** — different business, different supply side
- ❌ **Non-football sports** — padel/tennis/basketball tempt us; resist until Cyprus football is saturated
- ❌ **Web app for players** — mobile only until 1000+ MAU
- ❌ **In-app chat / DMs** — WhatsApp exists and wins; we link out
- ❌ **Live match streaming / spectator features**
- ❌ **Social feed / stories / follower graph**
- ❌ **Free tier for pitch owners** — 10% take rate from day one, no exceptions

---

## Changelog

- **2026-04-21** — Phase 1. Initial MoSCoW. MVP = booking loop only; matches deferred to Stage 3.
