# Design Handoff — apps/site v1 (marketing/legal site)

**Date:** 2026-08-12
**Direction:** first real visual pass. **Not** a repaint — the palette
and type system are already decided (Chalk & Aegean, per
[design-handoff-v1-polish.md](design-handoff-v1-polish.md)); this is
about giving the site depth, imagery and a real breakpoint story.
**Scope:** `apps/site` — the public marketing/legal site at
`ludi.football`. 4 page templates × 2 locales (EN/ΕΛ) = 8 routes.
**Status:** Phase A shipped in code
([PR #84](https://github.com/NikolasNeofytou/Ludi/pull/84),
[docs/plans/site.md](../plans/site.md)). Built by an engineer against
the token system, not designed — this doc is the honest diagnosis of
what that leaves on the table.

> **How to see it live.** Unlike the `.dc.html` prototypes in
> [design-handoff-bundle/](design-handoff-bundle/), this surface is
> already real, working Next.js code — the most reliable reference is
> the running app itself, not a static snapshot that could drift from
> it:
> ```
> cd apps/site && pnpm dev
> ```
> then visit `localhost:3002/`, `/owners`, `/privacy`, `/terms`, and
> the `/el` equivalent of each. If working in a tool that needs a
> self-contained file per screen (Adobe Express, Figma import), export
> each rendered route's HTML — `next build && next start`, then save
> each route's response — rather than hand-authoring new mockups from
> this spec; the spec below is what to change, the running app is the
> ground truth for what exists today.

---

## 1. Diagnosis — what's missing, evidence-based

Findings from driving the built site at desktop (1280px) and mobile
(375px) viewports, 2026-08-12, in both locales. Each is observed, not
guessed.

### 1.1 No imagery anywhere 🔴 highest priority

Every screen is type and flat color. The mobile app handoff
([§5.1](design-handoff-v1-polish.md#51-discover--apptabsindextsx))
solved the "no pitch photography" problem with a **generated field
tile** — an SVG pitch-marking motif keyed by format — and established
that as Ludi's actual visual identity, not a placeholder. The site
doesn't reuse it anywhere. The home page's two audience cards
([§4.2](#42-home--)) are eyebrow pill + heading + body + link, with
nothing to look at. This is the single biggest gap between this site
and it reading as a real product's front door rather than a content
page.

### 1.2 No responsive type scale

Headline sizes are fixed px values that don't change by viewport —
confirmed by resizing to 375px:

- Home hero: 64px at both desktop and mobile. Fits, but towers over a
  375px screen relative to the body copy underneath it.
- `/owners` hero ("Fill your pitch, without the admin"): 40px wraps to
  **three lines** on a 375px phone (see screenshot reference — this is
  the page a pitch owner is most likely to open from a WhatsApp link
  on their phone, per [docs/plans/site.md](../plans/site.md)'s own
  stated success criterion "works on a phone in a pitch owner's
  office"). Not broken, but clearly untuned.

### 1.3 Header has no mobile treatment

Confirmed on `/el/owners` at 375px: the wordmark, the Greek nav label
"Για ιδιοκτήτες γηπέδων" (notably longer than English), and the EN|ΕΛ
switcher all sit on one row with almost no breathing room between the
wordmark and the nav link. It doesn't break today, but it has no
margin left — a longer future label, or a genuinely narrow device
(320px), tips it into wrapping or collision. There is no hamburger /
priority-nav fallback.

### 1.4 No motion at all

The mobile app now has a real motion vocabulary
([§7](design-handoff-v1-polish.md#7-motion-spec) of the polish
handoff) — press scale, card entry stagger, sheet slides. The site has
**zero** transitions: no link hover state beyond the browser default,
no card entry, no page transition. For a marketing surface this
doesn't need to be elaborate, but it currently reads as inert rather
than calm.

### 1.5 No Open Graph / social preview image

This site's primary distribution is a link — sent to a pitch owner
over WhatsApp or email, potentially shared more broadly later. There
is no `og:image`, so every link preview (WhatsApp, iMessage, Slack,
Twitter/X) renders blank or falls back to a generic card. This is a
small, high-leverage miss: the first impression of Ludi for a pitch
owner is often the link preview, before they even tap it.

### 1.6 Legal pages are undifferentiated prose

`/privacy` and `/terms` are functional — clear hierarchy, the existing
draft-review banner reused from the earlier stub — but visually
they're a Word document: no visual distinction between section types,
no way to jump to a section, long uninterrupted paragraph runs on the
data-retention and rights sections.

---

## 2. What's already good — do not touch

- **Typography is actually loaded and working.** Unlike the mobile
  app's pre-polish state (fonts silently fell back to system for four
  months, per §1.1 of the polish handoff), Fraunces + JetBrains Mono
  ship correctly here via `next/font` — confirmed rendering in both
  locales. Fraunces has no Greek glyphs, so Greek headings fall back
  to the CSS chain's next serif; this looks intentional and clean, not
  broken (see the `/el/owners` screenshot reference above).
- **The palette and contrast are inherited, not new.** `apps/site`
  mirrors `packages/ui/src/tokens.ts` exactly (per
  [ADR-0007](../adr/0007-design-system-package.md)), so every contrast
  pair already measured in
  [design-handoff-v1-polish.md §Colour](design-handoff-v1-polish.md#colour--chalk--aegean)
  holds here too — no new audit needed unless new color combinations
  are introduced.
- **The audience-fork structure on home.** Splitting player vs. pitch
  owner into two equal cards rather than one generic pitch is the
  right information architecture; keep it as the visual redesign's
  spine.
- **`color-scheme: light` is deliberate, not a gap.** Chalk & Aegean
  has no dark variant anywhere in the product yet (mobile or admin);
  the site matches that scope on purpose.

---

## 3. Design tokens used

No new tokens needed for the audit above — everything already exists
in `packages/ui/src/tokens.ts` (mirrored in `apps/site/lib/tokens.ts`)
and [design-handoff-v1-polish.md §3](design-handoff-v1-polish.md#3-token-additions).
What the site currently **doesn't use**, and should draw on for this
pass:

| Token family | Status in `apps/site` today | Use for this pass |
|---|---|---|
| Colour (`bg`, `ink`, `primary`, `pitch`, `terracotta`, …) | ✅ fully used | — |
| Typography (Fraunces / JetBrains Mono / system) | ✅ fully used | Add a responsive scale — see §6 |
| Elevation (`elev0`–`elev4`) | ❌ unused — cards use a flat `1px line` border only | Give the fork cards and owner-page contact card `elev1`/`elev2` |
| Spacing (`space1`–`space8`) | ⚠️ ad-hoc px values in inline styles, not the named scale | Adopt the scale for consistency with mobile/admin |
| Radii (`r-sm`–`r-full`) | ⚠️ close by eye (`8`, `16`, `999`) but not the named tokens | Reconcile to `r-md 14` / `r-xl 28` / `r-full 999` |
| Motion (`motion-instant`–`motion-slow`) | ❌ unused | See §6 |

---

## 4. Screen specs

All four templates share the header/footer in §4.5 — specs below are
for the content area only.

### 4.1 Shared layout

| Breakpoint | Behavior |
|---|---|
| Desktop (>960px) | Content centered, `max-width: 960px` (home) / `720px` (owners, legal) |
| Mobile (<768px) | Content fills viewport width minus `24px` side padding, confirmed no horizontal overflow at 375px on any of the 4 templates |

No tablet-specific behavior exists today — single fluid column between
mobile and the desktop max-width. Worth a designer's eye on whether
768–960px needs its own treatment (e.g., the home fork cards currently
`grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`, which
already reflows to one column below ~600px content width — confirm
that's the desired tablet behavior rather than an accident of the CSS
Grid auto-fit).

### 4.2 Home — `/`

**Current layout:** centered hero (title, subtitle, city note) →
two-card audience fork (Playing / Pitch owners) → footer.

| Element | Current | Design opportunity |
|---|---|---|
| Hero title | Fraunces 64px, `ink`, no imagery | Consider a supporting visual — the generated pitch-tile motif from the mobile app (§1.1), or a simple illustrated Larnaca skyline/pitch silhouette, sized to not compete with the wordmark |
| Fork cards | `surface` fill, `1px line` border, `16px` radius, flat | Add `elev1`/`elev2` (§3), and an icon or small illustration per card so "Playing" and "Pitch owners" are visually distinct at a glance, not just by eyebrow-pill color |
| CTA links | Text link + arrow, color-coded per card (`pitch` green / `terracotta`) | Fine as-is; consider whether the player CTA (a `mailto:`) should look visually lighter-weight than the owner CTA (routes to a real page) so it doesn't over-promise |

**States:** no loading/empty/error states apply — this is static
content, no data fetching.

**Edge cases:**
- Long city name if a second city is ever named alongside Larnaca —
  not urgent, `/docs/plans/site.md` Phase D territory.
- Very long translated body copy — confirmed Greek fork-card bodies
  don't overflow the card at 280px min-width, but haven't been tested
  against a longer future rewrite.

### 4.3 Owners — `/owners`

**Current layout:** hero (title, subtitle) → 4 stacked sections (what
Ludi does / how you get paid / cost / what you don't do) → contact
card (`primarySoft` fill, centered, mailto CTA).

| Element | Current | Design opportunity |
|---|---|---|
| Hero | Fraunces 40px, wraps 3 lines at 375px (§1.2) | Needs a responsive scale — smaller on mobile, or a shorter mobile-specific headline |
| 4 sections | Plain heading + paragraph, no visual separation beyond spacing | Each section names a concrete mechanism (Stripe payouts, 10% commission) — icons or a simple numbered-step treatment would help this read as a process rather than a wall of claims |
| Contact card | `primarySoft` background, single centered CTA | Good bones; consider adding a small trust element (e.g. "usually replies within a day") since this is the page's one conversion point |

**States:** static content, no loading/empty/error states.

**Edge cases:**
- This is the page most likely to be opened cold from a WhatsApp/email
  link on a phone — treat mobile as the primary viewport for this
  template, not a fallback of desktop.
- Once ≥1 pitch is actually signed, `docs/plans/site.md` flags a real
  open question: whether to name it here. Leave generic until that's
  decided by the founder.

### 4.4 Legal — `/privacy`, `/terms`

**Current layout:** draft-review banner → title + last-updated date →
sequential sections (heading + paragraphs and/or bullet list).

| Element | Current | Design opportunity |
|---|---|---|
| Draft banner | `sunSoft` fill, `sunDeep` text, `8px` radius | Keep exactly as-is — functional, correctly flags unreviewed legal content, shouldn't be prettied into looking more authoritative than it is |
| Section list | Flat vertical list, no navigation | A sticky in-page section jump-list (desktop only) would help — privacy has 8 sections, terms has 8 |
| Body text | Single `16px` column, `1.7` line-height | Fine for readability; no change needed |

**States:** static content, no loading/empty/error states.

**Edge cases:**
- Both pages are already bilingual and content-parallel (same section
  count/order in EN and ΕΛ) — any redesign must preserve that 1:1
  structure since `lib/content/{en,el}.ts` drives both from the same
  shape.
- These pages must stay legible and unstyled-feeling enough that their
  "draft, pending legal review" status doesn't get visually buried
  under polish — don't let a redesign make them look more final than
  they are.

### 4.5 Shared header / footer

| Element | Current | Design opportunity |
|---|---|---|
| Header | Wordmark (Fraunces 22px) + "For pitch owners" link + EN\|ΕΛ switcher, one row, `max-width: 960px` centered | Needs a mobile treatment (§1.3) — likely: drop the "For pitch owners" text link on narrow viewports (it's reachable from the home page fork anyway) and keep only the switcher, or collapse into a compact menu |
| Footer | `© 2026 Ludi. Larnaca, Cyprus.` + Privacy/Terms links, `1px line` top border | Fine as-is; low priority |
| Language switcher | Plain text `EN \| ΕΛ`, active language in `primary`, inactive in `ink3`, inactive is a link | Works, but is easy to miss — consider a slightly more affordance-carrying treatment (pill/toggle) since it's a meaningful piece of functionality, not just metadata |

---

## 5. Animation / motion (currently absent — proposed, not required)

Keep restrained — this is a marketing site, not the booking app; the
mobile handoff's rule ("overusing haptics/motion make it feel like a
game") applies in spirit here too. Suggested minimum, using the
existing motion tokens from
[design-handoff-v1-polish.md §3.5](design-handoff-v1-polish.md#35-motion):

| Element | Trigger | Animation | Token |
|---|---|---|---|
| Fork card | hover (desktop) | subtle `elev1` → `elev2` lift, no transform | `motion-instant` |
| Nav / footer links | hover | color cross-fade to `primary` | `motion-instant` |
| Hero + fork cards | page load | fade + 8px rise, cards staggered ~60ms after hero | `motion-quick` |
| Language switcher | click | instant — no transition, avoid motion sickness on a locale swap that reflows the whole page | none |

---

## 6. Responsive type scale (proposed)

No scale exists today (§1.2). Proposed, matching the mobile app's
Fraunces sizing logic of "big on the screen that earns it, restrained
elsewhere":

| Element | Desktop (>768px) | Mobile (<768px) |
|---|---|---|
| Home hero title | 64px | 44px |
| Owners hero title | 40px | 32px |
| Section `h2` (owners, legal) | 20–24px | unchanged |
| Body | 15–18px | unchanged |

---

## 7. Accessibility

- **Contrast** — inherited from the already-measured Chalk & Aegean
  pairs (§2); no new combinations introduced yet. Any new color use in
  this pass (icons, illustration) must be checked against the same
  4.5:1 bar.
- **Touch targets** — nav links and footer links are text-only with
  generous line-height; not yet measured against the 44×44pt minimum
  used elsewhere in the product. Check when the mobile header
  treatment (§1.3/§4.5) is designed.
- **Focus order** — not yet audited. Header (wordmark → owners link →
  switcher) → main content → footer is the expected order; confirm
  once interactive elements (hover states, any future form) are added.
- **`lang` attribute** — already correct per-route (`<html lang="en">`
  / `lang="el"`, verified via `document.documentElement.lang`), so
  screen readers and browser translate tools already get this right —
  don't regress it when restructuring templates.
- **Reduced motion** — once §5's motion lands, gate it on
  `prefers-reduced-motion`, matching the mobile app's
  `AccessibilityInfo.isReduceMotionEnabled()` convention.

---

## 8. Sequencing

**High value, low effort (~half a day)**

1. Open Graph image (§1.5) — one static image, highest leverage per
   hour of any item here since it's the first thing a pitch owner sees
   before they even click.
2. Responsive type scale (§6) — fixes the `/owners` 3-line mobile wrap.
3. Header mobile treatment (§1.3).

**Real visual investment**

4. Imagery/illustration direction for the home fork cards and owners
   hero (§1.1) — the biggest lever, and the one most worth getting
   right rather than fast; reusing the mobile app's generated-tile
   language is the safe default, a bespoke illustration set is the
   ambitious option.
5. Elevation + spacing/radii token adoption (§3) across all four
   templates.
6. Motion pass (§5).

**Then**

7. In-page section navigation on the legal pages (§4.4) — nice to
   have, not urgent given these are still draft/unreviewed content.

---

## Changelog

- **2026-08-12** — Initial handoff. Written immediately after Phase A
  shipped in code (PR #84), via `/design-handoff`, following the
  diagnosis-first structure of
  [design-handoff-v1-polish.md](design-handoff-v1-polish.md). Findings
  are evidence-based from driving the built site at desktop and mobile
  viewports in both locales, not from a mockup.
