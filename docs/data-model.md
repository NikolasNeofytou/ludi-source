# Ludi · Data Model

_Phase 3 of the elite-dev planning pass. The schema is the most expensive thing to get wrong — every mistake here becomes a migration later. This document is the source of truth; the SQL migrations implement it._

## Scope

MVP tables only (booking loop). Stage 3 tables (`matches`, `match_participants`, `match_results`, `match_ratings`) are noted as **Future** where they affect current design decisions (e.g., payments 1:N from bookings future-proofs split payments), but not implemented yet.

## Locked conventions

- **Primary keys:** UUID v7 (time-ordered). One `uuid7()` function, used everywhere.
- **Money:** integer cents. Never floats. EUR only (add `currency` column when we need it).
- **Times:** `timestamptz`. Always UTC in DB.
- **Booleans named positively:** `is_active`, `is_verified` — not `is_disabled`.
- **Soft-delete** only where financial audit requires it (bookings, payments). Users get **anonymized**, not deleted (GDPR compliant + FK integrity).
- **Timestamps:** every table has `created_at timestamptz not null default now()` and (where mutable) `updated_at`, maintained by trigger.
- **Naming:** `snake_case` everywhere. Junction tables named `parent_children` (e.g. `venue_owners`). Columns suffixed by type where helpful (`total_cents`, `skill_level`, `opens_at`).

## ERD (ASCII)

```
┌──────────┐
│  cities  │
└────┬─────┘
     │ 1:N
     │
     ▼
┌──────────┐        ┌───────────────┐
│  venues  │─N:M────│ venue_owners  │────N:M────┐
└────┬─────┘        └───────────────┘           │
     │ 1:N                                      ▼
     │                                    ┌──────────────┐
     ▼                                    │  auth.users  │  (Supabase-managed)
┌──────────┐                              └──────┬───────┘
│ pitches  │                                     │ 1:1
│          │                                     ▼
└────┬─────┘                              ┌──────────┐
     │ 1:N                                │  users   │
     ├──────── pitch_schedules            └────┬─────┘
     │                                         │ 1:N
     ├──────── pitch_schedule_overrides        │
     │                                         │
     │ 1:N                                     │
     ▼                                         │
┌──────────────┐   N:1                         │
│   bookings   │──────────────────────────────┘
└──────┬───────┘
       │ 1:N
       ├──────── booking_addons
       │
       │ 1:N
       ▼
┌──────────────┐
│   payments   │   (1:N from bookings — Stage 3 split payments land here)
└──────────────┘

       ┌─────────────────┐
       │ admin_actions   │  (audit log, refs any table)
       └─────────────────┘
```

---

## Table-by-table

### `cities`

Reference table. Supports multi-city launch by flipping `is_enabled`. Both EN and GR names so UI can switch without client-side mapping.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `uuid7()` | |
| `code` | `text` UNIQUE NOT NULL | stable slug: `nicosia`, `limassol`, `larnaca`, `paphos`, `ayia_napa` |
| `name_en` | `text` NOT NULL | "Nicosia" |
| `name_gr` | `text` NOT NULL | "Λευκωσία" |
| `is_enabled` | `boolean` NOT NULL DEFAULT false | Larnaca = true at launch |
| `bounds` | `geography(polygon, 4326)` NULL | Stage 4 — city polygon for "pitches in this city" queries |
| `display_order` | `int` NOT NULL DEFAULT 0 | Manual sort in UI pills |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Indexes: `UNIQUE(code)`, `(is_enabled, display_order)` partial where is_enabled.

RLS: public read (no restriction). Write via admin console only (RLS: admin role).

---

### `users`

1:1 with `auth.users`. Supabase Auth owns identity; this table owns profile. The `id` column is an FK to `auth.users.id` — not a separate identity.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK REFERENCES `auth.users(id)` ON DELETE CASCADE | same id as auth row |
| `first_name` | `text` NOT NULL | required at signup |
| `last_name` | `text` NOT NULL | |
| `handle` | `citext` UNIQUE NULL | optional, @handle style, case-insensitive |
| `city_id` | `uuid` NOT NULL REFERENCES `cities(id)` | home city, defaults to device locale city |
| `skill_level` | `smallint` NOT NULL DEFAULT 3 CHECK `skill_level BETWEEN 1 AND 5` | |
| `preferred_locale` | `text` NOT NULL DEFAULT 'en' CHECK `preferred_locale IN ('en','gr')` | |
| `positions` | `text[]` NOT NULL DEFAULT '{}' | free-form, e.g. `{LW,CAM}` |
| `preferred_foot` | `text` NULL CHECK `preferred_foot IN ('left','right','both')` | |
| `height_cm` | `smallint` NULL CHECK `height_cm BETWEEN 120 AND 230` | self-declared, optional (player card) |
| `age_band` | `text` NULL CHECK `age_band IN ('u18','18_25','26_35','36_45','45_plus')` | coarse bracket, **not** a birth date — GDPR minimisation ([ADR-0012](adr/0012-player-profile-data-posture.md)) |
| `play_frequency` | `text` NULL CHECK `play_frequency IN ('casual','weekly','often')` | activity/commitment signal; reliability proxy pre-match-history |
| `role` | `text` NOT NULL DEFAULT 'player' CHECK `role IN ('player','admin')` | platform admin flag |
| `stripe_customer_id` | `text` UNIQUE NULL | lazily created on first payment |
| `anonymized_at` | `timestamptz` NULL | GDPR deletion marker — PII nulled, row kept for FK integrity |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | updated via trigger |

