# M2 #9 — Booking flow + Stripe Payment Sheet

**Drafted:** 2026-04-28 (end of M2 #7+#8 day)
**Target:** Wed 04-29 → Thu 04-30 (L, ~6h spread across two days)
**Branch model:** start fresh `feat/booking-flow` after PR #11 merges; no stacking on the open PR.

---

## Goal
Andreas, signed in, is on the pitch detail screen. He taps a slot, accepts the mandatory addons, taps **Book €N**, completes Apple Pay or card via Stripe Payment Sheet, and lands on a confirmation screen showing the booking code. End-to-end, ≤ 60 seconds, recordable as a screen video — this commit ticks the M2 exit criteria.

## Scope (what ships in the commit)
1. **Slot selection** on detail screen: tap toggles highlight, second tap deselects, only one slot at a time.
2. **Mandatory addons UI**: bibs + ball_rental default-on per [memory: Cyprus mandatory addons](../.claude/projects/-Users-nikolasneofytou-dev-Ludi/memory/project_cyprus_mandatory_addons.md). Quantity stepper for each (default 1, min 1, max 4 for bibs / max 2 for ball_rental). User cannot uncheck — they're legally required.
3. **Price summary**: base (`price_per_hour_cents`) + addons (€5/bib set × qty + €3/ball × qty) = total. Recompute reactively as quantities change.
4. **Book CTA**: bottom sticky button, label `Book €{total}`, disabled until slot selected.
5. **Booking submit**: `POST /create-booking` with `Idempotency-Key: <uuid v4>` (regenerated per attempt, not per render). On `SLOT_UNAVAILABLE`, refetch slots + show toast "Slot just got taken". On `PITCH_NOT_BOOKABLE`, send back to Discover with toast.
6. **Stripe Payment Sheet**: present with returned `client_secret` + `publishable_key`. Apple Pay enabled iff merchant ID configured (Thu task).
7. **Polling for confirmation**: after Sheet returns success, poll `bookings.state` every 2s, max 20s. States: `pending` → `paid` → `confirmed`. On `confirmed`, navigate to confirmation screen with booking code. On 20s timeout, show "Payment is taking longer than expected" screen with a "Check status" button that re-polls.
8. **Confirmation screen** at `/booking/[id]/confirmed`: booking code, date/time, venue, total, "Done" → goes to Bookings tab (which is currently a placeholder; #10 fills it).

## Out of scope
- The bookings list screen (M2 #10).
- Cancellation flow (M3 #11/#12).
- Apple Pay merchant ID configuration — done as a separate Thu commit; card-only Payment Sheet works without it.
- Price-by-policy display (cancellation refund preview) — adds in #12.
- Coupon codes / discount UI — not on the roadmap.
- Optimistic UI / offline queue — pure round-trip for MVP.

## File plan

### Modify
- `apps/mobile/app/pitch/[id].tsx` — add slot selection state, addon panel, sticky Book CTA, `useRouter().push('/booking/[id]/checkout')` on tap.
- `apps/mobile/app/_layout.tsx` — wrap with `<StripeProvider publishableKey={...}>`. Publishable key comes from create-booking response, but provider needs it at mount; bootstrap from env (`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`) or fetch a tiny `/stripe-config` Edge Function. **Decision:** env var, since it's already public. Add to `.env.local` + `.env.example`.
- `apps/mobile/app.json` — add `@stripe/stripe-react-native` plugin block; `merchantIdentifier` placeholder until Thu.
- `packages/ui/src/copy.ts` — new strings: `bookCta`, `addonBibs`, `addonBallRental`, `addonsRequiredNote`, `bookingProcessing`, `bookingTakingLong`, `bookingConfirmed`, `bookingCode`, `errorSlotTaken`, `errorPitchUnbookable`, plus EN+GR.

### Create
- `apps/mobile/src/lib/booking.ts` — typed wrapper around `/create-booking` (uuid v4 idempotency key, error normalization to a discriminated union, `pollBookingState(id, signal): Promise<'confirmed' | 'timeout'>`).
- `apps/mobile/src/lib/stripe-checkout.ts` — wraps `useStripe().initPaymentSheet()` + `presentPaymentSheet()` into one `runCheckout({clientSecret, publishableKey}): Promise<'success' | 'cancelled' | 'failed'>`.
- `apps/mobile/app/booking/[id]/checkout.tsx` — orchestrator: receives `pitch_id, starts_at, ends_at, addons` via route params, calls `createBooking()`, presents Sheet, polls, navigates. Single file owns the entire booking attempt's lifecycle so retries/cancels are coherent.
- `apps/mobile/app/booking/[id]/confirmed.tsx` — final screen. Reads booking row (or accepts as route param to avoid an extra round-trip).

### Install
- `@stripe/stripe-react-native` (current SDK 0.41.x for Expo SDK 54).
- `uuid` (or use Web Crypto's `randomUUID()` — RN 0.81 supports it via Hermes; **decision:** use `crypto.randomUUID()`, no dep).

## Data flow (happy path)
```
[detail screen]
  user picks slot → setSelectedSlot(s)
  user adjusts addon quantities → addons state
  taps "Book €N"
  router.push('/booking/{pitchId}/checkout', { startsAt, endsAt, addons })

[checkout screen — mounts]
  useEffect:
    idempotencyKey = crypto.randomUUID()
    {booking, payment} = await createBooking({pitch_id, starts_at, ends_at, addons}, idempotencyKey)
    result = await runCheckout({clientSecret: payment.client_secret, publishableKey: payment.publishable_key})
    if cancelled → router.back()
    if failed → show error, allow retry (NEW idempotency key)
    if success →
      state = await pollBookingState(booking.id, AbortSignal.timeout(20_000))
      if confirmed → router.replace('/booking/{booking.id}/confirmed', {code: booking.code})
      if timeout → show "taking longer", button re-polls

[stripe webhook, server-side, parallel]
  payment_intent.succeeded → bookings.state = 'paid' → 'confirmed'
```

## State machines

### Slot selection (detail screen)
```
none ── tap available slot ─────► selected(slot)
selected(s) ── tap same slot ───► none
selected(s) ── tap other slot ──► selected(other)
selected(s) ── tap unavailable ─► selected(s)  (no-op)
```

### Booking attempt (checkout screen)
```
idle → creating → presenting → polling ─┬─► confirmed (terminal)
                              ─────────┴─► timeout → polling-resume → confirmed
                ───► error(reason) → idle (retry → fresh idempotency key)
                ───► cancelled → router.back()
```

## Idempotency rules
- **One key per user attempt**, regenerated when user taps "Try again". Same key reused across retries within a single mount **only** if the request body hash is identical (the `idempotency_keys` table guards mismatches with `IDEMPOTENCY_MISMATCH`).
- Don't put the key in React state — `crypto.randomUUID()` inside the submit handler. State persists across renders; we want a new key per *attempt*.
- Never reuse a key from a previous booking — even if the body matches.

## Error handling matrix

| Error code | UX |
|---|---|
| `SLOT_UNAVAILABLE` | Toast "Just got taken — pick another time", refetch slots, send user back to detail |
| `PITCH_NOT_BOOKABLE` | Toast "This pitch can't be booked right now", `router.replace('/(tabs)')` |
| `VALIDATION_FAILED` | Should not happen if client validates; show generic "Couldn't submit", log details |
| `STRIPE_ERROR` | "Payment service is unavailable. Try again." Allow retry with new idempotency key |
| `RATE_LIMITED` | "Too many attempts. Wait a minute." Disable retry for 60s |
| `IDEMPOTENCY_MISMATCH` | Should not happen; if it does, generate a new key and retry once silently |
| Network error | "Connection lost. Try again." Inline retry |
| Sheet `cancelled` | `router.back()` to detail (no error UI — user chose this) |
| Sheet `failed` | "Card declined. Try a different card." Stay on checkout, retry button |
| Polling timeout | "Payment is taking longer than expected. We'll confirm shortly." Manual re-poll button |

## Decisions / open questions
- **Stripe publishable key source:** env var, NOT round-trip per booking. The contract returns it for safety against env-mismatch, but mobile reading from env is simpler and faster. We'll trust `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` matches the server's config.
- **Polling interval & cap:** 2s × 10 attempts = 20s. Stripe webhook usually round-trips in <3s for test mode, <10s for live. 20s is generous. **Open:** if polling proves laggy in real testing Thursday, switch to a Realtime channel subscription on `bookings:id=eq.X`.
- **Apple Pay:** card-only ships in #9; Apple Pay merchant identifier becomes a separate small commit Thu (`feat(mobile): Apple Pay merchant identifier (M2 #9.1)`). Keeps the L commit reviewable.
- **Confirmation screen vs. modal:** screen, because Bookings tab is empty pre-#10 — user needs somewhere to land that proves the booking exists. Screen has Done CTA → tabs.
- **Notes field:** schema supports it; UI omits it for #9 to keep scope tight. Ship in a follow-up if owners ask.

## Pre-flight (do before opening the editor Wed)
- [ ] PR #11 merged to main
- [ ] `pnpm install` after pulling main on the new branch
- [ ] `supabase status` confirms `create-booking` is deployed locally; replace fixture `acct_seed_larnaca_fixture` with a real Stripe test account id via Studio (so PI creation reaches Stripe) — the seed.sql comment block calls this out explicitly
- [ ] Stripe test publishable key in `apps/mobile/.env.local` as `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…`
- [ ] Apple Pay merchant identifier deferred — set placeholder, ship Thu

## Test plan (mirrors PR template)
- [ ] `pnpm typecheck` passes
- [ ] Tap available slot → highlights; tap again → deselects; tap unavailable → no-op
- [ ] Adjust bibs to 2 + ball_rental to 1 → CTA label updates to `Book €X` reflecting +€10 +€3
- [ ] Bibs and ball_rental cannot be removed (steppers don't go below 1)
- [ ] Tap Book → checkout screen appears, Sheet presents within 2s
- [ ] Successful test card (`4242 4242 4242 4242`) → confirmation screen with booking code
- [ ] Cancel from Sheet → returns to detail with selection intact
- [ ] Declining card (`4000 0000 0000 0002`) → checkout shows "Card declined", retry generates new idempotency key
- [ ] Race-condition manual test: two devices/sims book the same slot at once → loser sees `SLOT_UNAVAILABLE` flow
- [ ] Force close app between Sheet success and polling → re-open lands on Discover; booking still confirms (webhook handles it server-side)
- [ ] Locale toggle EN ↔ ΕΛΛΗΝΙΚΑ swaps all booking copy

## Estimated time
- Wed 04-29 (~3h): scaffold files, slot selection, addon UX, create-booking wrapper, checkout screen skeleton, Stripe Provider mount.
- Thu 04-30 (~3h): Payment Sheet integration, polling, confirmation screen, error states, Apple Pay merchant identifier as separate commit, end-to-end test on physical iPhone.

If Wed runs long: cut polling-resume UI (just show error with retry); add it Thu.
If Thu blocks on Apple Pay: ship card-only #9, do Apple Pay as #9.1.
