import { cache } from 'react';

import type { VenuePageCopy } from '@/lib/content/types';

// The venue's own page (plans/reach.md R1): `/v/<slug>` reads one RPC,
// `venue_page(slug)`, signed out. Server-only by the same convention as
// lib/fixture.ts: the env vars are not NEXT_PUBLIC_*, so a client import
// fails loudly rather than leaking the key.

/** Row shape of `public.venue_page(p_slug)`. */
export interface VenuePage {
  venue_id: string;
  name: string;
  address: string;
  city_code: string;
  city_name_en: string;
  city_name_gr: string;
  lat: number | null;
  lng: number | null;
  contact_phone: string | null;
  /** Stripe active and at least one live court: the app can take the booking. */
  bookable: boolean;
  courts: number;
  formats: string[];
  from_price_cents: number | null;
  /** "09:00:00" or null when no live court opens today. */
  opens_today: string | null;
  closes_today: string | null;
}

// Mirrors `venues_slug_shape` in migration 20261014000001, so junk paths
// never cost a database round trip.
const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{2,39}$/;

/** Every call is fresh and nothing goes into Vercel's Data Cache. The site's
 * Vercel team shares one quota of cache writes with other projects, and on
 * 2026-10-16 running out of it paused the site (docs/JOURNAL.md). */
async function rpc<T>(fn: string, body: Record<string, string>): Promise<T | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error(`venue page: SUPABASE_URL / SUPABASE_ANON_KEY are not set (${fn})`);
    return null;
  }
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`venue page: ${fn} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`venue page: ${fn} unreachable`, err);
    return null;
  }
}

/**
 * The venue for a slug, or null: unknown, inactive, bad shape and backend
 * errors all read the same, so the page cannot leak whether a slug exists.
 * Wrapped in React `cache()` so metadata and the body share one call.
 */
export const fetchVenuePage = cache(async (slug: string): Promise<VenuePage | null> => {
  if (!SLUG_SHAPE.test(slug)) return null;
  const rows = await rpc<VenuePage[]>('venue_page', { p_slug: slug });
  return rows && rows.length === 1 ? rows[0]! : null;
});

/**
 * The venues the home page names, in order, read through the same RPC as
 * their own pages, fresh on every visit like them. A venue that fails to
 * load is left out rather than shown half-filled.
 */
export async function fetchVenueCards(slugs: readonly string[]): Promise<(VenuePage & { slug: string })[]> {
  const rows = await Promise.all(
    slugs.map(async (slug) => {
      if (!SLUG_SHAPE.test(slug)) return null;
      const found = await rpc<VenuePage[]>('venue_page', { p_slug: slug });
      return found && found.length === 1 ? { ...found[0]!, slug } : null;
    }),
  );
  return rows.filter((r): r is VenuePage & { slug: string } => r !== null);
}

/** Row shape of `public.venue_open_games(p_slug)` (ADR-0056): the fields the
 * lobby screen already shows, never a name or a price. */
export interface VenueOpenGame {
  starts_at: string;
  ends_at: string;
  pitch_type: '5-a-side' | '7-a-side' | '11-a-side';
  gk_open: number;
  outfield_open: number;
  invite_token: string;
}

/** ADR-0056: the page lists a venue's open games only once the app's switch
 * says it does, so the section stays off until that build is out. Vercel env
 * `VENUE_OPEN_GAMES=on` turns it on, no commit needed. */
export const VENUE_OPEN_GAMES = process.env.VENUE_OPEN_GAMES === 'on';

/**
 * The venue's open games (plans/instagram.md IG-2), read fresh on every
 * request: a seat taken a minute ago must not still show (and nothing here
 * writes Vercel's Data Cache). Null when the section is off or the read
 * failed, so the page hides it rather than say "none" when it doesn't know.
 */
export async function fetchVenueOpenGames(slug: string): Promise<VenueOpenGame[] | null> {
  if (!VENUE_OPEN_GAMES || !SLUG_SHAPE.test(slug)) return null;
  return rpc<VenueOpenGame[]>('venue_open_games', { p_slug: slug });
}

/** An open-games count as an analytics enum; 'off' while the section is. */
export function openBucket(games: VenueOpenGame[] | null): 'off' | '0' | '1' | '2+' {
  if (games === null) return 'off';
  return games.length === 0 ? '0' : games.length === 1 ? '1' : '2+';
}

/** "Ατλαντίδος 17 , 2306" → "Ατλαντίδος 17, 2306": addresses are typed in by
 * hand at the counter, so tidy the spacing rather than trust it. */
export function formatAddress(address: string): string {
  return address.replace(/\s+([,.])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** A live venue as a pin on the island map (plans/maps.md M3). */
export interface VenuePin {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  city_code: string;
  courts: number;
  bookable: boolean;
}

/** Every active venue with a page and a point. Empty when the backend is unset. */
export const fetchVenuePins = cache(async (): Promise<VenuePin[]> => {
  const rows = await rpc<VenuePin[]>('venue_pins', {});
  return (rows ?? []).filter((r) => SLUG_SHAPE.test(r.slug) && r.lat != null && r.lng != null);
});

/** Pin counts as an analytics enum. */
export function pinBucket(n: number): '1' | '2-5' | '6+' {
  return n <= 1 ? '1' : n <= 5 ? '2-5' : '6+';
}

/** Every active venue's slug, for the sitemap. Empty when the backend is unset. */
export async function fetchVenueSlugs(): Promise<string[]> {
  const rows = await rpc<{ slug: string }[]>('venue_slugs', {});
  return (rows ?? []).map((r) => r.slug).filter((s) => SLUG_SHAPE.test(s));
}

/** "€40" or "€37.50": whole euros stay whole. */
export function formatFromPrice(cents: number, locale: 'en' | 'el'): string {
  return new Intl.NumberFormat(locale === 'el' ? 'el-GR' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** "7 courts · 5-a-side": the venue page's courts row and the home page's
 * venue cards say it the same way. */
export function formatCourts(copy: VenuePageCopy, venue: Pick<VenuePage, 'courts' | 'formats'>): string {
  const names = venue.formats.map((f) => copy.pitchTypes[f as keyof VenuePageCopy['pitchTypes']] ?? f);
  const courts = venue.courts === 1 ? copy.courtsOne : copy.courtsMany(venue.courts);
  return names.length ? `${courts} · ${names.join(', ')}` : courts;
}

/** "09:00:00" → "09:00". */
export function formatHour(t: string): string {
  return t.slice(0, 5);
}
