# Ludi · API Contract

_Phase 4 of the planning pass. Defines every operation the mobile app performs, its Zod input/output schemas, auth requirements, and which RLS policies or Edge Functions are responsible. Stage 2 code implements this contract verbatim._

## Architectural convention

Supabase gives us three client surfaces:

1. **Client SDK queries** (`supabase.from('table').select()`) — direct Postgres access, governed by RLS. Use when the operation is a CRUD read or a user-limited write (e.g. update own profile).
2. **Client SDK RPC** (`supabase.rpc('function_name', args)`) — call Postgres functions. Use when a single DB function replaces several round-trips safely.
3. **Edge Functions** (Deno, called via `supabase.functions.invoke('name')`) — server code that uses the **service role key** and bypasses RLS. Use for anything that needs to: contact Stripe, enforce multi-row invariants, snapshot pricing, or hold a short transaction.

**Rule of thumb:** if the operation changes money, creates bookings, or touches multiple tables atomically, it lives in an Edge Function.

## Auth context every call assumes

All authenticated calls carry `Authorization: Bearer <access_token>` where the token's `sub` is `auth.uid()` referenced by every RLS policy. The app persists this token in `expo-secure-store` (see ADR-0003).

## Zod schemas

Ship in `packages/schemas/` (created in Stage 2). Every boundary — user input, DB result, Edge Function request/response, Stripe webhook — is validated by a Zod schema. See ADR-0006.

---

## Flow 1 · Auth

### 1.1 Sign up with Phone OTP
- **Call:** `supabase.auth.signInWithOtp({ phone })` → `supabase.auth.verifyOtp({ phone, token, type: 'sms' })`
- **Downstream:** on successful signup the `on_auth_user_created` trigger inserts a `public.users` row with default city (Larnaca) and empty name fields.
- **Onboarding UI** must then prompt for first/last name, locale, city confirmation.

### 1.2 Sign in with Apple / Google
- **Apple:** `supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce })` — `expo-apple-authentication` is given the SHA-256 of a fresh nonce, Supabase the raw nonce, so an identity token cannot be replayed.
- **Google:** `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'ludi://callback', skipBrowserRedirect: true } })` in an `expo-web-browser` auth session; the client runs the PKCE flow, so the redirect carries a `?code` only this phone's verifier can redeem (`exchangeCodeForSession`).
- **Downstream:** same trigger populates profile row.

### 1.3 Sign in with email magic link
- **Call:** `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: 'https://ludi.football/auth/callback/<nonce>' } })` → the email links to that universal link with `?token_hash=…&type=email` (templates in `packages/supabase/supabase/templates/`).
- The app accepts the link only for a sign-in it started in the last 15 minutes, never over an existing session, and never takes raw tokens from a URL (`apps/mobile/src/lib/pending-sign-in.ts`, `auth-providers.ts` `completeMagicLink`). `+native-intent.tsx` maps `/auth/callback/<nonce>` onto the `/callback` route (`(auth)` is a route group and is not part of the URL).

### 1.4 Sign out
- **Call:** `supabase.auth.signOut()`. Clears token from secure store.

### 1.5 Account deletion (GDPR)
- **Edge Function:** `POST /anonymize-me` (user-authed; the caller erases themselves). Body optional: `{ apple_authorization_code?: string }`.
- **Sign in with Apple revocation (App Review 5.1.1(v)):** an Apple account's app re-confirms with Apple on the delete screen and sends the fresh authorization code. Before erasing, the function exchanges it at `appleid.apple.com/auth/token` (ES256 `client_secret` signed with the Sign in with Apple key, `APPLE_SIWA_*` secrets), checks the returned `id_token.sub` is the account's own Apple identity, and revokes the refresh token at `/auth/revoke`. A different Apple ID → `400 APPLE_ACCOUNT_MISMATCH`, nothing changed. Missing secrets, an expired code, or Apple being down are logged and recorded as `payload.apple_revoke` on the audit row, and never block the erasure. No Apple token is ever stored.
- Flow ([ADR-0018](adr/0018-account-erasure-anonymize-and-keep.md)): verify user identity → null out PII in `public.users` + set `anonymized_at` (atomic on `anonymized_at IS NULL`; service role, since the RLS update path forbids writing `anonymized_at`) → record `admin_actions` row with `action_type = 'anonymize_user'`, `admin_user_id = <the user themselves>` (the row is kept, so the `NOT NULL`/`RESTRICT` FK is satisfied) → `supabase.auth.admin.deleteUser(userId, true)` (**soft-delete**) to scrub the auth identity (email/phone/metadata) and block login.
- **Anonymise, don't hard-delete:** `public.users.id → auth.users ON DELETE CASCADE` while child FKs are `ON DELETE RESTRICT`, so a hard `deleteUser` would be blocked for any user who has booked. Soft-delete keeps the row (the cascade never fires) so `bookings`/`payments` survive for 7-year retention — see [data-model.md §GDPR](data-model.md). `stripe_customer_id` is kept; Stripe-customer deletion is a parked follow-up.
- **Idempotent:** the soft-delete runs on every call (no-op the second time) so a retry after a partial failure self-heals; the audit row is written only on the first transition. Re-calling an already-anonymised user is a `200` no-op while the token is valid, `401` once the soft-delete invalidates it.
- **Why Edge Function:** writing `anonymized_at` + soft-deleting `auth.users` require the service role, and the anonymisation must be atomic with the audit log entry.
- **Response:** `200 { anonymized: true, already_anonymized: boolean, apple_revoke: 'revoked' | 'not_apple' | 'skipped_no_code' | 'skipped_not_configured' | 'failed_exchange' | 'failed_revoke' }, upcoming_bookings: Array<{ id, code, starts_at, state, venue_name }> | null }`. `upcoming_bookings` lists the caller's future app bookings (pending / collecting / paid / confirmed) that stay booked — nothing is cancelled here — so the app can tell the person; `null` if the lookup failed.
- **Also cleared (2026-10-21):** `public_profile` off (and `public_profile_at` NULL), `goes_in_goal = 'no'`, both `notify_*` switches off; the user's `push_tokens`, `team_follows`, `player_notifications`, `gk_feedback` about them, `wallet_pass_tickets` and `idempotency_keys` are deleted, with per-table counts in the audit row's `purged`. The full kept/cleared list is at the top of `functions/_shared/anonymize.ts`.

---

## Flow 2 · Profile

### 2.1 Read my profile
- **Call:** `supabase.from('users').select('*, cities(name_en, name_gr, code)').eq('id', userId).single()`
- **RLS:** `users_select_self_or_admin` permits only own row.

**Zod (output):**
```ts
const UserSchema = z.object({
  id: z.string().uuid(),
  first_name: z.string(),
  last_name: z.string(),
  handle: z.string().nullable(),
  city_id: z.string().uuid(),
  skill_level: z.number().int().min(1).max(5),
  preferred_locale: z.enum(['en', 'gr']),
  positions: z.array(z.string()),
  preferred_foot: z.enum(['left','right','both']).nullable(),
  role: z.enum(['player','admin']),
  cities: z.object({ name_en: z.string(), name_gr: z.string(), code: z.string() }),
});
```

### 2.2 Update my profile
- **Call:** `supabase.from('users').update({ first_name, last_name, handle, city_id, skill_level, preferred_locale, positions, preferred_foot }).eq('id', userId)`
- **RLS:** `users_update_self_or_admin` + `tg_users_block_role_change` trigger prevents self-promotion.
- **Not updatable:** `role`, `stripe_customer_id`, `anonymized_at`, `id`.

