// src/lib/analytics.ts
// PostHog product analytics (ADR-0011). TWO guards, both load-bearing:
//   1. Key-guarded — with no EXPO_PUBLIC_POSTHOG_API_KEY the module no-ops
//      (ships dormant; local dev / CI / PR builds need no key). Parity with
//      the Sentry DSN guard.
//   2. Consent-gated — UNLIKE Sentry (legitimate interest), product analytics
//      is exactly what the M4 #22 GDPR modal exists to gate. Nothing — not
//      even app_opened — sends until consent is granted, and it stops on
//      revocation. The PostHog client is not even *constructed* before consent,
//      so a decliner generates zero network traffic.
// No PII ever: properties are ids / enums / counts / cents / timestamps only
// (enforced by the per-event types below). Autocapture is off (no
// PostHogProvider) — explicit capture() calls only.

import PostHog from 'posthog-react-native';

const KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

let client: PostHog | null = null;
let consentGranted = false;

/**
 * The canonical event taxonomy (ADR-0011 §4). The per-event property shapes
 * are the no-PII contract: only ids, enums, counts, cents, timestamps.
 */
export interface AnalyticsEvents {
  app_opened: { locale: string; city?: string };
  auth_completed: { method: 'phone' | 'apple' | 'google' | 'magic_link'; is_new_user: boolean };
  pitch_viewed: { pitch_id: string; city?: string; price_cents: number };
  booking_started: { pitch_id: string; slot_starts_at: string };
  booking_confirmed: { booking_id: string; total_cents: number };
  booking_failed: { error_code: string };
  booking_cancelled: { refund_cents: number; hours_to_slot: number };
  fixture_left: { slot_kind: 'gk' | 'outfield'; hours_to_slot: number };
  // Find my replacement (ADR-0044): does an ask get taken, and how fast?
  // The taken half is derivable from seat_swaps; the ask is the client act.
  replacement_asked: { slot_kind: 'gk' | 'outfield'; paid: boolean; hours_to_slot: number };
  seat_taken: { booking_id: string; paid: boolean };
  // The goalkeeper pool (ADR-0047): posted, claimed, and the record kept.
  keeper_posted: { shape: 'full' | 'rotation'; audience: number };
  keeper_claimed: { booking_id: string };
  keeper_feedback: { role: 'organiser' | 'keeper'; again: boolean };
  // court cameras (ADR-0042)
  recording_toggled: { on: boolean };
  recording_watched: { booking_id: string };
  recording_deleted: { booking_id: string };
  // maps (plans/maps.md): the picture, and what gets tapped on it. Pin
  // counts are bucketed so the property stays an enum.
  map_shown: { surface: 'discover' | 'record'; pins: '1' | '2-5' | '6+' };
  map_pin_tapped: { surface: 'discover' | 'record'; kind: 'venue' | 'game' | 'keeper' };
  // push (plans/reach.md R2): the ask at one of four moments, its
  // answer, and a tapped notice. Never a token, never the content.
  push_prompted: { moment: 'booking_confirmed' | 'fixture_joined' | 'in_goal' | 'replacement_asked' | 'team_followed' };
  push_permission: {
    moment: 'booking_confirmed' | 'fixture_joined' | 'in_goal' | 'replacement_asked' | 'team_followed';
    granted: boolean;
  };
  push_opened: { kind: 'booking' | 'community' | 'bookings' };
  // The CFA Saturday inside Ludi (plans/cfa-in-the-app.md): a follow is
  // counted as an event, never as who or which team — the success number
  // (30 parents by 29 Nov) is read from team_follows on prod.
  team_followed: { plays: boolean };
  team_unfollowed: Record<string, never>;
  parents_asked: { booking_id: string };
  // C2 W6/W7 — the split-payment funnel (community.md §Measurement).
  // fixture_confirmed is observation-based: captured by whichever consented
  // client watches the collecting → confirmed flip happen. No
  // fixture_expired event — expiries are derivable from the rows.
  share_paid: { booking_id: string; amount_cents: number };
  fixture_covered: { booking_id: string; amount_cents: number };
  fixture_confirmed: { booking_id: string };
  // Open matches (ADR-0028, plans/open-matches.md §Measurement). The board's
  // honest question is "does anyone join a fixture they had no link to?" —
  // tapped rows route through /f/<token>, so a join that follows a tap is
  // the discovery signal.
  open_board_viewed: { open_count: number };
  // series_weeks: the row's weekly run when it shows one (≥ 4), else null —
  // taps on rows with the line against rows without (plans/strava-build.md B2)
  open_match_tapped: { booking_id: string; series_weeks: number | null };
  fixture_opened: { booking_id: string; is_open: boolean };
  // 2026-09-01 board enhancements, re-cut 2026-09-11 (community-v4.md
  // unit 2: time chips replaced venue/format). filtered fires per filter
  // *change*, with the resulting active set — whether filters get used at
  // all is the signal that decides if they earn server-side support later.
  open_board_filtered: {
    time: 'tonight' | 'tomorrow' | 'weekend' | null;
    city: string | null;
    keeper_only: boolean;
  };
  fixture_level_set: { booking_id: string; level: 'casual' | 'competitive' | 'unset' };
  // The shelf (community-v2.md): which standing cards actually get used.
  shelf_card_tapped: { card: 'whatsapp' | 'keeper_filter' | 'keeper_pool' };
  // The create pill beside the title (community-v4.md unit 4) — the one
  // create affordance on the screen; `yours_count` says whether the tapper
  // already carries a short fixture (a second one) or none (a first).
  community_create_tapped: { yours_count: number };
  // The organiser lane (community-v3.md), now the *Yours* section
  // (community-v4.md): does putting the fill job in front of the person
  // who carries the fixture actually produce shares? Event name kept for
  // continuity; `role` added because a joiner can now share too, and the
  // v4 check is that the share rate does not fall when the row shrinks.
  organiser_lane_shared: { booking_id: string; role: 'hosting' | 'joined' };
}

