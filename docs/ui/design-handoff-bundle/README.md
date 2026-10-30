# Handoff: Ludi v1 polish — Chalk & Aegean

## Overview

This bundle covers the visual and interaction polish pass over the whole Ludi mobile app (19 routes, 5 tabs, `@ludi/ui` primitives) plus the venue-owner console. It implements the direction set out in `docs/ui/2026-08-10-v1-polish-handoff.md` and resolves the open colour question in favour of a new palette, **Chalk & Aegean**.

Three things change:

1. **The typography ships.** Fraunces and JetBrains Mono are loaded for the first time — `app/_layout.tsx` currently calls `useFonts({})` with an empty map, so every string in the app has always fallen back to SF Pro. This is the single highest-leverage change and everything else assumes it lands first.
2. **The app gains depth and rhythm** — an elevation scale, a 4px spacing scale, a radius scale, motion tokens, and five real states on every list-bearing screen.
3. **The palette moves** from warm terracotta-on-stucco to a cool chalk ground with Aegean blue as the primary. Terracotta is retained but demoted to a **semantic** colour (errors, cancellations, refunds) and is no longer the accent.

Two screens that previously shipped internal roadmap vocabulary to end users ("Stage 3", "Stage 4") are designed properly: Matches and Map.

## About the design files

The files in this bundle are **design references written in HTML**. They are prototypes that demonstrate the intended look, spacing, and behaviour — they are **not production code to copy**.

The Ludi app is React Native 0.81 / Expo SDK 54 / expo-router 6, with tokens and primitives in `packages/ui`. The task is to **recreate these designs in that environment**, using its established patterns: `TOKENS` from `packages/ui/src/tokens.ts`, the primitives in `packages/ui/src/primitives.tsx`, the icon set in `packages/ui/src/icons.tsx`, and the copy source of truth in `packages/ui/src/copy.ts`. The admin console is Next.js (`apps/admin`) with a duplicated web-safe token file at `apps/admin/lib/tokens.ts` — per the comment in that file, any token change must be mirrored in both.

Do not port the HTML. Read it for values and behaviour, then build the React Native equivalent.

## Fidelity

**High fidelity.** Every colour, type size, weight, letter-spacing, radius, shadow and animation duration in this document is final and should be reproduced exactly. Where the prototype and this README disagree, this README wins.

---

## Design tokens

### Colour — Chalk & Aegean

Replace the values in `packages/ui/src/tokens.ts` (and mirror in `apps/admin/lib/tokens.ts`).

| Token | Value | Use |
|---|---|---|
| `bg` | `#F2F4F3` | App background (chalk) |
| `surface` | `#FFFFFF` | Cards, sheets, tab bar, elevated UI |
| `ink` | `#10181C` | Primary text, headlines, icons |
| `ink2` | `#3F4C51` | Secondary text, supporting labels |
| `ink3` | `#5F6E73` | Tertiary text, captions, placeholders, disabled |
| `line` | `rgba(16,24,28,0.07)` | Hairlines, dividers |
| `lineBold` | `rgba(16,24,28,0.12)` | Heavier borders, outlined buttons |
| `primary` | `#175E77` | **New.** Primary CTA, active tab, selected slot/day, focus ring |
| `primaryDeep` | `#0F3F52` | Accent text on tinted surfaces, hero numerals |
| `primarySoft` | `#DCE9EC` | Booking-code card, field-tile tint, info surfaces |
| `pitch` | `#1F6640` | Success, confirmed bookings, availability, level bars |
| `pitchSoft` | `#DFECE3` | Success surfaces, 7-a-side field tint |
| `sun` | `#D99520` | Pending state, warnings, 11-a-side format dot |
| `sunSoft` | `#F8E8C9` | Timeout / escalation notices |
| `terracotta` | `#C1502E` | **Semantic only** — errors, cancellation, refund actions |
| `terraSoft` | `#F4E1D4` | Error surfaces |
| `terraDeep` | `#8B3415` | Error *text* (terracotta at text size fails AA) |

Contrast, measured (WCAG 2.1, AA needs 4.5:1 for normal text):

| Pair | Ratio | Verdict |
|---|---|---|
| `ink` on `bg` | 15.9:1 | ✅ |
| `ink2` on `bg` | 8.2:1 | ✅ |
| `ink3` on `bg` | 5.3:1 | ✅ (the old `#8A8374` was 3.35:1 and failed everywhere) |
| `primary` on `bg` | 6.6:1 | ✅ |
| white on `primary` | 6.9:1 | ✅ |
| `pitch` on `bg` | 5.5:1 | ✅ |
| `terraDeep` on `bg` | 7.4:1 | ✅ |
| `terracotta` on `bg` | 4.3:1 | ❌ **fills only, never text** |

Rules that fall out of this:
- The tab bar is filled `surface`, not `bg`. The active tab label is `primary` on `surface`.
- Any accent-coloured *text* on the `bg` ground uses `primaryDeep` or `terraDeep`, never `terracotta`.
- Every state carries a text label as well as a colour (see booking rails, §Bookings).

