# Site motion spec

Fills in [design-handoff-site-v1.md](design-handoff-site-v1.md) §5, which was
marked _"currently absent — proposed, not required"_. Nothing here is new: it
reuses the four motion tokens already defined in
[design-handoff-v1-polish.md](design-handoff-v1-polish.md) §3.5, so the site
and the app share one vocabulary.

Implemented in `apps/site/app/[locale]/globals.css`.

## Tokens (unchanged, from the app)

| Token | Duration | Easing |
| --- | --- | --- |
| `motion-instant` | 120ms | ease-out |
| `motion-quick` | 200ms | ease-out |
| `motion-standard` | 280ms | cubic-bezier(0.2, 0, 0, 1) |
| `motion-slow` | 450ms | cubic-bezier(0.2, 0, 0, 1) |

## Interactions

| Surface | Trigger | Change | Token | Reduced motion |
| --- | --- | --- | --- | --- |
| Fork card | hover | `elev1` → `elev2`, **no transform** | instant | unchanged |
| Venue row | hover | `elev1` → `elev2`, no transform | instant | unchanged |
| Primary / secondary button | hover | background cross-fade to `primaryDeep` | instant | unchanged |
| Button | press | `scale(0.97)` | instant | no scale |
| Nav / footer link | hover | colour cross-fade to `primary` | instant | unchanged |
| Language switcher | click | **none — deliberately instant** | — | — |
| Hero + following group | page load | fade + 8px rise; next group +60ms | quick | fade only |

**Decided: reveals happen on load only.** Nothing animates on scroll — the page
holds still once it has arrived, so reading, screenshotting and fast scrolling
are never fought. A reveal-on-scroll variant was built and rejected: it costs
~700ms before the last of four steps is readable.

## Ambient motion policy

1. Ambient motion lives **inside artwork only** — floodlights breathing, a ball
   playing a pass. Never type, cards, or anything clickable.
2. **One surface gets the full treatment: the home hero.** Pages where someone
   is reading or deciding (players, owners, pitches, roadmap, legal) hold still.
   `/players` carries a floodlight strip and no ball — the home hero owns the
   movement.
3. Loops run **9–18 seconds**. Faster distracts next to a headline; slower is
   invisible and burns battery. In use: 9s floodlight breathe, 14s ball pass.
4. Under `prefers-reduced-motion` every loop **stops dead** — not slows —
   matching the app's `AccessibilityInfo.isReduceMotionEnabled()` convention.
5. Nothing ambient below the fold. If it can't be seen on first paint, it
   shouldn't be running.

Rationale for the constraint: the mobile handoff's own warning that overusing
haptics and motion makes a product feel like a toy. These five rules are how the
site obeys it.

## Implementation notes

- Load reveals are a single `@keyframes ldload` (opacity + 8px translate)
  applied with `animation-delay` for the stagger — no JS, no observers.
- Every page root carries `data-load`; the reduced-motion media query nulls
  `animation-name` on its subtree so content is simply present.
- Ambient loops sit on a `data-motion` root so they can be paused wholesale.

## Not yet implemented

Two rows from the original spec describe surfaces that do not exist yet, and
are deliberately omitted rather than built speculatively:

- **Consent banner** (slide up from below + fade, `standard`). The site loads no
  analytics and sets no non-essential cookies, so there is nothing to gate. This
  lands with PostHog.
- **Signup block** (cross-fade + 10px rise to confirmation, `slow`). There is no
  waitlist capture by design — see [plans/site.md](../plans/site.md); every CTA
  is a direct line to the founder.
