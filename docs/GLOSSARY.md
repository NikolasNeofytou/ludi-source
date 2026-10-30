# Ludi · Glossary (Ubiquitous Language)

> The single source of truth for every noun used in code, docs, UI copy, and conversation.
> If you find yourself about to invent a new term, grep this file first.

This file follows the [Domain-Driven Design](https://www.domainlanguage.com/ddd/) principle: **one term, one meaning, everywhere**. Drift here is the #1 cause of later rework.

---

## Places

### Venue
A physical location owned by one legal entity, containing one or more **pitches**. Example: *"Larnaca Sportsplex"* is a venue that contains three pitches.

- In schema: `venues` table.
- User-facing label: sometimes shown as just the venue name (*"Larnaca Sportsplex"*), never as "facility" or "club".

### Pitch
A single playable surface inside a venue. Has a `type` (5/7/11-a-side), `surface` (turf/grass/indoor), and its own bookable calendar. One venue can list multiple pitches as separate inventory.

- In schema: `pitches` table, `venue_id` FK.
- **Not** to be called "court", "field", or "ground" in code or UI.

### City
One of the five Cypriot cities Ludi operates in: Nicosia, Limassol, Larnaca, Paphos, Ayia Napa. Stored as an enum/enum-like reference table so we can enable/disable cities without code changes.

- In schema: `cities` reference table.
- Launch city: **Larnaca**. Others are `enabled: false` until supply is validated.

### Slot
A discrete bookable time window on a pitch's calendar. In MVP all slots are 1 hour. Identified by `(pitch_id, starts_at, ends_at)`.

- In schema: not a table — derived from `bookings` + availability rules on the pitch.
- **Not** "time slot", "reservation window", or "session" — just "slot".

---

## People

### Player
A Ludi end user who books pitches and (from Stage 3) joins matches. Authenticated via phone OTP, Apple, Google, or email. Has a skill level (int 1–5), a home city, optional positions, and a handle.

- In schema: `users` table, extending `auth.users` via Supabase.
- User-facing label: shown as first name + last-initial (*"Andreas M."*) in public contexts.

### Pitch Owner (or "Owner")
The legal entity / individual that owns a **venue** and its pitches. In MVP, onboarded manually by the founder via in-person meeting → invite link → Stripe Connect Express onboarding. Receives 90% of each booking (gross minus Ludi's 10% take rate) to their Stripe Express account.

- In schema: `venue_owners` join table (one owner can own multiple venues; one venue can have multiple signatories).
- **Not** "partner", "operator", "host", "merchant" — always "pitch owner".

### Host _(Stage 3, not MVP)_
A **player** who books a pitch and opens extra spots for other players to join. A host is never a pitch owner acting in an owner capacity — those are distinct roles.

- In schema: `matches.host_user_id` FK, in Stage 3.

### Platform Admin
The founder (you), acting in an operational capacity: verifying pitches, resolving payment disputes, issuing refunds, accessing the admin dashboard. Same `auth.users` row as your player account, but with an `is_admin` flag or admin role via RLS.

- In schema: `users.role` enum or a `platform_admins` allowlist.

---

## Actions & Artifacts

### Booking
A confirmed reservation of a **slot** on a pitch by a **player**. Represents the financial transaction — it has a `total`, a Stripe `payment_intent_id`, and a state machine (`pending → paid → confirmed → completed | cancelled | refunded`).

- In schema: `bookings` table.
- **Not** "reservation", "appointment", "order". Always "booking".

### Match _(Stage 3, not MVP)_
A **booking** that has been opened to other players. Adds `host_user_id`, `spots_available`, `skill_level`, `is_open`. A match without open spots is functionally a private booking.

- In schema: `matches` table — **not a subtype of booking**; references it 1:1 via `booking_id`.
- Distinction matters: every match has a booking, but not every booking has a match.

### Match Result _(Stage 3, not MVP)_
The post-game record of a match: final score, team rosters, scorers with minutes, MVP vote, user ratings submitted.

- In schema: `match_results`, `match_scorers`, `match_ratings`.

### Add-on
Optional extras attached to a booking at checkout: bibs, ball rental. Priced separately, sum into the `total`. Not inventory-tracked in MVP — assumed always available at the venue.

- In schema: `booking_addons` join table.

### Skill Level
Integer 1–5. 1 = casual, 3 = regular, 5 = ex-semi-pro. Stored on the `player`. In Stage 3, matches have a `min_skill` and `max_skill` for filtering. No ELO, no dynamic recalculation in MVP.

---

## Money

### GMV (Gross Merchandise Value)
Total euros transacted through Ludi in a period. Numerator: sum of `bookings.total` where state ∈ {paid, confirmed, completed}. Does **not** include refunds.

### Take Rate
Ludi's commission percentage per booking. **Fixed at 10% in MVP.** Configurable per-venue later (e.g., seeded partners at 5%).

- In schema: `venues.take_rate_bps` (basis points — 1000 = 10%). Default 1000.

### Net Revenue
Ludi's income: `GMV × take_rate`. This is the KPI that matters for business viability, not GMV.

### Payout
A transfer from Stripe to a pitch owner's bank account, handled automatically by Stripe Connect on their chosen schedule (usually weekly). Ludi does not hold pitch-owner funds.

---

## Product

### Discover
The Home tab. Pitch list, filters, featured pitch, city selector. In code: `DiscoverScreen` (not "Home" — only the tab icon is a house).

### Open Match _(Stage 3, not MVP)_
A match with `is_open = true` and `spots_available > 0`. Visible in the Matches tab's "Upcoming" list to any player in the same city and skill range.

### Rated _(Stage 3, not MVP)_
Boolean on a match: has the current user submitted teammate ratings for this match? Drives the "RATE TEAM" pill in the Results list.

---

## Process

### Launch City
The single city where Ludi is live and accepting real bookings. **Larnaca in MVP.** Defined by `cities.enabled = true`. Other cities render but show a "Coming soon" state in the UI.

### Cold-Start Match
A seeded open match (Stage 3+) — the founder manually creates 1–2 matches per week in Larnaca, personally invites a WhatsApp group to join, to create the illusion of activity for the first wave of organic players.

### Verified Pitch
A pitch whose owner has completed Stripe Connect onboarding and signed the Ludi partnership agreement. Only verified pitches are bookable. Unverified pitches may appear in discovery during soft-launch with a "Coming soon" state but cannot transact.

- In schema: `pitches.is_verified` boolean + `venues.stripe_account_status`.

---

## Changelog

- **2026-04-21** — Phase 1 kickoff. Initial glossary.