### Typography

Ship **static instances**, not the variable font — RN's font matching does not expose variable axes, and a variable `.ttf` registered under one family renders at its default axis position only.

| Family | Files | Token |
|---|---|---|
| Fraunces | `Fraunces-Regular` (500), `Fraunces-SemiBold` (600), `Fraunces-Italic` | `TOKENS.display` |
| JetBrains Mono | `JetBrainsMono-Regular` (400), `JetBrainsMono-Medium` (500), `JetBrainsMono-Bold` (700) | `TOKENS.mono` |
| System (SF Pro / Roboto) | — | `TOKENS.ui` (unchanged) |

Register in `useFonts({...})` in `apps/mobile/app/_layout.tsx` (currently line 111), keep the splash screen up until `fontsLoaded`, and add a `__DEV__` startup assertion that every family named in `TOKENS` is actually present — the silent-fallback failure mode is exactly what hid this for four months.

**Roles.** Fraunces for headings, section titles and all numerics (prices, totals, day numbers, counts). JetBrains Mono for booking codes, times, dates and uppercase micro-labels. System for body, buttons and form labels. Never Fraunces for body; never Mono for headlines.

Scale as used in the designs:

| Element | Family | Size | Weight | Tracking |
|---|---|---|---|---|
| Screen title | Fraunces | 32–34 | 600 | −0.02em |
| Hero confirmation | Fraunces | 40 | 600 | −0.03em |
| Card title | Fraunces | 20–21 | 600 | −0.01em |
| Sheet title | Fraunces | 26 | 600 | −0.02em |
| Price (card) | Fraunces | 22 | 600 | — |
| Price (detail / total) | Fraunces | 24 | 600 | — |
| Day number | Fraunces | 19 | 600 | — |
| Body | System | 15–15.5 | 400 | −0.2px |
| Secondary body | System | 13.5–14 | 400 | — |
| Button label | System | 16–17 | 600 | −0.3px |
| Form label | Mono | 10.5 | 500 | 0.08em, uppercase |
| Meta row | Mono | 11 | 400 | 0.07em, uppercase |
| Tab label | Mono | 9 | 500 | 0.06em, uppercase |
| Slot time | Mono | 13 | 400 | — |
| Booking code (list) | Mono | 10.5 | 400 | 0.04em |
| Booking code (hero) | Mono | 28 | 700 | 0.02em |

### Elevation

Depth comes from shadow only — never a second background fill. Shadow colour is always ink-derived, never black; black on a chalk ground reads grey and dirties the palette.

| Token | Shadow | Use |
|---|---|---|
| `elev0` | none | Flush surfaces, list rows on `bg` |
| `elev1` | `0 1px 3px rgba(16,24,28,0.06)` | Cards at rest, chips, slot tiles, keypad keys |
| `elev2` | `0 2px 8px rgba(16,24,28,0.08)` | Pitch cards, selected slot, raised list items |
| `elev3` | `0 6px 20px rgba(16,24,28,0.10)` | Sticky CTA bar, sheets, tab bar, title card |
| `elev4` | `0 12px 32px rgba(16,24,28,0.14)` | Modals, toasts |

In RN, express these as `shadowColor: '#10181C'`, `shadowOffset`, `shadowOpacity`, `shadowRadius` for iOS plus `elevation` for Android. `elev2` and above should pair with a `StyleSheet.hairlineWidth` `TOKENS.line` border so the shape survives on Android, where shadow colour is ignored below API 28.

### Spacing

Promote the 4px scale from "future" to real: `space1: 4, space2: 8, space3: 12, space4: 16, space5: 20, space6: 28, space8: 40`.

Screen horizontal padding is `space5` (20) everywhere, with **one exception**: full-attention screens with no list — consent, sign-in, OTP, checkout failure — use 24. Section separation is `space6` (28). Major block separation is `space8` (40).

### Radii

`r-sm: 10` (chips, filter pills, icon tiles) · `r-md: 14` (inputs, slot tiles, day tiles, OTP boxes) · `r-lg: 20` (cards) · `r-xl: 28` (sheets, hero cards, modals) · `r-full: 999` (buttons, pills, avatars).

### Motion

| Token | Duration | Easing | Use |
|---|---|---|---|
| `motion-instant` | 120ms | ease-out | Press feedback, hover, chip toggle |
| `motion-quick` | 200ms | cubic-bezier(0.2, 0, 0, 1) | Selection, segment change, tab switch |
| `motion-standard` | 280ms | cubic-bezier(0.2, 0, 0, 1) | Screen transitions, sheets, card entry |
| `motion-slow` | 450ms | cubic-bezier(0.2, 0, 0, 1) | Confirmation celebration only |

Every animation must respect `AccessibilityInfo.isReduceMotionEnabled()` — when on, transforms become opacity-only and durations halve.

