// Pitch-detail data layer (M2 #8). Implements docs/api-contract.md §4.1
// (pitch + nested venue + schedules) and §4.2 (availability via the
// get_available_slots RPC).
//
// All date math runs in the venue's wall-time so day tabs and slot times
// match what the venue keeps, regardless of the device timezone. The RPC
// itself hardcodes Europe/Nicosia per the migration; we match that here.

import { supabase } from './supabase';

const VENUE_TZ = 'Europe/Nicosia';

export interface PitchSchedule {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  slot_duration_minutes: number;
}

export interface PitchDetail {
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
    cancellation_policy: 'standard' | 'strict' | 'flex';
    stripe_account_status: 'pending' | 'active' | 'restricted' | 'disabled';
  };
  schedules: PitchSchedule[];
}

export interface AvailableSlot {
  starts_at: string;
  ends_at: string;
  is_available: boolean;
}

interface DetailRow {
  id: string;
  name: string;
  type: PitchDetail['type'];
  surface: PitchDetail['surface'];
  price_per_hour_cents: number;
  amenities: string[] | null;
  hero_image_url: string | null;
  venues:
    | DetailVenue
    | DetailVenue[];
  pitch_schedules: PitchSchedule[] | null;
}

interface DetailVenue {
  id: string;
  name: string;
  address: string;
  cancellation_policy: PitchDetail['venue']['cancellation_policy'];
  stripe_account_status: PitchDetail['venue']['stripe_account_status'];
}

export async function fetchPitchDetail(pitchId: string): Promise<PitchDetail> {
  const { data, error } = await supabase
    .from('pitches')
    .select(
      `id, name, type, surface, price_per_hour_cents, amenities, hero_image_url,
       venues!inner(id, name, address, coords, cancellation_policy, stripe_account_status),
       pitch_schedules(day_of_week, opens_at, closes_at, slot_duration_minutes)`,
    )
    .eq('id', pitchId)
    .single();
  if (error) throw error;

  const row = data as DetailRow;
  const venue = Array.isArray(row.venues) ? row.venues[0] : row.venues;
  if (!venue) throw new Error('pitch missing venue');
  return {
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
      cancellation_policy: venue.cancellation_policy,
      stripe_account_status: venue.stripe_account_status,
    },
    schedules: row.pitch_schedules ?? [],
  };
}

export async function fetchAvailableSlots(
  pitchId: string,
  startDate: string,
  endDate: string,
): Promise<AvailableSlot[]> {
  const { data, error } = await supabase.rpc('get_available_slots', {
    p_pitch_id: pitchId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) throw error;
  return (data ?? []) as AvailableSlot[];
}

// ── Date helpers ─────────────────────────────────────────────────────
// All formatters pin to VENUE_TZ so the day tabs stay aligned with the
// RPC's slot windows even when the device sits in a different timezone.

export function venueDateStr(d: Date): string {
  // en-CA gives YYYY-MM-DD, which is the date format the RPC expects.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VENUE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function venueTimeStr(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: VENUE_TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

const WEEKDAY_TO_MON_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

// 0 = Mon … 6 = Sun, matching COPY.days ordering.
export function venueWeekdayMonIndex(d: Date): number {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: VENUE_TZ,
    weekday: 'short',
  }).format(d);
  return WEEKDAY_TO_MON_INDEX[wd] ?? 0;
}

export function venueDayOfMonth(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: VENUE_TZ,
      day: 'numeric',
    }).format(d),
  );
}

export type SevenDays = readonly [Date, Date, Date, Date, Date, Date, Date];

export function next7Days(now: Date = new Date()): SevenDays {
  // +24h ticks land inside the next venue-day even across DST shifts
  // (the worst case is a 1h drift, never enough to skip a date).
  const t0 = now.getTime();
  const day = 24 * 60 * 60 * 1000;
  return [
    new Date(t0),
    new Date(t0 + day),
    new Date(t0 + 2 * day),
    new Date(t0 + 3 * day),
    new Date(t0 + 4 * day),
    new Date(t0 + 5 * day),
    new Date(t0 + 6 * day),
  ];
}
