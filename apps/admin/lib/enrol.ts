import type { SupabaseClient } from '@supabase/supabase-js';

import type { OwnerRow } from '@/components/owner-access';
import type { VenueStripeStatus } from '@/components/venue-connect-modal';

// Reads for the counter flow. Where the flow is comes from the rows — a
// venue with no pitches is at "courts", pitches with no windows at
// "hours", and so on (ADR-0031). Nothing here is stored.

export type EnrolPitch = {
  id: string;
  name: string;
  type: string;
  surface: string;
  price_per_hour_cents: number;
  is_verified: boolean;
  is_active: boolean;
  windows: number;
  // Names of the courts this one is made of (ADR-0032); empty for a leaf.
  made_of: string[];
};

export type Enrolment = {
  venue: {
    id: string;
    name: string;
    address: string;
    lat: number | null;
    lng: number | null;
    city_id: string | null;
    cancellation_policy: string;
    is_active: boolean;
    stripe_account_status: VenueStripeStatus;
    city: { id: string; name_en: string; is_enabled: boolean } | null;
  };
  contact: {
    contact_phone: string | null;
    contact_email: string | null;
    take_rate_bps: number | null;
    stripe_account_id: string | null;
  };
  pitches: EnrolPitch[];
  owners: OwnerRow[];
};

export type EnrolStep = 'venue' | 'courts' | 'hours' | 'owner' | 'review';

export const ENROL_STEPS: ReadonlyArray<{ key: EnrolStep; label: string }> = [
  { key: 'venue', label: 'Venue' },
  { key: 'courts', label: 'Courts' },
  { key: 'hours', label: 'Hours' },
  { key: 'owner', label: 'Owner' },
  { key: 'review', label: 'Review' },
];

export async function loadEnrolment(
  supabase: SupabaseClient,
  venueId: string,
): Promise<Enrolment | null> {
  const [venueRes, privateRes, pitchRes, ownerRes] = await Promise.all([
    supabase
      .from('venues')
      .select(
        `id, name, address, lat, lng, city_id, cancellation_policy, is_active,
         stripe_account_status, city:cities ( id, name_en, is_enabled )`,
      )
      .eq('id', venueId)
      .maybeSingle(),
    supabase
      .from('v_venue_private')
      .select('contact_phone, contact_email, take_rate_bps, stripe_account_id')
      .eq('venue_id', venueId)
      .maybeSingle(),
    supabase
      .from('pitches')
      .select(
        'id, name, type, surface, price_per_hour_cents, is_verified, is_active, pitch_schedules ( id )',
      )
      .eq('venue_id', venueId)
      .order('name'),
    supabase.rpc('admin_list_venue_owners', { p_venue_id: venueId }),
  ]);

  if (venueRes.error) throw new Error(`enrol: venue load failed: ${venueRes.error.message}`);
  if (!venueRes.data) return null;
  if (privateRes.error) {
    throw new Error(`enrol: private load failed: ${privateRes.error.message}`);
  }
  if (pitchRes.error) throw new Error(`enrol: pitch load failed: ${pitchRes.error.message}`);
  if (ownerRes.error) throw new Error(`enrol: owner list failed: ${ownerRes.error.message}`);

  const venue = venueRes.data as unknown as Enrolment['venue'];
  const contact = (privateRes.data ?? {
    contact_phone: null,
    contact_email: null,
    take_rate_bps: null,
    stripe_account_id: null,
  }) as Enrolment['contact'];
  const rawPitches = (pitchRes.data ?? []) as unknown as Array<
    Omit<EnrolPitch, 'windows' | 'made_of'> & { pitch_schedules: { id: string }[] | null }
  >;

  // What each composite is made of, as names (ADR-0032). A separate read:
  // pitch_components has two foreign keys to pitches, so embedding would
  // need disambiguation on every select, and names are all the pages show.
  const madeOf = new Map<string, string[]>();
  if (rawPitches.length) {
    const { data: comps, error: compError } = await supabase
      .from('pitch_components')
      .select('parent_pitch_id, child_pitch_id')
      .in('parent_pitch_id', rawPitches.map((p) => p.id));
    if (compError) throw new Error(`enrol: components load failed: ${compError.message}`);
    const nameOf = new Map(rawPitches.map((p) => [p.id, p.name]));
    for (const c of comps ?? []) {
      const list = madeOf.get(c.parent_pitch_id as string) ?? [];
      list.push(nameOf.get(c.child_pitch_id as string) ?? '?');
      madeOf.set(c.parent_pitch_id as string, list);
    }
  }

  const pitches: EnrolPitch[] = rawPitches.map(({ pitch_schedules, ...p }) => ({
    ...p,
    windows: pitch_schedules?.length ?? 0,
    made_of: madeOf.get(p.id) ?? [],
  }));

  return {
    venue,
    contact,
    pitches,
    owners: (ownerRes.data ?? []) as OwnerRow[],
  };
}

// Which steps have something behind them. "Done" is a fact about rows,
// so the stepper can be honest on a venue the old form created.
export function stepsDone(e: Enrolment): Record<EnrolStep, boolean> {
  return {
    venue: true,
    courts: e.pitches.length > 0,
    hours: e.pitches.length > 0 && e.pitches.every((p) => p.windows > 0),
    owner: e.owners.length > 0,
    review: e.venue.is_active,
  };
}