### 2.3 List enabled cities
- **Call:** `supabase.from('cities').select('id, code, name_en, name_gr').eq('is_enabled', true).order('display_order')`
- **RLS:** `cities_select_public` — public.

---

## Flow 3 · Discover (pitch list)

### 3.1 List pitches in a city
- **Call:**
  ```ts
  supabase.from('pitches')
    .select('id, name, type, surface, price_per_hour_cents, amenities, hero_image_url, venues!inner(id, name, city_id, coords, cancellation_policy)')
    .eq('venues.city_id', cityId)
    .eq('is_verified', true)
    .eq('is_active', true)
    .order('price_per_hour_cents')
  ```
- **RLS:** `pitches_select_bookable_or_owner_or_admin` and the venue join is filtered by `venues_select_public_or_owner_or_admin`.
- **Filters** apply client-side in MVP: type, indoor/outdoor (surface='indoor'), price bucket.

### 3.2 Search pitches by name
- **Call:** same as 3.1 but with `.ilike('name', '%query%')`. Add a pg_trgm index in a future migration when usage justifies it.

### 3.3 Pitch distance sort
- **Location source:** `expo-location` gives the user's lat/lng.
- **Client-side sort** in MVP (pitch count is small). Stage 4: push into a Postgres RPC using `ST_Distance(coords, user_point)`.

---

## Flow 4 · Pitch Detail + Availability

### 4.1 Get pitch detail
- **Call:**
  ```ts
  supabase.from('pitches')
    .select(`
      id, name, type, surface, price_per_hour_cents, amenities, hero_image_url,
      venues!inner(id, name, address, coords, cancellation_policy, stripe_account_status),
      pitch_schedules(day_of_week, opens_at, closes_at, slot_duration_minutes)
    `)
    .eq('id', pitchId).single()
  ```
- **RLS:** public if bookable.

### 4.2 List available slots for a date range
- **Call:** RPC `get_available_slots(p_pitch_id, p_start_date, p_end_date)`.
- **Why RPC not client compute:** deriving slots from (schedules minus overrides minus existing bookings) in one query is far cheaper than 3 client round-trips, and centralises the logic for consistency with booking creation.
- **Signature (to be implemented in Stage 2):**
  ```sql
  CREATE FUNCTION get_available_slots(
    p_pitch_id uuid,
    p_start_date date,
    p_end_date date
  ) RETURNS TABLE (starts_at timestamptz, ends_at timestamptz, is_available boolean)
  LANGUAGE sql STABLE;
  ```