---

## Player app — screens

### 1. Consent — `src/components/ConsentScreen.tsx`

Padding 24. Brand mark 52×52, `r-md` 16, `primary` fill, ball icon in `surface`, `elev2`. Title Fraunces 32/600/−0.02em at 22 above the subtitle. Body System 15.5, line-height 23.

Four bullets, each a 34×34 `r-sm` 11 icon tile + body text, gap 14, row gap 16. Tile tints and icon colours in order: `primarySoft`/`primaryDeep` (identity, user icon), `pitchSoft`/`#174028` (bookings, calendar icon), `sunSoft`/`#8A5A0E` (payments, card icon), and a fourth for analytics. This replaces the current `•` bullet character.

Residency line System 13.5 `ink3`, line-height 20. Privacy link System 14.5/600 `primary`. CTA pinned 34 from the bottom: 56 tall, `r-full`, `primary`, white 17/600/−0.3px, `elev2`, press scale 0.97 at 120ms.

### 2. Sign in — `app/(auth)/signin.tsx`

The current screen wastes ~40% of the viewport. Move the block to optical centre and add a brand mark above it.

Order: brand mark → "Sign in" (Fraunces 34/600) → subtitle → **phone field, primary** → Continue → `or` divider → Apple / Google / email as three equal secondary buttons.

- Phone field: 58 tall, `r-md` 14, `surface`, `elev1`, 1.5px border — `lineBold` when empty, `primary` when focused or filled (this focus state does not exist today; `primitives.tsx` sets `borderColor` from `error` only, so a focused field is identical to an idle one). Contains `+357` in Mono 16 `ink3`, a 1px × 22 divider, then the number in Mono 18 `ink` with 0.06em tracking.
- Continue: disabled until 8 digits — `bg` fill, `line` border, `ink3` label. Enabled: `primary`, white, `elev2`.
- Secondary auth buttons: `min-height` 52 (not fixed height), `r-full`, `surface`, `elev1`, padding 14/20, `text-align: center`. **They must wrap to two lines rather than truncate** — "Continue with Apple" → "Συνέχεια με Apple" is ~30% wider.
- Legal line pinned at the bottom, System 13 `ink3`, centred.

**Numeric keypad.** The prototype uses a custom keypad rather than the system keyboard: 4 rows × 3 keys, key height 52, `r-md` 14, `surface`, `elev1`, Mono 22 `ink`; the blank and `⌫` keys are transparent. This is optional — the system `phone-pad` keyboard is acceptable — but the 52pt key height and 8px gutters are the minimum if you build it.

### 3. OTP — `app/(auth)/verify.tsx`

Six discrete boxes replacing the single text field. Each `flex: 1`, height 64, `r-md` 14, Mono 24 centred.

| State | Fill | Border | Notes |
|---|---|---|---|
| Empty | `bg` | 1px `line` | — |
| Active (next to fill) | `surface` | 1.5px `primary` | `elev1` |
| Filled | `surface` | none | `elev1`, `popIn` 200ms on entry: scale 0.86 → 1.06 → 1 |

Auto-advance on entry, backspace steps back, paste-fill from SMS. When the sixth digit lands, wait 750ms then verify — the pause is deliberate so the last digit is seen.

Resend is a **live countdown** — "Resend code in 0:24", ticking each second, only tappable at 0:00. It is currently always enabled.

Back chevron in a 38×38 `r-full` `surface` `elev1` circle at top-left. "Change number" is `primary` at System 15/600 (it is currently `sea`, which no longer exists as a role).

### 4. Profile setup (post-auth, new)

A two-tap onboarding step between verification and the app. Eyebrow "Step 2 of 2" Mono 10.5. Title Fraunces 32. Level as five `flex: 1` tiles, height 52, `r-md` 14 — unselected `surface`/`elev1`/`ink`, selected `primary`/white/`elev2`, 200ms cross-fade. Below it the plain-language tier anchor from `copy.ts` (`profileSkillTier1`–`5`).

Positions as `r-sm` 10 chips, Mono 12/500, padding 10/15 — unselected `surface`/`ink2`/`elev1`, selected `ink` fill/white. Values from `POSITIONS` in `src/lib/player-profile.ts`.

CTA label is state-dependent: "Find me a pitch" when at least one position is set, "Skip for now" when none.

### 5. Discover — `app/(tabs)/index.tsx`

The commercial screen; highest priority after the fonts.

**Header** — padding 20, gap 4. Eyebrow: city name, Mono 11/500 uppercase 0.08em `ink3`. Greeting: Fraunces 34/600/−0.02em, line-height 1.1. Sub: System 15 `ink2`.

**Filters** — row of `r-sm` 10 pills, padding 7/12, Mono 11/500 uppercase 0.06em. Inactive `surface` + 1px `lineBold` + `ink2`; active `ink` fill + `surface` text + `elev1`. Note `Tonight` is reintroduced here and needs availability data.

