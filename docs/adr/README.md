# Architecture Decision Records (ADRs)

Every non-trivial architectural decision gets a short, append-only document. If you want to change something recorded here, **write a new ADR that supersedes the old one — never edit the old one silently**.

## Format

We use [MADR](https://adr.github.io/madr/). One file per decision, named `NNNN-short-title.md`.

Each ADR has:

- **Status** — Accepted, Proposed, Superseded by NNNN, Deprecated
- **Context** — the problem, constraints, and forces in play
- **Decision** — what we chose, in one sentence, then details
- **Consequences** — positive, negative, neutral outcomes
- **Alternatives considered** — what else was on the table and why we didn't pick it

## Index

| # | Title | Status |
|---|---|---|
| [0001](./0001-monorepo-pnpm-turborepo.md) | Monorepo with pnpm + Turborepo | Accepted |
| [0002](./0002-mobile-expo-rn-expo-router.md) | Mobile stack: Expo + React Native + expo-router | Accepted |
| [0003](./0003-backend-supabase.md) | Backend: Supabase (Postgres + Auth + Storage + Realtime) | Accepted |
| [0004](./0004-payments-stripe-connect.md) | Payments: Stripe + Stripe Connect Express | Accepted |
| [0005](./0005-i18n-i18next.md) | i18n: i18next + expo-localization | Accepted |
| [0006](./0006-typescript-strict-zod.md) | TypeScript strict mode + Zod for runtime validation | Accepted |
| [0007](./0007-design-system-package.md) | Design system lives in `@ludi/ui` as source of truth | Accepted |
| [0008](./0008-maps-mapbox-deferred.md) | Maps: Mapbox (deferred to Stage 4) | Accepted |
| [0009](./0009-responsible-disclosure-policy.md) | Responsible disclosure policy | Accepted |
| [0010](./0010-sentry-error-tracking.md) | Sentry for error & crash tracking | Accepted |
| [0011](./0011-posthog-product-analytics.md) | PostHog for product analytics (consent-gated) | Accepted |
| [0012](./0012-player-profile-data-posture.md) | Player Card profile: age-as-band minimisation + empty-state display | Accepted |
| [0013](./0013-cross-player-card-read.md) | Cross-player card read via a dedicated `public_player_cards` view | Accepted |
| [0018](./0018-account-erasure-anonymize-and-keep.md) | Account erasure: anonymise-and-keep via GoTrue soft-delete | Accepted |
| [0019](./0019-venue-owners-share-apps-admin.md) | Venue owners share `apps/admin` behind a second gate | Accepted |
| [0020](./0020-venue-map-picker-leaflet-osm.md) | Venue coordinates: a map picker on Leaflet + OpenStreetMap | Accepted |
| [0021](./0021-invite-token-not-booking-code.md) | The fixture invite capability is a rotatable token, not the booking code | Accepted |
| [0022](./0022-join-fixture-definer-rpc.md) | Joining a fixture is a `SECURITY DEFINER` RPC, not an Edge Function | Accepted |
| [0023](./0023-venue-booking-roster-exposure.md) | The venue booking roster: full name always, phone only near kick-off | Accepted |
| [0024](./0024-owner-sign-in-email-magic-link.md) | Owners sign in by email magic link; accounts are invited, not self-created | Accepted |
| [0025](./0025-invite-web-fallback.md) | The invite link's web fallback is a server-rendered preview, not a client app | Accepted |
| [0026](./0026-funds-flow-destination-charges.md) | Funds flow is destination charges; refunds reverse the transfer | Accepted |
| [0027](./0027-shares-separate-charges-one-transfer.md) | Split-fixture shares are separate platform charges with one transfer at confirm | Accepted |
| [0028](./0028-open-matches-reuse-fixture-substrate.md) | Open matches are a discovery view over fixtures, joined through the invite capability | Accepted |
| [0029](./0029-home-minimap-react-native-maps.md) | Home mini-map ships now on react-native-maps; ADR-0008 narrows to "no map screen" | Accepted |
| [0031](./0031-enrolment-state-derives-from-rows.md) | Venue enrolment state derives from rows; the inactive venue is the draft, there is no wizard table | Accepted |
| [0032](./0032-composite-pitches-occupy-units.md) | A composite pitch is a pitch made of others; a booking occupies units, enforced in the database | Accepted |
| [0033](./0033-standing-bookings-are-materialised-walk-ins.md) | A standing booking is a series whose instances are ordinary walk-ins, materialised eight weeks ahead | Accepted |
| [0035](./0035-motion-engine-and-spring-policy.md) | Motion runs on Reanimated 4; springs for what moves in space, durations for everything else (0034 reserved for booking approval) | Accepted (amended 2026-10-20: `error` haptic, "You're in" screen) |
| [0037](./0037-owner-dashboard-language-follows-the-account.md) | The owner dashboard's language follows the account, not the browser | Accepted |
| [0041](./0041-a-manager-runs-the-day.md) | A manager runs the day; an owner decides what the venue is, what it charges, and sees what it earned | Accepted |
| [0042](./0042-the-recording-belongs-to-the-booking.md) | Court cameras: a booking is recorded only when its organiser switches it on before kickoff; only its roster watches, for thirty days | Accepted |
| [0043](./0043-the-wall-publishes-an-opened-fixture.md) | The venue's screen carries an opened fixture's invite, exactly where the board would list it | Accepted |
| [0044](./0044-a-seat-changes-hands-and-the-money-follows.md) | A seat changes hands in one step; on a paid split seat the taker's share replaces the leaver's | Accepted |
| [0045](./0045-the-owner-sends-ludi-only-ranks.md) | Fill the hour: Ludi ranks the venue's regulars for an empty hour; the owner sends each offer from his own WhatsApp | Accepted |
| [0046](./0046-the-desk-proposes-the-owner-books.md) | The booking desk reads a customer's message into a proposal; the owner books it with the ordinary walk-in form | Accepted |
| [0047](./0047-the-keeper-pool-is-free-and-first-claim-wins.md) | The keeper pool: willing players see a short keeper on Community, the first claim wins and plays free, and both sides say whether the other turned up | Accepted |
| [0048](./0048-player-notices-are-a-ledger-and-push-is-the-first-channel.md) | A player's notices are a ledger minted by the database, drained every minute, sent by Expo push first and email where wanted; skipped is a status with a reason | Accepted |
| [0050](./0050-a-competitions-scores-are-public-only-when-its-owner-says-so.md) | One model for every competition a venue hosts; a competition's scores are public only when its owner says so, and a CFA grassroots competition never has a table (amended 2026-10-15: a CFA competition's scores are never public) | Accepted |
| [0051](./0051-a-parent-follows-a-team-not-a-person.md) | A parent follows a team, not a person: a private subscription to its fixtures, told through the player's ledger | Accepted |
| [0054](./0054-the-lobby-screen-names-the-booking-by-first-name-today.md) | The lobby screen names each booking by its first name, today only, on a board of rows by time | Accepted |

> ADR-0014…0017 are reserved by the in-flight `plan/match-fit-card`
> branch and will appear here when it merges. ADR-0036, 0038, 0039 and
> 0040 are likewise reserved by open PRs (icons, the verified card, the
> store, venue contacts); 0049 by
> [plans/find-us-an-opponent.md](../plans/find-us-an-opponent.md) (a side
> is a block; the first captain to claim it wins); 0052 and 0053 by the
> open `docs/ludi-member` branch (the membership).

## Template

Copy [`_template.md`](./_template.md) when writing a new ADR.
