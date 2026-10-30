# Design Handoff — v1 "Mediterranean" polish

**Date:** 2026-08-10
**Direction:** polish the shipped v1 Mediterranean language. **Not** a repaint.
**Scope:** whole mobile app — 19 routes, 5 tabs, `@ludi/ui` primitives.
**Status:** spec, not yet scheduled. Sequencing proposal in §10.

> **Why this exists.** Three prior attempts to make Ludi look premium
> ([ADR-0015](../adr/0015-player-card-premium-visual-language.md) Chrome
> Classic → superseded, ADR-0016 Dark Poster → rejected, ADR-0017 Ludi
> Factions → accepted but deferred to post-launch v3) all worked on the
> *Player Card* and all proposed a **new colour language**. None of them
> touched the app the player actually uses, and none of them shipped.
>
> This handoff takes the opposite bet: the v1 palette is fine. What makes
> the app read flat is measurable, mechanical, and mostly already
> specified in [design-tokens.md](design-tokens.md) — it just isn't
> implemented. Fix that first. Judge the colour language afterwards, on a
> build where the type and depth are actually present.

---

## 1. Diagnosis — why v1 reads flat

Findings from driving the running app on an iPhone 16 Pro simulator,
2026-08-10. Each is evidence-backed and each has a mechanical fix.

### 1.1 The typography never shipped 🔴 **critical**

[`app/_layout.tsx:111`](../../apps/mobile/app/_layout.tsx) is:

```
const [fontsLoaded] = useFonts({});
```

An empty map. There are no `.ttf` or `.otf` files anywhere in the repo.
`TOKENS.display = 'Fraunces'` and `TOKENS.mono = 'JetBrainsMono'`
therefore resolve to font families that do not exist, and iOS silently
falls back to SF Pro for **every string in the app**.

So the two-serif-and-a-mono system documented in
[design-tokens.md](design-tokens.md) — Fraunces for headings and numerals,
JetBrains Mono for codes and micro-labels — has never once rendered. The
app has been judged "not premium" while wearing none of its typography.

This is the single highest-leverage fix in this document and it is
roughly an hour of work. **Everything below assumes it lands first**;
several other findings partially dissolve once it does.

### 1.2 Nothing is elevated

`TOKENS` has no shadow tokens. No screen uses `shadowOpacity` or
`elevation`. Cards, sheets, the sticky CTA bar and the tab bar all sit in
the same optical plane as the background, separated only by a 1px hairline.
[design-tokens.md](design-tokens.md) already forbids the lazy fix
("never layer surface over surface") — which is correct, and which is
exactly why an elevation scale is needed instead.

### 1.3 The catalogue has no imagery

Discover renders three text rows. A pitch — a physical place a player is
about to spend €43 and an evening on — is communicated as a name, a
subtitle and a price. There is no photo, no surface texture, no crest, no
map thumbnail. This is the largest single gap between Ludi and any
booking app a Cypriot footballer already uses.

Note the ordering problem this creates: Discover is sorted with the €35
indoor pitch first and the €60 11-a-side last, with no visual weight to
distinguish 5-a-side from 11-a-side beyond a text fragment.

### 1.4 Empty and error states are bare sentences

- Bookings → "No upcoming bookings." — 14px grey text, vertically adrift
  in ~700px of empty background, no illustration, no CTA back to Discover.
- Checkout failure → "Booking failed" centred in an empty screen with two
  stacked buttons and no explanation of what failed or what it cost.
- Matches → **"Upcoming + Results arrive in Stage 3."**
- Map → **"Mapbox integration arrives in Stage 4."**

The last two ship internal roadmap vocabulary to end users. A player who
installs from your first venue's QR code will tap Map, read "Stage 4",
and learn that they are using unfinished software. Two of five tabs are
currently in this state.

### 1.5 Controls are iOS defaults wearing brand colours

The tab bar is stock `expo-router`/RN. `Input` is a bordered box with no
focus state — [`primitives.tsx:229`](../../packages/ui/src/primitives.tsx)
sets `borderColor` from `error` only, so a focused field is visually
identical to an idle one. `Button` has a press scale (0.97) and that is
the app's entire motion vocabulary. There are no transitions, no
skeletons, no haptics.

### 1.6 Density is inconsistent

Sign-in and Profile leave ~40% of the viewport empty while the pitch
detail slot grid is tight. Screen padding is ad-hoc (10/12/14/16/20/28 per
[design-tokens.md](design-tokens.md), which already flags this). The 4px
scale is specified there as "future" — it should stop being future.