**PitchCard** — `surface`, `r-lg` 20, 1px `line`, `elev2`, overflow hidden. Structure: a 170-tall generated field tile, then a 16-padding content row.

Content row: left column gap 6 — name Fraunces 20/600/−0.01em (two lines then ellipsis; one line on compact rows), then a meta row of a 6×6 format dot + Mono 11 uppercase 0.07em `ink3` reading `<format> · <surface> · <distance>`. Right: price Fraunces 22/600 with `/hr` in System 12/400 `ink3`.

Format dot colours: `primary` for 5-a-side, `pitch` for 7-a-side, `sun` for 11-a-side — so size is scannable without reading.

Availability badge, top-left of the tile at 12/12: `r-sm` 8, `rgba(255,255,255,0.94)`, `elev1`, Mono 10/500 uppercase `pitch`, reading "4 free tonight".

Cards animate in with `riseIn` — fade + 14px rise, 280ms, staggered 60ms, first six items only.

**Generated field tile (the imagery answer).** There are no pitch photos in the data model and none are coming for the first venues, so this is the product's visual identity, not a placeholder. Each tile is an SVG keyed on pitch format:

- Ground fill by format: 5-a-side `#DCE9EC`, 7-a-side `#DFECE3`, 11-a-side `#DCE9EC` (deep variant on hero).
- Pitch markings in `#FFFFFF` at 0.9 opacity, stroke-width 2 (2.4 on the 280-tall hero): an inset boundary rect, a halfway line, a centre circle, and two penalty boxes. Geometry for a 362×170 tile: rect `x18 y16 w326 h138`, line `x181 y16→154`, circle `cx181 cy85 r34`, boxes `x18/x302 y47 w42 h76`.
- The format number set in Fraunces 86/600 at 0.17 opacity, bottom-right, anchored `end` at `x330 y150`. Fill `primaryDeep` for 5-a-side, `#174028` for 7-a-side.

Never a grey box, never a stretched logo. If real photography arrives later, it drops into the same slot without a redesign.

**States.** Loading: three card skeletons — the tile becomes a 1.2s linear shimmer sweep (`background-size: 560px`, `-280px → 280px`), the text lines become 18/11-tall `r-sm` bars at 9%/6% ink. Never a spinner on blank. Empty: centred illustration tile 96×96 `r-xl` 28 `surface` `elev2` with a `terracotta` 44px pin icon, Fraunces 24 title naming the city, body naming the cities that are coming, a `primary` "Notify me" CTA and a `terraDeep` text link back to a live city. Error: inline retry card, header stays visible.

**Do not** put the locale toggle inline in the list — it pins to the end of scroll.

### 6. Pitch detail — `app/pitch/[id].tsx`

The one place the app should feel physically layered.

**Hero** — full-bleed 280 tall field tile, no safe-area inset. Back button floats at top 56 / left 16 in a 38×38 `r-full` `rgba(255,255,255,0.95)` circle with `elev2`. Heart and share mirror it on the right.

**Title card** — overlaps the hero by 20 (`margin: -20 20 0`), `surface`, `r-xl` 28, 1px `line`, `elev3`, padding 20. Venue name Mono 11 uppercase `ink3`; pitch name Fraunces 26/600/−0.02em; then a row of the format dot + meta and the price Fraunces 24/600.

**Amenities** — `r-sm` 10 tiles, `surface`, `elev1`, padding 8/12: a 16px line icon from `icons.tsx` (`shower`, `parking`, `lights`, `ball`) in `ink2` plus a Mono 10 uppercase label.

**Availability** — section label Mono 11 uppercase `ink3`.

Day strip: horizontally scrolling, `min-width` 56, padding 10/0, `r-md` 14, gap 8. Inactive `surface` + `elev1`; active `primary` + `elev2`. Weekday Mono 10/500 uppercase, day number Fraunces 19/600. A 36-wide `bg`-to-transparent gradient sits over the right edge to signal horizontal scroll — currently `SAT 15` is clipped mid-glyph and reads as a bug.

Slot tiles: width 79, padding 11/0, `r-md` 14, Mono 13, gap 8.

| State | Fill | Text | Notes |
|---|---|---|---|
| Available | `surface` | `ink` | `elev1` |
| Selected | `primary` | white 500 | `elev2`, `transform: scale(1.04)`, 200ms |
| Unavailable | `bg` | `ink3` | strikethrough, no border, not pressable |

Keep struck-through past slots rather than hiding them — that is a deliberate, correct call. Reflow 4 columns → 3 on 375pt devices.

Slot tiles need `accessibilityLabel="20:00, available"` / `"20:00, unavailable"`; the strikethrough is currently the only signal and is invisible to VoiceOver.

