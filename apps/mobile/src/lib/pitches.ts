// Discover-tab data layer. Two queries: enabled cities (for the city chips),
// and pitches in the active city per docs/api-contract.md §3.1.
//
// RLS already restricts pitches to bookable+owner+admin rows, so the explicit
// is_verified/is_active filters here are belt-and-braces and let the
// pitches_bookable_idx partial index serve the query.

import { supabase } from './supabase';

export interface CityRow {
  id: string;
  code: string;
  name_en: string;
  name_gr: string;
}

export interface PitchListItem {
  id: string;
  name: string;
  type: '5-a-side' | '7-a-side' | '11-a-side';
  surface: 'turf' | 'grass' | 'indoor';
  price_per_hour_cents: number;
  amenities: string[];
  hero_image_url: string | null;
  venue: {
    id: string;
    name: string;
    address: string;
    city_id: string;
    // PostgREST computed columns over venues.coords (20260822000004); the
    // schema guarantees coords, but the projection can miss, so keep nullable.
    lat: number | null;
    lng: number | null;
    cancellation_policy: 'standard' | 'strict' | 'flex';
  };
}

// Discover is venue-first: the list screen shows venues, each derived from
// the (already filter-reduced) pitch rows. Grouping stays client-side so the
// filter pills keep operating on pitches — a venue is visible when at least
// one of its pitches matches, and count/price reflect the matching subset.
export interface VenueListItem {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  courtCount: number;
  fromPriceCents: number;
  hasSinglePrice: boolean;
  dominantType: PitchListItem['type'];
}

export function groupPitchesByVenue(pitches: PitchListItem[]): VenueListItem[] {
  const byVenue = new Map<string, PitchListItem[]>();
  for (const p of pitches) {
    const list = byVenue.get(p.venue.id);
    if (list) list.push(p);
    else byVenue.set(p.venue.id, [p]);
  }
  const out: VenueListItem[] = [];
  for (const list of byVenue.values()) {
    const first = list[0];
    if (!first) continue;
    const prices = list.map((p) => p.price_per_hour_cents);
    const typeCounts = new Map<PitchListItem['type'], number>();
    for (const p of list) typeCounts.set(p.type, (typeCounts.get(p.type) ?? 0) + 1);
    let dominantType = first.type;
    let best = 0;
    for (const [type, n] of typeCounts) {
      if (n > best) {
        best = n;
        dominantType = type;
      }
    }
    out.push({
      id: first.venue.id,
      name: first.venue.name,
      address: first.venue.address,
      lat: first.venue.lat,
      lng: first.venue.lng,
      courtCount: list.length,
      fromPriceCents: Math.min(...prices),
      hasSinglePrice: Math.min(...prices) === Math.max(...prices),
      dominantType,
    });
  }
  // Cheapest entry point first — mirrors the old pitch ordering.
  out.sort((a, b) => a.fromPriceCents - b.fromPriceCents);
  return out;
}

export async function fetchEnabledCities(): Promise<CityRow[]> {
  const { data, error } = await supabase
    .from('cities')
    .select('id, code, name_en, name_gr')
    .eq('is_enabled', true)
    .order('display_order');
  if (error) throw error;
  return data ?? [];
}

export async function fetchPitchesInCity(cityId: string): Promise<PitchListItem[]> {
  const { data, error } = await supabase
    .from('pitches')
    .select(
      'id, name, type, surface, price_per_hour_cents, amenities, hero_image_url, venues!inner(id, name, address, city_id, lat, lng, cancellation_policy)',
    )
    .eq('venues.city_id', cityId)
    .eq('is_verified', true)
    .eq('is_active', true)
    .order('price_per_hour_cents');
  if (error) throw error;

  // Supabase types nested embeds as arrays even with !inner; flatten.
  // !inner guarantees a row exists, but TS can't see that — drop any
  // row that comes back without a venue rather than throw.
  const out: PitchListItem[] = [];
  for (const row of (data ?? []) as PitchRow[]) {
    const venue = Array.isArray(row.venues) ? row.venues[0] : row.venues;
    if (!venue) continue;
    out.push({
      id: row.id,
      name: row.name,
      type: row.type,
      surface: row.surface,
      price_per_hour_cents: row.price_per_hour_cents,
      amenities: row.amenities ?? [],
      hero_image_url: row.hero_image_url,
      venue: {
        id: venue.id,
        name: venue.name,
        address: venue.address,
        city_id: venue.city_id,
        lat: venue.lat ?? null,
        lng: venue.lng ?? null,
        cancellation_policy: venue.cancellation_policy,
      },
    });
  }
  return out;
}

interface PitchRow {
  id: string;
  name: string;
  type: PitchListItem['type'];
  surface: PitchListItem['surface'];
  price_per_hour_cents: number;
  amenities: string[] | null;
  hero_image_url: string | null;
  venues:
    | {
        id: string;
        name: string;
        address: string;
        city_id: string;
        lat?: number | null;
        lng?: number | null;
        cancellation_policy: PitchListItem['venue']['cancellation_policy'];
      }
    | {
        id: string;
        name: string;
        address: string;
        city_id: string;
        lat?: number | null;
        lng?: number | null;
        cancellation_policy: PitchListItem['venue']['cancellation_policy'];
      }[];
}

// Venue screen data: the venue's identity plus its bookable courts. The
// query goes through pitches (not venues) so the same RLS path that renders
// Discover renders this screen — a venue with zero bookable courts simply
// yields no rows.
export interface VenueDetail {
  id: string;
  name: string;
  address: string;
  /** The pin, for directions (plans/maps.md). */
  lat: number | null;
  lng: number | null;
  courts: PitchListItem[];
}

export async function fetchVenueDetail(venueId: string): Promise<VenueDetail | null> {
  const { data, error } = await supabase
    .from('pitches')
    .select(
      'id, name, type, surface, price_per_hour_cents, amenities, hero_image_url, venues!inner(id, name, address, city_id, cancellation_policy, lat, lng)',
    )
    .eq('venue_id', venueId)
    .eq('is_verified', true)
    .eq('is_active', true)
    .order('price_per_hour_cents')
    .order('name');
  if (error) throw error;

  const courts: PitchListItem[] = [];
  let venue: PitchListItem['venue'] | null = null;
  for (const row of (data ?? []) as PitchRow[]) {
    const v = Array.isArray(row.venues) ? row.venues[0] : row.venues;
    if (!v) continue;
    venue = venue ?? {
      id: v.id,
      name: v.name,
      address: v.address,
      city_id: v.city_id,
      lat: v.lat ?? null,
      lng: v.lng ?? null,
      cancellation_policy: v.cancellation_policy,
    };
    courts.push({
      id: row.id,
      name: row.name,
      type: row.type,
      surface: row.surface,
      price_per_hour_cents: row.price_per_hour_cents,
      amenities: row.amenities ?? [],
      hero_image_url: row.hero_image_url,
      venue,
    });
  }
  if (!venue) return null;
  return { id: venue.id, name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng, courts };
}
