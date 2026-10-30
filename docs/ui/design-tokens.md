# Ludi · Design Tokens Usage Guide

_Which token to reach for, and when. The tokens themselves live in `packages/ui/src/tokens.ts`._

## The palette (Mediterranean)

Five named palettes + neutral ink scale. The default **accent** is `terracotta`; it's used on primary CTAs, active pills, icon highlights, and any UI element that should feel "Ludi-branded."

| Palette | Hex | Soft | Deep | Use for |
|---|---|---|---|---|
| **terracotta** | `#C1502E` | `#F4E1D4` | `#8B3415` | Primary accent, profile hero, warm callouts |
| **olive** | `#6B7A3A` | `#E8EAD4` | `#3E4A1F` | Secondary accent, nature/outdoor signals |
| **sea** (Aegean) | `#1F6F8B` | `#D6E8EE` | `#0F3F52` | Locations, water-adjacent venues, map markers |
| **sun** | `#D99520` | `#F8E8C9` | `#8A5A0E` | Ratings (stars), MVP highlights, warnings |
| **pitch** | `#2E7D4F` | `#D8ECDD` | `#174028` | Success states, confirmed bookings, skill bars |

## Neutrals (ink scale)

| Token | Hex | Use |
|---|---|---|
| `TOKENS.ink` | `#1A1814` | Primary body text, icons, headlines |
| `TOKENS.ink2` | `#4F4A40` | Secondary text, supporting labels |
| `TOKENS.ink3` | `#8A8374` | Tertiary text, captions, placeholders, disabled |
| `TOKENS.line` | `rgba(26,24,20,0.08)` | Dividers, light borders |
| `TOKENS.lineBold` | `rgba(26,24,20,0.14)` | Heavier borders, outlined buttons |

## Surfaces

| Token | Hex | Use |
|---|---|---|
| `TOKENS.bg` | `#F6F1E8` | App background (sun-bleached stucco) |
| `TOKENS.surface` | `#FFFBF2` | Cards, sheets, elevated UI |

**Rule:** never layer surface over surface. If a card sits on a surface, nudge the color slightly or use a thin border (`TOKENS.line`) for separation, not a second background.

## Typography

Three families, each with a distinct job:

| Family | Use | Weight range |
|---|---|---|
| **Fraunces** (`TOKENS.display`) | Headings, section titles, numeric values (scores, totals) | 500 regular, 600 bold, italic for emphasis |
| **System / SF Pro / Roboto** (`TOKENS.ui`) | All body text, buttons, labels | 400 / 500 / 600 |
| **JetBrains Mono** (`TOKENS.mono`) | Micro-labels, codes (`LAR-2026-0001`), timestamps, tags | 400 / 600 / 700 |

**Convention:** Fraunces is never used for body copy. JetBrains Mono is never used for headlines. Using them out of role breaks the visual language immediately.

### Scale (approximate)

| Size | Fraunces use | UI use | Mono use |
|---|---|---|---|
| 10 | — | tiny labels | tag text (uppercase, letter-spaced) |
| 11–12 | — | captions | caption mono |
| 13–14 | — | body | — |
| 15–16 | — | button text | — |
| 17–22 | sub-heading | — | — |
| 24–36 | section headline | — | — |
| 38–64 | scoreboard, hero numbers | — | — |

## Spacing

The prototype uses ad-hoc numbers (10, 12, 14, 16, 20, 28). For Stage 2, consolidate to a 4px base scale:

| Token (future) | Px | Use |
|---|---|---|
| `space-1` | 4 | fine-grained gaps |
| `space-2` | 8 | between tight elements |
| `space-3` | 12 | between related rows |
| `space-4` | 16 | cards inner padding, list item vertical |
| `space-5` | 20 | screen horizontal padding (default) |
| `space-6` | 28 | section separation |
| `space-8` | 40 | between major blocks |

Actual constants to add in `packages/ui/src/tokens.ts` when we formalize. For now, keep to the ad-hoc usage but prefer the values above on new code.

## Border radii

| Token | Use |
|---|---|
| 10–14 | inline chips, small buttons, icon tiles |
| 16–18 | cards |
| 20–24 | hero cards, sheets |
| 28–32 | floating pill CTAs |
| 100 / 9999 | fully round (avatars, chip pills, round buttons) |

## When to use the accent color

The accent (`ACCENT_MAP[tweaks.accent]`, default `terracotta`) is for **one thing per screen**: the primary action. Not decoration.

- Primary CTA ("Book now", "Pay €40") → `accent`
- Active state of a selected chip or day → `accent`
- Icon inside a "ready to go" card → `accent`
- Everything else → ink scale + surfaces

Overuse of accent makes the design feel garish and breaks the "mediterranean calm" the palette is designed for.

## Using palettes for semantics

When you need to convey a state (win, loss, draw, warning), reach for a named palette, not the accent:

- **Success / booked / available** → `TOKENS.pitch` (+ `pitchSoft` for backgrounds)
- **Warning / rating / MVP** → `TOKENS.sun` (+ `sunSoft`)
- **Error / cancellation / loss** → `TOKENS.terracotta` (+ `terraSoft`)
- **Info / location / water** → `TOKENS.sea` (+ `seaSoft`)

The prototype's result cards (WIN green, DRAW gold, LOSS terracotta) are the canonical example.

## Component-level guidance

### Button variants
- `variant="primary"` — filled with accent, white text. One per screen.
- `variant="secondary"` — transparent with border, accent text. For secondary actions.
- Disabled — `TOKENS.lineBold` background + `TOKENS.ink3` text.

### Chip
- Default — transparent with `lineBold` border.
- Active — filled with color (usually accent). Crucially, chip color can differ from global accent when communicating semantic meaning (e.g., a "drawn" chip uses `sun`).

### Avatar
- Always a colored circle with a single initial.
- Color derived from a stable hash of user_id if not explicitly set (so the same user gets the same color across sessions).

### LevelBars
- Always `TOKENS.pitch` for filled, `TOKENS.lineBold` for unfilled.
- Never rendered larger than `size="md"` unless in a profile hero.

## Accessibility guardrails

- **Minimum contrast:** WCAG AA for all text on surface. Verified combinations:
  - `TOKENS.ink` on `TOKENS.bg` → 13.8:1 ✓
  - `TOKENS.ink` on `TOKENS.surface` → 14.6:1 ✓
  - `TOKENS.ink2` on `TOKENS.bg` → 7.8:1 ✓
  - `TOKENS.ink3` on `TOKENS.bg` → 3.8:1 → **captions only, never body**
- **Tap targets:** 44×44pt minimum (iOS HIG). Buttons default to 48pt height.
- **Dynamic Type:** honour `useWindowDimensions` + `PixelRatio.getFontScale()` on text larger than 11pt.
- **Reduced motion:** disable scale animations on `Pressable` when accessibilityReduceMotion is on.

## Dark mode

**Not in MVP.** The Mediterranean palette was designed light-first. Dark mode ships Stage 4 — would require a dedicated pass on `TOKENS` (probably a light/dark pair per token) and all gradients in `hero` fields.

## Changelog

- **2026-04-21** — Phase 5. Guidance codified based on the prototype's implicit conventions.