**Sold-out day** — when every slot on a day is unavailable, replace the grid entirely with a card (`surface`, `r-lg` 20, `elev2`, padding 20): a `sun` dot + "FULLY BOOKED" in Mono 10.5 uppercase, Fraunces 21 "Nothing free on Monday", a body line naming the next day with capacity, and a `bg`-filled pill CTA "Try Tue 11 →". A grid of struck text is not an empty state.

**Sticky footer** — `surface`, top hairline `line`, `elev3`, padding 16/20/34. It slides up (`translateY(120%) → 0`, 280ms) when a slot is selected; before that it shows a disabled "Pick a time" pill.

It contains the **price summary, always expanded, never behind a disclosure**:

```
Pitch · Mon 20:00–21:00        €35.00
Bibs · required                 €5.00
Match ball · required           €3.00
────────────────────────────────────
Total                          €43.00
```

Line labels System 14 `ink2`, the `· required` qualifier Mono 10 uppercase `ink3`, amounts Mono 13 `ink`, a `line` rule above the total, total label System 14/600 and total amount Fraunces 22/600. CTA: 52 tall, `r-full`, `primary`, "Book" in System 17/600 with the amount in Fraunces.

> **Open product decision, unchanged by this pass.** Discover advertises `€35/hr`; the CTA charges `€43` because bibs (€5) and ball rental (€3) are mandatory on every Cyprus booking. The founder's call was to keep `€35/hr` as the catalogue headline for now, so the price summary above is the mitigation: the breakdown appears before payment, not after. Revisit before the first venue's customers see the app.

### 7. Checkout — `app/booking/[id]/checkout.tsx`

Currently a bare phase machine that renders raw runtime errors to users. Give each phase a real screen.

**In progress.** Eyebrow "Step 2 of 3 · Paying" (Mono 10.5 uppercase) with an elapsed timer at the right, and a 3px segmented progress bar. Title Fraunces 30 — "Holding your slot…" then "Confirming with the venue…". A summary card in `surface`/`elev2` with the amounts.

After 10 seconds, escalate honestly: a `sunSoft` `r-lg` 20 card with a clock icon in `#8A5A0E`, "Still confirming with your bank" in System 14.5/600, and "Your card has not been charged twice." Footer button is a secondary "Check status".

**Failure.** Replace the centred sentence with a real state: an 88×88 `r-full` `terraSoft` circle with a `terraDeep` × glyph, Fraunces 30 title **mapped from the error code** ("Your card was declined", "That slot just went", "Payment service is unavailable"), and a body that states the money position first — "No charge was made" — then the hold: "We're holding Mon 20:00 for another 4:32 so you can try a different card." A Mono 10.5 reference chip (`REF LAR-2026-0008 · CARD_DECLINED`) sits below for support.

Two footer buttons: `terracotta` "Try another card" (fills only — the label is white), and a secondary "Back to pitch". **Never render a raw runtime message.** Today it renders `Property 'crypto' doesn't exist` straight to the screen.

Map error codes to titles from the existing `BookingError['code']` union in `src/lib/booking.ts` and add the copy keys to `copy.ts` in EN and ΕΛ.

### 8. Confirmation — `app/booking/[id]/confirmed.tsx`

The only celebratory moment in the app, and currently unstyled.

A 64×64 `pitch` circle, `elev3`, with a white check drawn on entry: `ringPop` 450ms on the circle (scale 0.6 → 1.08 → 1) and `drawCheck` 450ms at 180ms delay on the path via `stroke-dasharray: 40` / `stroke-dashoffset: 40 → 0`. Then "Booked." in Fraunces 40/600/−0.03em and the when-line, each rising in at 260ms and 320ms.

The **booking code card** is the artifact players screenshot and send to their group chat, so it should be worth screenshotting: `primarySoft` fill, `r-xl` 28, padding 28/24, `elev3`. Label Mono 10.5 uppercase 0.1em `primaryDeep`; code **Mono 28/700** with 0.02em tracking; a hairline; then Pitch / When / Paid rows with the amount in Fraunces 18.

Below: "Add to calendar" and "Share" as two equal `r-full` `surface` `elev1` buttons with 17px icons (the sharing pattern is already anticipated in `docs/FUTURE.md`). Footer: `ink` "Done".

Fire `notificationSuccess` haptic here and **nowhere else** — overusing haptics on a booking app makes it feel like a game.

### 9. Bookings — `app/(tabs)/bookings.tsx`

Title Fraunces 32/600. Replace the two `Chip`s with a real **segmented control**: a `r-full` container filled `rgba(16,24,28,0.06)`, padding 4, two `flex: 1` halves at padding 9/0; the selected half is `surface` + `elev1` + `ink` 14/600, the other is `ink3`. Counts sit inside the label in Mono 12 `ink3`.

Booking rows are `surface` `r-lg` 20 cards with a **4px left accent rail** running the full height, coloured by state — `pitch` confirmed, `sun` pending, `ink3` completed, `terracotta` cancelled. The rail is never the only signal: the state name is repeated in Mono 10.5 uppercase in the rail's colour at the top-left of the card, with the booking code in Mono 10.5 `ink3` at the top-right.

