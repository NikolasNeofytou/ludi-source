import { cache } from 'react';

// The invite preview read (C1, docs/plans/invite-landing.md; ADR-0025).
//
// This module is server-only by convention: the env vars are deliberately
// NOT `NEXT_PUBLIC_*`, so importing it from a client component would fetch
// with an undefined key and fail loudly rather than leak the key quietly.
// The anon key is only an identifier, but keeping it off the browser gives
// abuse one throat to choke (the site's server) and keeps the site's
// no-client-JS-talks-to-the-backend line clean.

/** Row shape of `public.fixture_preview(p_invite_token)` — the deliberately
 * narrow pre-join read (never names, never the booking code). Mirrors
 * `apps/mobile/src/lib/fixture.ts`. */
export interface FixturePreview {
  booking_id: string;
  starts_at: string;
  ends_at: string;
  pitch_type: '5-a-side' | '7-a-side' | '11-a-side';
  pitch_name: string;
  venue_name: string;
  city_name_en: string;
  city_name_gr: string;
  gk_open: number;
  outfield_open: number;
  joinable: boolean;
  /** Seats a player is waiting to hand over (ADR-0044). Older previews omit them. */
  gk_replacing?: number;
  outfield_replacing?: number;
}

/** Seats a newcomer can have: free ones, and ones a player is handing over. */
export function seatsOpen(p: FixturePreview): number {
  return (
    Math.max(0, p.gk_open) + Math.max(0, p.outfield_open) + (p.gk_replacing ?? 0) + (p.outfield_replacing ?? 0)
  );
}

export function keeperOpen(p: FixturePreview): boolean {
  return p.gk_open > 0 || (p.gk_replacing ?? 0) > 0;
}

export type PreviewResult =
  | { kind: 'ok'; preview: FixturePreview }
  | { kind: 'invalid' }
  | { kind: 'error' };

// `new_invite_token()` emits 16 chars of base64url. The guard is wider than
// that on purpose (rotation could change the length) but tight enough that
// junk paths never cost a database round trip.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Resolve an invite token to its fixture preview, or say why not.
 *
 * Wrapped in React `cache()` so `generateMetadata` and the page body share
 * one RPC call per request. `no-store` because spots-open changes with every
 * join and this page must not lie from a cache.
 *
 * An empty result set is `invalid` — a revoked or made-up token gets the
 * same answer, so the page cannot leak whether a link ever existed.
 */
export const fetchFixturePreview = cache(async (token: string): Promise<PreviewResult> => {
  if (!TOKEN_SHAPE.test(token)) return { kind: 'invalid' };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('fixture preview: SUPABASE_URL / SUPABASE_ANON_KEY are not set');
    return { kind: 'error' };
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/fixture_preview`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_invite_token: token }),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`fixture preview: rpc returned ${res.status}`);
      return { kind: 'error' };
    }
    const rows = (await res.json()) as FixturePreview[];
    const row = rows.length === 1 ? rows[0] : undefined;
    return row ? { kind: 'ok', preview: row } : { kind: 'invalid' };
  } catch (err) {
    console.error('fixture preview: rpc unreachable', err);
    return { kind: 'error' };
  }
});

/**
 * Court cameras (ADR-0042): whether the organiser switched recording on.
 * Anything short of a clear yes reads as no; the notice is extra, never
 * the page's reason to fail.
 */
export const fetchInviteRecorded = cache(async (token: string): Promise<boolean> => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!TOKEN_SHAPE.test(token) || !url || !key) return false;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/invite_recorded`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_invite_token: token }),
      cache: 'no-store',
    });
    return res.ok ? (await res.json()) === true : false;
  } catch {
    return false;
  }
});

/** What the screen actually renders. `joinable` alone can't tell "kicked off"
 * from "called off", and doesn't know about capacity — derive the one state
 * the copy speaks to. */
export type FixtureState = 'open' | 'full' | 'started' | 'off';

export function fixtureState(p: FixturePreview): FixtureState {
  const started = new Date(p.starts_at).getTime() <= Date.now();
  if (!p.joinable) return started ? 'started' : 'off';
  if (seatsOpen(p) <= 0) return 'full';
  return 'open';
}

/** "Saturday 30 August · 19:00–20:00", pinned to Cyprus time — the server
 * rendering this page does not live where the match is played. */
export function formatFixtureWhen(locale: 'en' | 'el', startsAt: string, endsAt: string): string {
  const tag = locale === 'el' ? 'el' : 'en-GB';
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = new Intl.DateTimeFormat(tag, {
    timeZone: 'Asia/Nicosia',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(start);
  const time = new Intl.DateTimeFormat(tag, {
    timeZone: 'Asia/Nicosia',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${day} · ${time.format(start)}–${time.format(end)}`;
}
