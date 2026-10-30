# Ludi · User Journeys

> Prose journeys in present tense with real names and numbers. These drive the data model (Phase 3) and the acceptance criteria (Phase 8). Every journey here maps to at least one schema decision.

Convention: **[J1]** is the canonical journey number. Code and tests may reference these IDs.

---

## J1 · Andreas books his first pitch _(MVP · Must)_

**Persona:** Andreas, 31, software engineer in Larnaca. Plays 5-a-side every Wednesday with colleagues. Currently books pitches via WhatsApp with Maria who runs Larnaca Sportsplex.

1. Andreas sees a Ludi sticker at Larnaca Sportsplex and scans the QR code. App Store opens, he installs Ludi.
2. On first launch, the **consent modal** asks for GDPR consent and offers EN / ΕΛ. He picks EN.
3. The sign-up screen offers Phone OTP, Sign in with Apple, Google, or email magic link. He taps Apple, completes the iOS sheet.
4. The app asks: first name (*Andreas*), last name (*M.*), city (Larnaca pre-filled from locale), preferred language (EN, already set). **No skill level, no positions, no handle** — those are optional, deferred.
5. Discover screen opens. City pill is "Larnaca" (only one enabled — others say "Coming soon"). Featured pitch: **Larnaca Sportsplex**. Near-you list shows 3 pitches.
6. He taps Larnaca Sportsplex → **Pitch Detail**. Sees hero image, address, amenities, 7-day slot picker.
7. Picks Wednesday 19:00 — the slot is available, 1 hour, €40.
8. Taps "Book now" → **Checkout**. Sees booking summary, add-on toggles (bibs +€3 off, ball rental +€2 on by default). He toggles off ball rental. Total: €40.
9. Taps "Pay €40" → Stripe Payment Sheet opens with Apple Pay. He confirms with Face ID.
10. **Booking confirmation screen**: booking code `LDN-2026-0001`, date, time, pitch, "Added to your calendar" prompt (iOS calendar deep link).
11. Confirmation email arrives in 30 seconds — subject `Your booking at Larnaca Sportsplex — Wed 22 Apr, 19:00`.
12. My Bookings tab now lists the booking under "Upcoming". Cancel option visible ("Free cancellation until Tue 21 Apr 19:00").

**Schema implications:**
- `users` with optional fields (skill_level nullable at signup)
- `bookings` with state machine `pending → paid → confirmed → completed | cancelled | refunded`
- `bookings.code` public-safe short code (not id)
- `booking_addons` join table with denormalized price (in case addon base price changes later)
- `cities.enabled` boolean

**Acceptance criterion:** New user signs up and completes booking in <3 minutes on a cold install, end-to-end.

---

## J2 · Andreas cancels 28 hours ahead _(MVP · Must)_

1. Tuesday morning Andreas gets called out of town. Opens Ludi → My Bookings → taps the Wednesday booking.
2. Booking detail shows "Free cancellation until Tue 21 Apr 19:00 (in 4h)".
3. Taps Cancel → confirmation sheet: "You'll be refunded €40 to your card. This cannot be undone."
4. Confirms. Stripe refund initiated. Booking state flips to `cancelled`.
5. Refund email sent. Admin is notified (low-priority) so we can backfill the slot on the pitch's calendar.

**Schema implications:**
- `bookings.cancelled_at`, `bookings.cancellation_refund_amount` (in cents)
- Cancellation policy enum on `pitches` or `venues` (free > 24h, partial 6–24h, none < 6h)

**Acceptance criterion:** A cancellation > 24h before slot issues 100% refund within 5 minutes and frees the slot for rebooking.

---

## J3 · Andreas cancels 4 hours ahead _(MVP · Must, edge case)_