The next booking gets a relative-time headline in Fraunces 24 — "Tonight · 20:00". Threshold: relative under 24 hours, absolute beyond it. Then the pitch name in Fraunces 18, the venue line in System 13.5, and a footer row above a `line` rule with the duration/format in Mono 11 uppercase and the total in Fraunces 20. Past rows drop the headline and sit at 0.78 opacity with `elev1` instead of `elev2`.

**Cancel** is a full-width secondary button inside the card. It opens a bottom sheet (`surface`, `r-xl` 28 top corners, `elev4`, slide-up 280ms) that states the refund position **before** the user commits — amount, timing, and what happens to the slot — then a `terracotta` confirm and a "Keep booking" secondary. On confirm, the row moves to History, the rail and label become Cancelled, and a toast confirms. Wire this to the existing cancel-booking Edge Function and the policy copy already in `copy.ts` (`cancelConfirmBodyWithRefund` etc.).

Empty: centred 88×88 icon tile, Fraunces 22 "Nothing booked yet", a body that names live availability ("Six slots are free in Larnaca tonight, from 19:00"), and a `primary` "Find a pitch" CTA routing to Discover.

### 10. Matches — `app/(tabs)/matches.tsx`

Currently ships the words "Stage 3" to users. **Before any TestFlight build, either implement this or hide the tab** (`href: null` in `app/(tabs)/_layout.tsx`) — three working tabs beat five where two apologise. Never the placeholder.

Segmented control Open / Mine with live counts. Each match card (`surface`, `r-lg` 20, `elev2`, padding 18):

- Header row: format dot + "TONIGHT 20:00 · 5-A-SIDE" in Mono 10.5 uppercase `ink3`; right side shows spots left in Mono 10.5 uppercase — `primaryDeep` normally, `#8A5A0E` at one spot, `#174028` reading "You're in" once joined.
- Pitch name Fraunces 21, venue + distance System 13.5.
- A crew row: 28×28 avatars with 2px `surface` rings overlapping at −8, then `7 / 10` in Mono 11. Right side: `LevelBars` (existing primitive, `pitch` filled / `lineBold` empty) + "LEVEL 3" in Mono 10.5.
- Footer above a `line` rule: per-player price in Fraunces 22 with "/ player" in System 12 `ink3`, and a Join pill — `primary`/white, becoming `pitchSoft`/`#174028` "Leave" once joined.

A floating `ink` "Organise a match" pill sits above the tab bar at `elev3`.

> **Blocked on the data model.** Per-player pricing has no representation in the schema — `bookings` carries a single `total_cents` and one user. Split payment is Stage 3 work; this design assumes it exists.

### 11. Map — `app/(tabs)/map.tsx`

Also ships "Stage 4" today. Same rule: build it or hide the tab.

See `ludi-map-screen.html` in this bundle for the working reference. It uses Leaflet + OpenStreetMap tiles; the production app uses Mapbox per the stack, so treat the HTML as a spec for the **overlay**, not the map library.

- Tiles are desaturated toward the palette: `saturate(0.62) brightness(1.06) contrast(0.94) hue-rotate(-6deg)`. In Mapbox this is a custom style, not a CSS filter.
- Pins are **price pills**, not markers: `surface`, `r-full`, padding 6/10/6/7, `elev2`, a 6px format dot + the price in Fraunces 15/600. The selected pin inverts to `primary` fill with white text and `elev3`.
- Top overlay: a 48-tall `r-full` `surface` `elev3` search pill with a magnifier icon reading "Larnaca · 3 pitches", plus a filter icon button; a row of filter chips below it.
- Bottom sheet: `surface`, `r-xl` 28 top corners, `elev4`, with a grabber, the meta row, pitch name Fraunces 24, address, a 4-up slot row (same tile spec as pitch detail, including per-pitch closed hours), and a footer with the price and a `primary` "Book 20:00" CTA that resolves to a `pitch`-filled "Booked · 20:00".
- The OpenStreetMap attribution string is a licence requirement in the HTML reference. With Mapbox, use Mapbox's required attribution instead.

### 12. Profile — `app/(tabs)/profile.tsx`

Today it is one long ungrouped scroll. Group into cards: **Identity**, **Play style**, **Preferences**, **Account**.

Identity is a `primarySoft` `r-xl` 28 card, `elev2`: a 56×56 `primary` avatar circle with the initial at 22/700, the name in Fraunces 22, and a Mono 10.5 uppercase `primaryDeep` line reading "Level 3 · CDM · Larnaca" that updates live from the fields below. It is tappable — this is the "View my card" affordance and should be a proper preview tile, not a bordered button.

Play style and Preferences are `surface` `r-lg` 20 cards, `elev1`, padding 18, with rows separated by 1px `line` rules. Section headings sit outside the cards in Mono 10.5 uppercase 0.09em `ink3` with 20/4/8 padding.

