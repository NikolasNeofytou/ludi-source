# ADR-0035 — Motion runs on Reanimated 4; springs for what moves in space, durations for everything else

**Status:** Accepted;
**amended 2026-10-15** (see Amendment: the tab bar is the platform's)
**Date:** 2026-09-15
**Deciders:** Nikolas Neofytou (founder)
**Supersedes:** —
**Superseded by:** —

## Context

The player app's motion was rebuilt as a system on 2026-09-01 (#169):
four duration tokens (`instant` 120 · `quick` 200 · `standard` 280 ·
`slow` 450), one easing (`cubic-bezier(0.2, 0, 0, 1)`), a `PressScale`
/ `RiseIn` pair, a haptics bridge with a three-word vocabulary, and a
reduce-motion contract — transforms become opacity-only, durations
halve. Every animation is React Native's core `Animated`.

The research pass in [plans/motion-v2.md](../plans/motion-v2.md)
found the system sound and the engine idle: `react-native-reanimated`
4.1.7 and `react-native-worklets` are already in the binary as a
gesture-handler peer, the New Architecture is on, and
`babel-preset-expo` wires the plugin. Nothing imports it. Meanwhile
two animations (the sticky-CTA height, the confirmation's check draw)
run on the JS thread because core `Animated` cannot offload layout or
SVG props, and five sites had missed the hand-rolled reduce-motion
check — the kind of hole that recurs when every site must remember to
ask.

The platform vendors have converged on physics for spatial motion:
Material 3 Expressive replaced its duration system with *spatial*
springs (position, size; stiffness ≈ 380, damping ≈ 0.8) and *effects*
springs (colour, opacity; critically damped), and SwiftUI's default
animation is a spring. That is company-grade evidence about *feel*, not
study-grade evidence about outcomes. Ludi's identity — "Chalk & Aegean",
crisp, editorial — argues against bounce for its own sake.

Three directions were tabled: **A** calm (durations only), **B**
physical (springs on spatial motion), **C** native-first (hand
containers to the OS). The founder chose **B**, with the native
`formSheet` for the sheet alone and native tabs parked.

## Decision

**Reanimated 4 is the motion engine for `@ludi/ui` and the app; spring
physics drives anything that moves in space or under a finger, and the
four duration tokens drive colour, opacity and reveals.**

Concretely:

- `@ludi/ui` takes `react-native-reanimated` as a peer dependency. The
  package is RN-only by [ADR-0007](0007-design-system-package.md); the
  site copies `tokens.ts` and imports no component, so nothing on the
  web is affected.
- **Spatial** (press scale, slot pop, sheet settle, a roster row
  arriving, the confirmation ring): `withSpring` with two named
  configs added beside `MOTION` — `SPRING.spatial` (default,
  overshoot allowed but clamped where it would read as bounce) and
  `SPRING.gentle` (settles, no overshoot). Values are tuned on device
  and recorded in `tokens.ts`, not in this ADR.
- **Effects** (colour cross-fades, opacity, skeleton wave, text rise):
  `withTiming` on the existing tokens and easing. No springs on colour
  or opacity, ever.
- **Reduced motion** is the engine's job: every animation inherits
  `ReduceMotion.System`; a site that needs a different reduced form
  (the launch screen's "collapse to the built mark") says so
  explicitly. `useReduceMotion()` stays for render-time branches.
- **Layout props and SVG props** animate on the UI thread via layout
  transitions or CSS-style transitions; `useNativeDriver: false` is
  not written again.
- **Screen pushes** stay the platform's. The sheet moves to the native
  `formSheet` route when the booking screen is next open. Native tabs
  are not adopted until the founder has seen them on a device.

## Consequences

### Positive
- Reduce-motion coverage stops depending on each author remembering a
  hook; the default is the accessible one.
- The two JS-thread animations move off the JS thread; a slot fetch no
  longer stutters the price summary.
- Layout transitions make a seat filling *visible* on the fixture
  screen with one prop, which the community research wanted and core
  `Animated` cannot do.
- One vocabulary — spatial vs effects — settles the springs-or-not
  argument per site before it starts.

### Negative
- One new mental model for the founder: springs have no duration.
- `@ludi/ui` grows a native peer; a future test harness needs
  Reanimated's mock.
- Migration touches every primitive at once; it ships as its own
  version (slice 4 of the plan), not as a drive-by.

### Neutral
- The four duration tokens and the easing are unchanged; the handoff's
  §3.5 table stays true.
- Haptics vocabulary is untouched (three words; a fourth needs an ADR
  amendment). *Amended 2026-10-20: a fourth word, `error` — see below.*

## Alternatives considered

### A — Calm: durations only, stay on core `Animated`

Lowest cost; the tokens already comply with the practitioner envelope
(under 300 ms, ease-out). Rejected because it leaves the JS-thread
animations and the per-site reduce-motion hole structurally in place,
and because the platform's own containers now spring — a sheet that
eases while the OS's sheets spring reads as a web view.

### C — Native-first: hand every container to the OS

Most "feels like the phone" per line of code. Taken for the sheet only.
Native tabs are alpha in SDK 54 and cost the tab bar's typography for a
Liquid Glass effect two players would notice; parked on a device look.

### Lottie / Rive / Skia for the celebration

A native dependency and a rebuild for a celebration the app
deliberately has one of, drawn with the brand mark. Rejected.

### Shared element transitions

Reanimated's implementation is experimental with open crash issues in
2026 and no tab-navigator support. Rejected until marked stable.

## Follow-ups

- Slice 4 of [plans/motion-v2.md](../plans/motion-v2.md) migrates the
  primitives and records the tuned spring values in `tokens.ts`; amend
  the handoff §7 `RiseIn` row at the same time.
- ~~Revisit native tabs when `NativeTabs` leaves `unstable_` in
  expo-router, or when a player mentions the tab bar.~~ Revisited
  2026-10-15 — see the amendment below.
- Related: [ADR-0007](0007-design-system-package.md) (design system
  package), [ADR-0002](0002-expo-sdk-54-expo-router.md) (Expo SDK 54).

## Amendment — 2026-10-15: the tab bar is the platform's

**Context.** Option C above parked native tabs as "a typography
sacrifice for a Liquid Glass effect two players would notice, on an alpha
API". Three of those premises moved
([plans/ios-current.md](../plans/ios-current.md)):

- **The API.** `NativeTabs` leaves `unstable_` in Expo SDK 58 (beta
  2026-09-15) — the revisit trigger above fired. The app is on SDK 57
  (`expo-router/unstable-native-tabs`), one import path away.
- **The typography.** The label takes `fontFamily`, `fontSize`,
  `fontWeight` and `color` — not `textTransform` or `letterSpacing`. The
  mono survives; uppercase arrives in the string; only the 0.54 tracking
  is lost. Checked on the iOS 26.2 simulator and the Android emulator.
- **The cost of staying custom.** iPhone Duo (2026-09-09) moves the
  system's tab bar, toolbar and navigation bar to the side of its outer
  display — only system bars; Apple's porting guide tells apps with custom
  bars to use the navigation containers' own. And apps built with the
  iOS 27 SDK can no longer opt out of the new design.

**Decision (founder, 2026-10-15).** Native tabs, with the brand label:
`NativeTabs`, JetBrains Mono uppercase labels, the Aegean tint on the
selected tab, SF Symbols on iOS and Material Symbols on Android in the
bar (Ludi's own icons stay in the content). Unselected labels and icons
are left to the system so they adapt over the glass. Chosen over the
system labels (C) and keeping the JS bar (A) from simulator screenshots
of all three.

**Consequences.** iOS 26+ gets the Liquid Glass bar floating over the
content; the four tab screens set `contentInsetAdjustmentBehavior=
"automatic"` so their lists scroll under it and stop clear of it. iOS
18 gets the classic system bar; Android the Material 3 bar, all labels
shown. The bar's height can no longer be measured (nothing did), all
four tabs mount eagerly, and FlatList misses scroll-to-top. Native top
bars (move 6) and dark mode (move 9) were deferred in the same sitting.

## Amendment 2026-10-20 — a fourth haptic word, `error`, and a second celebration

From [plans/motion-v3.md](../plans/motion-v3.md), decided by the
founder after playing the decision page's demos.

**`error` joins `press`, `selection` and `success`.** iOS
`notificationAsync(Error)`, Android `performAndroidHapticsAsync(Reject)`,
through the same bridge. It plays at exactly three sites: a **wrong
one-time code** (`(auth)/verify.tsx`), a **join refused** because the
game filled or ended (`f/[token].tsx`), and a **payment declined**
(`booking/[id]/checkout.tsx`). Each pairs it with an in-screen message;
the wrong code also shakes its boxes (dropped under Reduce Motion). A
fourth site needs this ADR amended again — every other failure in the
app stays silent in the hand and speaks on screen. Grounds: Apple's
haptics guidance names success, warning and error as the system
notification set, and the iPhone's own passcode screen pairs the error
haptic with a shake.

**"You're in" is the second celebration.** Joining a game — from an
invite, by taking a seat, or by claiming a keeper slot — lands on a
screen with the booked confirmation's ring and check and the `success`
haptic, then "See the squad". The recommendation was to confirm in
place on the roster; the founder chose the screen. A third celebration
needs this ADR amended.