Indexes: `UNIQUE(handle)` where `handle IS NOT NULL`, `UNIQUE(stripe_customer_id)` where NOT NULL, `(city_id)`.

RLS (Phase 4 will detail):
- select: own row; admins see all
- insert: none directly — created via signup trigger from `auth.users`
- update: own row, restricted columns (can't self-promote to admin)
- delete: admins only (soft via anonymization)

---

### `venues`

Legal entity + physical location + Stripe Connect account. Owns many pitches.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `uuid7()` | |
| `name` | `text` NOT NULL | "Larnaca Sportsplex" |
| `address` | `text` NOT NULL | free-form; structured geocoding deferred |
| `city_id` | `uuid` NOT NULL REFERENCES `cities(id)` | |
| `coords` | `geography(point, 4326)` NOT NULL | from Mapbox geocoding on onboarding |
| `lat` / `lng` | `double precision` GENERATED ALWAYS AS `ST_Y` / `ST_X(coords::geometry)` STORED | numeric coordinates for API reads (since `20260913000005`; were `lat(venues)` / `lng(venues)` computed columns, which need whole-row SELECT) |
| `contact_phone` | `text` NULL | |
| `contact_email` | `citext` NULL | |
| `stripe_account_id` | `text` UNIQUE NULL | set after Connect Express onboarding |
| `stripe_account_status` | `text` NOT NULL DEFAULT 'pending' CHECK `stripe_account_status IN ('pending','active','restricted','disabled')` | updated via webhook |
| `take_rate_bps` | `smallint` NOT NULL DEFAULT 1000 CHECK `take_rate_bps BETWEEN 0 AND 5000` | basis points; 1000 = 10% |
| `cancellation_policy` | `text` NOT NULL DEFAULT 'standard' CHECK `cancellation_policy IN ('standard','strict','flex')` | per J2/J3 |
| `is_active` | `boolean` NOT NULL DEFAULT true | admin can deactivate |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Indexes: `(city_id, is_active)`, `UNIQUE(stripe_account_id)` where NOT NULL.

RLS: public read if `is_active` AND `stripe_account_status='active'`; owners update own; admins all.

**Column guard (M6 #41e prerequisite):** RLS is row-level, so `venues_owner_or_admin_update` alone let an owner set *any* column on their own row — including `take_rate_bps`, `stripe_account_id` and `stripe_account_status`. `tg_venues_block_privileged_columns` (migration `20260822000003`) restricts a non-privileged writer to `name`, `address`, `coords`, `contact_phone`, `contact_email`. See [threat-model.md](threat-model.md) §Authorization.

**Read guard (2026-09-13):** reads had the same row-level blind spot. `venues_select_public_or_owner_or_admin` makes an active venue's whole row public, so anyone holding the anon key could read its `take_rate_bps` and `stripe_account_id`, and would read `contact_phone` / `contact_email` once they were filled in. Migration `20260913000005` revokes SELECT on those four columns from `anon` and `authenticated`. Owners, managers and admins read them through `v_venue_private(venue_id, contact_phone, contact_email, stripe_account_id, take_rate_bps)`, which returns only the caller's venues, or every venue for an admin. Clients must name their columns: `select('*')` on `venues` now fails with 42501, and so does anything that takes the whole row, such as a function over the `venues` row type.

---

### `venue_owners`

Many-to-many between users and venues. One owner can own multiple venues; one venue can have multiple signatories.

| Column | Type | Notes |
|---|---|---|
| `venue_id` | `uuid` REFERENCES `venues(id)` ON DELETE CASCADE | |
| `user_id` | `uuid` REFERENCES `users(id)` ON DELETE RESTRICT | can't delete a user who owns a venue — admin must transfer first |
| `role` | `text` NOT NULL DEFAULT 'owner' CHECK `role IN ('owner','manager')` | **manager runs the day; owner decides what the venue is, what it charges, and sees what it earned** ([ADR-0041](adr/0041-a-manager-runs-the-day.md), 2026-09-18). Owner-only: earnings, payouts, `v_venue_private` (take rate), editing the venue, pitches and composite components, Stripe onboarding / Express dashboard, and who holds access. A manager keeps bookings, walk-ins, series, notes, schedules and the roster. Enforced in RLS with `has_venue_role()` / `has_pitch_role()`; `is_venue_owner_of_venue()` still means "any access" and ignores role on purpose. |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `accepted_at` | `timestamptz` DEFAULT `now()` | NULL = an owner's grant the person hasn't opened yet; `venue_people()` hides their own details from the venue until `accept_venue_access()` sets it (2026-10-20) |
| `invited_email` | `text` | the address the granting owner typed, shown back while the grant is pending |

Primary key: `(venue_id, user_id)`.

Indexes: `(user_id)` for "my venues" queries.

RLS: the table itself stays admin-write and self-read (`venue_owners_admin_write`, `venue_owners_select_self_or_admin`). Since 2026-09-18 an **owner** manages his own venue's people through gated paths instead: `venue_people()` to list, `revoke_venue_person()` to remove (a venue always keeps at least one owner), and `invite-venue-owner` to add — a **manager** only, capped at 12 people and 5 invites a day. Since 2026-10-20 an owner's grant starts pending (`accepted_at` NULL, `invited_email` = what the owner typed) and `venue_people()` shows only that address and the role until the person opens the venue in the dashboard (`accept_venue_access()`); the email lookup is the server-only `account_id_for_email()`, which replaced the owner-callable `venue_invite_lookup()`. Making someone an owner stays a founder act. See [plans/venue-staff.md](plans/venue-staff.md).

---

### `pitches`

Single playable surface. Many per venue.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `uuid7()` | |
| `venue_id` | `uuid` NOT NULL REFERENCES `venues(id)` ON DELETE CASCADE | |
| `name` | `text` NOT NULL | "Pitch 1", "Main field" |
| `type` | `text` NOT NULL CHECK `type IN ('5-a-side','7-a-side','11-a-side')` | |
| `surface` | `text` NOT NULL CHECK `surface IN ('turf','grass','indoor')` | |
| `price_per_hour_cents` | `int` NOT NULL CHECK `price_per_hour_cents > 0` | base price; snapshotted to bookings |
| `amenities` | `text[]` NOT NULL DEFAULT '{}' | MVP: free-form tags. Normalize to a table in Stage 4 if filter UI demands it |
| `hero_image_url` | `text` NULL | Supabase Storage URL |
| `is_verified` | `boolean` NOT NULL DEFAULT false | gated by venue.stripe_account_status (trigger) |
| `is_active` | `boolean` NOT NULL DEFAULT true | temporary deactivation |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Indexes: `(venue_id)`, `(is_verified, is_active)` partial.

RLS: public read if `is_verified AND is_active`; venue owners update own; admins all.

**Column guard (M6 #41e prerequisite):** `tg_pitches_block_privileged_columns` stops a non-privileged writer changing `is_verified`, `is_active` or `venue_id`, and `tg_pitches_force_unverified_on_insert` forces `is_verified = false` on owner-created pitches. Verification stays a platform decision made through `admin-toggle-pitch` (M3 #18).

**Composite pitches (ADR-0032, 2026-09-15):** "single playable surface" is no longer quite true — a pitch may be *made of* other pitches at the same venue (a 7-a-side joined from two 5-a-sides), see `pitch_components` below. The composite is still one `pitches` row with its own name, type, price, hours and verification; `is_pitch_bookable` is additionally false while any member is inactive.

---

### `pitch_components`

Which leaf pitches a composite pitch is made of. One level only: a child is never itself a parent, and both rows share a `venue_id` (`tg_pitch_components_guard`).

| Column | Type | Notes |
|---|---|---|
| `parent_pitch_id` | `uuid` NOT NULL REFERENCES `pitches(id)` ON DELETE CASCADE | the composite |
| `child_pitch_id` | `uuid` NOT NULL REFERENCES `pitches(id)` ON DELETE RESTRICT | a leaf; deleting a leaf that is part of a composite is refused |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

PK `(parent_pitch_id, child_pitch_id)`; CHECK parent ≠ child; index on `child_pitch_id`.

**What a booking occupies.** `pitch_units(p)` is the physical surfaces a pitch occupies — its children, else itself. `pitch_blockers(p)` is every pitch whose active bookings occupy a unit `p` needs: itself, its units, and any composite sharing a unit. `get_available_slots`, `bookings_on_date` and `bookings_in_weekly_window` subtract bookings on `pitch_blockers(p)` rather than on `p` alone, so a 7v7 slot disappears when either half is booked and a half's slot disappears when the 7v7 is.

**The invariant.** `tg_bookings_composite_guard` (BEFORE INSERT/UPDATE on `bookings`) takes an advisory transaction lock per unit and refuses an overlap with any active booking on a blocker, raising `23P01` — the same code the `EXCLUDE` raises, so both booking edge functions answer `SLOT_UNAVAILABLE` unchanged. The `EXCLUDE` keeps covering same-pitch races through its index; the trigger covers the cross-pitch ones. Pitches that take part in no composition skip the lock.

RLS: readable wherever the parent pitch is readable; insert/delete by the parent's venue owners or admins.

---

### `pitch_schedules`

Recurring weekly template. One row per (pitch, day-of-week). For multiple windows in a day (e.g., "9-13 and 17-23"), add a second row with same pitch_id+day_of_week — UNIQUE relaxed to allow this. Simplest model: assume contiguous for MVP, split later if needed.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `uuid7()` | |
| `pitch_id` | `uuid` NOT NULL REFERENCES `pitches(id)` ON DELETE CASCADE | |
| `day_of_week` | `smallint` NOT NULL CHECK `day_of_week BETWEEN 0 AND 6` | 0 = Sunday |
| `opens_at` | `time` NOT NULL | |
| `closes_at` | `time` NOT NULL CHECK `closes_at > opens_at` | same-day only; overnight pitches need a separate row model (not MVP) |
| `slot_duration_minutes` | `smallint` NOT NULL DEFAULT 60 CHECK `slot_duration_minutes IN (30,60,90,120)` | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Indexes: `(pitch_id, day_of_week)`.

Constraint (M6 #41b): `EXCLUDE USING gist (pitch_id WITH =, day_of_week WITH =, tsrange(date '2000-01-01' + opens_at, date '2000-01-01' + closes_at, '[)') WITH &&)` — split windows on one day are allowed, overlapping ones are not. Overlap would make `get_available_slots` emit the shared hours twice. Half-open bounds mean an abutting pair (09:00–13:00 and 13:00–17:00) stays legal. Postgres has no `timerange`, hence the projection onto a fixed date.

**Derivation rule (not stored):** Given a date D and a pitch, available slots = generate slots from D's open windows, minus any existing `bookings` in state pending/paid/confirmed/completed. D's open windows are the `pitch_schedule_overrides` rows for D if any exist, otherwise the `pitch_schedules` rows for `dow(D)` — see the precedence note under `pitch_schedule_overrides`. Multiple `pitch_schedules` rows for one `(pitch, day_of_week)` are legal and mean split windows; they must not overlap.

RLS: public read (needed for slot rendering); owners/admins write.

---

### `pitch_schedule_overrides`

Per-date exceptions: closures, special hours (e.g., "closed Dec 25", "open 9am on tournament day").

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `uuid7()` | |
| `pitch_id` | `uuid` NOT NULL REFERENCES `pitches(id)` ON DELETE CASCADE | |
| `override_date` | `date` NOT NULL | |
| `is_closed` | `boolean` NOT NULL DEFAULT false | if true, ignore opens_at/closes_at |
| `opens_at` | `time` NULL | required if is_closed = false |
| `closes_at` | `time` NULL | |
| `slot_duration_minutes` | `smallint` NOT NULL DEFAULT 60 CHECK `slot_duration_minutes IN (30,60,90,120)` | added M6 #41a — an override replaces the weekly windows, so it may have no weekly row to borrow a slot size from |
| `reason` | `text` NULL | displayed to admins only |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Constraint: `CHECK ((is_closed = true) OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at))`

Constraint (M6 #41b): `EXCLUDE USING gist (pitch_id WITH =, override_date WITH =, <window> WITH &&)`, where `<window>` is the whole day for `is_closed` rows and `[opens_at, closes_at)` otherwise. This **replaced** `UNIQUE(pitch_id, override_date)` and carries three rules at once: open windows on a date may not overlap; a closure cannot coexist with an open window on the same date; and a date cannot have two closures (what the UNIQUE really protected).

**Precedence (M6 #41a):** an override **replaces** its date's weekly windows rather than amending them. For date D the open windows are the override rows for (pitch, D) if any exist — `is_closed = true` contributes none, so the day is shut — otherwise the `pitch_schedules` rows for `dow(D)`. Two consequences worth knowing: a special opening on a day with **no** weekly row works (the override alone defines the day), and a restriction is expressed by naming what stays **open** ("open 17:00–23:00"), not what closes.

Before #41a the override was `COALESCE`d onto *every* weekly row for that day, which duplicated every slot on a split-window pitch and silently ignored overrides on unscheduled days. Reproduction: [spikes/schedule-derivation-defects.md](spikes/schedule-derivation-defects.md).

A date may therefore carry **several** non-overlapping override windows, so an exception day with non-contiguous open hours ("open 09:00–11:00 and 19:00–21:00 on the 15th") is expressible. `get_available_slots` was already row-set-shaped and needed no change for this.

Because an exclusion constraint cannot arbitrate `ON CONFLICT`, writers that used to upsert on the old UNIQUE delete-then-insert instead — see `seed.sql`.

RLS: public read; owners/admins write.

---

### `bookings`

The core transaction row. State machine:

```
pending ──(payment succeeded)──> paid ──(venue auto-confirms)──> confirmed
                                                                    │
                                                     ┌──────────────┼──────────────┐
                                                     ▼              ▼              ▼
                                                  completed    cancelled      refunded
                                                                    │
                                                                    ▼
                                                        cancelled_no_refund
                                                                    │
                                                                    ▼
                                                           refunded_by_admin
```

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `uuid7()` | |
| `code` | `text` UNIQUE NOT NULL | public-safe: `LDN-2026-0001` |
| `user_id` | `uuid` NOT NULL REFERENCES `users(id)` ON DELETE RESTRICT | can't delete user with bookings — must anonymize |
| `pitch_id` | `uuid` NOT NULL REFERENCES `pitches(id)` ON DELETE RESTRICT | |
| `starts_at` | `timestamptz` NOT NULL | |
| `ends_at` | `timestamptz` NOT NULL CHECK `ends_at > starts_at` | |
| `time_range` | `tstzrange` GENERATED ALWAYS AS `tstzrange(starts_at, ends_at, '[)')` STORED | computed for EXCLUDE constraint |
| `state` | `text` NOT NULL DEFAULT 'pending' CHECK `state IN ('pending','paid','confirmed','completed','cancelled','refunded','refunded_by_admin','cancelled_no_refund')` | |
| `base_price_cents` | `int` NOT NULL CHECK `base_price_cents > 0` | pitch price at booking time |
| `addons_price_cents` | `int` NOT NULL DEFAULT 0 CHECK `addons_price_cents >= 0` | sum of addon quantities × unit prices |
| `total_cents` | `int` NOT NULL CHECK `total_cents > 0` | base + addons |
| `platform_fee_cents` | `int` NOT NULL CHECK `platform_fee_cents >= 0` | total × venue.take_rate_bps / 10000; snapshotted |
| `cancellation_policy` | `text` NOT NULL CHECK `cancellation_policy IN ('standard','strict','flex')` | snapshotted from venue |
| `gk_slots` | `smallint` NOT NULL CHECK `> 0` | roster shape, frozen from `pitches.type` at booking time (2026-08-24) |
| `outfield_slots` | `smallint` NOT NULL CHECK `> 0` | stored, not derived — an owner editing the pitch must not reshape a fixture people already joined |
| `invite_token` | `text` NOT NULL UNIQUE | the join capability. **Not** `code`, which is sequential and enumerable — ADR-0021. Rotate to revoke shared links |
| `cancelled_at` | `timestamptz` NULL | |
| `cancellation_refund_cents` | `int` NULL CHECK `cancellation_refund_cents IS NULL OR cancellation_refund_cents >= 0` | actual refund issued |
| `notes` | `text` NULL | user-provided notes to pitch owner |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

**The critical constraint — no double booking:**
```sql
EXCLUDE USING gist (
  pitch_id WITH =,
  time_range WITH &&
) WHERE (state IN ('paid','confirmed','completed'))
```

This rejects any new booking whose time range overlaps an existing **active** booking for the same pitch. Cancelled/refunded bookings don't block re-use.

Indexes: `UNIQUE(code)`, `(user_id, state)`, `(pitch_id, starts_at)`, the EXCLUDE constraint creates a GiST index implicitly.

RLS: user sees own; venue owners see own pitches' bookings; admins all. Insert via Edge Function only (booking must pass server-side validation + Stripe PaymentIntent creation atomically).

**`series_id` (ADR-0033, 2026-09-15):** nullable FK to `booking_series`, `ON DELETE SET NULL`; CHECK `series_id IS NULL OR origin = 'walk_in'`. Set on the instances of a standing booking, which are walk-ins in every other respect.

**`contact_id` (2026-09-18):** nullable FK to `venue_contacts`, `ON DELETE SET NULL`. Who a walk-in turned out to be — set by `tg_bookings_contact` from the typed phone, or from the series for an instance. Always NULL on an app booking. `walk_in_name` / `walk_in_phone` stay as the record of what was typed on the day; deleting the contact leaves them.

---

### `booking_series`, `booking_series_pitches`, `booking_series_skips`

A standing booking — the owner's recurring walk-in: the academy on courts 1–3, Monday to Friday, 16:00 for two hours, until June (ADR-0033, [plans/standing-bookings.md](plans/standing-bookings.md)).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `uuid7()` | |
| `venue_id` | `uuid` NOT NULL REFERENCES `venues(id)` ON DELETE CASCADE | |
| `name` | `text` NOT NULL, 1–120 | what the cell says — becomes `walk_in_name` |
| `phone` | `text` ≤ 30 | optional, becomes `walk_in_phone` |
| `weekdays` | `smallint[]` NOT NULL, 1–7 of 0…6 | 0 = Sunday, matching `pitch_schedules.day_of_week` |
| `starts_time` | `time` NOT NULL | venue wall clock |
| `duration_minutes` | `int` NOT NULL, 30–480, half-hours | |
| `starts_on` / `ends_on` | `date` / `date` NULL | `ends_on ≥ starts_on`; NULL = open-ended |
| `created_by` | `uuid` NOT NULL REFERENCES `users(id)` | the instances' `user_id`, as the walk-in's is the acting owner |
| `contact_id` | `uuid` NULL REFERENCES `venue_contacts(id)` ON DELETE SET NULL | who the series is for; set by trigger from `phone`, inherited by every instance (2026-09-18) |

`booking_series_pitches (series_id, pitch_id)` — the courts; a trigger keeps them at the series' venue. `booking_series_skips (series_id, pitch_id, on_date, reason)` — where the materialiser could not place an instance (a `23P01` from the exclusion constraint or the composite guard) and why; a skip is never retried.

**Materialisation.** `materialise_booking_series(series_id | NULL, horizon_days = 56)` writes, for every court × matching day from today to the horizon that has no row *in any state* and no skip, an ordinary walk-in booking (`origin = 'walk_in'`, the court's rate × duration, no fee, `state = 'confirmed'`) and its offline `payments` row. Run on creation for that series, and nightly for all live series by cron `ludi-materialise-booking-series`. Un-booking an instance leaves a cancelled row, which is exactly what stops it being re-created. `end_booking_series(id, ends_on)` sets the end and cancels the confirmed instances after it with their payments.

RLS: the venue's owners and admins read all three; nothing writes them directly — `create_booking_series` and `end_booking_series` are `SECURITY DEFINER` RPCs gated on `is_venue_owner_of_venue`, and the all-series materialise run is for `is_privileged_writer()` only.

---

### `venue_contacts`

A venue's own regulars — the people it already knows by name and phone ([plans/owner-contacts.md](plans/owner-contacts.md), 2026-09-18). Venue-scoped, keyed on the phone number, and **derived**: a trigger makes or finds the contact for every walk-in and standing series, so the list fills itself. The venue is the controller of this data and Ludi the processor.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `uuid7()` | |
| `venue_id` | `uuid` NOT NULL REFERENCES `venues(id)` ON DELETE CASCADE | no cross-venue person |
| `display_name` | `text` NOT NULL default `''`, ≤ 120 | may be empty when a walk-in carried only a phone |
| `phone` | `text` ≤ 30 | as typed |
| `phone_e164` | `text` GENERATED from `normalize_phone_cy(phone)` | the identity; NULL when not confidently one number |
| `note` | `text` ≤ 280 | what the venue calls them ("Tuesday 20:00") |
| `search_key` | `text` GENERATED from `normalize_contact_text(display_name ‖ note)` | Greek transliterated, unaccented, lower-case |
| `source` | `text` NOT NULL, `counter` / `manual` / `backfill` / `csv` / `google` | |
| `google_resource` | `text` ≤ 200 | People API `resourceName`, for re-import (slice E) |

A row needs a name or a phone. Unique `(venue_id, phone_e164) WHERE phone_e164 IS NOT NULL` and `(venue_id, google_resource) WHERE NOT NULL`; GIN `gin_trgm_ops` on `search_key`.

`bookings.contact_id` and `booking_series.contact_id` → `venue_contacts(id)` ON DELETE SET NULL. `tg_bookings_contact` sets a walk-in's from its typed phone (or its series'), checks a supplied one belongs to the booking's venue, and leaves app bookings NULL. A counter-typed name never overwrites a contact's existing name. A walk-in with no usable number makes no contact.

RLS: **the owner lists; a manager searches** (ADR-0041). The only SELECT policy is `has_venue_role(venue_id, 'owner') OR is_admin()`. A manager reads through `venue_contacts_search(venue, query)` — at least two letters or three digits, at most eight rows. Writes are `SECURITY DEFINER`: `venue_contact_create` / `_update` for anyone with venue access, `venue_contact_delete` / `venue_contacts_delete_all` for the owner, audited. Deleting a contact never deletes a booking.

---

### `booking_addons`

| Column | Type | Notes |
|---|---|---|
| `booking_id` | `uuid` REFERENCES `bookings(id)` ON DELETE CASCADE | |
| `addon_code` | `text` CHECK `addon_code IN ('bibs','ball_rental')` | MVP set; extensible |
| `quantity` | `smallint` NOT NULL DEFAULT 1 CHECK `quantity > 0` | |
| `unit_price_cents` | `int` NOT NULL CHECK `unit_price_cents >= 0` | snapshotted |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Primary key: `(booking_id, addon_code)`.

RLS: inherits booking visibility.

---

### `booking_participants`

Added 2026-08-24 by the *booking as a shared fixture* version
([plans/shared-fixture.md](plans/shared-fixture.md)). A booking stops being
a receipt with one `user_id` and becomes a fixture with a roster.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK DEFAULT `uuid7()` | |
| `booking_id` | `uuid` REFERENCES `bookings(id)` ON DELETE CASCADE | |
| `user_id` | `uuid` REFERENCES `users(id)` ON DELETE RESTRICT | a participant is a Ludi **account**; no guest rows |
| `slot_kind` | `text` CHECK `IN ('gk','outfield')` | not an index — two keepers are interchangeable |
| `status` | `text` NOT NULL DEFAULT `'in'` CHECK `IN ('in','out')` | leaving is an UPDATE, never a DELETE |
| `joined_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `left_at` | `timestamptz` | CHECK-bound to `status` |
| `created_at` / `updated_at` | `timestamptz` | |

Unique: `(booking_id, user_id)` — rejoining flips the existing row back to
`in`.

Capacity (`gk_slots` / `outfield_slots` on the booking) is enforced by a
`BEFORE INSERT OR UPDATE` trigger that locks the booking row before
counting; it cannot be a CHECK, which sees only one row.

RLS: readable by yourself, anyone else on the same roster, the organiser,
and admin — via the `SECURITY DEFINER` helper `is_participant_of_booking()`,
which must be definer or the policy recurses through itself (cf. #36).
**No INSERT policy**: `join_fixture()` is the only writer (ADR-0022). No
DELETE policy at all.

Reads go through `v_fixture` and `v_fixture_roster`, definer views carrying
a caller predicate — ADR-0013's shape, with the difference that a card is
meant to be public and a roster is not.

---

### `payments`

1:N from bookings. One booking can have multiple payment attempts (failed + retry) and, from Stage 3, multiple participant PaymentIntents.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `uuid7()` | |
| `booking_id` | `uuid` NOT NULL REFERENCES `bookings(id)` ON DELETE RESTRICT | never cascade delete payments |
| `stripe_payment_intent_id` | `text` UNIQUE NOT NULL | |
| `amount_cents` | `int` NOT NULL CHECK `amount_cents > 0` | |
| `application_fee_cents` | `int` NOT NULL CHECK `application_fee_cents >= 0` | Ludi's cut on this payment |
| `status` | `text` NOT NULL CHECK `status IN ('requires_payment_method','requires_confirmation','processing','succeeded','cancelled','failed','refunded','partially_refunded','refunding')` | mirrors Stripe PaymentIntent status; `refunding` (2026-10-20) is a leaver's share marked under the booking lock and not yet refunded — `settle_split_booking` does not count it |
| `failure_code` | `text` NULL | Stripe error code on failure |
| `failure_message` | `text` NULL | |
| `refunded_amount_cents` | `int` NOT NULL DEFAULT 0 CHECK `refunded_amount_cents >= 0` | running total |
| `stripe_latest_event_at` | `timestamptz` NULL | last webhook timestamp for reconciliation |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Indexes: `(booking_id)`, `UNIQUE(stripe_payment_intent_id)`, `(status)` partial where status = 'failed' (for retry UI).

RLS: user sees payments tied to own bookings; admins all. Writes via Edge Function (webhook handler) only.

---

### `admin_actions`

Audit log. Every admin-triggered write gets a row. Required for J5 (dispute handling) and future compliance.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `uuid7()` | |
| `admin_user_id` | `uuid` NOT NULL REFERENCES `users(id)` ON DELETE RESTRICT | |
| `action_type` | `text` NOT NULL CHECK `action_type IN ('refund_booking','verify_pitch','deactivate_pitch','activate_pitch','create_venue','deactivate_venue','anonymize_user','other', …)` | widened by later migrations (owner acts, `invite_owner`, walk-ins, `series_*`, `enable_city`) — **always from the live definition** via `pg_get_constraintdef`, never a retyped list (JOURNAL 2026-09-15) |
| `target_type` | `text` NOT NULL CHECK `target_type IN ('booking','pitch','venue','user','payment','city')` | `city` since 2026-09-16 (`enable_city`) |
| `target_id` | `uuid` NOT NULL | |
| `reason` | `text` NOT NULL | free-text justification |
| `payload` | `jsonb` NOT NULL DEFAULT '{}' | before/after diff, Stripe response IDs, etc. |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Indexes: `(admin_user_id, created_at DESC)`, `(target_type, target_id)`.

RLS: admins only read/write.

---

## Helper objects

### Function `uuid7()`

Generates UUID v7 — 48 bits of millisecond timestamp + 12 bits of random + version/variant bits + 62 bits of random. Draft RFC spec. Gives time-ordered IDs (good index locality) while remaining opaque client-side.

### Function `generate_booking_code()`

Format: `{CITY}-{YEAR}-{SEQ}` where:
- CITY = first 3 letters of venue city (NIC, LIM, LAR, PAF, AYI)
- YEAR = 4-digit year of `starts_at`
- SEQ = zero-padded sequence number, per-city per-year, from a `booking_codes_seq` table

Example: `LAR-2026-0001`.

### Triggers

- `tg_bookings_updated_at` — bump `updated_at` on UPDATE
- `tg_users_updated_at` — same
- `tg_venues_updated_at` — same
- `tg_pitches_updated_at` — same
- `tg_pitches_verification_from_venue` — `pitches.is_verified` follows `venues.stripe_account_status = 'active'`
- `tg_bookings_derive_total` — on INSERT, compute `total_cents` and `platform_fee_cents`
- `tg_bookings_snapshot_policy` — on INSERT, snapshot `cancellation_policy` from venue

### Views (for reporting)

- `v_bookings_revenue` — bookings joined with venue/pitch, with computed Ludi revenue (completed bookings only)
- `v_gmv_daily` — daily sum of `total_cents` for confirmed+completed bookings
- ~~`v_venue_payouts` — per-venue sum of `total_cents - platform_fee_cents` for completed bookings~~ Superseded 2026-08-31 (41l): real payouts land in the **`venue_payouts` table**, a webhook-written mirror of Stripe `payout.paid`/`payout.failed` on the venue's connected account (migration `20260831000002`) — a derived sum can only guess what Stripe actually paid, the mirror records it.

RLS on views inherits from base tables.

---

## RLS intent (Phase 4 will implement)

| Table | Select | Insert | Update | Delete |
|---|---|---|---|---|
| `cities` | anyone | admin | admin | admin |
| `users` | self, admins | signup trigger | self (restricted fields), admin (all) | admin (via anonymize) |
| `venues` | public if active | admin | owner (limited), admin | admin |
| `venue_owners` | admin, self | admin | — | admin |
| `pitches` | public if bookable | owner, admin | owner, admin | admin |
| `pitch_schedules` | public | owner, admin | owner, admin | owner, admin |
| `pitch_schedule_overrides` | public | owner, admin | owner, admin | owner, admin |
| `bookings` | self, venue owner, admin | Edge Function only (server-signed) | Edge Function only | admin only |
| `booking_addons` | inherits | Edge Function only | Edge Function only | admin |
| `payments` | self (via booking), admin | webhook Edge Function only | webhook Edge Function only | never |
| `admin_actions` | admin | admin | — | — |

---

## Future schema additions (Stage 3+)

Not implemented now, but current decisions must not block:

- **`matches`** (1:1 `bookings`) — adds `host_user_id`, `spots_total`, `spots_available`, `skill_min`, `skill_max`, `is_open`, `price_per_head_cents`
- **`match_participants`** (N per match) — who joined, which payment paid their share
- **`match_results`** — score, duration, entered_by, confirmed_by
- **`match_scorers`** — player + minutes + goals + assists
- **`match_ratings`** — rater, ratee, stars, fair_play (double-blind aggregate)

The **payments 1:N from bookings** decision is what enables split payments cleanly — Stage 3 adds a nullable `match_participant_id` FK to `payments` without schema surgery.

---

## Index strategy (summary)

Every FK gets an index (Postgres doesn't auto-index the child side). Additionally:
- `bookings(pitch_id, starts_at)` — "upcoming slots on pitch X"
- `bookings(user_id, state)` — "my active bookings"
- `bookings(state)` partial WHERE state IN ('pending','paid') — "bookings needing attention"
- EXCLUDE constraint on `(pitch_id, time_range)` is itself a GiST index
- `venues(city_id, is_active)` — "active venues in this city"
- `admin_actions(admin_user_id, created_at DESC)` — admin activity feed

No full-text search indexes in MVP. Add GIN on `pitches.name` + `venues.name` when search demands it.

---

## GDPR notes

- **Right to erasure:** implemented as anonymization (`users.anonymized_at` set, PII nulled). Bookings and payments remain for 7-year financial audit retention (Cyprus tax law). `admin_actions` logs the anonymization event.
- **Data portability:** user can request an export of their `users` row + `bookings` + `payments` (via support ticket in MVP; self-serve later).
- **Consent:** stored outside this schema — in `auth.users.raw_user_meta_data.gdpr_consent_at` timestamp.

---

## Changelog

- **2026-04-21** — Phase 3. Initial schema for MVP booking loop. Stage 3 matches/results/ratings noted as future extensions, not yet materialized.