1. Wednesday afternoon Andreas gets stuck at work. Opens the booking.
2. Booking detail shows "No refund: cancellation within 6h of slot". Cancel option still available.
3. He cancels anyway — slot opens back up for the owner, but no money back.
4. Booking state → `cancelled_no_refund`. Venue keeps €40 (net of Ludi's €4 take rate).

**Schema implications:** cancellation policy enum must distinguish "no refund" from "no cancellation allowed".

**Acceptance criterion:** Cancellations inside the policy window clearly communicate zero refund before confirmation.

---

## J4 · Maria (pitch owner) onboards _(MVP · Must, mostly manual)_

**Persona:** Maria, 45, runs Larnaca Sportsplex. Has three pitches. Currently uses a paper diary + WhatsApp.

1. Founder meets Maria in person at the Sportsplex. Agrees to partnership on the spot (10% take rate, no setup fee, Ludi lists her three pitches).
2. Founder goes home, opens admin dashboard → "Create venue" → fills: name, address, contact, three pitches (name, type, surface, price per hour, default availability rules).
3. Founder sends Maria a magic link: *"Tap here to receive payouts from Ludi."*
4. Maria taps, lands on Stripe Connect Express hosted onboarding. Fills bank details, IBAN, ID document.
5. Stripe confirms her account `complete`. Ludi webhook flips `venues.stripe_account_status = 'active'` and `pitches.is_verified = true`.
6. Maria's three pitches now appear live on Discover in Larnaca. She gets a WhatsApp message from founder with her first booking link to test.
7. Bookings arrive. Each week Stripe automatically pays out to Maria's bank account, Ludi's 10% cut already withheld via `application_fee_amount`.

**Schema implications:**
- `venues` with `stripe_account_id`, `stripe_account_status` ('pending' | 'active' | 'restricted')
- `pitches.is_verified` gated by venue's Stripe status
- Webhook handler for `account.updated`, `account.application.deauthorized`

**Acceptance criterion:** Founder can onboard a new venue and go live in <30 minutes (assuming Maria has her IBAN ready).

---

## J5 · Platform Admin dispute handling _(MVP · Must)_

1. Monday morning, Maria WhatsApps: "Andreas didn't show Saturday and the pitch was dark — can we refund him anyway as goodwill?"
2. Founder opens admin `/admin/bookings`, searches `LDN-2026-0001`.
3. Booking state is `completed`. Taps "Issue full refund (admin override)" → confirms.
4. Stripe refund issued (€40 to Andreas, €4 clawed back from Maria's payout). Booking state → `refunded_by_admin`. Audit log captures: admin_user_id, timestamp, reason (free-text).
5. Andreas receives refund notification email.

**Schema implications:**
- Audit log table `admin_actions` (admin_id, action_type, target_type, target_id, reason, created_at)
- Booking state enum includes `refunded_by_admin` distinct from player-initiated cancellation
- Stripe reverse-transfer on the pitch owner's already-paid-out amount (edge case — may need negative balance handling)

**Acceptance criterion:** Admin can issue a full refund on any booking in <60 seconds, with audit trail.

---

## J6 · Kostas joins an open match _(Stage 3 · Should)_

**Persona:** Kostas, 24, lives in Larnaca. Wants to play tonight but has no group.

1. Opens Ludi → Matches tab → sees 4 open matches in Larnaca tonight.
2. Filters by skill = 3 (his level). 2 matches remain. Picks one at Sportsplex 20:00, 3 spots left, €5 per head.
3. Taps Join → Stripe Payment Sheet → Apple Pay for €5 → confirmed.
4. Match detail now shows him as a participant. He gets a push notification 2h before.
5. Plays the match. Afterwards he's prompted to rate teammates and vote MVP.

**Schema implications (Stage 3):** `matches`, `match_participants`, `match_ratings`.

---

## J7 · Kostas hosts an open match _(Stage 3 · Should)_

1. Kostas books a pitch for Friday 20:00 (5-a-side, €40 total).
2. On confirmation, "Make it an open match?" prompt. He taps Yes.
3. Configures: 10 spots, skill range 2–4, price per head €5 (€40 ÷ 8 — he covers the extra).
4. Publishes. Match visible in Larnaca Matches tab.
5. Over 2 days 7 players join, paying €5 each directly via Stripe.
6. Match fills with 1 spot left, Kostas closes it. All €5 payments confirmed, Stripe distributes proportionally to venue + Ludi.

**Schema implications (Stage 3):** `matches.host_user_id`, `matches.spots_total`, `matches.spots_available`, `matches.price_per_head`. Split-payment complexity.

---

## Non-happy paths we're explicitly punting

- **Failed payment at checkout** — Stripe handles retry UI; if still failing, booking never created (idempotency key protects).
- **Pitch owner deactivates mid-week** with bookings on the books — admin manually cancels and refunds. No automation in MVP.
- **Double-booking race condition** — prevented at DB level with `EXCLUDE` constraint on `(pitch_id, time_range)`.
- **Stripe webhook failure** — idempotent webhook handler, retry via Stripe's built-in retry + a nightly reconciliation cron.

---

## Changelog

- **2026-04-21** — Phase 1. J1–J5 are MVP canonical journeys. J6–J7 are Stage 3 previews.
