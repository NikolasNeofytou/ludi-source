# JOURNAL.md — techniques, gotchas, workflow patterns

## Purpose

A captured-while-fresh record of **reusable techniques, gotchas that
bit us, and workflow patterns** picked up during development. Each
entry is short, self-contained, and links to the relevant code,
commit, or ADR where the full context lives.

This file is **not**:
- a planning artifact (those are `VISION.md`, `roadmap.md`, `stage-2-commit-plan.md`)
- an architectural decision record (those are ADRs in `docs/adr/`)
- a convention spec (that's `CONVENTIONS.md`)
- a changelog (the git log + the `stage-2-commit-plan.md` changelog are the changelog)

It **is**:
- a "future-us cheat sheet" for things we figured out the hard way
- a write-down of patterns we used more than once and want to use again
- a parking spot for one-paragraph lessons too small for an ADR

## How to add an entry

Three sections — Techniques, Gotchas, Workflow patterns. Each entry
is one heading (`###`) plus a short body, ideally under ~15 lines.
If an entry grows past that or starts encoding a real architectural
decision, it has outgrown the journal and should become its own ADR
or doc.

---

## Techniques

### Server-snapshot pricing + client never sends amounts

Every Edge Function that creates a money-touching row reads the
catalog rows itself (`pitches.price_per_hour_cents`, addon prices,
`venues.take_rate_bps`, `venues.cancellation_policy`) and computes
`base_price_cents`, `addons_price_cents`, `total_cents`,
`platform_fee_cents` server-side. The booking row carries those
snapshots so mid-booking config changes don't retroactively shift
historical bookings. The client sends `pitch_id`, `starts_at`,
`ends_at`, and addon codes — never amounts.

This is the convention; see [CONVENTIONS.md](CONVENTIONS.md) §Edge
Functions. The exemplar is `create-booking`. Tampering threat is
neutralised structurally instead of by validation — the client
literally has no field to inflate.

### EXCLUDE USING gist for no-double-booking

```sql
EXCLUDE USING gist (
  pitch_id WITH =,
  time_range WITH &&
) WHERE (state IN ('paid','confirmed','completed'))
```

This is the load-bearing invariant of the booking model. Even if
two `create-booking` requests race past the application-level
"is this slot free?" check, the constraint rejects the second
insert at the DB level. Cancelled/refunded bookings are filtered
out by the partial `WHERE`, so the slot becomes re-bookable
without manual cleanup.

`time_range` is a generated `tstzrange(starts_at, ends_at, '[)')` —
half-open so abutting bookings (10:00–11:00 and 11:00–12:00) don't
falsely collide.

### pg_cron + cleanup functions for transient state

Three scheduled functions backstop the booking flow:
- `cleanup_stale_pending_bookings(15)` — every 5 min; cancels
  bookings stuck in `pending` for >15 min (abandoned PaymentIntents).
- `cleanup_expired_idempotency_keys()` — every 10 min; prunes
  the idempotency cache.
- `cleanup_old_stripe_events(30)` — daily 03:00 UTC; prunes
  processed-event de-dup rows older than 30 days.

The schedule migration detects pg_cron availability and skips
gracefully where absent (e.g. vanilla CI Postgres). See PR #6
([20260423000003_pg_cron_cleanup_schedules.sql](packages/supabase/supabase/migrations/20260423000003_pg_cron_cleanup_schedules.sql)).

### Stripe webhook de-dup via `stripe_events` table

```sql
INSERT INTO stripe_events (id) VALUES ($1) ON CONFLICT DO NOTHING
-- if 0 rows inserted, this event was already processed
```

Replay safety for free. The first-action of every webhook handler.
Combined with Stripe's at-least-once delivery, this gives
at-most-once business-state changes.

### pgtap + role-switching helpers for RLS tests

CI bootstrap installs an `auth.uid()` GUC override and helper
functions `set_test_user(uuid)` / `set_test_anon()` so a single
transaction can switch identity to assert "user A can see X" /
"user A cannot see Y". The full bootstrap is in
`packages/supabase/tests/rls/_bootstrap.sql`.

The CI workflow installs `postgresql-15-pgtap` into the postgis
service container and `pg_prove` on the runner. See PR #8 for the
template.

### Hermes has no global `crypto` — use `expo-crypto`

`crypto.randomUUID()` throws `ReferenceError: Property 'crypto'
doesn't exist` under Hermes on RN 0.81. There is no global `crypto`
object at all, so this fails on property *access*, not on the method.

It sat at the top of the checkout effect
(`newIdempotencyKey()` is the first statement), so the entire booking
flow was dead — no `create-booking` call was ever made. It shipped
behind a comment asserting the opposite ("RN 0.81 + Hermes ships Web
Crypto's randomUUID. No polyfill needed"), which is the real lesson:
a comment claiming a runtime capability is a claim to verify on
device, not to take on trust.

`expo-crypto` was already a dependency. `import { randomUUID } from
'expo-crypto'` is native-backed and needs no polyfill wiring.

### Idempotency keys in a `useRef` across mobile retries

```ts
const cancelKeyRef = useRef<string | null>(null);
const onCancel = async () => {
  cancelKeyRef.current ??= crypto.randomUUID();
  const res = await invoke('cancel-booking', { booking_id }, {
    headers: { 'Idempotency-Key': cancelKeyRef.current },
  });
  if (res.ok || isAlreadyDoneError(res)) cancelKeyRef.current = null;
  // transient errors → keep the key, retry hits the cached response
};
```

Generate the idempotency key when the *user-action* starts, not
when each HTTP attempt fires. Hold it in a ref, reuse on retries,
clear on terminal states. See [CONVENTIONS.md](CONVENTIONS.md)
§Mobile and the cancel-booking exemplar.

### Sales-demo fixtures: prospect venues seeded by visit-plan stop number

`seed.sql` §3 seeds the 18 Nicosia prospect venues from
[docs/plans/Nicosia/nicosia-visit-plan.pdf](plans/Nicosia/nicosia-visit-plan.pdf)
so a sales visit can show a manager their own venue inside Discover —
real name, district, pitch mix, and published prices where the desk
scan found them. The ID namespace encodes the source: venues
`…-0000000002VV`, pitches `…-00000003VVPP`, where `VV` is the stop
number in the visit plan. Local-dev only (seed never touches the
hosted project); the pattern generalises to the next city's visit
plan by claiming the next `VV` range. Contact details are fakes on
purpose — the real ones are personal mobiles and seed.sql carries no
personal data. Prices marked unverified in the scan are placeholders
inside the city's established price band, not facts.

### Injectable haptics bridge keeps @ludi/ui Expo-free

`packages/ui` must not depend on Expo (it typechecks standalone and
could serve non-Expo hosts), but the handoff's motion spec wants
haptics inside primitives (`Button` press, `SegmentedControl`
selection). The pattern: `packages/ui/src/haptics.ts` exports
`haptic(kind)` as a no-op plus `setHapticsHandler()`; the app injects
expo-haptics once at the top of `apps/mobile/app/_layout.tsx`. The
vocabulary is deliberately closed (`press` / `selection` / `success`)
so call sites can't invent new haptic moments — the handoff reserves
`success` for booking confirmation only. Same shape works for any
native capability a shared package wants but must not import.

---

## Gotchas

### One Vercel team is one quota: another project's ISR paused ludi.football

On 2026-10-16 at 14:26 Cyprus time Vercel soft-blocked the Hobby team
`nikolas-neofytous-projects` (`FAIR_USE_LIMITS_EXCEEDED`,
`dataCacheWrite`, unpauses 2026-11-15). Every project on it answered 402:
the site, the admin and the lobby TV. Hobby includes 200k ISR write units
a month (8 KB each), shared by every project on the team. The usage API
(`GET /v2/usage?type=requests`, the CLI token works) put plutarch at 111k
of the team's ~121k function invocations in the 30 days. Its word pages
are ISR (`revalidate = 3600`, `dynamicParams`, 94,509 lemmas, 40,000 in
the sitemap), so crawlers write the cache. Ludi wrote almost nothing.
Every admin route renders on demand and the TV is `force-dynamic`, so its
once-a-minute refresh costs invocations, not cache writes. The site's
only writer was the home page's hourly venue-card fetch. It is
`no-store` now, and nothing in either app writes the Data Cache. On
Hobby, the per-project ISR breakdown needs Observability Plus. Read the
invocation split per project instead. Don't expect a `●` in `next
build`'s route table to mean "static". The site's table marks a dozen
pages `●`, yet `prerender-manifest.json` holds only robots, health, AASA
and the OG images, and `next start` serves every page `private, no-store`.

### A sign-in email's token_hash is a bearer token, whatever the client's flow

Checked against GoTrue 2.195 locally and 2.197 (prod's version) in a
throwaway container, 2026-10-20: `verifyOtp({ token_hash, type: 'email' })`
returns a session on ANY client, even when the link was requested by a
PKCE client and the hash is `pkce_…`-stamped. Only the
`{{ .ConfirmationURL }}` shape is bound to the asking device (GoTrue's
GET /verify redirects with a `?code` that needs the stored verifier). So
moving a client to PKCE protects OAuth redirects, not token_hash links:
those need their own gate (`apps/mobile/src/lib/pending-sign-in.ts`) and
a transport only the app can receive (the universal link). Two template
traps from the same probe: GoTrue renders bodies with `html/template`, so
`{{ .RedirectTo }}` holding `ludi://callback` comes out as `#ZgotmplZ`
(the scheme must be written into the template literally); and a double
brace inside the template's own HTML comment is parsed too — an empty one
failed `invite.html` whole, and GoTrue silently sent its default email.
Paste-and-forget templates get the probe before they get the dashboard.
And on Hermes, supabase-js's PKCE degrades without a word beyond one
warning: no global `crypto`, so the verifier comes from `Math.random` and
the challenge goes out `plain`. `apps/mobile/src/lib/web-crypto.ts` lends
it expo-crypto's CSPRNG and SHA-256; the authorize request then carries
`code_challenge_method=s256` (checked on the simulator).

### A screen's own light status bar outlives a push

Sign-in draws its art under a light status bar, while the root layout's
`<StatusBar style="dark" />` serves every chalk screen. A stack keeps the
screen underneath mounted, so a plain `<StatusBar style="light" />` on
sign-in would stay in charge over verify and magic link, white on chalk,
where the clock disappears. Render it only while the screen is focused:
`useFocusEffect` sets a `focused` flag and the screen renders
`{focused && <StatusBar style="light" />}`. Unmounting it hands the bar
back to the root's dark one on push, and the flag brings it back on
return ([app/(auth)/signin.tsx](../apps/mobile/app/(auth)/signin.tsx),
checked both ways on the simulator 2026-10-20).

### Fraunces has no Greek, and Literata's capital accents hang outside the box

Google Fonts serves Fraunces in latin, latin-ext and vietnamese only, so
every Greek name, foot or tier set in `TOKENS.display*` silently fell back
to the system font, mid-card, beside Latin in the serif. Check a font's
cmap before trusting it with a script (`fontTools` `getBestCmap()`).
Literata (already bundled for the share card) has Greek, so display text
goes through `displayFamily()` in `@ludi/ui`, which picks Literata for a
Greek string ([plans/player-card-v2.md](plans/player-card-v2.md)). Second
trap, found on the simulator: Literata draws a capital's tonos up to
0.23 em *left* of the glyph origin (Έ, Ό, Ύ), and iOS clips whatever a
Text draws outside its box, so «Έμπειρο» rendered as «Εμπειρο».
`displayHang()` pads the box and pulls it back by the same amount.
Related: upper-case Greek labels must drop the tonos («ΕΠΙΠΕΔΟ», not
«ΕΠΊΠΕΔΟ»); bare `textTransform: 'uppercase'` keeps it, `upperLabel()`
doesn't.

### The Stripe publishable key that counts is the one inside the binary

`create-booking` returns `publishable_key` from the server environment and
the mobile client carries it all the way through its types — and then
never uses it. `StripeProvider` is initialised in `_layout.tsx` from
`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, baked in at build time, and
`stripe-checkout.ts` calls `initPaymentSheet` without a key at all. So the
money flip cannot be a secrets-only change: a server on `sk_live` with an
installed build on `pk_test` produces a payment sheet that fails at
confirmation with nothing useful in the error. Found while writing
[runbooks/money-flip.md](runbooks/money-flip.md), not by a failing test —
nothing exercises the two keys against each other.

### A venue leaving `active` un-verifies its pitches, and they can't be re-verified early

Two triggers compose into a strict ordering nobody wrote down.
`tg_venues_cascade_stripe_status` sets `pitches.is_verified = false` on
every pitch of a venue that leaves `active`; `tg_pitches_verify_guard`
then refuses to set `is_verified = true` while the parent venue is not
`active`. Together they mean pitch verification can only ever happen
*after* Stripe onboarding completes — so the money flip's venue reset
(which drops every venue to `pending`) silently un-verifies the estate,
and the tempting optimisation of pre-verifying pitches during the KYC wait
is impossible by construction. Fail-closed and correct; just invisible
until you plan a flip around it.

### RLS has no column dimension — and a column REVOKE breaks whole-row reads

A SELECT policy decides which *rows* a role sees, never which columns.
`venues_select_public_or_owner_or_admin` made active venues public, so
anyone with the anon key could read `take_rate_bps` and
`stripe_account_id` (confirmed on prod 2026-09-13). The fix is column
privileges (`REVOKE SELECT` on the table, then `GRANT SELECT (col, …)`),
plus a definer-rights view for the columns owners do need. One trap: once
any column is revoked, anything that references the **whole row** fails
with "permission denied for table". That includes PostgREST computed
columns such as `lat(venues)`, which the player app's pitch list used,
and `select('*')`. The pgtap database caught it before prod did; the
answer was stored generated columns. Grep for `(public.<table>)` function
signatures before revoking anything. Migration `20260913000005`.

### Money-flow claims get a test-mode run, not a docs read

ADR-0026 reasoned from Stripe's docs that a destination-charge refund
with `reverse_transfer` alone "halves Ludi's fee through the balance
math". A 30-line script against test mode showed otherwise: with
`application_fee_amount` the transfer is the **full** charge, so the
venue funded the whole refund and Ludi kept its whole fee (€17.20 /
€4.30 instead of €19.35 / €2.15). Two careful readings of the docs had
given opposite answers. When a claim decides who ends up with the
money, create the charge in test mode, refund it, and read
`transfer.amount_reversed` and `application_fee.amount_refunded`. Script
shape: [ADR-0026 amendment](adr/0026-funds-flow-destination-charges.md),
launch audit 2026-09-13.

### An empty state is a promise with an expiry date

The player card reserved three reputation slots — reliability, matches
played, peer ratings — as designed "earned as you play" em-dashes,
deliberately unwired (ADR-0012, 2026-05-30). Correct at the time: no
match history existed anywhere in the system.

Community v2 then shipped `my_record()` (2026-09-01). Nobody went back.
By 2026-09-02 the profile tab said **3 matches played** and the card
opened from it said **—** plus a **NEW PLAYER** chip. The card was
denying a record its own sibling screen was displaying, and it had been
doing so since the day the RPC landed.

The empty state was never wrong; it just outlived the condition that
made it true. So: **every empty state is a claim that some data does not
exist yet, and it acquires an expiry the moment that data ships.** When
a feature starts producing a number, grep for the surfaces still saying
that number is unearnable. Two are still pending on this card —
reliability and ratings — and they will fail exactly this way the day
no-show tracking and peer ratings land.

Cheap mitigation used here: the card now takes the record as a prop
rather than deciding for itself, so the "is there data?" question is
answered by the caller that actually knows.

### A migration's REVOKE is not the last word in the pgtap harness

*Fixed 2026-10-20; kept for the symptom and the rule that replaced it.*

Until 2026-10-20, `_bootstrap.sql` ran *after* every migration and did a
blanket `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` and `GRANT
EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated`, so the
old CI role stub had enough privilege to exercise RLS at all. Those
grants silently undid any `REVOKE ... FROM anon` a migration wrote.
Production never saw this, because there Supabase's default privileges
apply at CREATE time and the migration's trailing REVOKE really is the
last word.

The symptom is specific and misleading: a `throws_ok(..., '42501')`
assertion reports **"caught: no exception"** while the object's ACL,
inspected directly, looks exactly right. The role *is* `anon`; the grant
was simply re-added underneath you.

It bit three times — `v_open_fixtures` (2026-08-31), community v2's
functions (2026-09-01), `my_fixtures_to_fill` / `my_series` (2026-09-02)
— and each time the fix was to re-state the revoke in the bootstrap. The
revokes nobody re-stated were invisible: the 2026-10-19 audit found four
definer functions open to anon on prod that no test could see.

**Now there is no blanket grant.** Functions came out with #335 and
tables and views a day later. The CI dry-run restores Supabase's default
privileges after it recreates `public`, so the suite runs on the grants
the migrations leave, which are prod's. Removing the table grant failed
two tests, and both read objects as a role prod denies: 13_* counted
`v_fixture_roster` rows as anon (20260824000001 revokes anon on it and on
`v_fixture`), and 49_* counted `push_tokens` rows as a player
(20261014000003 revokes the table from anon and authenticated). Neither
was a prod gap; both now assert the 42501. So **never re-state a revoke
in `_bootstrap.sql`**: assert it in the test. A grant the test sees is a
grant prod has.

### `REVOKE … FROM anon` and `REVOKE … FROM public` are two different doors

anon is a member of PUBLIC, so revoking anon alone leaves it PUBLIC's
`EXECUTE` (every new function has one). And Supabase's default privileges
give anon its own explicit grant, so revoking PUBLIC alone leaves that.
The 2026-10-19 audit found both: `end_booking_series`, `load_cfa_round`,
`venue_display_token` and `materialise_booking_series` had the first
half, `join_fixture` the second. Write both, every time:
`REVOKE ALL ON FUNCTION … FROM public, anon`. `tests/rls/59_function_acl.sql`
fails on any definer function anon can reach that is not on its
allowlist.

### The empty-name gotcha claimed a third surface

`users.first_name` is `NOT NULL DEFAULT ''` (see *NOT NULL DEFAULT
columns cannot answer "did they choose this?"* below). The fixture
roster found it on 2026-09-02; the profile audit found it again the same
day, one layer up. `FactionsBanner` and `FactionsCard` both interpolated
`` `${first_name} ${last_name}`.trim() `` with no fallback, so the
profile tab's entire identity — the name at the foot of the hero — was
the empty string, and the screen rendered as a bare brand mark with no
person in it.

Interpolation hides this in a way `??` at least makes visible: there is
no null to catch, and no type error, because `''` is a perfectly good
string. Both surfaces now go through one `displayName(profile, fallback)`
helper in `lib/player-profile.ts`, so the fallback cannot be remembered
in one call site and forgotten in the other.

### NOT NULL DEFAULT columns cannot answer "did they choose this?"

Two of them bit the same screen on the same afternoon (fixture roster
depth, 2026-09-02). `users.first_name` is `NOT NULL` and defaults to the
empty string, so a player who never opened their profile comes back as
`''` — and `first_name ?? handle ?? '—'` sails straight past it, because
`??` catches null and not empty. Seats rendered nameless. `users.skill_level`
is `NOT NULL DEFAULT 3`, so it cannot distinguish "picked Regular" from
"never touched the card": the teammate sheet confidently reported a skill
level for someone with an entirely empty profile.

The rule both cases want: a column with a NOT NULL default carries no
evidence that a human chose its value. Read intent off a genuinely
**nullable** neighbour instead — the roster sheet now waits for `positions`
or `preferred_foot` (both optional) before it believes `skill_level`. And
for text, `||` (falsy) not `??` (nullish), or trim first.

Both were invisible in the types (`string`, `number` — never null) and
invisible in review. The simulator against seed rows in exactly that state
is what surfaced them.

### Generated columns are NULL in NEW inside BEFORE triggers

The ADR-0028 column guard on `bookings` compares
`to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)` (minus the columns a
client may touch) so that every future column is frozen without list
maintenance. First run rejected even a legitimate `is_open` flip:
Postgres computes `GENERATED ALWAYS … STORED` columns only **after**
all BEFORE triggers have run, so `NEW.time_range` arrives in the
trigger as NULL while `OLD.time_range` carries the stored value — a
phantom diff on every UPDATE, surfaced by the pgtap suite (test 1 of
`24_open_matches.sql`) rather than by reading. The durable lesson:
a whole-row jsonb comparison in a BEFORE trigger must subtract every
generated column alongside the deliberately-writable ones — and a new
generated column added later will resurface as this exact failure, so
the guard's comment names the mechanism.

### The RLS harness's blanket grant silently undoes migration REVOKEs

**Superseded 2026-10-20:** the bootstrap no longer grants anything on
`public` tables, views or functions to anon or authenticated. See *A
migration's REVOKE is not the last word in the pgtap harness*.

`_bootstrap.sql` grants table CRUD to `anon`/`authenticated` AFTER all
migrations have run (the CI stub ships no Supabase default privileges),
which re-grants `anon` on any object whose own migration deliberately
ended with `REVOKE … FROM anon` — in production the migration's revoke
is the last word, in the harness the blanket grant is. Found when
`v_open_fixtures`' anon-lessness test caught no exception. The
bootstrap now re-states that one revoke after the grant block; any
future migration that revokes `anon` on a new object and wants that
tested must do the same, or the test asserts against harness state,
not production state.

The same blind spot hid a worse case on 2026-10-20 (Strava build,
Wave 1), the day before the harness stopped granting: a view checks EXECUTE on the functions it calls **as the
player reading it**, even with `security_invoker = off`. So a definer
view cannot call a function the migration revoked from `authenticated`.
`v_open_fixtures` called the internal `fixture_series()`, and every
signed-in player's board failed. pgtap passed, because the harness had
granted the function back. Seen first on the simulator. Fixed with a
narrow, granted `open_fixture_series()`, and the test re-states the
REVOKE before it reads the view.

### A state census must grep the literals, not just the `state IN` idiom

Adding `'collecting'` to `bookings.state` (C2) began with a census of
every site that enumerates booking states — fifteen found by grepping
`state IN` and state-literal lists across migrations, functions and
clients, each updated with a named decision. The sixteenth was found
only by driving the real screen: `ACTIVE_STATES` in the bookings tab
builds its set positively (`new Set(['pending', 'paid', …])`), so the
grep for the SQL idiom never saw it, and every collecting fixture was
silently absent from the one list meant to show them. The durable
lesson compounds the `completed`-in-six-places one: when a state joins
the machine, grep for the **literals** (`'pending'`, `'confirmed'`, …)
across the whole repo and triage every hit — the idiom-shaped grep
finds only the sites that share your idiom. Client-side Record<State,…>
maps are the reliable tell: the typechecker catches those, which is
also why `BookingState` must gain the new member before anything else.


### `refund_application_fee` does the opposite of what it sounds like

Both refund paths shipped with `refund_application_fee: true` and no
`reverse_transfer`, under a comment claiming the venue's payout would
shrink proportionally. Stripe's actual destination-charge semantics:
without `reverse_transfer` the venue **keeps the transfer** and the
platform funds the whole refund, and `refund_application_fee` pushes
the platform's fee **to the connected account** — so the shipped flags
would have had Ludi paying the customer, the venue keeping everything,
and Ludi's own fee handed to the venue on top (≈ −€25 on a €45 booking
refunded 50%). Found 2026-08-29 during the M6 #38 funds-flow
reconciliation, by reading the docs instead of the parameter names;
fixed the same day (`reverse_transfer: true`, fee flag removed) before
any real-money refund existed. The durable lesson: pro-rata unwinding
needs **no** fee flag — reversal plus the balance math already shrink
every party proportionally — and any Stripe parameter whose name
encodes a direction ("refund", "reverse") deserves one docs read to
learn *which way* it points. ADR-0026 records the model.


### A view without `security_invoker` bypasses RLS — "views inherit RLS" is false

`v_gmv_daily` shipped in May with a closing comment asserting that views
inherit RLS from their base tables. They do not. A view runs with its
OWNER's privileges by default, and the owner (`postgres`) bypasses RLS —
so any signed-in user could read Ludi's daily gross/net/refund numbers
through PostgREST while `payments` itself correctly returned zero rows.
Found 2026-08-28 while writing `v_venue_earnings_daily`, by checking the
claim in that comment rather than trusting it; fixed in
`20260828000001` with `security_invoker = on` plus a pgtap regression.

Two lessons worth more than the bug: **a reassuring comment is a claim to
test, not a fact**, and the tell is cheap to check — probe the view as
`anon`/a stranger and compare against the base table. If the base table
returns nothing and the view returns rows, the view is a hole. Every new
view in this repo now sets `security_invoker` explicitly, and definer
views (the ADR-0013 shape) must carry their own caller predicate in the
`WHERE` clause.

### sqlfluff cannot parse `ALTER VIEW … SET (…)`

The postgres dialect throws an unparsable-section (PRS) error on
`ALTER VIEW x SET (security_invoker = on)` and fails CI, even though the
statement is valid Postgres that `psql` applies happily. Restate the view
with `CREATE OR REPLACE VIEW … WITH (security_invoker = on) AS …`
instead — same effect, parses fine, and it matches how every other view
in the repo declares its options. Local check before pushing:
`cd packages/supabase && sqlfluff lint supabase/migrations/`.

### Editing a migration doesn't reach the running app until it is re-applied

Re-running a migration against a throwaway pgtap database (the correct
way to test RLS — see the next entry) proves the SQL is right. It proves
nothing about the LIVE local dev database the simulator's app is actually
talking to, which only sees a `CREATE OR REPLACE` the moment it is run
against it again.

Bit W5: `fixture_preview()` grew a `booking_id` output column mid-session.
Verified clean against `ludi_pgtap`, never re-applied to the `postgres`
database on port 64322. The client called it, got the old 10-column
shape, and silently built `/booking/undefined` — no thrown error anywhere,
because every layer along the way handled its own "no such id" case
correctly. Found by reading the PostgREST gateway's own access log
(`docker logs supabase_kong_ludi`), which showed the literal query string
`booking_id=eq.undefined`, not by anything in the app.

Two things worth carrying forward: change a function's *return columns*
and `CREATE OR REPLACE` fails outright (Postgres doesn't allow altering a
set-returning function's shape in place) — but `DROP FUNCTION` then
re-running the whole migration file recovers cleanly, which is the
teardown+reapply loop this session already used for RLS testing, just
also needed here. And when a network call to a definitely-correct RPC
does nothing useful, checking the actual request the client sent — via
the gateway log, not the app — finds a stale-server mismatch far faster
than re-reading the client code.

### Nothing ever sets `bookings.state = 'completed'`

`'completed'` has been in the state CHECK since the initial schema and
**six** places read it — `get_available_slots`, both EXCLUDE predicates,
`admin-refund-booking`'s allowed prior states, the `charge.refunded`
handler, the admin bookings list, the mobile state labels. No code writes
it. There is no cron job for it (the three scheduled jobs are
stale-pending cleanup, idempotency pruning, Stripe-event pruning) and no
webhook path that sets it.

It reads as harmless because a played fixture stays `confirmed`, which
still blocks its slot. The money is where it bites:

`cancel-booking` rejects `completed` explicitly — *"slot already played"*
— and that guard **never fires**. A week-old booking is still `confirmed`,
still passes the `pending/paid/confirmed` check, and
`refundBpsForPolicy('flex', -168)` falls through to the `< 6h` tier,
which for `flex` is **50%**. So a played flex booking is refundable for
half its value, indefinitely. `standard` and `strict` return 0 at that
tier, and no venue is on `flex` yet, which is the only reason this has
not cost anything.

Two separable fixes: derive "played" from `ends_at < now()` wherever the
UI needs it (the truth is on the row), and decide who owns the
`confirmed → completed` transition — a cron job, or the payout webhook.
Found 2026-08-24 while writing DATA_MODEL for
[plans/shared-fixture.md](plans/shared-fixture.md), not by a test.

### `get_available_slots` mis-derives split windows and ignores off-schedule overrides

`pitch_schedules` allows several rows per `(pitch, day_of_week)` so a
pitch can open "09–13 and 17–23". `get_available_slots`'s
`day_schedules` CTE LEFT JOINs the date override onto **every** one of
those rows and `COALESCE`s the hours:

```sql
COALESCE(o.opens_at, s.opens_at) AS opens_at
```

So a single "this Saturday we're only open 10:00–12:00" override
collapses *both* windows to 10:00–12:00 and **every slot comes back
twice**. `UNIQUE (pitch_id, override_date)` also means "close only the
morning window" is inexpressible. Separately, the CTE's
`JOIN public.pitch_schedules` is an **inner** join, so an override on a
day with no weekly row is silently dropped — "open specially this
Sunday" returns zero slots.

Reproduced 2026-08-22 on the local stack (transaction, rolled back):
split Saturday + one override → 2 slots each returned twice; Sunday
override with no weekly row → 0 slots. Overlapping weekly windows are
also accepted with no constraint, which is a third way to duplicate
slots.

Latent today only because no pitch has split windows — a schedule
editor is the feature that creates them.

**Fixed in 41a** (`20260822000001_slots_override_precedence.sql`) by
replacing the COALESCE with **precedence**: the override rows for a date
*are* that date's windows if any exist, otherwise the weekly rows.
One rule, no per-row fan-out, and an override no longer needs a weekly
row to exist. The override carries its own `slot_duration_minutes`,
since under replacement there may be nothing to borrow one from.
Regression cases live in `packages/supabase/tests/get_available_slots.sql`.

**The third failure mode — overlapping weekly windows accepted with no
constraint — is fixed in 41b**
(`20260822000002_schedule_overlap_constraints.sql`) with a `btree_gist`
EXCLUDE per table. Postgres ships no `timerange`, so the windows are
projected onto a fixed date and compared as `tsrange` with half-open
bounds, which keeps abutting windows (09:00–13:00 and 13:00–17:00)
legal while rejecting real overlap. The override constraint models a
closure as covering the whole day, which lets one constraint replace
`UNIQUE (pitch_id, override_date)` *and* forbid a closure sitting
alongside an open window. Gotcha in passing: an exclusion constraint
cannot be an `ON CONFLICT` arbiter, so the seed's upsert became a
delete-then-insert. See
[plans/venue-owner-admin.md](plans/venue-owner-admin.md) gaps 5–6.

### Owner-facing reads that RLS quietly returns empty

Three surfaces look like they work for a venue owner and return
nothing, because the policy that gates them was written admin-first:

- `v_gmv_daily` has **no venue dimension** and inherits
  `payments_select_self_or_admin` — an owner sees €0.
- `bookings` are visible to owners, but `users_select_self_or_admin`
  blocks the join, so an owner sees "19:00 — booked" with no name.
- `admin_actions` is admin-insert-only, so owner writes leave no audit
  row.

None of these error. They return empty sets, which is the hardest
failure mode to notice from the UI side. Enumerated with fixes in
[plans/venue-owner-admin.md](plans/venue-owner-admin.md) gaps 1–3.


### Supabase CI needs explicit role grants for RLS tests

**Shrunk to almost nothing 2026-10-20:** CI has run on the Supabase image
since 2026-10-12 and restores its default privileges after recreating
`public`, so the bootstrap keeps only schema USAGE and EXECUTE on `auth`
functions. See *A migration's REVOKE is not the last word in the pgtap
harness*. The history below is the old stub's.

The vanilla postgis container's `CREATE ROLE anon NOLOGIN`-style stub
gives no schema/table privileges — real Supabase pre-grants them.
RLS tests die with `permission denied for schema public` *before* RLS
even gets a chance to filter, on the first `SET LOCAL ROLE anon`.

Bootstrap once at suite start (`packages/supabase/tests/rls/_bootstrap.sql`):

```sql
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO anon, authenticated;
```

New tables don't auto-inherit the grant — it ran once. When you
add a table that RLS tests need to touch, add it to the grant
list explicitly or re-grant in the test file's setup. If a future
test fails with "permission denied," check this first.

Discovered landing M1 #5 (PR #8). Will shrink to zero if we ever
switch the CI image to a Supabase-flavored container that
pre-grants like real Supabase.

### Local Supabase ports pinned to 64xxx

`packages/supabase/supabase/config.toml` explicitly pins ports to
64xxx so Ludi coexists with another local Supabase project on the
same box. Mapping:

- api (kong): **64321**
- db: **64322** (shadow_port 64320)
- studio: **64323**
- inbucket / mailpit: **64324**
- pooler: **64329**

`apps/mobile/.env` uses `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:64321`.

Previously relied on the CLI's auto-shift on collision, which was
unreliable — restarts sometimes tried the default 54321 again.
Pinning removes the fragility entirely. `supabase status` is now
honest. If you need to verify in the wild, prefer
`docker ps --filter name=supabase_kong_ludi` and read the
host-side of the port mapping.

If a third local Supabase project ever shows up on this box, give
it 74xxx in its own config.toml.

### Local phone OTP needs both test_otp AND a twilio placeholder

Local Supabase auth disables phone login entirely unless an SMS
provider is declared in `config.toml`. `supabase start` warns
`no SMS provider is enabled. Disabling phone login`, and the auth
container has `GOTRUE_EXTERNAL_PHONE_ENABLED=false` — even when
`[auth.sms.test_otp]` is set. `enable_confirmations = false`
under `[auth.sms]` does *not* bypass — that only controls
confirmation, not provider presence.

Fix (committed in PR #19):

```toml
[auth.sms.test_otp]
"35799000000" = "123456"

[auth.sms.twilio]
enabled = true
account_sid = "test"
message_service_sid = "test"
auth_token = "test"
```

The twilio block satisfies the CLI's "real provider declared"
check; nothing is sent because `test_otp` short-circuits the
lookup. Verify with
`docker exec supabase_auth_ludi env | grep EXTERNAL_PHONE_ENABLED`
— should print `true`. Seeded number `+35799000000` / `123456` is
fake-only; never commit a real owner phone.

### Local-dev admin promotion needs a trigger bypass

`tg_users_block_role_change` refuses any role update unless
`is_admin()` returns true. `is_admin()` reads `auth.uid()`, which
is NULL over a direct psql connection — so the trigger fires even
for the postgres superuser.

To promote a freshly OTP-signed-up user to admin:

```sql
BEGIN;
SET LOCAL session_replication_role = 'replica';
UPDATE public.users SET role = 'admin' WHERE id = (
  SELECT id FROM auth.users WHERE phone = '35799000000'
);
COMMIT;
```

`SET LOCAL` confines the trigger bypass to the transaction.
Supabase Studio's SQL editor works without this because it runs
as service_role with a session context that gives the trigger an
admin reading.

Phone-format-without-plus is `35799000000` in `auth.users.phone`.

### `STRIPE_SECRET_KEY` unset crashes outside the try-block

The `admin-refund-booking` Edge Function (and friends) initialise
the Stripe client at module-load time. If `STRIPE_SECRET_KEY`
is unset in the deployed env, the function throws before the
request handler runs — the error doesn't get caught by the
function's request-time `try/catch`, and the failure is opaque
in logs.

Workaround for now: a runtime guard at the top of the handler
returns a clear `CONFIG_ERROR` response. Real fix is module-load
fail-fast with a structured error — pending.

Flagged in the 05-15 EOW notes as "out-of-band fix spawned
earlier, still pending."

### RLS helper predicates must be SECURITY DEFINER

`users_select_self_or_admin` is `USING (id = auth.uid() OR
public.is_admin())`, and `is_admin()` reads `public.users`. As
`SECURITY INVOKER` that read re-enters the same policy and recurses
until `54001 stack depth limit exceeded`. Postgres's "infinite
recursion detected in policy" guard does **not** fire — it only
catches a policy referencing its own table directly, and here the
reference is laundered through a function.

Whether it actually blows up is plan-dependent, which is why it hid
for four months. `id = auth.uid()` and `id IN (…)` are leakproof, so
when the planner can push an id filter below the policy qual the
policy only sees the caller's own row and short-circuits on the first
OR branch. Every read the app did was id-filtered (self-profile) until
the admin bookings list embedded `users` with no id filter.

Fixed in migration `20260810000001` — `SECURITY DEFINER` + pinned
`search_path` (CVE-2018-1058). Safe here: no arguments, one row keyed
by `auth.uid()`, returns a boolean. The other three helpers stay
INVOKER; they were only reachable into the cycle *through* is_admin().

### pgtap can't see plan-dependent RLS bugs

The recursion above passed all 70 assertions of the RLS suite. Two
reasons, both worth remembering before trusting a green suite:

1. **No PostgREST.** The suite talks to Postgres directly. The failing
   plan only appears on unfiltered scans of the kind PostgREST
   generates for embeds — `bookings?select=…,user:users(…)`.
2. **Fixtures are id-filtered.** Assertions like `WHERE id IN (…4
   uuids…)` let the planner push the filter below the policy qual, so
   the recursive branch is never evaluated.

The regression test added in `02_users.sql` is therefore *structural*
(`prosecdef = TRUE`), not behavioural — a behavioural test passes
against the broken definition too. When a bug is plan-dependent,
assert the property that prevents it, not the symptom.

### Don't run `tests/rls/_bootstrap.sql` against a local stack

The bootstrap does `CREATE OR REPLACE FUNCTION auth.uid()` to read a
session GUC — correct for CI, where `auth.uid()` is a stub owned by
`postgres`. Against real local Supabase it needs the `supabase_admin`
superuser, and if you give it that it **replaces the real JWT-reading
`auth.uid()`**. Every PostgREST request then sees `auth.uid() = NULL`,
RLS filters everything, and the app silently returns empty arrays with
no error — a confusing failure that looks like a permissions bug.

It also inserts fixture users permanently (it's only the per-test
transactions that roll back). Recovery is `supabase db reset`, which
also wipes whatever local dev data you had accumulated. If you need
pgtap against local, do it in a throwaway branch of the DB, not the
one your simulator is pointed at.

### Phone-OTP accounts are only findable via `auth.users.phone`

A phone-OTP signup produces a `public.users` row with
`first_name = ''` (see `handle_new_user`) and **no phone column at
all** — the number lives only in `auth.users`, which PostgREST never
exposes. So an admin surface that needs to find "the account behind
+35799…" (granting `venue_owners` access, say) cannot do it with a
session client and RLS; it needs a `SECURITY DEFINER` function that is
itself gated on `is_admin()` — see
`20260827000001_admin_owner_access.sql`. Two sub-gotchas: GoTrue
stores the number as bare digits (`35799123456`, no `+`), so normalise
before comparing; and DEFINER functions are PUBLIC-executable by
default, so `REVOKE … FROM PUBLIC, anon` in the same migration.

### Vercel env vars added by an agent pull back as "" and 500 the middleware

`vercel env add` piped from a non-TTY (or run by an agent) stores the
value as **sensitive** by default. Sensitive values cannot be pulled:
`vercel pull` writes `NAME=""` to `.env.production.local` without a
word of warning. Next then **inlines** that empty string into the
middleware bundle at build time (Next 15 inlines `NEXT_PUBLIC_*` in
middleware; the platform does NOT inject project env into prebuilt
edge functions at runtime), and every request 500s with
`MIDDLEWARE_INVOCATION_FAILED` / "Your project's URL and Key are
required". Fix: add with
`--force --yes --no-sensitive --value "$V"`, then verify the pull
returns a non-empty value **and** grep the built
`middleware.func/index.js` for the prod host before deploying.
`scripts/deploy_admin.sh` refuses to ship a build that fails either
check.

### Prebuilt Vercel deploys from a pnpm monorepo must run from the repo root

`vercel deploy --prebuilt` validates the build output's traced-file
paths against the CWD, but Next writes them relative to
`outputFileTracingRoot` — the repo root. Deploying from `apps/admin`
fails with a phantom `node_modules/@opentelemetry/api/... does not
exist` even though the build is complete and the file exists at the
root. Stage `.vercel/{project.json,output}` at the repo root and
deploy from there — `scripts/deploy_admin.sh` does exactly this.

### "JWT issued at future" = infra clock skew, not an auth bug

`requireVenueAccess: role lookup failed: JWT issued at future` took the
deployed admin down intermittently on 2026-08-29 (launch minus two).
GoTrue mints the session token with its clock; PostgREST validates
`iat` with its own — when the nano instance's node clock drifts behind,
every FRESHLY-REFRESHED token is "from the future" and rejected, while
slightly older tokens pass. Hence the tell: one page renders, the next
500s seconds later, same session (the middleware refresh mints the
doomed token). Code, deploy and data are all innocent — do not roll
anything back. Fix: Supabase dashboard → Project Settings → General →
Restart project (resyncs clocks; ~1 min down; sessions may need a
fresh sign-in). If it recurs, it is a support-ticket + Pro-upgrade
conversation, not a debugging session.

### `useFonts({})` fails silently — the whole type system was missing

`apps/mobile/app/_layout.tsx` called `useFonts({})` with an empty map and
no `.ttf` files existed in the repo. `TOKENS.display = 'Fraunces'` and
`TOKENS.mono = 'JetBrainsMono'` therefore named families that were never
registered, and **React Native falls back to the system font without
warning** — no error, no red box, no console message.

Result: the entire two-serif-and-a-mono system in
[design-tokens.md](ui/design-tokens.md) had never rendered once. Four
months of "the design looks flat / not premium" feedback (three ADRs'
worth — 0015, 0016, 0017) was given against a build wearing SF Pro.

Two defences, both cheap:
1. A `__DEV__` startup assertion that every family named in `TOKENS`
   is actually in the loaded font map.
2. Never let a token name a resource that nothing verifies exists —
   this is the same class of bug as the Hermes `crypto` comment.

Found 2026-08-10 during the design pass; see
[design-handoff-v1-polish.md](ui/design-handoff-v1-polish.md) §1.1.

### `unverify_pitch` is not a thing yet

`admin_actions.action_type` CHECK constraint allows
`verify_pitch` / `activate_pitch` / `deactivate_pitch` but not
`unverify_pitch`. The M3 #18 `admin-toggle-pitch` Edge Function's
`AdminTogglePitchInput` enum is `verify` / `activate` / `deactivate`
only. If ops ever need to un-verify a pitch (e.g. discovered fraud
after verification), extend the CHECK in a forward migration and
add the action in a follow-up — don't backdoor it via direct UPDATE.

### `v_gmv_daily` attributes refunds to original payment date

The view attributes refunds to the *original payment's* date, not
the refund's date. Useful for "what did we keep from Saturday's
bookings" reports; misleading for "how much did we refund yesterday."

If "refunds by refund-day" becomes a real need, ship a separate
view (`v_refunds_daily`) rather than mutating this one — historical
revenue charts depend on the current shape.

### sqlfluff treats `EXCLUDED.<col>` as a lowercase identifier

In `ON CONFLICT … DO UPDATE SET col = EXCLUDED.col`, Postgres treats
`EXCLUDED` as a reserved pseudo-relation keyword. sqlfluff's CP02
rule classifies it as an identifier and demands lowercase. Two paths:

1. **Accept lowercase** — `excluded.col` works identically in Postgres
   (case-insensitive). The seed file uses this style; CI is happy.
2. **Disable CP02** — gives back uppercase but loses the convention
   for actual user identifiers.

Going with #1. Same applies to `OLD.col` / `NEW.col` in triggers —
sqlfluff would flag those too, so future trigger functions write
them lowercase. Not load-bearing; Postgres parses both.

### Editing an applied migration is OK only for parse-equivalent changes

[CONVENTIONS.md](CONVENTIONS.md) §Migrations says *append-only — never
edit an applied migration*. Strict reading: any edit is forbidden.
Practical reading, while pre-prod: edits that produce **byte-equivalent
parsed AST** are OK, because `supabase db reset` on the same source
yields the same schema. Examples:

- `false` → `FALSE` (boolean literal — Postgres normalises).
- `EXCLUDED.col` → `excluded.col` (identifier case — Postgres
  normalises).
- Whitespace, comments, formatting — never affect parse.

Examples that are **not** OK even pre-prod:
- Changing a CHECK predicate, even by one operator.
- Renaming a column or type.
- Adding/removing a constraint.

Once Stage 2 ships to prod (per [roadmap.md](roadmap.md) target
2026-06-30), the line shifts: even parse-equivalent edits cause local
checksum drift relative to prod, and tooling like `supabase migration
list` notices. After that point, write a forward migration even for
cosmetic fixes — or do them via the linter on the new file.

### iOS 14+ local-network permission required for LAN dev Supabase

When the mobile app talks to a non-public IP (`192.168.x.x`, `10.x.x.x`,
`172.16-31.x.x`), iOS 14+ requires the bundle to declare
`NSLocalNetworkUsageDescription` in Info.plist. Without it, iOS *silently
hangs* the request rather than prompting the user — the app shows "Loading
pitches…" forever, no error, no Sentry breadcrumb.

Symptom on the device: Discover tab (or any first network call to the
Mac's LAN IP) spins forever. From the Mac: `curl` to the same URL
returns 200 in milliseconds — proving the server is fine; the phone is
being silenced by the OS.

Fix (committed in `apps/mobile/app.json`):

```json
"ios": {
  "infoPlist": {
    "NSLocalNetworkUsageDescription": "Ludi needs local-network access ..."
  }
}
```

First launch after install: iOS shows a prompt *"Allow Ludi to find
devices on your local network?"* — tap Allow. Subsequent launches reuse
the granted permission. Decline = LAN traffic stays silently blocked
until the user re-enables under Settings → Privacy → Local Network → Ludi.

Production builds against the public Supabase URL don't need this
string — the network call is HTTPS over WAN, not local-network access.
Keeping the key in `app.json` is harmless either way (just a string in
Info.plist).

### Physical-iPhone install — the five things that go wrong

`scripts/install_on_device.sh` automates the build but the iPhone
side has to be in the right state. Failure modes seen in practice:

1. **iPhone unlocked but "Trust This Computer" not accepted** — phone
   shows up under `xcrun xctrace list devices` under `== Devices
   Offline ==` instead of `== Devices ==`. Unlock + plug in + re-accept.
2. **Developer Mode disabled** — install succeeds, app shows
   "Untrusted Developer" on launch. Settings → Privacy & Security →
   Developer Mode → toggle on → restart phone.
3. **`.env` points at `127.0.0.1`** — release build won't crash, but
   Discover loads nothing because the phone can't reach localhost.
   The script grep-warns when `EXPO_PUBLIC_SUPABASE_URL` is
   loopback. Fix: point at staging, or at your Mac's LAN IP
   (`ipconfig getifaddr en0`).
4. **CocoaPods crashes on ASCII-8BIT path strings** — same locale
   bug as the simulator script. The script exports `LANG=en_US.UTF-8`
   and `LC_ALL=en_US.UTF-8` defensively.
5. **Stale native config after editing `app.json` plugins** — the
   prebuilt `apps/mobile/ios/` carries old Info.plist entries. Run
   with `--clean` to wipe and re-prebuild.

Aristophanes has the Flutter equivalent at
`/Users/nikolasneofytou/dev/aristophanes/scripts/install.sh` —
same pattern, different toolchain (`flutter build ios --release`
+ `flutter install -d` vs `expo run:ios --device --configuration
Release`).

### Local migration history can drift behind manually-applied SQL

Found 2026-08-30: `supabase migration up` failed with `relation
"v_venue_earnings_daily" already exists` — every migration from
`20260828000001` to `20260830000005` had been applied to the local DB
(probably pasted via psql/Studio during those work sessions) without
being recorded in `supabase_migrations.schema_migrations`, whose
history ended at `20260827000001`. Diagnosis: compare the history
table against marker objects from each "pending" file (a view, a
column, a function). Fix: `supabase migration repair --status applied
<version...> --local`, then `migration up` runs only the genuinely
new files. Don't `db reset` for this — it nukes seeded auth sessions
for a bookkeeping problem.

### Stale Pods vs node_modules: headless xcodebuild needs two fixes

Found 2026-08-30 building the dev client for the simulator: `ios/Pods`
predated the expo-aligned `stripe-react-native` 0.50.3, whose iOS
sources were renamed (`StripeSdk.swift` → `StripeSdkImpl.swift`), so
xcodebuild failed on "Build input files cannot be found" for files the
Pods project still listed. `pod install` alone refuses (changed
`StripePaymentSheet` constraint) — it takes a full `pod update
--project-directory=apps/mobile/ios`. And any headless/agent
xcodebuild must export `SENTRY_DISABLE_AUTO_UPLOAD=true` or the
"Bundle React Native code and images" phase dies on sentry-cli's
missing org — same flag EAS local builds need (see the EAS entry).

### Expo dev client sticks to its last Metro port

The installed dev client reconnects to the **last dev server it
loaded**, and `ludi://expo-development-client/?url=…` deep links do
not reliably switch it — even after `simctl terminate` + relaunch it
kept bundling from a stale Metro. With two worktrees (`Ludi`,
`Ludi-open-matches`) both using port 8081, whichever Metro owns 8081
wins, and a second Metro on 8082 gets zero bundle requests while you
stare at the wrong branch's UI. Tell-tale: your Metro log shows no
`Bundled` line. Fix: free 8081 (`lsof -ti :8081 | xargs kill`), start
your Metro there, cold-start the app. Verify you're on the right
bundle by a feature diff (e.g. which tabs exist), not by vibes.

### CocoaPods on Homebrew Ruby 4.0 needs a UTF-8 locale

Bare `pod install` on this Mac dies before reading the Podfile with
`Unicode Normalization not appropriate for ASCII-8BIT
(Encoding::CompatibilityError)` — Homebrew's Ruby 4.0 defaults the
external encoding to ASCII-8BIT when the shell exports no locale.
Fix is one prefix:

```
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install
```

Worth exporting in the shell profile if it bites twice.

### Headless xcodebuild needs SENTRY_DISABLE_AUTO_UPLOAD in .xcode.env.local

`SENTRY_DISABLE_AUTO_UPLOAD=true` in `apps/mobile/.env` only reaches
EAS/Metro — Xcode's "Bundle React Native code and images" phase never
reads `.env`, so a headless `xcodebuild` (or plain Xcode ⌘R) fails at
the Sentry wrapper with "An organization ID or slug is required". The
env file that phase *does* source is `ios/.xcode.env.local`
(gitignored, machine-local, already carries `NODE_BINARY`). Add:

```
export SENTRY_DISABLE_AUTO_UPLOAD=true
```

there once per machine and local builds stop needing Sentry auth.

---

### Verifying a worktree on the simulator: the binary is whoever built last

The simulator holds ONE `Ludi.app`, and it is the native build of
whichever checkout last ran `expo run:ios`. Pointing a *different*
worktree's Metro at it loads that worktree's JS into a binary whose
native modules may be older — found 2026-09-11 when the community-v4
worktree's bundle rendered into a pre-ADR-0029 binary and the Home tab
red-boxed with `View config not found for component AIRMapMarker`
(react-native-maps was never linked in that build). Every tab that
does not touch the missing module works, which makes the mismatch
look like a bug in your change.

Rule: verify a worktree from *that worktree's* native build —
`expo run:ios --device <UDID>` from its `apps/mobile` (prebuild + pods
+ xcodebuild, ~10 min cold). Two shell habits that keep the session
usable while it runs:

- `--no-bundler`, so the build command *returns* instead of holding
  Metro in the foreground; start Metro yourself, detached
  (`nohup pnpm exec expo start --dev-client --port 8081 &`).
- `scripts/launch_ios_simulator.sh` refuses to run if port 8081 is
  taken by another checkout's Metro — that guard exists precisely for
  this mismatch, so stop the other Metro rather than working around it.

A restarted local stack also drops the app's session (`Invalid Refresh
Token`): sign back in with the `test_otp` number, it is not a bug.

---

### The simulator tool's quick swipes land as taps

Driving the iOS simulator through the Claude Code simulator tool on
2026-09-11: two "scroll to top" swipes of 0.4s registered as taps, the
first on a board card (→ the invite screen), the second on that
screen's *Take a slot* button (→ a real join, a `booking_participants`
row for the keeper slot, no payment because the seed fixture was not
split). Found by the fixture screen suddenly reading "You're in", and
confirmed in the table. Swipes of ≥1s scrolled cleanly every time.

Rule: scroll with ≥1s swipes, and after any surprising screen check
`booking_participants` (and `payments`) before assuming the UI did
something on its own. A demo seed that includes a split fixture would
have turned this into a Stripe test-mode charge.

---

### Client state that must outlive `router.refresh()` lives in a component that stays mounted

**Gotcha, 2026-09-15 (late), counter follow-through.** *Verify all*
calls an Edge Function once per court, then `router.refresh()` so the
server component re-reads the rows. The first cut mounted the component
only while unverified courts existed — so after a run where one court
refused (already verified by someone else), the refresh found nothing
left to verify, unmounted the component, and the refusal it was holding
in state vanished with it. The badges said "verified"; the one that
wasn't done by this run was invisible. Caught on the local walkthrough,
not by any test (the admin has none).

**Rule.** Mount on the *stable* condition (payments active, courts
exist), pass the changing list as props, and let the component return
`null` when there is nothing to do and no outcome to show. React keeps
state across a refresh only for a component that stays at the same
position in the tree; a conditional in the parent that flips on the
very rows the action changes will always unmount it at the moment the
outcome matters.

### Widening a CHECK list: derive it, don't retype it — CI has no prod rows

`admin_actions_action_type_check` has been re-stated by five migrations
as a literal list. The fifth (standing bookings, 2026-09-15) copied a
list that lacked `invite_owner` (added 2026-08-29) and **failed on
prod** — `check constraint … is violated by some row` — because prod
holds invite rows and the CI database, seeded from migrations and a
fixture, holds none. Every local run was green. The migration rolled
back cleanly, but the admin deploy that followed it shipped a page whose
tables did not exist.

Two rules:

1. **Widen from the live definition.** Read `pg_get_constraintdef`,
   take its `ARRAY[...]`, append the new words, re-create. Prod's words
   survive whatever the migrations say (`20260915000002`, the DO block).
2. **A migration that fails on prod means the admin must not deploy
   until it passes** — the deploy step's "from this moment" note cuts
   both ways. Run `db push` first, read its result, then deploy.

The same shape as the function-body lesson below: the latest migration
is not always the truth — the database is.

---

### Replacing a function: copy the body from its LATEST migration

`CREATE OR REPLACE FUNCTION` replaces the whole body, so a migration
that "only changes one predicate" silently reverts every other change
any later migration made to that function. On 2026-09-15 the composite
migration re-stated `bookings_in_weekly_window` from its 2026-08-22
definition and lost the 2026-09-13 rule that skips dates an exception
replaces — a regression the schedule editor would have shown as a
refused, legitimate deletion. Found by the RLS suite (test 30, the one
#204 wrote for exactly that rule), not by reading.

Rule: before re-stating a function, `grep -ln "FUNCTION public.<name>"
supabase/migrations/*.sql` and take the body from the last file listed.
The code map an agent hands you points at the file it found first,
which is usually the oldest. And run the whole suite locally before
pushing — the CI replica script is a few docker commands, and it is the
only thing that reads every test.

---

### A second worktree's local stack: give it its own `project_id`

`supabase start` names its Docker volumes after `project_id` in
`config.toml`, so every checkout of this repo shares one database
volume. On 2026-09-15 a worktree's stack refused to boot — `database
files are incompatible with server … initialized by PostgreSQL version
17, which is not compatible with this version 15.8` — because an
earlier session had started the volume under a newer major version.
The CLI retries for two minutes and then reports the container as
"unhealthy", which hides the real message unless you read the log.

Do not delete the volume: it is another checkout's local data. Change
`project_id` locally instead (`ludi` → `ludi-enrol`), which gives the
worktree fresh volumes on the same ports; keep the change out of the
commit. The admin's `.env.local` carries no project id, so it works
unchanged. The trade: the two stacks cannot run at the same time (same
ports), which is already true of Metro (see above).

### `onPress={load}` hands the press event to `load` — and a loud default hides it

Two traps in one screen, found by the motion-v3 audit (2026-10-20).
The fixture screen's loader is `load(quiet = false)`, written so a
refresh could keep the roster on screen. Its children are passed
`reload={load}`, so every join, leave, rejoin and share payment reloads
*loudly*: the screen unmounts into a full-screen spinner and loses its
local state (`booking/[id]/index.tsx:278`). Its Retry button, meanwhile,
is `onPress={load}` — a `Pressable` calls `onPress(event)`, so `quiet`
receives the event object, which is truthy, and Retry shows no loading
state at all (`:254`). The rules: **a loader's default is the quiet
path, and the first load is the one that says so explicitly**; and
**never pass a function with optional parameters straight to `onPress`**
— wrap it, `onPress={() => load()}`. A screen that reloads through its
loading state can never animate a change, because the thing that
changed has just been unmounted.

### Reanimated: an animated style owns its keys, and a leaving element keeps its last props

Two traps from motion-v3 slice 1 (2026-10-20). First: when a
`useAnimatedStyle` returns `opacity`, it wins over the same key in the
static style beside it — so moving `Press` onto Reanimated would have
silently undimmed Bookings' past rows (`opacity: past ? 0.78 : 1`) and
every disabled `Chip`. The pieces in `motion.tsx` read the caller's
opacity (`StyleSheet.flatten`) and multiply the press dip into it.
Keep an animated style's keys the same in every branch, too: returning
`transform` in one and not the other strands the last transform when
Reduce Motion flips. Second: a component unmounted with an `exiting`
animation keeps the props of its *last* render, so it cannot know
anything about the render that removed it — `Tally`'s old value can't
leave "the way the number moved". Give the arriving element the
direction; let the leaving one only fade.

### Reanimated: a raw `withTiming` snaps under Reduce Motion, and `Press` styles its inner view

Two more from motion-v3 sweep 4 (2026-10-20), both found only on the
simulator. First: `withTiming`'s `reduceMotion` defaults to
`ReduceMotion.System`, which *finishes the animation instantly* when
the setting is on. `effect()` passed `ReduceMotion.Never`, but the
entering/exiting worklets in `Reveal`, `Tally`, the price lines and the
fixture's seats called `withTiming` bare — they computed a halved
duration for Reduce Motion and then never ran it. Any raw timing in a
worklet must say `ReduceMotion.Never` if it means to fade. Second:
`Press` and `Pick` put `style` on the animated view *inside* their
`Pressable`, so in a row the flex item is the bare `Pressable`: a
`width: '33.33%'` on the style resolved against a parent shrunk to its
text and Profile's spec grid collapsed. Sweep 5 fixed it in the engine:
`Press` and `Pick` now put placement keys (alignSelf, flex, width,
margins, position) on the `Pressable` and the rest inside — the same
trap had left "Cancel booking"'s hit area as wide as its row, so a tap
beside the link opened it.

### A programmatic `scrollTo` fires `onMomentumScrollEnd` (New Architecture)

Found in motion-v3 sweep 5 (2026-10-20). Under Fabric, a ScrollView's
`scrollTo({ animated: false })` runs the "finished scrolling" path and
emits `onMomentumScrollEnd`, as if the user had flung it and let it
settle. The height ruler positions itself on open that way and committed
its value on momentum end — so opening it and pressing Done saved
175 cm for someone who never touched it. Any picker that commits on
scroll end must only commit after a drag began (`onScrollBeginDrag`
sets a ref; the end handlers check it).

---

### A table-level REVOKE takes the column grants with it

`REVOKE UPDATE ON public.users FROM authenticated` (the 2026-10-19 audit,
`20261020000002`, PR #335) also revokes every `GRANT UPDATE (col)` made
before it; Postgres revokes the column privileges with the table one. So
a migration that adds a player-writable column and grants it must sort
**after** any migration that revokes the table-level privilege, or the
grant silently vanishes and the app's write fails with 42501 on prod
while an older local database still allows it. The Strava build's
Wave 1 numbered its migration `20261021000001` for this reason, and its
pgtap asserts `has_column_privilege(...)` rather than trusting the order.

### Vercel "Deployment was blocked" is the commit's author

On the Hobby plan Vercel refuses a preview whose commit author it does
not know. On 2026-10-20 two commits went out as `sim <sim@local>` (a
transient identity override in another session's shell), and the
Vercel check on PR #356 failed with "Deployment was blocked" while every
build check passed. Read `git log -1 --format='%an <%ae>'` first; the fix
is `git commit --amend --no-edit --reset-author` and a
`--force-with-lease` push. A squash merge would otherwise also credit
the stray author as a co-author on `main`.

### The site's 404 kept every page from prerendering

`next build` marked a dozen site pages ● (SSG), but `prerender-manifest.json`
held none of them and `next start` served them `private, no-store`. The
cause was `app/not-found.tsx`: Next renders a not-found boundary into every
page's payload under it, so its `headers()` call (for the locale) ran in
every prerender and made every page dynamic, silently. The rules: **nothing
in a `not-found.tsx` reads `headers()` or `cookies()`**, and the route table
is not proof — read the manifest. The site's 404s now split
(fix/site-locale-not-found): `app/global-not-found.tsx` takes URLs that
match no route, renders with no layout and may read the header;
`app/[locale]/not-found.tsx` takes a thrown `notFound()` and gets its locale
from the layout through `lib/request-locale.ts`. And a page's `notFound()`
is never server-rendered in Next 15: the HTML is the empty
`__next_error__` shell and the browser draws the boundary, so `curl`
shows a blank page that a browser doesn't.

---

## Workflow patterns

### Stacked PR merge order: retarget before squash

When merging A → B → C where each PR targets the previous head
branch, GitHub **auto-closes child PRs whose base branch is
deleted**. Squash-merging A with `--delete-branch` silently closes
B; merging B closes C. Closed PRs whose base is gone *can't be
reopened* — recovery is cherry-pick + force-push + a fresh
`gh pr create` with a redirect comment on the closed PR.

Two safe paths:

1. **Retarget descendants to `main` BEFORE squashing the parent**:
   ```sh
   gh pr edit <child#> --base main
   ```
   GitHub recomputes the diff but the PR stays open.

2. **Pass `--delete-branch=false`** on the parent merge and clean
   up branches after the whole stack is merged.

Bit us twice on 2026-05-04 (M2 stack). The fix landed and the
practice is now habit. Standalone PRs (`feature → main`) are
fine to `--delete-branch` directly.

### One commit per session, one PR per commit

The [stage-2-commit-plan.md](stage-2-commit-plan.md) is the menu;
each row is a scoped, ~one-session-of-work PR. Status flips from
⬜ to ✅ when the PR lands on `main`. No verbal claims of progress.

The plan's effort tags are honest: `S` = 30 min – 1 h, `M` = 1 – 3 h,
`L` = 3 – 6 h, `XL` = multi-session. Anything that grows past `XL`
is a missing milestone — re-plan rather than fudge.

### Memory-first wrap on Sunday close-out

End-of-week ritual: update `stage-2-commit-plan.md` ticks, refresh
the active week plan in `~/.claude/projects/.../memory/`, draft the
next week, then close out. The auto-memory is short-term tactical;
the committed monthly plans (`docs/plans/2026-MM.md`) are
strategic and authoritative.

When the two disagree, the committed file wins (it's reviewable and
git-tracked); the memory gets updated to match. The memory entry
itself encodes this rule — see `project_month_plan_2026-05.md`.

### Don't write `apps/mobile/__tests__/*.ts` yet

`apps/mobile/package.json` ships without jest/vitest. CI only runs
typecheck + lint on mobile. The risk-managed server surface (auth,
RLS, refund math) is covered by Deno + pgtap, which is where
mistakes are hardest to recover from.

If you want test coverage *now* for a pure-logic helper in mobile
(date math, refund preview, pricing display), check whether the
same logic exists on the server-side first — the server's test
usually covers the boundary table and the mobile mirror is verified
via the PR's manual test plan.

When a runner does land, jest is the default for Expo SDK 54
(`jest-expo` preset). Until then, those files would silently rot.

---

### A mount animation can't ask reduce-motion at mount — neither way

Two idioms for reading the OS reduce-motion setting, and both are
wrong for a one-shot animation that plays when a screen mounts. A
one-shot `AccessibilityInfo.isReduceMotionEnabled()` read (the old
`confirmed.tsx`, `Nest`) is async, so the animation either waits for
it (a blank frame) or starts before it (full motion for a player who
asked for none) — and `Nest` fell into a third trap: it wrote the
answer into a ref and never read it. A hook that starts `false` and
updates (`useReduceMotion()`) has the same first-frame problem on
every mount. Fix (motion-v2 slice 1): the hook caches the last known
value at module level, so any screen that mounts after launch reads
the right answer synchronously; only the launch screen itself still
has to wait, and it does so deliberately before drawing anything.
Audit rule that found five holes: grep every `Animated.timing` /
`Animated.loop` and ask what it does with the setting on — a loop
that ignores it is the commonest miss.

---

### A gesture and its own settle animation fight over one value

A pan writes `dragY` from `e.translationY`; the release starts an
`Animated.timing` back to 0. Grab the sheet again before that finishes
and it *snaps*: the new gesture's `translationY` starts at ~0, so the
first frame teleports the sheet to rest — and the timing is still
running, so two writers now drive one value and the finger loses. The
rule is general and applies to every draggable thing: **a gesture that
takes over an animated value must cancel the animation on it and offset
from the value's current position, not from zero.** Keep the offset at
gesture start (or `cancelAnimation()` + read the shared value) and add
`translationY` to it. Apple's word for the property this buys is
*interruptible*; the symptom of not having it is a sheet that feels
like it is arguing with you. Found in the gesture audit,
[plans/gesture-motion.md](plans/gesture-motion.md) defect 3.

---

### Android predictive back is off on purpose — don't "fix" it

`android:enableOnBackInvokedCallback="false"` in
`apps/mobile/android/.../AndroidManifest.xml` looks like an oversight
worth turning on. It is not ours to turn on: that directory is
gitignored prebuild output, the value comes from Expo's template, and
Expo sets `android.predictiveBackGestureEnabled: false` deliberately
because `react-native-screens` v4 does not support predictive back —
with it enabled, back leaves for the **home screen** instead of the
previous route. The general rule: **before changing anything in
`apps/mobile/android/` or `ios/`, check whether it is prebuild output**
(`git check-ignore -v <path>`) — if it is, the change belongs in
`app.json` or a config plugin, and the default you are about to
override may be load-bearing.

---

### Pins at one venue stack — draw the venue, not the game

The first cut of the Discover map drew a pin per open game and per
keeper request. Every game at a venue sits on the venue's one point, so
three pins stacked exactly and only the last one drawn was visible —
the keeper pill hid two games. At Ludi's density this is the ordinary
case (one venue, several courts, several games a night), not an edge.
The fix is structural: **one pin per venue**, labelled by its single
item or by a count (`11:00 · 2 games`), and the venue's row beneath the
map lists the items with their own taps, so a pin with several opens
the row. Two smaller lessons from the same pass: a `react-native-maps`
marker keeps a selected callout's text when only its `description`
changes — key the `Marker` by its label so a change remounts it; and a
simulator can hold an app binary older than a native dependency
(`View config not found for component AIRMapMarker` = the installed
`.app` predates `react-native-maps`), so before debugging a "missing
view config" check `ls <Ludi.app>` for the pod's resource bundle
(`ReactNativeMapsPrivacy.bundle`) and the bundle's date against the
dependency's.

---

### A pgtap test that says `current_date` is on a UTC clock

CI's Postgres and the local stack both run in UTC, while every "today"
in the schema is a Cyprus date — `materialise_booking_series` starts
from `(now() AT TIME ZONE 'Europe/Nicosia')::date`. Between midnight and
03:00 in Cyprus (21:00–00:00 UTC) those differ by a day, so
`32_booking_series.sql`, which built its series from `current_date`,
materialised 26 instances instead of 28 and failed 3/19 — on a PR that
touched nothing near it, at 01:32 EEST, and reproduced locally at that
hour. The rule: **a test that reasons about days uses the same clock as
the function under test** — `(now() AT TIME ZONE 'Europe/Nicosia')::date`,
never `current_date` — and a suite that is green all day and red after
midnight is a timezone, not a race.

### Signing in to the local admin after a pgtap run on the live database

Two things stood between a fresh test account and the local dashboard on
2026-10-15. First, someone had once run the RLS bootstrap against the
live local database (the entry above warns against it), which replaces
`auth.uid()` with the version that reads `test.current_user_id`: every
real request then has no user, RLS hides the caller's own `users` row,
and the admin sends a signed-in admin to `/locked`. The repair is not a
`db reset` (which wipes local data) but Supabase's own definition, as
`supabase_admin` in the container:
`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;`.
Run pgtap against a throwaway container of the prod image instead (the
CI job's steps, on another port). Second, the local magic-link template
is still the PKCE one, which fails even in the same browser: ask the
local auth admin API for `generate_link` and open
`/auth/callback?token_hash=<hashed_token>&type=magiclink` instead.

---

## Changelog

- **2026-10-20 (Strava build, Wave 1)** — Three gotchas: a table-level
  REVOKE drops column grants (number the migration after it); Vercel's
  "Deployment was blocked" means an unknown commit author; and a definer
  view checks EXECUTE on the functions it calls as the caller (added to
  the entry on migration REVOKEs).
- **2026-10-20 (night)** — From motion-v3 sweep 5: the Press placement
  trap is now fixed in the engine (entry amended), and one new entry — a
  programmatic `scrollTo` fires `onMomentumScrollEnd` under Fabric, so a
  scroll picker must commit only after a drag.
- **2026-10-20 (evening)** — One entry from motion-v3 sweep 4: a raw
  `withTiming` snaps under Reduce Motion (say `ReduceMotion.Never`), and
  `Press`/`Pick` style their inner view, so size the flex item outside.
- **2026-10-20 (later)** — One entry from motion-v3 slice 1: an animated
  style owns its keys (multiply a caller's opacity), and an exiting
  element keeps its last render's props.
- **2026-10-20** — One gotcha from the sign-in art: a screen's own light
  status bar stays in charge over the screens pushed on top of it, so it
  renders only while its screen is focused.
- **2026-10-20** — One entry from the motion-v3 audit: `onPress={load}`
  passes the press event as the loader's first argument, and a loud
  default reload throws the fixture screen away after every action.
- **2026-10-20** — The pgtap harness runs on prod's table and view
  grants: the bootstrap's blanket table grant is gone, two tests that
  read revoked objects now assert the 42501, and the entry on
  migration REVOKEs records the rule that replaced re-stating them.
- **2026-10-17** — One gotcha: a `headers()` call in the site's `not-found.tsx` kept every page from prerendering, and a page's `notFound()` is client-rendered in Next 15.
- **2026-10-16** — One entry: the Vercel team pause came from another project's ISR on the shared Hobby quota; the site's last Data Cache write (home venue cards) is gone.
- **2026-10-15 (later)** — One entry: signing in to the local admin when a pgtap run has replaced `auth.uid()` on the live local database, and the PKCE magic link locally.
- **2026-10-15** — One entry: a pgtap test on `current_date` fails
  between midnight and 03:00 Cyprus time because the server is UTC;
  tests use the Cyprus date.
- **2026-10-14** — One entry from the maps build: pins at one venue
  stack, so the map draws venues with counts and the row beneath lists
  the games; plus the marker-callout key and the stale-simulator-binary
  tells.
- **2026-09-16 (evening)** — Two gotchas from the money-flip runbook: the
  Stripe publishable key that decides checkout is the one compiled into
  the build (the server's is returned and ignored), and the venue-status
  cascade that makes pitch verification impossible before Connect
  onboarding completes. Both feed
  [runbooks/money-flip.md](runbooks/money-flip.md).
- **2026-09-16 (later, deploy)** — Two from deploying the Greek
  dashboard. `vercel deploy --prebuilt --prod` does **not** move the
  named production domain: with no Git context it takes the deployment
  as production but leaves `ludi-admin.vercel.app` where it was and hands
  the build an auto-generated alias, so the script exited 0 while the
  live site served the previous build — `scripts/deploy_admin.sh` now
  runs `vercel alias set` and reads the alias back before claiming
  success. And `supabase functions deploy` resolves its entrypoint from
  the current directory, so it needs `--workdir packages/supabase` (the
  same flag the migration commands take) or it dies on *entrypoint path
  does not exist* — the more so because `deploy_admin.sh` leaves you in
  `apps/admin`.
- **2026-09-16 (later)** — Two gotchas from the Greek dashboard
  (ADR-0037): `text-transform: uppercase` drops Greek accents only when
  the *element's* language is Greek — `<html lang>` set from a cookie is
  not enough when the account decides, so the shell carries `lang`
  itself; and `app/error.tsx` renders above the shell's provider, so
  only the root (cookie) locale reaches it — the cookie mirror of the
  account's choice is what keeps the error page in the owner's language.
- **2026-09-16** — Two from the gesture research pass: a gesture that
  takes over an animated value must cancel the animation and offset
  from the current position (or it snaps, and two writers fight); and
  Android predictive back is off deliberately — check
  `git check-ignore` before "fixing" anything under
  `apps/mobile/android/`.
- **2026-09-15 (night)** — One gotcha from motion-v2 slice 1: neither a
  one-shot `isReduceMotionEnabled()` read nor a hook that starts `false`
  is right for a mount animation; the hook now caches the last known
  value. Five reduce-motion holes found by grepping every loop/timing.
- **2026-09-15 (late)** — One gotcha from the counter follow-through:
  a component mounted on the rows an action changes loses its outcome
  at `router.refresh()`; mount on the stable condition and return null.
- **2026-09-15 (night)** — One gotcha from the standing-bookings deploy:
  a retyped CHECK list failed on prod against rows CI never has; widen
  from `pg_get_constraintdef`, and never deploy the admin over a failed
  push.
- **2026-09-15 (later)** — One gotcha from the composite-pitch version:
  re-stating a function from an old migration reverted a newer rule;
  take the body from the latest migration that defines it, and run the
  suite locally.
- **2026-09-15** — One gotcha from the enrolment version: a second
  worktree's local stack fails on a Postgres major-version mismatch
  against the shared `ludi` volume; give it its own `project_id`
  locally rather than deleting the volume.
- **2026-09-13 (later)** — One gotcha from the owner web-app review:
  revoking columns to close a public read broke every whole-row
  reference (PostgREST computed columns), caught by the pgtap suite.
- **2026-09-11 (later)** — One more: the simulator tool's quick swipes
  register as taps and once joined a seeded fixture; scroll with ≥1s
  swipes and check `booking_participants` after any surprise.
- **2026-09-11** — One gotcha: the simulator holds one native binary,
  so a worktree's Metro into a stale build fails on whichever native
  module the build predates (AIRMapMarker); verify from the worktree's
  own `expo run:ios`, with `--no-bundler` + detached Metro.
- **2026-09-01** — One technique (injectable haptics bridge keeping
  `@ludi/ui` Expo-free) and one gotcha (the Expo dev client silently
  reconnecting to a stale worktree's Metro on 8081) from the
  motion/gesture polish pass.
- **2026-08-31** — Two gotchas from the open-matches board (ADR-0028):
  generated columns arriving as NULL in BEFORE-trigger NEW rows, and
  the RLS harness's post-migration blanket grant undoing a migration's
  deliberate `REVOKE … FROM anon`. Both found by the pgtap suite.
- **2026-08-24 (later)** — One gotcha: editing a migration and verifying
  it against the throwaway pgtap database does not update the live local
  dev database the app actually talks to. Found via the PostgREST gateway
  log during W5, not the app.
- **2026-08-24** — One gotcha: nothing in the codebase sets
  `bookings.state = 'completed'`, which leaves a played `flex` booking
  refundable at 50%. Found while writing the shared-fixture DATA_MODEL.
- **2026-08-22** — Two entries from the admin/venue-owner planning
  session: `get_available_slots` mis-deriving split windows (three
  failure modes, all reproduced against the local stack) and the three
  owner-facing reads that RLS returns empty rather than erroring on.
  Both feed [plans/venue-owner-admin.md](plans/venue-owner-admin.md).
- **2026-08-10** — Five entries from the pre-venue-onboarding eyes-on
  pass: the `is_admin()` RLS recursion, why pgtap couldn't see it, the
  `_bootstrap.sql`-against-local-stack trap, Hermes having no global
  `crypto`, and `useFonts({})` silently dropping the entire type system.
  The first two of those were live blockers on the admin bookings list
  and the entire mobile checkout; the last explains four months of
  "the design looks flat" feedback.
- **2026-05-27** — Initial JOURNAL.md. Eight entries absorbed from
  the auto-memory store (port shift, local OTP, admin promotion,
  CI role grants, stacked PR merge, Stripe idempotency, mobile
  test runner, STRIPE_SECRET_KEY guard) plus four techniques
  consolidated from PR history.
