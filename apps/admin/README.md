# `@ludi/admin`

Internal admin dashboard for Ludi. Next.js 15 + App Router + TypeScript.

## What this is

Stage-2 admin tool for the Ludi team to:

- See all bookings across all venues (M3 #15)
- Refund a booking with audit trail (M3 #16, #17)
- Verify / deactivate pitches (M3 #18)
- Watch daily GMV (M3 #19)

## Status

Scaffold (M3 #13), admin-role gate (M3 #14), the M3 #15–#19 feature pages, and the #41c shell. It ships:

- App Router pages — `/` (redirects to `/bookings`), `/bookings`, `/pitches`, `/venues`, `/gmv`, `/login`, `/locked`.
- `@supabase/ssr` cookie-based auth helpers in `lib/supabase/{server,client,middleware}.ts`.
- Middleware that refreshes the Supabase session on every request.
- `requireAdmin()` server helper in `lib/auth.ts` — every protected page calls this. Non-admins → `/locked`; anonymous → `/login`.
- A web-friendly token subset in `lib/tokens.ts` (mirrors `@ludi/ui` until `packages/ui-web/` exists, per ADR-0007).

Venue + pitch + schedule CRUD, and access for venue owners, land in M6 #41d–#41f — see [docs/plans/venue-owner-admin.md](../../docs/plans/venue-owner-admin.md).

## Run

```sh
cp .env.example .env.local
pnpm dev
```

`pnpm dev` serves **local** Supabase on `http://localhost:3001`.
`pnpm dev:prod` reads `.env.prod.local` and serves **production** on
`http://localhost:3003`. Override either with `ADMIN_PORT`.

The two ports are deliberately different. They used to share 3001, so
starting one while the other was running either failed to bind or left you
on the wrong one — and since both render an identical UI, the only symptom
was data that seemed to be missing. Editing production while believing you
are local is the expensive direction of that mistake; it nearly happened on
2026-08-22. Keep the defaults distinct.

## Env

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (local: `http://127.0.0.1:54321`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key from `supabase status` or the project dashboard. |

Service-role key intentionally **not** here. Privileged operations (refunds, audit writes) call Supabase Edge Functions, which hold the service-role key server-side.

## Two audiences (M6 #41d, ADR-0019)

Venue owners share this app with the founder rather than getting a separate one — see [ADR-0019](../../docs/adr/0019-venue-owners-share-apps-admin.md). Two server-side guards in `lib/auth.ts`:

| Guard | Who passes | Used by |
|---|---|---|
| `requireVenueAccess()` | platform admin, or anyone with a `venue_owners` row | `/`, `/bookings`, `/pitches` |
| `requireAdmin()` | platform admin only | `/venues`, `/gmv` |

Both return a `Viewer` — `{ user, isAdmin, venues }` — where `venues` is the scope: every venue for an admin, the caller's `venue_owners` rows for an owner. `AppShell` reads it for the scope label and the nav.

**The guards are affordance; RLS is the boundary.** Write every page so a bug in the guard leaks nothing the caller could not already read with the anon key.

That guarantee is weaker than it sounds for two tables. `pitches` and `venues` both have a **public read branch** (`is_pitch_bookable(id)`, and active + Stripe-active venues), so RLS alone would show a venue owner every other venue's pitches. Pages listing either table must filter by the viewer's scope themselves — use `scopeToViewer()`. `bookings` needs no such filter: its policy is self-or-owner-or-admin with no public branch.

Pitch verify/activate/deactivate stay admin-only because they go through the admin-authed `admin-toggle-pitch` Edge Function. Owner write access to schedules arrives with #41e/#41f.

## Language (ADR-0037)

The owner surface renders in the **account's** language: `Viewer.locale` is `users.preferred_locale` (`'en' | 'gr'`), read in the same query as the role. The switch in the shell bar (EN · ΕΛ) writes the column and a mirror cookie (`ludi_locale`); the cookie is what the sign-in page, the error and not-found pages and `<html lang>` use, since they render outside auth. A new owner is created Greek — `invite-venue-owner` writes `preferred_locale` into the invite metadata and the signup trigger copies it.

The strings live in `lib/copy/`: one `AdminCopy` interface (`types.ts`), two objects (`en.ts`, `el.ts`), `getCopy(locale)`. Server components call it with `viewer.locale`; client components read the locale from `LocaleProvider` (`useCopy()`); server actions pick their messages from it and `invalid()` / `toFormError()` take the locale. `formatEur`, `formatDate`, `formatDateTime`, `formatDayLabel` take it too and use `el-GR` for Greek. Count-bearing strings are functions.

Two rules keep it honest:

- **English is the source of truth.** `schemas.ts` keeps its English zod messages; `el.ts` maps them by sentence (`validation.messages`), and an unmapped zod default falls back to `validation.fallback`.
- **The founder's pages are not translated** — `/venues`, `/venues/enrol/*`, `/gmv`, the invite and owner-access cards, the refund and verify modals. They carry no dictionary entries on purpose; the shared forms (pitch, venue) are translated whole, commercial block included.

`tsc` is the parity check: a key in one dictionary and not the other fails the build.

## Write surface (M6 #41e)

Venue and pitch CRUD, so onboarding a venue no longer means hand-writing INSERTs.

| Route | Guard | Notes |
|---|---|---|
| `/venues/new` | `requireAdmin()` | Creating a venue is a platform act (ADR-0019) |
| `/venues/[id]/edit` | `requireVenueAccess()` | Commercial block renders for admins only |
| `/pitches/new` | `requireVenueAccess()` | Always created **unverified** |
| `/pitches/[id]/edit` | `requireVenueAccess()` | Venue is locked; verification/activation are read-only |

Forms post to **server actions** in `lib/actions.ts`. Those run with the caller's cookies, so the Supabase client they build carries the caller's JWT and every write lands under their own RLS policies. Nothing here uses the service-role key, and nothing should — the moment it does, RLS stops being the boundary ADR-0019 depends on.

**Three layers have to agree on what an owner may write:**

1. the form doesn't render an admin-only field to an owner;
2. the action doesn't *read* one from an owner's submission — the owner schema has no such keys, so an injected `take_rate_bps` is dropped;
3. `tg_venues_block_privileged_columns` / `tg_pitches_block_privileged_columns` reject the write at the database.

Layer 3 is the one that matters. 1 and 2 exist so a legitimate owner never sees a raw `insufficient_privilege` error. Verified by injecting the admin fields into an owner's form by hand: the venue's take rate, policy and active flag were unchanged while the owner's own edits saved.

**Coordinates.** PostgREST serialises a `geography` column as hex EWKB, which is unusable as a number input's value. `lat`/`lng` are PostgREST *computed columns* (migration `20260822000004`) so the form gets numbers. Note PostGIS stores X = longitude, the reverse of how people say it.

Validation is Zod (ADR-0006, "Zod for every data boundary… user input (forms, URL params)"), pinned to the same `3.23.8` the Edge Functions' import map uses. Lat/lng deliberately do **not** use `z.coerce.number()`: an untouched number input submits `''`, and `z.coerce.number('')` is `0` — which passes a -90..90 check and would silently relocate a venue to POINT(0 0).

## Schedule editor (M6 #41f)

`/pitches/[id]/schedule` — the weekly windows availability is derived from, plus per-date exceptions.

A day may hold several windows (a morning and an evening) as long as they don't overlap; the `btree_gist` exclusion constraint from #41b rejects overlaps at the database and the editor surfaces `23P01` as a sentence.

**The refusal is the feature.** `get_available_slots` subtracts bookings from availability, but nothing subtracts availability from bookings — so before #41f, closing a Saturday left a paid booking pointing at a shut pitch: no slot released, nobody notified, a player at a locked gate.

Cancelling automatically is not on the table: that moves money, which belongs to `admin-refund-booking` with its audit row and required reason. So the editor **refuses** and names what is in the way. Two lookups back it, both `SECURITY INVOKER` so RLS answers for the caller:

| Function | Guards |
|---|---|
| `bookings_in_weekly_window` | deleting or shrinking a weekly window |
| `bookings_stranded_by_override_change` | adding **or removing** an exception: a closure, special hours, a second window on the same date, or deleting one |

An exception **replaces** the day's weekly hours, so the only right question is what the day looks like *after* the change. That rules out two shortcuts:
- **"Removing an exception only adds hours back" is wrong.** A normally-closed Sunday opened specially and then booked would be stranded when the exception goes.
- **"Check the new window alone" is wrong too.** A date can hold several windows, so a booking in the other window is not in the way. The function resolves the precedence exactly as `get_available_slots` does. (`bookings_on_date` and `bookings_outside_window` stay as its building block and for back-compat.)

Two details worth keeping:

- **Only the removed sliver is checked.** Shrinking 23:00 → 21:00 endangers 21:00–23:00, not the whole evening. Checking the entire new window would refuse edits that are perfectly safe, and an editor that cries wolf is one people learn to route around.
- **`bookings_in_weekly_window` is bounded by the data**, not by an invented horizon — a weekly row recurs forever, so the search runs to the furthest existing future booking on that pitch and no further.

## Auth flow

1. Anonymous request hits any protected page → `requireAdmin()` finds no user → `redirect('/login')`.
2. `/login` is a client component. Phone-OTP via `signInWithOtp({ phone })` → `verifyOtp({ phone, token, type: 'sms' })`.
3. On verify, the browser client writes the session cookies; `router.refresh()` re-runs the protected page server component.
4. `requireAdmin()` then checks `users.role`:
   - `'admin'` → render the page.
   - anything else → `redirect('/locked')`.
5. Every subsequent request goes through `middleware.ts → updateSession` so the access token stays fresh.

Self-promotion is blocked at the database level by the `tg_users_block_role_change` trigger (see `packages/supabase/.../20260421000005_rls_policies.sql`), so trusting `users.role` here is safe — a player cannot `UPDATE users SET role='admin'` via the anon client.

## Promote a user to admin (local dev)

Phone-OTP signup creates rows in `auth.users` and `public.users` with `role='player'`. To grant admin during local development, open Supabase Studio (`http://127.0.0.1:54323`) and run, against the local DB:

```sql
UPDATE public.users
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE phone = '+35799123456');
```

(Service-role connection — Studio uses it by default — bypasses RLS, so this works even though clients can't.)

## Shell and UI primitives (M6 #41c)

`components/ui/` holds the app shell and the primitives every page renders through — `AppShell`, `PageHead`, `Card`, `Table`/`Th`/`Td`, `Field`, `Badge`, `Stat`, `EmptyState`. Styling lives in `app/globals.css` under plain class names, matching the convention `apps/site` already set (global CSS + inline styles, no CSS Modules).

**Phone-first.** The venue owner who gets access in #41d checks "is anyone booked tonight?" on a phone in the office; the schedule editor (#41f) may assume a laptop. Every rule in `globals.css` is written narrow-first and widened at 768px. Below that breakpoint tables stop being tables — each row becomes a card and each cell is labelled from `Td`'s `label` prop, which is why that prop is required rather than optional.

**Type.** Literata + JetBrains Mono via `next/font/google`, the same pair `apps/site` uses. Not Fraunces: it ships no Greek subset, so Greek headings silently fall back to a system serif. Venue names and player names are Greek today, and the owner's first contact with Ludi is the site — matching it is continuity.

**Colour.** `lib/tokens.ts` is the single source for the admin. `tokensToCssVars()` emits it as `--ludi-*` custom properties at the document root so `globals.css` can read the palette without the hex being mirrored again. Aegean (`primary`) is the CTA fill; `pitch` green is the success/availability role and is no longer used for buttons; `alert*` is the semantic role for refunds, cancellations and deactivation.

## ADR-0007 follow-up

`lib/tokens.ts` duplicates `@ludi/ui/src/tokens.ts`. We accepted this in [ADR-0007](../../docs/adr/0007-design-system-package.md), which gates extraction on three components genuinely shared between `apps/admin` and `apps/site`.

Checked 2026-08-22 while building #41c: `apps/site/components/ui.tsx` exports `Reveal`, `Eyebrow`, `Kicker`, `StatRail`, `Process`, `Notice`, `ContactCta`, `FieldTile` and `AppCta` — none of which overlap with a Table or a Badge. **The trigger is still 0/3**, so the primitives above stay in-app deliberately rather than being extracted early. `tokensToCssVars()` is the piece worth lifting first when the extraction does happen.
