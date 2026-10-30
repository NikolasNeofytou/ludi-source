import Link from 'next/link';

import { CfaLoader } from '@/components/cfa-loader';
import { AppShell, EmptyState, PageHead } from '@/components/ui';
import { requireVenueAccess } from '@/lib/auth';
import { SLOT_HOLDING_STATES } from '@/lib/booking-states';
import { cfaSeason, saturdayOnOrAfter, teamKey, type Busy, type LoaderCourt } from '@/lib/cfa';
import { getCopy } from '@/lib/copy';
import { formatTime, venueDayBoundsUtc, venueToday } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

// Load a CFA grassroots round (plans/cfa-grassroots-saturday.md): the CFA's
// file names the venue, the owner puts each match on a court. The page reads
// what the loader needs to propose courts — the venue's courts with what each
// is made of, and what already holds a court that day (standing holds aside:
// a match releases those).

type SearchParams = { venue?: string; day?: string };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export default async function CfaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const viewer = await requireVenueAccess();
  const params = await searchParams;
  const t = getCopy(viewer.locale);
  const venue = viewer.venues.find((v) => v.id === params.venue) ?? viewer.venues[0] ?? null;
  const day = params.day && DATE_KEY.test(params.day) ? params.day : saturdayOnOrAfter(venueToday());

  if (!venue) {
    return (
      <AppShell viewer={viewer}>
        <PageHead title={t.cfa.title} />
        <EmptyState>{t.calendar.noVenue}</EmptyState>
      </AppShell>
    );
  }

  const supabase = await createClient();
  const { start, end } = venueDayBoundsUtc(day);
  const [{ data: courtRows, error: courtError }, { data: bookingRows }, { data: matchRows }, { data: teamRows }] = await Promise.all([
    supabase
      .from('pitches')
      .select('id, name, price_per_hour_cents, parts:pitch_components!pitch_components_parent_pitch_id_fkey ( child_pitch_id )')
      .eq('venue_id', venue.id)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('bookings')
      .select('id, starts_at, ends_at, series_id, pitch:pitches!inner ( id, venue_id )')
      .eq('pitch.venue_id', venue.id)
      .in('state', [...SLOT_HOLDING_STATES])
      .gte('starts_at', start)
      .lt('starts_at', end),
    // The day's matches here, with each team's group: two matches between
    // the same academies in two groups are two matches.
    supabase
      .from('competition_matches')
      .select(
        'booking_id, category, competition:competitions!inner ( venue_id, kind ), booking:bookings!inner ( pitch_id ), ' +
          'home:competition_teams!competition_matches_home_team_fkey ( name, group_label ), ' +
          'away:competition_teams!competition_matches_away_team_fkey ( name, group_label )',
      )
      .eq('competition.venue_id', venue.id)
      .eq('competition.kind', 'cfa_grassroots')
      .is('elsewhere', null)
      .neq('status', 'cancelled')
      .gte('kickoff_at', start)
      .lt('kickoff_at', end),
    // The venue's CFA teams this season: the file's away rows are sent only
    // for these, and the database keeps those whose team plays here.
    supabase
      .from('competition_teams')
      .select('name, category, group_label, competition:competitions!inner ( venue_id, kind, season )')
      .eq('competition.venue_id', venue.id)
      .eq('competition.kind', 'cfa_grassroots')
      .eq('competition.season', cfaSeason(day)),
  ]);
  if (courtError) throw new Error(`cfa: courts failed: ${courtError.message}`);

  const rows = (courtRows ?? []) as unknown as Array<{
    id: string;
    name: string;
    price_per_hour_cents: number;
    parts: { child_pitch_id: string }[] | null;
  }>;
  const courts: LoaderCourt[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    units: c.parts && c.parts.length ? c.parts.map((p) => p.child_pitch_id) : [c.id],
  }));
  const unitsOf = new Map(courts.map((c) => [c.id, c.units]));
  const loaded = (matchRows ?? []) as unknown as Array<{
    booking_id: string;
    category: string | null;
    booking: { pitch_id: string } | null;
    home: { name: string; group_label: string | null } | null;
    away: { name: string; group_label: string | null } | null;
  }>;
  const loadedBookings = new Set(loaded.map((m) => m.booking_id));
  // What is already on a court keeps it on a re-load unless the owner moves
  // it (plans/cfa-in-the-app.md K1: a re-load is a diff).
  const existing = loaded
    .filter((m) => m.booking && m.home && m.away)
    .map((m) => ({
      category: m.category ?? '',
      home: m.home!.name,
      homeGroup: m.home!.group_label ?? '',
      away: m.away!.name,
      awayGroup: m.away!.group_label ?? '',
      pitchId: m.booking!.pitch_id,
    }));
  const minutes = (iso: string) => {
    const [h, m] = formatTime(iso).split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const busy: Busy[] = ((bookingRows ?? []) as unknown as Array<{
    id: string;
    starts_at: string;
    ends_at: string;
    series_id: string | null;
    pitch: { id: string } | null;
  }>)
    .filter((b) => b.pitch && !b.series_id && !loadedBookings.has(b.id))
    .map((b) => ({
      units: unitsOf.get(b.pitch!.id) ?? [b.pitch!.id],
      start: minutes(b.starts_at),
      end: minutes(b.ends_at) || 24 * 60,
    }));
  const single = rows.find((c) => !c.parts || c.parts.length === 0);

  return (
    <AppShell viewer={viewer}>
      <PageHead
        title={t.cfa.title}
        meta={venue.name}
        actions={
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href={`/calendar/cfa/programme?venue=${venue.id}&day=${day}`} className="btn btn-secondary">
              {t.cfa.programme}
            </Link>
            <Link href={`/calendar?venue=${venue.id}&view=day&day=${day}`} className="btn btn-secondary">
              {t.calendar.title}
            </Link>
          </span>
        }
      />
      <CfaLoader
        venueId={venue.id}
        venueName={venue.name}
        day={day}
        courts={courts}
        busy={busy}
        alreadyLoaded={loadedBookings.size}
        existing={existing}
        teamKeys={((teamRows ?? []) as unknown as Array<{ name: string; category: string | null; group_label: string | null }>).map(
          (r) => teamKey(r.name, r.category ?? '', r.group_label ?? ''),
        )}
        defaultPriceCents={single?.price_per_hour_cents ?? 4000}
      />
    </AppShell>
  );
}