/** Construct the client lazily — and ONLY when a key is present. */
function ensureClient(): PostHog | null {
  if (!KEY) return null; // dormant without a key (ADR-0011 §6)
  if (!client) {
    client = new PostHog(KEY, {
      host: HOST,
      captureAppLifecycleEvents: false, // app_opened is fired explicitly
      preloadFeatureFlags: false, // funnel only; no flag fetch / quota noise
    });
  }
  return client;
}

/**
 * Drive analytics from the GDPR consent state (consent.ts is the single source
 * of truth — call this on first consent and on every change). Granted →
 * construct (if a key exists) + opt in. Revoked → opt out; never constructs the
 * client just to opt out, so a decliner stays at zero network.
 */
export function setAnalyticsConsent(granted: boolean): void {
  consentGranted = granted;
  if (__DEV__) console.log('[analytics] consent', granted ? 'granted' : 'revoked');
  if (granted) ensureClient()?.optIn();
  else client?.optOut();
}

/** Emit a funnel event. No-op without consent (and without a key). */
export function capture<E extends keyof AnalyticsEvents>(event: E, properties: AnalyticsEvents[E]): void {
  if (!consentGranted) return;
  // Dev sanity check: print every captured event to the Metro terminal. This
  // fires regardless of whether a key is set, so the funnel wiring + consent
  // gate can be verified locally with no PostHog account (ADR-0011 manual
  // verification). Stripped from production bundles via __DEV__.
  if (__DEV__) console.log('[analytics]', event, properties);
  // Cast to PostHog's own expected properties type (derived from the method so
  // it tracks the SDK); our per-event types are all JSON-safe primitives.
  ensureClient()?.capture(event, properties as unknown as Parameters<PostHog['capture']>[1]);
}

/** Tie subsequent events to the user — UUID only, never PII (ADR-0011 §5). */
export function identifyUser(userId: string): void {
  if (!consentGranted) return;
  ensureClient()?.identify(userId);
}

/** Clear the identity on sign-out (back to an anonymous distinct_id). */
export function resetAnalytics(): void {
  client?.reset();
}

/** Pin counts as an analytics enum (plans/maps.md). */
export function pinBucket(n: number): '1' | '2-5' | '6+' {
  return n <= 1 ? '1' : n <= 5 ? '2-5' : '6+';
}