- **Output shape:** one row per candidate slot, including unavailable ones (so UI can show them struck-through).
- **Override precedence (M6 #41a):** a `pitch_schedule_overrides` row **replaces** its date's weekly windows rather than amending them, and carries its own `slot_duration_minutes`. So an override can open a day that has no weekly schedule row, and a partial closure is expressed by naming the hours that stay open. Before #41a the override was `COALESCE`d onto every weekly row, duplicating every slot on a split-window pitch — see [data-model.md](data-model.md) and [spikes/schedule-derivation-defects.md](spikes/schedule-derivation-defects.md).

---

## Funds flow (M6 #38, ADR-0026)

**Destination charges, platform as settlement merchant.** Every booking
charge is a PaymentIntent on the **platform** account with
`application_fee_amount` (Ludi's cut) and `transfer_data.destination`
(the venue's Express account). Ludi settles, carries refund/dispute
liability, and recovers from the venue by transfer reversal. `on_behalf_of`
stays unset — platform and venues are both EU, and the statement
descriptor is Ludi's.

**Refunds mirror the charge:** `refunds.create` sets
`reverse_transfer: true` and does **not** set `refund_application_fee`
(that flag pushes the fee to the connected account, not back to the
platform). Stripe reverses the transfer proportionally on partial
refunds, so customer, venue, and platform each give back their pro-rata
share with no additional arithmetic. Both refund paths
(`cancel-booking`, `admin-refund-booking`) follow this shape.

**Split payment (C2)** decides its own share mechanics against ADR-0026 —
destination charge per share versus platform shares plus one explicit
transfer — in its DATA_MODEL, not here.

---

## Flow 5 · Booking

### 5.1 Create booking (the critical path)
- **Edge Function:** `POST /create-booking`
- **Why Edge Function:** must atomically (a) validate slot is still free (b) compute `base_price_cents`, `addons_price_cents`, `total_cents`, `platform_fee_cents` (c) insert booking row with the EXCLUDE-protected invariant (d) create Stripe `PaymentIntent` with `application_fee_amount` and `transfer_data.destination` set to venue's Stripe account (e) insert `payments` row with status `requires_payment_method` (f) return the PaymentIntent `client_secret` to the app.

**Zod (input):**
```ts
const CreateBookingInput = z.object({
  pitch_id: z.string().uuid(),
  starts_at: z.string().datetime(),   // ISO-8601
  ends_at:   z.string().datetime(),
  addons: z.array(z.object({
    code: z.enum(['bibs','ball_rental']),
    quantity: z.number().int().positive(),
  })).default([]),
  notes: z.string().max(500).optional(),
});
```

**Zod (output):**
```ts
const CreateBookingOutput = z.object({
  booking: z.object({
    id: z.string().uuid(),
    code: z.string(),
    state: z.literal('pending'),
    total_cents: z.number().int(),
  }),
  payment: z.object({
    client_secret: z.string(),
    payment_intent_id: z.string(),
    publishable_key: z.string(), // Stripe publishable key — only non-secret bit
  }),
});
```

**What may be booked (2026-10-20):** the requested `[starts_at, ends_at)` must be exactly one slot that `get_available_slots` offers for that pitch on that venue-local day, still available — so the weekly hours, date overrides, closed days and composite blockers all apply. Bookings open 31 days ahead (the same range cap `get_available_slots` has), and a player holds at most 2 unpaid `pending` bookings at once.

**Error cases (discriminated union):**
- `SLOT_UNAVAILABLE` — another booking claimed the range, the range is not one of the pitch's slots that day, it has started, or it is more than 31 days ahead
- `PITCH_NOT_BOOKABLE` — pitch deactivated or venue Stripe restricted
- `VALIDATION_FAILED` — Zod rejected input
- `STRIPE_ERROR` — Stripe API failure; a generic message, with the Stripe error code in `details.stripe_code`
- `RATE_LIMITED` — 429: the player already has 2 bookings waiting for payment

### 5.2 Confirm payment (client-side)
After `/create-booking` returns, the app presents Stripe Payment Sheet with the `client_secret`. Stripe SDK calls Stripe directly — Ludi backend is not involved in the confirmation step. Apple Pay / Google Pay / card all go through the same Payment Sheet.

### 5.3 Webhook: payment_intent.succeeded
- **Edge Function:** `POST /stripe-webhook` (signature-verified)
- Handlers (one per event type, idempotent by `event.id`):
  - `payment_intent.succeeded` — update `payments.status`, flip `bookings.state` to `paid`, then to `confirmed` (auto-confirmation in MVP; Stage 4: venue may opt into manual confirm).
  - `payment_intent.payment_failed` — update `payments.status = 'failed'` with failure code. Booking stays in `pending` until timeout (cron cleanup every hour).
  - `charge.refunded` — update `payments.refunded_amount_cents`, set `payments.status` accordingly.
  - `account.updated` — update `venues.stripe_account_status`; cascade `pitches.is_verified` update.
  - `payout.paid` / `payout.failed` — upsert the payout into `venue_payouts` keyed on the payout id (41l). These fire on the venue's **connected account** (`event.account` → `venues.stripe_account_id`), so the Stripe webhook endpoint must be configured to **listen to events on connected accounts** or they never arrive. A payout on the platform account itself (no `event.account`) is acknowledged and skipped. `payout.failed` also logs loudly — the venue's bank rejected their money.

### 5.4 List my bookings
- **Call:**
  ```ts
  supabase.from('bookings')
    .select(`
      id, code, state, starts_at, ends_at, total_cents, platform_fee_cents,
      cancellation_policy, cancelled_at, cancellation_refund_cents,
      pitches!inner(id, name, venues!inner(id, name, city_id, cities(name_en, name_gr))),
      booking_addons(addon_code, quantity, unit_price_cents)
    `)
    .eq('user_id', userId)
    .order('starts_at', { ascending: false })
  ```
- **RLS:** `bookings_select_self_or_owner_or_admin` returns only user's own.

### 5.5 Cancel booking
- **Edge Function:** `POST /cancel-booking`
- **Why Edge Function:** must (a) compute refund amount per `cancellation_policy` and now-vs-slot (b) call Stripe refund API with `refund_application_fee: true` (c) update booking state and `cancellation_refund_cents`.

**Zod (input):**
```ts
const CancelBookingInput = z.object({
  booking_id: z.string().uuid(),
});
```

**Zod (output):**
```ts
const CancelBookingOutput = z.object({
  booking: z.object({
    id: z.string().uuid(),
    state: z.enum(['cancelled','cancelled_no_refund','refunded']),
    cancellation_refund_cents: z.number().int().nullable(),
  }),
});
```

**Cancellation policy logic:**

| Hours to slot | standard | strict | flex |
|---|---|---|---|
| >24h | 100% refund | 100% refund | 100% refund |
| 6–24h | 50% refund | 0% refund | 100% refund |
| <6h | 0% refund | 0% refund | 50% refund |
| kicked off | — | — | — |

Applied server-side in the Edge Function. From `starts_at` on, a booking holding money (`paid`, `confirmed`, a split still `collecting`) can no longer be cancelled: `409 ALREADY_STARTED`. The hourly cron flips a played game to `completed` only later, so the state alone does not say the game has happened. An unpaid `pending` booking can still be cancelled — that only releases its PaymentIntent. The `cancellation_policy` snapshot on the booking row protects the user from mid-booking policy changes (see data-model.md).

### 5.6 Walk-in booking (owner/admin, offline payment)
- **Edge Function:** `POST /create-walk-in-booking` (M6 #41j)
- **Why Edge Function:** must (a) authorise owner-or-admin explicitly (it writes as service role) (b) reuse the booking-code sequence and the EXCLUDE slot lock (c) write the offline `payments` row that makes walk-in revenue count in `v_venue_earnings_daily`. Deliberately separate from `create-booking`: no Stripe call anywhere on this path.
- **Auth:** caller must be platform admin or an owner/manager of the pitch's venue (403 `NOT_AUTHORIZED` otherwise).
- **Idempotency:** `Idempotency-Key` header **required** for `action: 'create'` (a front-desk double-tap must not double-book).
- **Bookability gate is weaker than 5.1 on purpose:** requires `pitch.is_active AND venue.is_active` only — no `is_verified`, no Stripe checks. A venue still onboarding Stripe takes cash walk-ins from day one.

**Zod (input)** — discriminated on `action`:
```ts
const WalkInInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    pitch_id: z.string().uuid(),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),   // 30 min – 8 h after starts_at
    customer_name: z.string().trim().min(1).max(120),
    customer_phone: z.string().trim().max(30).optional(), // digits server-side; a bare 8-digit 2x/9x gains 357 (2026-09-18)
    contact_id: z.string().uuid().optional(),         // the venue contact picked in the form; another venue's → 400 (2026-09-18)
    addons: z.array(z.object({ code: addonCode, quantity: z.number().int().positive().max(50) })).max(10).default([]),
    price_override_cents: z.number().int().min(100).max(500_000).optional(), // desk price replaces base; addons on top
  }),
  z.object({
    action: z.literal('cancel'),                      // walk-ins only; app bookings use 5.5 / admin refund
    booking_id: z.string().uuid(),
    reason: z.string().trim().max(200).optional(),
  }),
]);
```

**Effects (create):** booking row `state='confirmed'`, `origin='walk_in'`, `walk_in_name/phone` set, `user_id` = acting owner; payments row `status='succeeded'`, `payment_method='offline'`, `stripe_payment_intent_id='offline_<booking_id>'`; `platform_fee_cents` and `application_fee_cents` are always 0, because Ludi takes no fee on walk-ins (schema-enforced since `20260912000001`); `admin_actions` row `walk_in_created`. Errors: `SLOT_UNAVAILABLE` (409, EXCLUDE), `PITCH_NOT_BOOKABLE` (409).

**Effects (cancel):** state-guarded `confirmed | completed → cancelled`, offline payment `→ cancelled` (drops out of earnings), `admin_actions` row `walk_in_cancelled`. `completed` since 2026-09-13: the hourly completion flip made a mistyped walk-in uncorrectable once its slot ended. Refuses app bookings and walk-ins in any other state with `INVALID_BOOKING_STATE` (409).

---

### 5.7 Split fixtures (C2, docs/plans/split-payment.md)

`create-booking` accepts `split: boolean` (default false). When true, the
PaymentIntent charges only the organiser's **anchor share** as a plain
platform charge (ADR-0027 — no `transfer_data`, no application fee), the
booking gains `is_split` / `share_amount_cents` / `collect_deadline`
(kickoff − 24h; `SPLIT_TOO_LATE` inside 26h), and the anchor settling moves
the booking to `collecting`, which holds the slot like `paid` does.

- **`POST /claim-share`** `{ invite_token, slot_kind }` — the paid twin of
  `join_fixture()` (which refuses unconfirmed split fixtures). Seats the
  caller under the capacity trigger's lock and returns a PI client_secret
  for `share_amount_cents`. A re-call returns the SAME live PI. Errors:
  `INVALID_INVITE`, `NOT_SPLIT`, `CLAIM_NOT_OPEN`, `FIXTURE_STARTED`,
  `COLLECTION_CLOSED`, `ALREADY_PAID`, `FIXTURE_FULL`, `COVER_IN_FLIGHT`.
  The seat holds ~15 min; the expire-collecting sweep frees seats whose PI
  died.
- **`POST /cover-shortfall`** `{ booking_id }` — organiser only, any time
  while `collecting`: one PI for `total − Σ succeeded shares`. Errors add
  `NOTHING_TO_COVER`, `NOT_AUTHORIZED`, `BOOKING_NOT_FOUND`.
- **Webhook**: `payment_intent.succeeded` branches on `payments.kind`.
  share/cover → `settle_split_booking()` (service-role-only, FOR UPDATE,
  sum-exact) flips `pending→collecting→confirmed` and the handler creates
  the ONE venue Transfer (`transfer:{booking_id}`), recording
  `bookings.stripe_transfer_id`. A share settling after confirm refunds
  itself (`late-share-refund:{pi}`).
- **`POST /expire-collecting`** — the pg_cron+pg_net sweeper (5 min,
  shared-secret header `x-expire-secret`, `verify_jwt=false`): expires
  collecting fixtures past deadline+2h, refunds succeeded share/cover money
  on dead UNTRANSFERRED split fixtures 100%, un-seats stale claims.
- **Cancellation**: `cancel-booking` on `collecting` → flip then 100%
  fan-out (sweeper's idempotency keys, so crashes heal next tick); on
  confirmed split → policy bps fanned pro-rata per payment
  (`cancel-share:{payment_id}`) + one proportional transfer reversal
  (`cancel-reversal:{booking_id}`). `admin-refund-booking` refuses split
  fixtures.

### 5.8 Find my replacement (ADR-0044, docs/plans/find-my-replacement.md)

A player who cannot make it keeps the seat until someone takes it.

- **`rpc ask_replacement(p_booking_id)`** / **`rpc keep_my_seat(p_booking_id)`**
  — the caller's own seat; not the organiser (`ORGANISER_CANNOT_BE_REPLACED`),
  only on `paid`/`confirmed` and before kick-off (`LEAVE_INSTEAD` while a split
  fixture is collecting, `FIXTURE_NOT_LIVE`, `FIXTURE_STARTED`). The roster
  view carries `replacing_since` and `was_replaced`; `fixture_preview()`
  carries `gk_replacing` / `outfield_replacing`; the board and the venue's
  screen count an asked-for seat as open; `v_crew_seats` lists it to players
  who finished a match with the asker or the organiser.
- **`rpc take_seat(p_invite_token, p_slot_kind?)`** — the free swap: the
  longest-waiting ask goes out (`replaced_by` set), the caller comes in on its
  slot kind, one `seat_swaps` row `done`. Errors: `INVALID_INVITE`,
  `SEAT_NOT_TAKEABLE`, `FIXTURE_STARTED`, `ALREADY_IN`, `NO_SEAT_TO_TAKE`,
  `SEAT_REQUIRES_PAYMENT` (a paid split seat).
- **`POST /take-seat`** `{ invite_token, slot_kind? }` + `Idempotency-Key` —
  the paid swap on a confirmed split fixture (answers free seats too). The
  seat moves first (`begin_seat_swap`, service-only), then a share PI
  (`swap:{swap_id}`) for `share_amount_cents`; a re-tap returns the same PI.
  `200 { booking_id, taken, share_amount_cents, payment | null }`. Adds
  `ALREADY_PAID_HERE`.
- **Webhook**: a share PI linked to a `seat_swaps` row is settled by the swap
  branch before the late-surplus branch: the taker's share stands, the
  leaver's is refunded (`swap-refund:{payment_id}`), the swap is `done`. A
  swap the sweeper already reverted, or a fixture that died meanwhile,
  refunds the taker (`swap-void-refund:{pi}`).
- **Sweeper** pass d: pending swaps older than 15 minutes whose share never
  settled — cancel the PI, `revert_seat_swap` (taker out, leaver back in,
  still asking).
- **`POST /leave-share`** `{ booking_id }` — leaving a split fixture that is
  still collecting refunds the paid share 100% (`leave-refund:{payment_id}`)
  or cancels a live PI, then frees the seat; elsewhere it is the plain leave.
  Since 2026-10-20 the seat-out and the share's mark (`refunding`, which
  `settle_split_booking` does not count) happen in one locked transaction,
  `begin_leave_share`, before the Stripe refund. A refund Stripe refuses
  stays `refunding` and the sweeper's pass e retries it with the same key.
  `200 { left, refunded_cents, refund_pending_cents }`. Errors: `NOT_ON_ROSTER`,
  `ORGANISER_CANNOT_LEAVE`, `PAYMENT_IN_FLIGHT`. The database refuses the
  bare status flip on such a seat (`LEAVE_NEEDS_REFUND`).
- **`charge.refunded`** flips a booking to `refunded` only for a
  single-payer `kind='booking'` payment; a share or cover refund is one
  seat's money.

### 5.9 The keeper pool (ADR-0047, docs/plans/keeper-pool.md)

A fixture short a keeper is posted to the players in its city who said they
will go in goal; the first to claim it plays free.

- **`users.goes_in_goal`** — `full | rotation | no` (default `no`); the
  player's own column, written by the profile editor.
- **`rpc gk_post(p_booking_id, p_shape = 'full')`** → `(request_id,
  audience)` — the organiser posts (or re-shapes) the fixture's one open
  request; `audience` counts willing players in the city who are not on the
  roster. Errors: `GK_NOT_ORGANISER`, `GK_BAD_SHAPE` (`full | rotation`),
  `GK_FIXTURE_NOT_LIVE`, `GK_NO_PLACE`.
- **`rpc gk_withdraw(p_request_id)`** — the organiser's own open request.
- **`rpc gk_request_for(p_booking_id)`** → `(request_id, status, shape,
  claimed_by_name, audience)` — the fixture's latest open or claimed
  request, for its organiser.
- **`view v_keeper_requests`** — what a willing player can claim: open
  requests in his city that reach him (`full` always; `rotation` when the
  request asks twenty minutes or kickoff is inside 48 hours), on live future
  fixtures with a keeper place, not his own. Counts only, with the team's
  record (`keepers_would_return`, `keepers_played`).
- **`rpc gk_claim(p_request_id)`** → `booking_id` — first claim wins: a free
  gk slot, or the seat of a keeper who asked to be replaced (the ADR-0044
  swap). Errors: `NOT_SIGNED_IN`, `GK_REQUEST_NOT_FOUND`,
  `GK_ALREADY_TAKEN`, `GK_FIXTURE_NOT_LIVE`, `GK_NOT_IN_POOL`,
  `GK_ALREADY_IN`. The roster view carries `keeper_free`; that seat is never
  asked for a share.
- **`rpc gk_feedback_due(p_booking_id)`** → `(request_id, role, other_name)`
  — within 14 days of a played fixture, for the organiser or the keeper who
  has not answered yet.
- **`rpc gk_feedback_give(p_request_id, p_showed_up, p_again)`** — the
  organiser answers both; the keeper answers `p_again` (his `p_showed_up`
  is ignored). Errors: `GK_NOT_YOURS`, `GK_NOT_PLAYED_YET`,
  `GK_ANSWER_MISSING`.
- **`rpc my_keeper_record()`** → `(games, showed, no_shows, wanted_back)`.

### 5.10 Court cameras (ADR-0042, docs/plans/court-cameras.md)

Dark until a court has a camera row; only the founder creates one.

- **`rpc pitch_has_camera(p_pitch_id)`** (anon too) and
  **`rpc my_recording_default()`** — what the pitch screen's switch shows.
- **`rpc set_recording(p_booking_id, p_on)`** — the organiser, before
  kickoff. Errors: `REC_NOT_ORGANISER`, `REC_FROZEN`, `REC_NOT_LIVE`,
  `REC_NOT_APP` (walk-in, standing booking, CFA), `REC_NO_CAMERA`,
  `REC_MINOR`. Off deletes an armed recording that has not started.
- **`rpc recording_state(p_booking_id)`** → `(has_camera, consented,
  can_toggle, blocked_reason, recording_id, state, duration_s,
  expires_at)` — organiser and participants.
- **`rpc invite_recorded(p_invite_token)`** (anon too) — the invite says
  the game is recorded.
- **`POST /recording`** (JWT) — `{action:'url', booking_id}` → a player in
  on the booking gets `{recording_id, url, expires_in: 3600}`;
  `{action:'staff_url', recording_id, reason}` → admin, audited in
  `recording_access`, 15 minutes; `{action:'delete', recording_id}` → the
  organiser, file removed. Errors: `REC_NOT_VIEWER`, `REC_NOT_READY`,
  `REC_NOT_ORGANISER`, `REC_NOT_FINISHED`, `REC_NOT_STAFF`,
  `REC_REASON_REQUIRED`, `STORAGE_ERROR`.
- **`POST /recorder`** (`x-camera-token`, no JWT) — the box at the venue.
  `{action:'sync'}` → `{now, recordings[]}` (heartbeat + arming);
  `{action:'mark', recording_id, state, bytes?, duration_s?, failure?}`
  moves `scheduled → recording → processing → ready`, or to `failed`;
  `processing` also returns a signed upload `{bucket, path, token}`.
  Errors: `REC_UNKNOWN_DEVICE`, `REC_BAD_TRANSITION`,
  `REC_OUTSIDE_WINDOW`, `REC_NOT_CONSENTED`.
- **`POST /recordings-sweep`** (`x-sweep-secret`) — daily via pg_cron:
  stalled recordings fail; expired and deleted files are removed.
  `200 {purged, errors}`.
- **`rpc camera_register(p_pitch_id, p_vendor, p_device_ref)`** → the
  device token once; **`rpc camera_retire(p_camera_id)`**. Admin only.

## Flow 6 · Venue Owner

### 6.1 List my venues
- **Call:** `supabase.from('venues').select('*, pitches(id, name, is_active, is_verified)').in('id', myVenueIds)`
- Resolve `myVenueIds` first via `supabase.from('venue_owners').select('venue_id').eq('user_id', userId)`.
- **RLS:** `venues_select_public_or_owner_or_admin`.

### 6.2 List my pitch bookings
- **Call:** `supabase.from('bookings').select().in('pitch_id', myPitchIds).order('starts_at')`
- **RLS:** `bookings_select_self_or_owner_or_admin`.

### 6.3 Edit pitch schedule
- **Call:** `supabase.from('pitch_schedules').update(...).eq('id', scheduleId)`
- **RLS:** `pitch_schedules_owner_write`.

### 6.4 Stripe Connect onboarding
- **Edge Function:** `POST /venue-connect-onboard`
- **Auth:** **admin OR owner of the venue** (via `venue_owners`) — widened
  2026-08-31 (41m) now that the owner dashboard exists; the owner starts
  their own KYC from the setup checklist's Payment setup step. Since
  2026-09-13 that means `venue_owners.role = 'owner'`: a `manager` gets
  `403 NOT_AUTHORIZED` — bank details and payouts are the owner's.
- **Flow:** load venue → verify caller is admin or owner of it → if
  `venues.stripe_account_id` is null, create a Stripe **Express** account
  (`country: 'CY'`, `card_payments` + `transfers` capabilities,
  `metadata.venue_id`, **weekly payouts anchored Monday** — the site's
  "Weekly payouts" promise, 41l) and persist the id → mint a fresh hosted
  **account-onboarding link** → return its URL. A second call reuses the
  stored account id (no duplicate accounts), re-asserts the payout
  schedule (converges pre-41l accounts), and just mints a new link.
- **State machine:** `venues.stripe_account_status` starts `'pending'`; the
  `account.updated` webhook maps the Stripe account to
  `pending | active | restricted | disabled` (charges + payouts enabled →
  `active`; `disabled_reason` → `disabled`; `currently_due` items → `restricted`).
  A pitch can only be verified once its venue is `'active'` (see §7.2).
- **No `Idempotency-Key`:** account creation is guarded by the stored id; links
  are ephemeral.

**Zod (input):**
```ts
const VenueConnectOnboardInput = z.object({
  venue_id: z.string().uuid(),
  return_url: z.string().url().optional(),  // admin UI supplies its origin
  refresh_url: z.string().url().optional(),
});
```

Both URLs must be on the admin site's origin (`ADMIN_SITE_URL`, falling back to `https://ludi-admin.vercel.app`); anything else is `400 VALIDATION_FAILED`. Omitted, they default to the admin's home page. The first call per venue creates the Express account with Stripe idempotency key `connect-account:{venue_id}` and stores its id only while `stripe_account_id` is still empty, so concurrent first calls end on one account.

**Response:** `{ stripe_account_id, account_link_url, expires_at, stripe_account_status }`.

### 6.5 Stripe Express dashboard login (41l)
- **Edge Function:** `POST /venue-express-login`
- **Why:** an Express account has no Stripe login of its own — the platform
  mints one-time login links or the owner sees nothing. Balance, next payout
  date, payout history and bank details all live behind this link; the
  `venue_payouts` mirror on the Earnings page shows history, Stripe stays
  the source of truth.
- **Auth:** admin OR owner of the venue (`venue_owners.role = 'owner'`;
  managers get 403, since 2026-09-13).
- **Flow:** load venue → authorise → `409 NO_STRIPE_ACCOUNT` if onboarding
  never started → `stripe.accounts.createLoginLink(account_id)` → return
  `{ login_url }`. Links are single-use and expire; no idempotency needed.

**Zod (input):**
```ts
const VenueExpressLoginInput = z.object({ venue_id: z.string().uuid() });
```

**Errors:** `VENUE_NOT_FOUND` (404), `NOT_AUTHORIZED` (403),
`NO_STRIPE_ACCOUNT` (409), `STRIPE_ERROR` (502).

---

## Flow 7 · Admin

### 7.1 List all bookings
- **Call:** `supabase.from('bookings').select(...)` with no filter; RLS `is_admin()` allows full read.

### 7.2 Verify / deactivate pitch
- **Edge Function:** `POST /admin-toggle-pitch`
- Flow: verify caller is admin → load pitch + parent venue → guard transition (`verify` requires venue `stripe_account_status='active'`) → flip `is_verified` or `is_active` (scoped by prior boolean to no-op concurrent toggles) → insert `admin_actions` row.
- One call = one boolean change = one audit row. Supports `verify` / `activate` / `deactivate`. Unverify deferred (admin_actions.action_type CHECK doesn't include `unverify_pitch` yet).
- `Idempotency-Key` is **optional**: a duplicate "verify" on an already-verified pitch returns `409 INVALID_PITCH_TRANSITION`, not a second audit row, so the no-key path is safe.

**Zod (input):**
```ts
const AdminTogglePitchInput = z.object({
  pitch_id: z.string().uuid(),
  action: z.enum(['verify', 'activate', 'deactivate']),
  reason: z.string().min(10).max(500),
});
```

### 7.3 Admin refund
- **Edge Function:** `POST /admin-refund-booking`
- Flow: verify caller is admin → Stripe refund → accumulate `cancellation_refund_cents` → insert admin_actions row.
- **Full vs partial (2026-09-13):** only a refund that brings the running total to `total_cents` moves the booking to `refunded_by_admin` (cancelled, slot freed). A partial refund leaves the booking in its state, holding its slot, and can be followed by another; `cancel-booking` caps a later player cancellation at what is still refundable.
- **Response:** `{ booking: { id, state, refund_cents, total_refunded_cents }, admin_action_id }`.

**Zod (input):**
```ts
const AdminRefundInput = z.object({
  booking_id: z.string().uuid(),
  amount_cents: z.number().int().positive().nullable(), // null = full refund
  reason: z.string().min(10).max(500),
});
```

### 7.4 Dashboard metrics
- **View:** `v_gmv_daily(day, gross_cents, refunded_cents, net_cents, payments_count, bookings_count)` — daily payments rollup bucketed by Europe/Nicosia local date. Stripe payments only: walk-in (offline) cash is the venue's, not money through Ludi (since 2026-09-13). Excludes pending/failed/cancelled payments. Refunds attributed to the original payment date. RLS inherited from `payments`, so admins see the full platform rollup.
- **Admin call:** `supabase.from('v_gmv_daily').select(...).gte('day', from).lte('day', to)`. The admin app's `/gmv` page renders the last 7/30/90 days as a stacked bar chart (kept vs refunded) plus totals.
- **RPC (deferred):** `get_platform_metrics(p_from date, p_to date)` returning GMV/net/active counts in one call. Will join `v_gmv_daily` with a future `v_venue_payouts`. Not in MVP — the view-direct path covers the dashboard's needs today.

### 7.5 Invite a venue owner ([ADR-0024](adr/0024-owner-sign-in-email-magic-link.md))
- **Edge Function:** `POST /invite-venue-owner`
- **Why Edge Function:** creating an auth account needs the service-role key, which the admin app must not hold (ADR-0019). Exists because closing signup removed the self-serve step the old flow depended on — without it, a new owner cannot be onboarded at all.
- **Auth:** caller must be `role = 'admin'` (403 `NOT_AUTHORIZED`).
- **Does invite AND grant in one call**, deliberately: an invited account nobody granted, or a grant pointing at nothing, are states a founder should never have to reason about mid-handover.

**Zod (input):**
```ts
const InviteOwnerInput = z.object({
  venue_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(254),
  owner_role: z.enum(['owner','manager']).default('owner'),
  first_name: z.string().trim().max(60).optional(),  // → user metadata, so the
  last_name:  z.string().trim().max(60).optional(),  //   access card shows a name
  preferred_locale: z.enum(['en','gr']).default('gr'), // → user metadata → users.preferred_locale (ADR-0037)
  confirm_new_person: z.boolean().default(false),    // see POSSIBLE_DUPLICATE
});
```

`preferred_locale` is the dashboard's language for the account the invite creates: the signup trigger copies it from the invite metadata into `users.preferred_locale`, and the admin renders the owner surface in it ([ADR-0037](adr/0037-owner-dashboard-language-follows-the-account.md)). Greek by default; the owner can switch it from the shell bar.

**Output:** `{ owner: { user_id, email, owner_role }, invited: boolean }`. `invited` is false when the address already had a Ludi account — access is granted and **no email is sent**, so the caller can say the right sentence.

**An owner's grant starts pending (2026-10-20).** When a venue's owner adds someone, the `venue_owners` row is written with `accepted_at` NULL and `invited_email` set. Until the person opens the venue in the dashboard (the admin app calls `accept_venue_access()` when it loads their venues), `venue_people()` shows the owner only the address they typed and the role — not the person's name, phone, own email or sign-in history. A founder's grant is accepted on insert. The address lookup is `account_id_for_email()`, callable only with the service-role JWT; the owner-callable `venue_invite_lookup` is gone. An owner may send at most 5 invites in 24 hours (counted from `admin_actions`, so removing someone does not refund the count): `429 RATE_LIMITED`.

**Errors:** `VENUE_NOT_FOUND` (404), `ALREADY_GRANTED` (409), `POSSIBLE_DUPLICATE` (409 — the venue already has a phone-only owner and the email matched no account, so this invite may mint a second account for the same human; `details.phone_only_owners` lists them, and resending with `confirm_new_person: true` asserts the invitee really is someone new), `RATE_LIMITED` (429, owner callers only — see above), `INTERNAL_ERROR` (500 when `ADMIN_SITE_URL` is unset — it refuses rather than sending an invite whose link goes nowhere; 502 with a generic message when SMTP rejects, the cause in the function log).

**Failure atomicity (41n):** if the grant insert fails after a fresh invite, the just-created auth account is deleted so no half-state survives — the emailed link is voided and a retry mints a fresh one. If even that delete fails, the retry self-heals: the email lookup finds the orphan account and takes the grant-only path.

**Required configuration** — the flow silently misbehaves without both:

| Setting | Where | Why |
|---|---|---|
| `ADMIN_SITE_URL` | Edge Function secret | Where the invite link returns. Never read from the request — an attacker-supplied redirect in an email we send is an open redirect with our name on it. |
| Admin origin in **Redirect URLs** | Auth → URL Configuration | GoTrue silently substitutes `site_url` for any `redirect_to` not on the allowlist. Verified 2026-08-29: without it the invite link came back pointing at the *mobile* app's URL. The email still sends, so this fails quietly. |
| Production SMTP | Auth → SMTP Settings | Supabase's built-in mailer is rate-limited to a handful per hour and is not for production. |

**The link itself** lands on `/auth/callback` in the admin app, which is a **client** page on purpose: the default email templates deliver tokens in the URL *fragment*, which is never transmitted to a server, so a route handler would reject valid invites. It handles the implicit fragment, PKCE `?code`, and `?token_hash` shapes, so the email templates can change without the code changing.

---

### 6.6 The booking desk (ADR-0046, docs/plans/whatsapp-desk.md)

- **`rpc desk_add(p_venue_id, p_sender_name, p_sender_phone, p_body)`** —
  owner or manager pastes a message. `DESK_EMPTY` on an empty body.
- **`rpc desk_set_status(p_id, p_status, p_booking_code?)`** — `booked`
  (with a walk-in code of the same venue, else `DESK_BOOKING_NOT_FOUND`),
  `declined`, `dismissed`, or back to `new`.
- **`rpc desk_free_courts(p_venue_id, p_starts_at, p_ends_at)`** — the
  venue's active courts with nothing live on them or on a court that
  blocks them, and not closed that day.
- **`rpc desk_connect_number(p_venue_id, p_phone_number_id, p_display_phone)`**
  — admin only; a null id disconnects.
- **`GET|POST /whatsapp-inbound`** — Meta's webhook (`verify_jwt=false`).
  GET answers `hub.challenge` when `hub.verify_token` equals
  `WHATSAPP_VERIFY_TOKEN`. POST requires `X-Hub-Signature-256` over the raw
  body with `WHATSAPP_APP_SECRET`; text messages go to
  `desk_receive_whatsapp` (service only), unknown numbers and redeliveries
  are ignored. 503 until both secrets are set.
- **`POST /whatsapp-reply`** `{ inbox_id, text }` — staff of the venue; the
  message must have come by WhatsApp within 24 hours and the venue's number
  be connected (`WHATSAPP_TOKEN`). Errors: `NOT_FOUND`, `NOT_AUTHORIZED`,
  `NOT_CONNECTED`, `WINDOW_CLOSED`, `WHATSAPP_ERROR`.

### 6.7 The venue's own link (docs/plans/reach.md R1)

- **`venues.slug`** — `ludi.football/v/<slug>`; lowercase, digits and
  dashes, 3–40 characters, unique; readable by anyone (column grant),
  written by the admin only (the venue column guard). NULL = no page.
- **`rpc venue_page(p_slug)`** (anon) → `(venue_id, name, address,
  city_code, city_name_en, city_name_gr, lat, lng, contact_phone,
  bookable, courts, formats[], from_price_cents, opens_today,
  closes_today)` — one row for an active venue; live courts only; today's
  hours across courts not closed today; `bookable` = Stripe active and a
  live court. Nothing for an inactive venue or an unknown slug.
- **`rpc venue_slugs()`** (anon) — active venues' slugs, for the sitemap.
- The page's *Open in Ludi* is `ludi://venue/<venue_id>`; *Get the app*
  is `/get?s=<slug>-page` (the scan source gains the `page` piece).

### 6.8 Maps (docs/plans/maps.md)

Migration `20261014000002_maps.sql`; views re-stated with columns
appended.

- **`v_fixture`** gains `venue_id`, `venue_address`, `lat`, `lng`;
  **`v_open_fixtures`** and **`v_keeper_requests`** gain `venue_id`,
  `lat`, `lng`; **`rpc fixture_preview(p_token)`** gains `lat`, `lng`.
  The venue's point, for directions and for the pins; null when the
  venue has no coordinates.
- **`rpc venue_pins()`** (anon, definer) → `(slug, name, lat, lng,
  city_code, courts, bookable)` — active venues with a slug and a point;
  `courts` = live courts, `bookable` as `venue_page`. The site's maps.
- **`rpc my_grounds()`** (authenticated, definer) → `(venue_id, name,
  slug, lat, lng, games, last_played)` — the caller's completed bookings
  with a seat `in`, grouped by venue, most games first. Own rows only.

### 6.9 The push substrate (docs/plans/reach.md R2)

Migration `20261014000003_push_substrate.sql`. Nothing is sent yet — the
ledger and the sender are R3 (ADR-0048).

- **`push_tokens`** (`id`, `user_id`, `token` UNIQUE, `platform` ios |
  android, `created_at`, `last_seen_at`, `disabled_at`, `disabled_reason`)
  — one row per device token, owned by whoever signed in on the device
  last. RLS on with no policies and table privileges revoked: the app
  neither reads nor writes it; the service role reads it when sending.
  The token must look like `ExponentPushToken[…]`.
- **`rpc register_push_token(p_token, p_platform)`** (authenticated,
  definer) — insert, or move the token to the caller and clear
  `disabled_*`; `last_seen_at` = now. Called after the permission is
  granted and on every launch. `42501 NOT_SIGNED_IN` signed out.
- **`rpc unregister_push_token(p_token)`** (authenticated, definer) —
  deletes the caller's own row; someone else's token is untouched. Called
  on sign-out, before the session goes.
- **`users.notify_games`, `users.notify_asks`** `boolean NOT NULL DEFAULT
  true` — the two switches, written through the player's own-row policy.
- **The app:** the permission is asked at four moments only — a booking
  confirmed, a fixture joined, *in goal* switched on, a replacement asked
  for — never at launch. A notice's `data.url` is `/booking/<uuid>` or
  `/community`; anything else is ignored on tap. `anonymize-me` deletes
  the player's tokens.

### 6.10 The player's notices (ADR-0048, docs/plans/reach.md R3)

Migration `20261014000004_player_notifications.sql`; function
`notify-players`; shared `_shared/notices.ts`.

- **`player_notifications`** (`id`, `user_id`, `kind`, `booking_id`,
  `ref_id`, `channel` push | email, `send_after`, `status` pending |
  sending | sent | failed | skipped, `attempts`, `claimed_at`, `sent_at`,
  `error`, `expo_tickets` jsonb `[{token, id}]`, `receipt_checked_at`,
  `created_at`) — one row per player, cause and channel,
  `UNIQUE NULLS NOT DISTINCT (kind, booking_id, ref_id, user_id,
  channel)`. Kinds: `booking_confirmed`, `reminder`, `fixture_cancelled`,
  `keeper_wanted`, `keeper_found`, `seat_offered`, `seat_taken`,
  `game_full`. RLS: a player reads their own rows; nobody writes from
  the app.
- **`notice_send_after(p_kind, p_kickoff, p_now)`** (immutable) — now,
  or 08:00 Cyprus for an ask minted 23:00–08:00 unless kickoff is before
  11:00; a player's own game is never held.
- **`mint_player_notice(p_user_id, p_kind, p_booking_id, p_ref_id,
  p_send_after)`** (definer, internal — the R4/R5 triggers call it) →
  rows inserted: a push row (`pending`, or `skipped` with `no_token` /
  `switched_off`), and an email row for `booking_confirmed` and
  `fixture_cancelled` when the player has an address. Nothing for an
  erased account. Once per cause and recipient.
- **Service role only:** `claim_player_notifications(p_limit)` → due
  rows flipped to `sending`, with `locale`, `first_name`, `email`,
  `tokens[]`, `code`, `starts_at`, `invite_token`, `pitch_name`,
  `venue_name`, `context` (`shape`, `keeper_name`, `slot_kind`); claims
  older than ten minutes are released first. `player_notification_sent
  (id, tickets)`, `player_notification_failed(id, error)` (pending again
  with a growing wait, `failed` after five), `player_notification_skipped
  (id, reason)`, `disable_push_token(token, reason)`,
  `player_notification_receipts(limit)` (sent pushes older than fifteen
  minutes, unread), `player_notification_receipt_checked(id, error)`.
- **`notify-players`** — `POST`, header `x-notify-secret` =
  `NOTIFY_PLAYERS_SECRET`; every minute from pg_cron (`ludi-notify-players`,
  Vault `notify_players_url` / `notify_players_secret`). Expo push a
  hundred messages a request (`EXPO_PUSH_URL`, `EXPO_RECEIPTS_URL`
  overridable for tests; `EXPO_ACCESS_TOKEN` optional); Resend when
  `RESEND_API_KEY` is set (`NOTIFY_EMAIL_FROM`, `SITE_ORIGIN`), else the
  email rows are `skipped` `no_email_channel`. Returns `{push_sent,
  email_sent, skipped, failed, tokens_disabled, receipts}`.

### 6.11 The player's own game is minted (docs/plans/reach.md R5)

Migration `20261015000001_confirmation_and_reminder.sql`. The first
two minters of §6.10's ledger; walk-ins and standing series mint
nothing.

- **`tg_bookings_notify_state`** (AFTER INSERT OR UPDATE OF state on
  `bookings`, definer) — entering `paid` or `confirmed` from anything
  else mints `booking_confirmed` for the organiser, once; leaving a
  live state for `cancelled` / `cancelled_no_refund` / `refunded` /
  `refunded_by_admin` mints `fixture_cancelled` for every seat still
  `in`, the organiser included. A booking that was never live dies
  silently.
- **`mint_reminders(p_now)`** (definer, internal) → rows minted: for
  every seat `in` a live app game kicking off in `(p_now + 1h50m,
  p_now + 2h]`, a `reminder` due at once (never held by quiet hours).
  pg_cron `ludi-mint-reminders` every five minutes; the window overlaps
  and the ledger dedups. A game booked inside the two hours gets no
  reminder — its confirmation said when it is.

### 6.12 The asks are minted (docs/plans/reach.md R4)

Migration `20261015000002_the_asks.sql`. Every audience is the query
the feature already uses, restated from the request's side; the two
switches and the quiet hours are `mint_player_notice`'s.

- **`keeper_wanted`** — `tg_gk_requests_notify` on INSERT of an open
  request calls `mint_keeper_wanted(request_id)`: every player in the
  venue's city for whom `gk_audience_ok(goes_in_goal, shape, starts_at)`
  holds, not the organiser, not on the roster, while the request is
  open, the game live and a keeper place open. `mint_keeper_asks()`
  every five minutes (`ludi-mint-keeper-asks`) runs it again for every
  open request, so the reserve is asked once kickoff is inside 48
  hours; the ledger mints each player once. `ref_id` = the request.
- **`keeper_found`** — the same trigger on `open → claimed`: the
  organiser (`requested_by`), `ref_id` = the request; the sender's
  context carries the keeper's first name.
- **`seat_offered`** — `tg_booking_participants_notify` when
  `replacing_since` goes from NULL to set calls
  `mint_seat_offered(participant_id)`: players who finished a match
  with the asker or the organiser, not on this roster, not either of
  them (`v_crew_seats` from the seat's side). `ref_id` = the seat; a
  seat asked for again tells the crew nothing new.
- **`seat_taken`** — `tg_seat_swaps_notify` when a swap is `done` (born
  done for a free seat; settled by the webhook for a paid one): the
  asker, `ref_id` = their seat. A reverted swap tells nobody.
- **`game_full`** — the participants trigger on a seat coming `in`
  calls `mint_game_full(booking_id)`: the organiser when every gk and
  outfield slot is in, once per booking; never for a walk-in or a
  series.

### 6.13 Competitions (ADR-0050, docs/plans/fixtures-and-scores.md F1)

Migration `20261015000003_competitions.sql`.

- **`competitions`** (`id`, `venue_id`, `name`, `kind` cfa_grassroots |
  league | tournament, `season` `YYYY-YY`, `scores_public`, `has_table`,
  `status` active | finished | archived, `created_by`, timestamps).
  `scores_public` / `has_table` default by kind; `has_table` is never
  true for `cfa_grassroots`; one `cfa_grassroots` per venue and season.
- **`competition_teams`** (`id`, `competition_id`, `name`) — unique per
  competition on `lower(btrim(name))`. No rosters.
- **`competition_matches`** (`id`, `competition_id`, `booking_id`
  UNIQUE NULL, `round_label`, `category`, `home_team_id`, `away_team_id`,
  `kickoff_at`, `status` scheduled | played | postponed | cancelled,
  `home_score`, `away_score` 0–99 both or neither and only when played,
  `result_by`, `result_at`, `created_by`, `created_at`).
- RLS: the venue's owner (and manager) and admin read all three; no
  client writes. Public reads arrive as definer RPCs that apply
  `scores_public` (F4/F6).
- **`competition_season(date)`** → `'2026-27'` (August to July).
- **`cfa_matches`** is now a `security_invoker` view over the model with
  the old columns (`id, venue_id, booking_id, match_date, round_label,
  kickoff, category, home_team, away_team, created_by, created_at`);
  embedding `booking:bookings(...)` still works. Transitional.
- **`rpc load_cfa_round(p_venue_id, p_date, p_round, p_matches)`** —
  unchanged signature and result; now writes the venue's CFA
  competition for the season (made private and tableless on first
  use), its teams by name, and a match per placed row. A row whose two
  teams are the same name is skipped `invalid`.

## Edge Function inventory (summary)

All Edge Functions live in `packages/supabase/supabase/functions/`. Deno runtime, uses service role key from env.

| Function | Auth | Idempotent | Purpose |
|---|---|---|---|
| `create-booking` | user | yes via `Idempotency-Key` header | Atomically create booking + PaymentIntent |
| `cancel-booking` | user | yes | Apply cancellation policy + Stripe refund |
| `stripe-webhook` | signature | yes via event.id | Reconcile payment state |
| `venue-connect-onboard` | owner (not manager)/admin | reuse-guarded | Create/reuse Stripe Express account (weekly payouts) + onboarding link |
| `venue-express-login` | owner (not manager)/admin | no — links are single-use | Mint a one-time Stripe Express dashboard login link |
| `admin-refund-booking` | admin | yes | Override refund with audit trail |
| `admin-toggle-pitch` | admin | optional | Verify / activate / deactivate a pitch with audit trail |
| `anonymize-me` | user | yes | GDPR deletion |
| `create-walk-in-booking` | owner/admin | **required** `Idempotency-Key` on create | Front-desk booking paid offline; no Stripe call |
| `invite-venue-owner` | admin | no — `ALREADY_GRANTED` is the guard | Create the owner's account and grant venue access in one step |
| `take-seat` | user | yes via `Idempotency-Key`; a re-tap returns the same PI | Take a seat a player is handing over; pays the share on a split fixture (ADR-0044) |
| `leave-share` | user | refund keyed per payment | Leave a collecting split fixture with the share refunded |
| `whatsapp-inbound` | Meta signature | yes via the message id | Booking messages on a venue's connected number into its desk |
| `whatsapp-reply` | staff | no | Answer a desk message from the venue's connected number |
| `recorder` | camera token | yes: the state machine refuses repeats | The court recorder's heartbeat, arming and state (ADR-0042) |
| `recording` | user | delete is idempotent | Watch a recording (roster), staff read (audited), organiser delete |
| `recordings-sweep` | cron secret | yes | Thirty-day expiry and deferred file removal |

Each function has:
- Zod schema for request body
- Typed response
- Structured error responses: `{ error: 'ERROR_CODE', message: string, details?: unknown }`
- Signature verification (for webhook) or session validation (for user-called)
- Tracing span via OpenTelemetry (Stage 4+; use console.log with request ID for MVP)

---

## Real-time (Supabase Realtime) — Stage 3+

MVP doesn't subscribe to Realtime channels. Stage 3 adds:
- `matches:${match_id}` for live spot fill/cancel
- `bookings:venue:${venue_id}` for owner's live booking feed

Realtime requires enabling publication on specific tables — a separate migration when it's needed.

---

## Rate limits & abuse

MVP relies on Supabase's default rate limits. Additional bounds to add in Stage 3:
- `create-booking`: 5 per user per minute (prevent mashing)
- `auth.signInWithOtp`: 3 per phone per hour (prevent SMS toll fraud — Supabase has a built-in cap, tune)
- `cancel-booking`: 10 per user per hour

Implementation: Edge Function middleware reading from `rate_limits` table (not yet designed; spec in Phase 7 threat model).

---

## Changelog

- **2026-10-15 (evening)** — §6.13 competitions: `competitions`, `competition_teams`, `competition_matches`, `competition_season`; `cfa_matches` becomes a view; `load_cfa_round` writes the model.
- **2026-10-15 (later)** — §6.12 the asks are minted: `mint_keeper_wanted`, `mint_keeper_asks`, `mint_seat_offered`, `mint_game_full`, the three triggers, `ludi-mint-keeper-asks`.
- **2026-10-15** — §6.11 the player's own game is minted: `tg_bookings_notify_state`, `mint_reminders`, `ludi-mint-reminders`.
- **2026-10-14 (night)** — §6.10 the player's notices: `player_notifications`, `mint_player_notice`, the sender's helpers, `notify-players`.
- **2026-10-14 (evening)** — §6.9 the push substrate: `push_tokens`, `register_push_token`, `unregister_push_token`, the two switches on `users`.
- **2026-10-14** — §6.8 maps: the fixture, board and keeper views and
  `fixture_preview` carry the venue's point; `venue_pins`, `my_grounds`.
- **2026-10-13** — §6.6 the booking desk: `desk_*` RPCs, `whatsapp-inbound`, `whatsapp-reply`.
- **2026-10-13** — §5.8 find my replacement: `ask_replacement`, `keep_my_seat`, `take_seat`, `take-seat`, `leave-share`; the webhook's swap branch; `charge.refunded` stops flipping split fixtures on a share refund.
- **2026-04-21** — Phase 4. Initial contract. All 6 Edge Functions listed by signature; implementation lands in Stage 2.
