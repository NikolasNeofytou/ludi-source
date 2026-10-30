 # App palette migration — adopt the site's Aegean palette

**Decision:** the app moves to the site's palette. Aegean (`#175E77`) is the
accent; the Mediterranean/terracotta accent set is retired. Target file:
`packages/ui/src/tokens.ts`.

## Status: mostly already done

Worth knowing before reading the mapping below — **the colour swap itself
landed with the Chalk & Aegean handoff on 2026-08-10**, not with this
migration. `packages/ui/src/tokens.ts` was already on `bg #F2F4F3`,
`ink #10181C`, `primary #175E77`, `pitch #1F6640` when this was picked up.

What was actually outstanding, and is now done:

- `PALETTES`, `PaletteKey` and `ACCENT_MAP` deleted. There is one accent now,
  not a choice. All three had zero call sites outside `tokens.ts`.
- `olive` retired — no site equivalent, no call sites.
- `alert` / `alertSoft` / `alertDeep` added as the role names for the semantic
  red, with `terracotta` / `terraSoft` / `terraDeep` kept as aliases on the same
  values so existing call sites keep working.

## Token mapping (for reference — already applied)

| Was | Hex | Now | Hex |
| --- | --- | --- | --- |
| accent (`terracotta`) | `#C1502E` | `primary` | `#175E77` |
| `sea` / `seaSoft` | `#1F6F8B` / `#D6E8EE` | folded into `primary` | `#175E77` / `#DCE9EC` |
| `pitch` | `#2E7D4F` | `pitch` | `#1F6640` |
| `bg` | `#F6F1E8` | `bg` | `#F2F4F3` |
| `surface` | `#FFFBF2` | `surface` | `#FFFFFF` |
| `ink` / `ink2` / `ink3` | `#1A1814` / `#4F4A40` / `#8A8374` | same roles | `#10181C` / `#3F4C51` / `#5F6E73` |
| `olive` | `#6B7A3A` | **retired** | — |

Typography and radii are unchanged — both systems already use Fraunces for
display, system UI for body, JetBrains Mono for codes and micro-labels.

## One accent, two semantics

Terracotta sat far from pitch green, so "selected" and "confirmed" could never
be confused. Aegean sits closer to pitch green, so the roles stay strict:

- **Aegean = the action you're about to take** — selected slot, active chip,
  primary CTA, prices.
- **Pitch green = the state after it succeeded** — confirmed booking, the
  confirmation screen, skill bars.

Never use pitch green on a control the user can press, and never use Aegean on
a success state.

## Open decision: the semantic red's hex

The design proposed replacing the semantic red with **`alert #A8341F`**
(`alertSoft #F6E0DB`), on the grounds that the site palette has no red and
`#A8341F` was already used by the site's signup-form error state.

**Not applied.** Two reasons:

1. The signup form was never built — there is no waitlist capture by design
   (see [../plans/site.md](../plans/site.md)) — so the "keeps the two in step"
   rationale has nothing to point at.
2. Changing the hex touches ~40 call sites across `apps/mobile`, `apps/admin`
   and `apps/site`, and visibly changes every error, cancellation and LOSS
   state in all three.

The naming half of the proposal *was* adopted, which is the part that carries
the real risk: a token named after a material invites use as an accent. Call
sites can migrate `terra*` → `alert*` incrementally.

If the hex should change too, it is a one-line edit in `tokens.ts` plus the
mirrors in `apps/admin/lib/tokens.ts` and `apps/site/lib/tokens.ts`. The
argument for it: `#A8341F` is 6.4:1 on white, so error *text* could use the
base token instead of having to reach for `alertDeep`.

## Contrast

Re-checked against `#F2F4F3` / `#FFFFFF`:

- `ink` on `bg` ~15:1 ✓
- `ink2` on `bg` ~8:1 ✓
- `ink3` on `bg` ~4.6:1 → captions only, never body
- white on `primary` `#175E77` — 5.3:1 ✓
- white on `pitch` `#1F6640` — 5.9:1 ✓