---

## 2. What is genuinely good — do not touch

Worth stating explicitly so a polish pass doesn't regress it:

- **The palette.** Terracotta on warm stucco is distinctive, is Cypriot
  without being kitsch, and is nothing like the blue-white SaaS default.
- **Type hierarchy and voice.** "Kalispéra." as a greeting, `LARNACA` as
  an eyebrow label — the structure is right even in the wrong font.
- **The availability grid.** Struck-through past slots rather than hidden
  ones is a deliberate, correct UX call ([stage-2 M1 #2](../stage-2-commit-plan.md)).
- **Mandatory-addon honesty.** "Bibs and a ball are included on every
  booking — Cyprus rules" is clear and legally load-bearing.
- **Bilingual from day one.** The `↔ ΕΛΛΗΝΙΚΑ` toggle is on the home
  screen, not buried in settings.

---

## 3. Token additions

All additions go in [`packages/ui/src/tokens.ts`](../../packages/ui/src/tokens.ts).
No existing token changes value. Nothing here alters the palette.

### 3.1 Typography — ship the fonts

| Family | Files | Token |
|---|---|---|
| Fraunces | `Fraunces-Regular` (500), `Fraunces-SemiBold` (600), `Fraunces-Italic` | `TOKENS.display` |
| JetBrains Mono | `JetBrainsMono-Regular` (400), `JetBrainsMono-Bold` (700) | `TOKENS.mono` |
| System | — | `TOKENS.ui` (unchanged) |

Fraunces is a variable font; ship **static instances**, not the variable
file — RN's font matching does not expose variable axes, and a variable
`.ttf` registered under one family name renders at its default axis
position only.

Register in `useFonts({...})`, keep the splash screen up until
`fontsLoaded`, and add a startup assertion in `__DEV__` that each family
in `TOKENS` is present — the silent-fallback failure mode is precisely
what hid this for four months.

**Roles** (as already written in [design-tokens.md](design-tokens.md), now
enforceable): Fraunces for headings, section titles and numerics —
prices, scores, totals, the `€43`. JetBrains Mono for booking codes
(`LAR-2026-0001`), timestamps, and the uppercase micro-labels currently
rendering as spaced sans (`AMENITIES`, `AVAILABILITY`, `REQUIRED ADDONS`).
Never Fraunces for body; never Mono for headlines.

### 3.2 Elevation

Depth comes from shadow only — never a second background fill.

| Token | Shadow | Use |
|---|---|---|
| `elev0` | none | Flush surfaces, list rows on `bg` |
| `elev1` | y1 blur3 `rgba(26,24,20,0.06)` | Cards at rest, chips |
| `elev2` | y2 blur8 `rgba(26,24,20,0.08)` | Pitch cards, raised list items |
| `elev3` | y6 blur20 `rgba(26,24,20,0.10)` | Sticky CTA bar, sheets, tab bar |
| `elev4` | y12 blur32 `rgba(26,24,20,0.14)` | Modals, Player Card hero |

Shadow colour is always ink-derived, never black — black shadow on a warm
`#F6F1E8` ground reads grey and dirties the palette.

`elev2`+ should pair with a `borderWidth: StyleSheet.hairlineWidth`
`TOKENS.line` border so the shape survives on Android, where elevation
renders differently and shadow colour is ignored below API 28.

### 3.3 Spacing — promote the 4px scale from "future" to real

`space1: 4, space2: 8, space3: 12, space4: 16, space5: 20, space6: 28,
space8: 40`. Screen horizontal padding is `space5` everywhere, no
exceptions. Section separation is `space6`. Major block separation is
`space8`.

### 3.4 Radii

`r-sm: 10` (chips, small tiles) · `r-md: 14` (inputs, slot tiles) ·
`r-lg: 20` (cards) · `r-xl: 28` (sheets, hero cards) · `r-full: 999`
(buttons, pills — matches the existing `h/2` behaviour in `Button`).

### 3.5 Motion

| Token | Duration | Easing | Use |
|---|---|---|---|
| `motion-instant` | 120ms | ease-out | Press feedback, chip toggle |
| `motion-quick` | 200ms | ease-out | Selection, expand/collapse |
| `motion-standard` | 280ms | cubic-bezier(0.2, 0, 0, 1) | Screen transitions, sheets |
| `motion-slow` | 450ms | cubic-bezier(0.2, 0, 0, 1) | Confirmation celebration |

Every animation must respect `AccessibilityInfo.isReduceMotionEnabled()`
— when on, transforms become opacity-only and durations halve.

---

## 4. Component specs

### 4.1 Changes to existing primitives

**`Input`** — [primitives.tsx:212](../../packages/ui/src/primitives.tsx)

Add a focus state, currently absent. Track `isFocused` internally.

| State | Border | Background | Notes |
|---|---|---|---|
| Idle | 1.5 `lineBold` | `surface` | current behaviour |
| Focused | 1.5 `terracotta` | `surface` | + `elev1`; animate 120ms |
| Error | 1.5 `terracotta` | `surface` | + error text below (exists) |
| Disabled | 1.5 `line` | `bg` | ink3 text |

Focused and Error currently share a colour, which makes an error on a
focused field invisible. Use `terracotta` for focus and the **deep**
variant `#8B3415` for error, plus the existing message.

**`Button`** — add a real loading state. `loading` currently only sets
`opacity: 0.4` and blocks the press; the label stays. Replace the label
with an `ActivityIndicator` in `fg`, keep the button's width fixed so the
layout doesn't jump. Add `variant: 'destructive'` (used by delete-account
and cancel-booking, both of which currently hand-roll it).

**`Chip`** — add `disabled` and a 120ms colour transition on toggle.
Selected chips should also carry `elev1`.

**`Avatar`** — add an `image` prop. Every avatar in the app is currently
an initial on a colour; player photos land with the Player Card work.

### 4.2 New components

| Component | Purpose | Key props |
|---|---|---|
| `Card` | The missing elevation primitive. Wraps content in `surface` + radius + elevation + hairline. | `elevation`, `radius`, `padded` |
| `PitchCard` | Discover row, image-led. | `image`, `name`, `venue`, `format`, `surface`, `pricePerHour`, `distance` |
| `SlotTile` | Availability grid cell. Extracted from `pitch/[id].tsx`. | `time`, `state: available \| unavailable \| selected` |
| `EmptyState` | One component for all six empty screens. | `icon`, `title`, `body`, `action` |
| `SegmentedControl` | Upcoming/History on Bookings. | `segments`, `value`, `onChange` |
| `PriceSummary` | Base + mandatory addons → total. See §5.3. | `lines`, `total` |
| `Skeleton` | Shimmer placeholder replacing spinner-on-blank. | `variant: card \| row \| tile` |

---

## 5. Screen specs

### 5.1 Discover — `app/(tabs)/index.tsx`

The commercial screen. Highest priority after the fonts.

**Layout.** Eyebrow (`LARNACA`, mono 11 uppercase, `ink3`, tracking 0.08em)
→ greeting (Fraunces 34) → sub (ui 15 `ink2`) → filter chip row →
pitch list → locale toggle pinned to the end of scroll, not inline in the
list.

**PitchCard.** 16:9 image, `r-lg`, `elev2`, image bleeds to card edges
with content below. Name Fraunces 20. Venue + format + surface as a mono
11 uppercase meta row. Price bottom-right, Fraunces 22 with `/hr` in
ui 12 `ink3`. Format gets a small accent dot — `pitch` green for 11-a-side,
`sea` for 5-a-side, `sun` for 7-a-side — so size is scannable without
reading.

**Image fallback** (there are no pitch photos in the data model yet, and
none will exist for the first venues): a generated pattern tile keyed on
pitch id, using the palette's `soft` variants with a pitch-line motif.
Never a grey box. Never a stretched logo. This must look deliberate,
because for the first month it *is* the design.

**Empty** — no pitches in city: `EmptyState`, "No pitches in Larnaca yet",
body naming the cities coming, action "Notify me".
**Loading** — three `Skeleton variant="card"`, not a spinner.
**Error** — inline retry card, keeps the header visible.

### 5.2 Pitch detail — `app/pitch/[id].tsx`

**Hero.** Promote the image to a full-bleed 280px header with the back
button floating on a scrim. Title block overlaps the hero by `space5` on
a `surface` card with `r-xl` and `elev3` — the one place the app should
feel physically layered.

**Availability.** Keep struck-through unavailable slots. Changes: day
strip gets a subtle right-edge fade to signal horizontal scroll (currently
`SAT 15` is clipped mid-glyph, which reads as a bug); selected slot uses
`terracotta` fill (already correct); available uses `surface` + `elev1`;
unavailable drops to `bg` with no border and `ink3` strikethrough.

Add a **sold-out day** state — every slot unavailable — with an inline
"Fully booked · try Tue 11" hint rather than a grid of struck text.

**Sticky CTA.** `elev3`, `surface` with a top hairline. Label shows the
true total: `Book €43`. This is correct today and must survive the
redesign — see §5.3.

### 5.3 The €35 → €43 problem

Discover advertises `€35/hr`. The CTA charges `€43`. The difference is
`bibs` (€5) + `ball_rental` (€3), which are **mandatory on every Cyprus
booking** and therefore are not an upsell — they are part of the price.

Showing €35 in the catalogue and €43 at checkout is the exact pattern
users read as a bait-and-switch, and it will be the first thing a venue
owner's customers complain about.

**Spec:** `PriceSummary` above the CTA, always expanded, never behind a
disclosure:

```
Pitch (1 hr)              €35.00
Bibs · required           €5.00
Ball · required           €3.00
─────────────────────────────────
Total                     €43.00
```

Discover cards should show `€43/hr` as the primary figure with
`€35 + required extras` as mono 11 `ink3` beneath — or show `from €43`.
**This is a product decision, not a visual one**, and it needs a call
before the first venue goes live. Flagged, not decided, here.

### 5.4 Booking flow — `app/booking/[id]/*`

**Checkout.** Currently a bare phase machine. Give each phase a real
state: `creating` → skeleton summary + "Holding your slot…"; `paying` →
Stripe sheet over a dimmed summary; `polling` → progress copy that
escalates honestly after 10s ("Still confirming — your card has not been
charged twice").

**Failure** (seen live today): replace the centred sentence with
`EmptyState` — `terracotta` icon, a title mapped from the error code,
body explaining the money position ("No charge was made"), then Try again
/ Done. Never show a raw runtime message to a user; today it rendered
`Property 'crypto' doesn't exist` straight to the screen.

**Confirmed.** The only celebratory moment in the app and currently
unstyled. Fraunces headline, booking code in JetBrains Mono at 28 on a
`pitchSoft` card — the code is the artifact the player screenshots and
sends to their group chat, so it should be worth screenshotting. Add "Add
to calendar" and "Share to WhatsApp" (the sharing pattern already
anticipated in [FUTURE.md](../FUTURE.md)). A `motion-slow` check-draw on
entry, reduce-motion aware.

### 5.5 Bookings — `app/(tabs)/bookings.tsx`

`SegmentedControl` for Upcoming/History. Booking rows as `Card` `elev1`
with a left accent rail coloured by state — `pitch` confirmed, `sun`
pending, `ink3` completed, `terracotta` cancelled. Code in mono. Next
booking gets a "Tonight · 20:00" relative-time treatment in Fraunces.

Empty: `EmptyState` with a "Find a pitch" action routing to Discover.

### 5.6 Matches and Map — `app/(tabs)/matches.tsx`, `map.tsx` 🔴

Both currently leak internal roadmap language to users.

**Immediate fix — required before any TestFlight build.** Rewrite as
player-facing `EmptyState` copy in EN and ΕΛ, with no stage numbers, no
vendor names:

- Matches — "Open matches are coming. Right now you can book a pitch and
  bring your own crew." + action → Discover.
- Map — "Map view is coming. Larnaca pitches are all within 15 minutes of
  each other — the list has them all." + action → Discover.

**Consider instead: hide both tabs until they do something.** Three
working tabs beat five where two apologise. This is one line in
`app/(tabs)/_layout.tsx` (`href: null`) and is the stronger option for a
first public build. Recommended.

### 5.7 Auth — `app/(auth)/*`

Sign-in wastes ~40% of the viewport. Move the block to optical centre,
add a brand mark above it, and give the four methods a hierarchy: phone
is primary (it is what the Cypriot market expects), Apple/Google/email
are secondary and equal.

**Greek is the constraint here.** "Continue with Apple" → "Συνέχεια με
Apple" is ~30% wider. Buttons must wrap to two lines gracefully, never
truncate a method name.

OTP screen: six discrete digit boxes rather than one text field, auto-
advance, paste-fill from SMS, and a live countdown on "Resend code" that
is currently always enabled.

### 5.8 Profile — `app/(tabs)/profile.tsx`

Group into `Card` sections — Identity, Play style, Preferences, Account —
instead of one long ungrouped scroll. "View my card" is the aspirational
element and should be a proper preview tile with `elev2`, not a bordered
button. Save state is currently invisible; add an explicit saved
confirmation.

Destructive actions (delete account) move into an Account card at the
bottom with `Button variant="destructive"`.

### 5.9 Consent — `src/components/ConsentScreen.tsx`

Genuinely good already — honest, specific, well-structured. Two changes:
give the four bullets small palette-coloured icons, and make "Read the
full privacy policy" a real link once `ludi.app/privacy` exists (M4 #28).
It currently promises a document that does not exist yet.

---

## 6. States matrix

Every list-bearing screen ships five states. None currently ships more
than two.

| Screen | Loading | Empty | Error | Partial | Full |
|---|---|---|---|---|---|
| Discover | 3 card skeletons | No pitches in city + notify | Inline retry, header intact | — | list |
| Pitch detail | Hero + grid skeleton | No slots in 7-day window | Retry, keep hero | Some days sold out | grid |
| Availability | Shimmer tiles | Day fully booked + next-day hint | Retry day | Past-slot strikethrough | tiles |
| Bookings | 2 row skeletons | Empty + Find a pitch | Retry | — | list |
| Checkout | Phase-specific | n/a | Coded failure + money position | Timeout escalation | sheet |
| Profile | Field skeletons | n/a | Save failed + retry | Unsaved changes | form |

---

## 7. Motion spec

| Element | Trigger | Animation | Token |
|---|---|---|---|
| Button | press | scale 0.97 + haptic `impactLight` | `SPRING.press` (amended 2026-10-20) |
| Chip | toggle | bg + border + label colour cross-fade, gives to 0.96, `selectionChanged` haptic | `motion-instant` / `SPRING.press` (amended 2026-10-20) |
| Slot tile | select | scale 1.0→1.04→1.0, fill cross-fade, `selectionChanged` haptic | `motion-quick` |
| Card | appear | fade + 14px rise, 40ms stagger, first 6 items only | `motion-quick` (amended 2026-10-20: the shipped 14 px kept, the spec's cadence restored) |
| Screen | push | platform default — do not hand-roll | `motion-standard` |
| Sticky CTA | slot selected | slide up from below with total cross-fade | `motion-standard` |
| Confirmation | mount | check draw + code fade-up, `notificationSuccess` haptic | `motion-slow` |
| Skeleton | while loading | 1200ms shimmer, `line` → `lineBold` → `line` | linear, loop |

Haptics via `expo-haptics` (new dependency — Expo SDK 54 managed, no
rebuild concerns beyond a config plugin check). Booking confirmation is
the only place that earns `notificationSuccess`; overusing haptics on a
booking app makes it feel like a game.

**Amended 2026-10-20** ([ADR-0035](../adr/0035-motion-engine-and-spring-policy.md),
[plans/motion-v3.md](../plans/motion-v3.md)): motion runs on Reanimated 4 —
springs (`SPRING` in `tokens.ts`) for what moves in space, the `motion-*`
durations for colour and opacity. `notificationSuccess` is earned twice — the
booking confirmation and "You're in" — and `notificationError` joins at three
sites only: a wrong one-time code, a join refused, a payment declined.

---

## 8. Accessibility

The app has had no accessibility pass. Minimum bar for a public build:

- **Contrast.** Measured against the real tokens (WCAG 2.1, normal text
  needs 4.5:1):

  | Foreground | on `bg #F6F1E8` | on `surface #FFFBF2` | Verdict |
  |---|---|---|---|
  | `ink` `#1A1814` | 15.76:1 | 17.16:1 | ✅ |
  | `ink2` `#4F4A40` | 7.82:1 | 8.52:1 | ✅ |
  | `ink3` `#8A8374` | **3.35:1** | **3.64:1** | ❌ fails AA |
  | `terracotta` `#C1502E` | **4.19:1** | 4.56:1 | ❌ fails on `bg` |
  | `pitch` `#2E7D4F` | **4.48:1** | 4.88:1 | ❌ marginal on `bg` |
  | white on `terracotta` | — | 4.71:1 | ✅ (just) |

  Two real problems, not one:

  **`ink3` fails everywhere.** It is the placeholder, caption, meta and
  disabled colour — used on every screen in the app. Darken to `#6E6758`
  (4.99:1 on `bg`, 5.43:1 on `surface`). One token change, app-wide fix.

  **`terracotta` as text on `bg` fails.** This is the *active tab label*
  colour — "Map", "Matches", "Bookings" render terracotta-on-background at
  4.19:1 — and the link colour ("Change number", "Read the full privacy
  policy"). The brand accent is safe as a **fill** with white on top
  (4.71:1) and safe as text on `surface`, but not as text on `bg`. Either
  use the `deep` variant `#8B3415` for accent text on background, or give
  the tab bar a `surface` fill (which §3.2 already wants for `elev3`).

  This matters more than usual here: pitches get booked outdoors, on
  phones, in Cyprus daylight.
- **Touch targets.** Slot tiles are currently ~76×54pt — acceptable. Chip
  height at `size="sm"` is ~26pt — below the 44pt minimum. Raise the hit
  slop rather than the visual size.
- **Dynamic Type.** All sizes are hardcoded. At minimum, support up to
  `AX1` on body text without clipping; the slot grid should reflow from
  4 to 3 columns.
- **Labels.** Slot tiles need `accessibilityLabel="20:00, available"` /
  `"…, unavailable"` — the strikethrough is currently the only signal and
  it is invisible to VoiceOver.
- **State, not just colour.** Booking state accent rails (§5.5) must
  carry a text label too.
- **Focus order** on auth screens: field → primary action → alternatives.

---

## 9. Edge cases

- **Greek text runs 20–35% longer.** Test every screen in ΕΛ before
  calling it done. Known pressure points: auth method buttons, the
  addons sentence, empty-state bodies, `SegmentedControl`.
- **Long venue names.** "Larnaca Sportsplex" is short and flattering.
  Spec two lines then ellipsis on `PitchCard`, one line on rows.
- **No pitch imagery** for the first venues — §5.1 fallback is the
  default state, not the exception.
- **Prices to €999/hr** — Fraunces numerals must not wrap the CTA label.
- **Slot grid on small devices** (iPhone SE, 375pt) — 4 columns become
  cramped; reflow to 3.
- **A booking tonight vs in 6 days** — relative time ("Tonight", "Tomorrow")
  vs absolute date. Threshold: <24h relative, else absolute.
- **Offline.** No offline state exists anywhere. Minimum: a persistent
  banner and disabled CTAs rather than failures at submit time.

---

## 10. Sequencing

August is committed to [M6 — first live venue](../stage-2-commit-plan.md).
This work must not compete with TestFlight. Proposed split:

**Ship-blocking — do before any public build (~4–6 h total)**

1. **Load the fonts** (§3.1). One hour. Changes the entire app.
2. **Fix Matches/Map copy, or hide both tabs** (§5.6). Minutes. Currently
   shows users the words "Stage 3" and "Stage 4".
3. **Fix the two failing contrast pairs** (§8) — `ink3` → `#6E6758`, and
   terracotta-as-text-on-background → `deep` or a `surface` tab bar. Two
   token changes; both currently fail WCAG AA on every screen.
4. **Humanise the checkout failure screen** (§5.4). It renders raw runtime
   errors to users today.

**High value, post-TestFlight (~2–3 days)**

5. Elevation + spacing + radii tokens (§3.2–3.4), `Card` primitive.
6. `PitchCard` with the generated fallback imagery (§5.1).
7. `EmptyState` across all six screens (§4.2).
8. `Input` focus state, `Button` loading state (§4.1).
9. The €35/€43 decision (§5.3) — **needs a founder call, not a designer.**

**Then, and only then, revisit colour**

10. With type and depth actually present, re-judge whether v1 Mediterranean
    still reads flat. If it does, that is the moment to weigh
    [ADR-0017 Ludi Factions](../adr/0017-ludi-factions-colour-language.md)
    — on evidence rather than on mockups. Note ADR-0017 currently lives
    only on the unmerged `plan/match-fit-card` branch; merge it as docs
    before acting on it either way.

---

## 11. Open questions

1. **§5.3 pricing display** — €35 or €43 as the headline? Product call,
   blocks Discover and pitch detail. Needed before the first venue's
   customers see the app.
2. **Pitch photography** — will the first venues supply photos? If yes,
   the fallback in §5.1 is temporary scaffolding; if no, it is the
   product's visual identity and deserves more investment.
3. **Hide or apologise** for Matches and Map (§5.6). Recommended: hide.
4. **Fraunces licensing** — SIL OFL, fine to embed. Confirm JetBrains
   Mono (Apache 2.0) attribution requirements before the App Store build.
5. **Is a five-tab shell right at launch?** With two tabs empty, the app
   advertises absence. Three tabs would read as finished.

---

## Changelog

- **2026-08-10** — Initial handoff. Written after an eyes-on pass over the
  running app (same session that found the `is_admin()` and Hermes
  `crypto` blockers). Direction and scope confirmed by founder: polish
  v1 Mediterranean, whole app.
