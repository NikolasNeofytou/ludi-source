# ADR-0037 — The owner dashboard's language follows the account, from a dictionary the app owns

**Status:** Accepted (reversible — the dictionary is plain TypeScript; the column already existed)
**Date:** 2026-09-16
**Deciders:** Nikolas Neofytou
**Supersedes:** —
**Superseded by:** —

## Context

`apps/admin` is the surface a venue owner signs into
([ADR-0019](0019-venue-owners-share-apps-admin.md)). Both owners so far
are Greek-speaking Cypriots; the invite email has been Greek-first since
2026-09-15; the calendar's printed day sheet is Greek because the paper
it replaces is. The dashboard between those two things is English, and
the app has no i18n at all — ~380 English strings inline across ~35
files ([plans/owner-greek.md](../plans/owner-greek.md)).

Three questions had to be settled before the first string moved:

1. **What decides the language?** The browser (`Accept-Language`), the
   URL (`/el/...`, as the marketing site does), the venue, or the
   account.
2. **Where do the strings live?** `i18next` (the mobile app's choice),
   `next-intl`, `@ludi/i18n` (a five-line placeholder), or a typed
   dictionary module inside the app (the site's choice).
3. **Who speaks Greek — the page only, or the server too?** Server
   actions return sentences (refusals, field errors, "Window added.");
   `Intl` formats dates and money.

Constraints: the admin is server-rendered and fully dynamic (every page
reads Supabase under the caller's JWT); it has no test runner, so the
build is the only parity check; and the founder's own pages (enrolment,
venues, revenue, invites) are English and must stay so without carrying
dead Greek entries.

## Decision

**The language is a property of the account — `users.preferred_locale` —
read on the server in the same query that reads the role; the strings
live in one typed dictionary module inside `apps/admin`; server actions
and formatters take the same locale.**

- `Viewer.locale` comes from `users.preferred_locale` (`'en' | 'gr'`, a
  column since the initial schema, own-row writable). A switch in the
  shell bar writes it. Before sign-in, a cookie the switch sets, else
  the browser's `Accept-Language`, else English.
- `lib/copy/{types,en,el}.ts` — one `AdminCopy` interface, two objects,
  `getCopy(locale)`. Server components call it with `viewer.locale`;
  client components read the locale from a context that carries the
  string only. Count-bearing strings are functions.
- English is the source of truth. The zod schemas keep their English
  messages; the Greek dictionary maps those sentences and falls back to
  a generic Greek "check this field" for zod defaults.
- Server actions read `getCopy(viewer.locale)` for every message they
  return. `formatEur`, `formatDate`, `formatDateTime`, `formatDayLabel`
  take the locale and use `el-GR` for Greek.
- New owners are created Greek: `invite-venue-owner` writes
  `preferred_locale: 'gr'` into the invite metadata; the signup trigger
  already reads it.
- The founder's admin-only pages are not in the dictionary.

## Consequences

### Positive
- The language survives a new phone, a cleared browser, and a colleague's
  laptop: it is the account's.
- `tsc` is the parity check. One interface, two objects: a key added to
  `en` without `el` fails the build — the check CONVENTIONS § i18n has
  promised since May, for this app.
- No new dependency, no runtime language negotiation on the client, no
  flash of the wrong language: the server renders the right words on
  the first byte.
- The same shape as `apps/site/lib/content`, so anyone who has edited
  the site's copy can edit the dashboard's.
- Server-side messages are Greek because they were written in Greek,
  not because a client translated an English sentence after the fact.

### Negative
- Two dictionaries to keep in step by hand (the type catches missing
  keys, not stale meaning).
- The owner-facing *halves* of two shared forms (pitch, venue) carry
  the admin-only commercial block along; that block is translated too
  rather than split, so the founder sees Greek there if he switches.
  He will not.
- Edge Function messages that reach a modal via `readEdgeError` stay in
  the function's English. Parked with a trigger.

### Neutral
- The locale key is `'gr'`, the column's vocabulary, not BCP-47 `'el'`;
  `htmlLang()` maps it for the `<html lang>` attribute. The site uses
  `'el'` in its URLs; the mobile app uses `'gr'`. Nothing shares a key
  across apps yet.
- A cookie mirrors the account's choice so the sign-in page and the
  `<html lang>` attribute (set in the root layout, outside auth) agree
  with the last signed-in account on that browser.

## Alternatives considered

### Browser language (`Accept-Language`)

What every unauthenticated site does. Wrong here: an owner's phone may
be set to English while they read Greek (common in Cyprus), and a
manager sharing the counter laptop would flip the owner's dashboard by
signing in. The browser decides only where there is no account.

### A locale route (`/el/...`), as `apps/site` does

Right for the site — search engines need one URL per language. The
dashboard is `noindex`, every page is one URL, and a `/el/bookings`
that a Greek owner bookmarks would still need to know it is *their*
page. The URL is not the account.

### `i18next` / `react-i18next`, as `apps/mobile` does

Runtime switching inside a native bundle, plurals, interpolation — the
mobile app needs them. A server-rendered admin renders one language per
request and would carry the library for a `t()` it can express as a
property access. Rejected for weight, not merit.

### `@ludi/i18n` as the home of the strings

It is the placeholder for strings shared across apps. Nothing is shared
yet; putting the admin's 380 strings there would make a package of one
consumer. Revisit when the site, the admin or the app share a sentence.

### Translate on the client only

Leave server actions English and map their messages in the browser.
Rejected: the collision refusal composes counts, codes and a way out
into one sentence — mapping that after the fact is a second copy of the
logic, in the wrong place.

## Follow-ups

- FUTURE: Edge Function messages in the owner's language (trigger: an
  owner reads one and asks what it means).
- FUTURE: a lint that fails on a bare English string in an owner-facing
  file (trigger: the first missed string found by an owner, not by us).
- Related: ADR-0019 (owners share `apps/admin`), ADR-0024 (email
  sign-in), plans/owner-greek.md, CONVENTIONS § i18n.