Level and Positions reuse the tile and chip specs from Profile setup. Language is a small inline segmented control (EN / ΕΛ). Save state is currently invisible: the button runs idle → "Saving…" → "Saved" with a check icon and a `pitchSoft` fill, reverting after 3s.

Destructive actions move into the Account card at the bottom, using a new `Button variant="destructive"` (`terracotta`) — delete-account and cancel-booking both hand-roll this today.

### 13. Tab bar — `app/(tabs)/_layout.tsx`

Stock `expo-router` chrome today. Height 83 (49 + 34 safe area), `surface` fill, top hairline `line`, `elev3` upward (`0 -6px 20px rgba(16,24,28,0.10)`). Icons 22 from `icons.tsx`, labels **Mono 9/500 uppercase 0.06em**, gap 4, padding-top 8. Active `primary`, inactive `ink3`.

The `surface` fill is not cosmetic — it is what makes the active `primary` label pass AA.

---

## Owner console — `apps/admin`

Same tokens, same type roles, desktop layout. Today it is an unstyled table.

**Header** — `surface`, bottom hairline. Venue mark (28×28 `r-sm` 9 `primary` tile) + venue name in Fraunces 18. Tabs as `r-full` pills: active `ink` fill/white, inactive `ink3`. Date in Mono 11 uppercase and an avatar at the right.

**Today** — four stat cards (`surface`, `r-lg` 20, `elev1`, padding 20/22): Mono 10 uppercase label, Fraunces 34 value. Payout value uses `pitch`.

Bookings table in a single `surface` `r-lg` 20 `elev2` card. Header row Mono 10 uppercase `ink3`; body rows 16/22 padding with a `line` rule between. Columns: time (Mono 14), pitch (System 14.5/500), player, code (Mono 12.5 `ink3`), state chip, total (Fraunces 17), action. State chips are `r-full` pills, Mono 10.5 uppercase: confirmed `pitchSoft`/`#174028`, pending `sunSoft`/`#8A5A0E`, played `rgba(16,24,28,0.07)`/`ink2`, refunded `terraSoft`/`terraDeep`. Refunded rows drop to 0.72 opacity.

**Pitches** — same table treatment over the existing verify/deactivate actions in `app/pitches/page.tsx`. Two chips per row (verified/unverified, live/hidden). "Verify" is a `primary` pill; "Hide"/"Show" is secondary.

**Payouts** — a 7-day bar chart (bars `r-sm` 8 top corners, `primarySoft` with today in `primary`, height animated 280ms) beside a payout summary card: Fraunces 40 `pitch` amount, arrival date and last-4, then Gross / Ludi fee / Refunds rows in Mono 13.

**Both money-moving actions open a confirm modal** — `surface`, 460 wide, `r-xl` 28, `elev4`, backdrop `rgba(16,24,28,0.42)`, rising in at 280ms. A kicker pill states the consequence ("Moves money", "Goes live now"), then a Fraunces 26 title, a body that spells out the amount, the timing and the irreversibility, then "Keep as is" / a confirm button (`terracotta` when destructive, `primary` otherwise). On success a dark `r-md` 16 toast appears bottom-left for 2.6s.

> **Blocked on access control.** This console is venue-scoped — one owner sees one venue's bookings and payouts. `apps/admin` today has a single shared admin role (`requireAdmin` in `lib/auth.ts`) with no venue scoping, so shipping it needs RLS work and a venue-membership table first. Until then, treat these screens as the internal admin restyled.

---

## Interactions & behaviour

| Element | Trigger | Behaviour | Token |
|---|---|---|---|
| Button | press | scale 0.97 + `impactLight` haptic | instant |
| Chip / filter | toggle | background + border cross-fade | instant |
| Slot tile | select | scale → 1.04, fill cross-fade, `selectionChanged` haptic | quick |
| Segmented control | change | selected pill cross-fades | quick |
| Tab | change | screen cross-fade, no slide | quick |
| Card list | appear | fade + 14px rise, 60ms stagger, first six only | standard |
| Screen | push | platform default — do not hand-roll | standard |
| Sticky CTA | slot selected | slide up from below with total cross-fade | standard |
| Bottom sheet | open | slide up + backdrop fade | standard |
| Skeleton | loading | 1.2s linear shimmer loop | linear |
| Confirmation | mount | ring pop + check draw + staggered rise, `notificationSuccess` | slow |
| Toast | show | rise + fade in, auto-dismiss 2.6s | standard |

Haptics via `expo-haptics` — a new dependency; Expo SDK 54 managed, no rebuild concerns beyond a config-plugin check.

## State

Per-screen state the prototype models, all of which maps to data the app already has:

- **Auth flow**: `phone` (8 digits, validated by `isValidCyMobile`), `code` (6 digits, auto-submit), `resendCountdown` (30s interval).
- **Profile**: `skill` (1–5), `positions` (string[]), `lang`, `saveState: idle | saving | saved`.
- **Discover**: `loadState: loading | success | error`, `activeCityId`, `activeFilters: Set<FilterId>` — all present today.
- **Pitch detail**: `days` (rolling 7), `activeDateStr`, `selectedSlot`, addon quantities — all present today.
- **Checkout**: existing `Phase` union, plus an elapsed-time counter driving the >10s escalation.
- **Bookings**: `segment: upcoming | history`, `cancelledIds`.
- **Matches**: `segment: open | mine`, `joinedIds` — new, Stage 3.
- **Owner**: `tab`, `modal: {kind, id, copy}`, `refundedIds`, `pitchState: {verified, active}`, `toast`.

## Copy

All new strings go in `packages/ui/src/copy.ts` in **both** EN and ΕΛ — the file is the source of truth that feeds `@ludi/i18n`. New keys needed: coded checkout-failure titles and bodies, sold-out-day hint, empty-state titles/bodies/actions for Discover / Bookings / Matches, segmented-control labels, match card labels, and the cancel bottom-sheet copy.

**Test every screen in Greek before calling it done.** Greek runs 20–35% longer. Known pressure points: auth method buttons, the mandatory-addons sentence, empty-state bodies, segmented controls, and the checkout failure body.

## Accessibility

- Contrast: all pairs measured above; `terracotta` is fills-only.
- Touch targets: 44×44pt minimum. Chip at `size="sm"` is ~26pt — raise the hit slop, not the visual size.
- Dynamic Type: support up to AX1 on body text without clipping; the slot grid reflows 4 → 3 columns.
- Slot tiles need explicit `accessibilityLabel`s including availability.
- Booking-state accent rails always carry a text label.
- Focus order on auth screens: field → primary action → alternatives.
- Reduced motion: transforms become opacity-only, durations halve.

## Edge cases

- No pitch imagery for the first venues — the generated tile is the default state, not the exception.
- Long venue names: two lines then ellipsis on cards, one line on rows.
- Prices to €999/hr must not wrap the CTA label.
- iPhone SE (375pt): slot grid reflows to 3 columns.
- Relative vs absolute time threshold: under 24h relative, else absolute.
- **Offline**: no offline state exists anywhere today. Minimum bar is a persistent banner and disabled CTAs rather than failures at submit time.

## Suggested sequence

**Ship-blocking, before any public build (~4–6h)**

1. Load the fonts (`app/_layout.tsx`) — one hour, changes the entire app.
2. Fix Matches/Map: implement, or set `href: null`. They currently show users the words "Stage 3" and "Stage 4".
3. Land the token file: new palette, `ink3`, elevation, spacing, radii. Mirror into `apps/admin/lib/tokens.ts`.
4. Humanise the checkout failure screen — it renders raw runtime errors today.

**High value, post-TestFlight (~2–3 days)**

5. New primitives: `Card`, `EmptyState`, `SegmentedControl`, `SlotTile`, `PriceSummary`, `Skeleton`.
6. `Input` focus state, `Button` loading state and `destructive` variant, `Chip` disabled + transition, `Avatar` image prop.
7. `PitchCard` with the generated field tile.
8. Empty, loading and error states across all six list screens.
9. Bookings segmented control, accent rails, cancel sheet.
10. Profile grouping and save state.

**Then**

11. Matches and Map, once split payment and Mapbox land.
12. Owner console restyle, once venue scoping exists.

## Assets

No binary assets. Everything is either an existing icon in `packages/ui/src/icons.tsx`, a generated SVG field tile (geometry given above), or type.

Fonts to add to `apps/mobile/assets/fonts/`: Fraunces (SIL OFL — fine to embed) and JetBrains Mono (Apache 2.0 — **confirm attribution requirements before the App Store build**). Ship static instances only.

## Files in this bundle

| File | What it is |
|---|---|
| `Ludi - Flows.dc.html` | **The primary reference.** Working prototype of the whole player journey (consent → phone → OTP → profile → Discover → pitch → checkout → confirmation, then Matches, Bookings, Profile) plus the owner console with live modals and toasts. All motion and state behaviour is real here. |
| `ludi-map-screen.html` | Working Map tab on real Larnaca geography, with pin selection, per-pitch slots and booking. |
| `Ludi - Chalk & Aegean.dc.html` | The palette across three registers, with the swatch strip and the rejected warmed variant. |
| `Ludi - Polished App.dc.html` | Static spec board: 16 screens including all five states per list screen, both Greek and English passes, and the token legend. Uses the previous warm palette — refer to it for **layout and states**, not colour. |
| `Ludi - Current App.dc.html` | The pre-polish baseline, rebuilt from source, for before/after comparison. |
| `ios-frame.jsx`, `browser-window.jsx`, `support.js` | Runtime files the HTML prototypes need to open in a browser. Not part of the design. |

Open any `.dc.html` file directly in a browser. Keep the folder structure intact — the prototypes reference the runtime files by relative path.
