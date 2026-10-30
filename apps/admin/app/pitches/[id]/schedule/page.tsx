import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  Overrides,
  WeeklySchedule,
  type Override,
  type Window,
} from '@/components/schedule-editor';
import { AppShell, PageHead } from '@/components/ui';
import { requireVenueAccess } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import { venueToday } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale);

  const supabase = await createClient();
  const { data: pitch, error } = await supabase
    .from('pitches')
    .select('id, name, venue_id, venue:venues!inner ( name )')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`schedule: pitch load failed: ${error.message}`);
  if (!pitch) notFound();

  // `pitches` is publicly readable when bookable, so loading the row is not
  // evidence the caller may edit its schedule.
  if (!viewer.isAdmin && !viewer.venues.some((v) => v.id === pitch.venue_id)) {
    notFound();
  }

  // Nicosia's date, not the server's UTC one: for the first two or three
  // hours of every Cyprus day UTC still says yesterday, so yesterday's
  // exceptions lingered and the date picker's minimum lagged a day.
  const today = venueToday();

  const [{ data: windows }, { data: overrides }] = await Promise.all([
    supabase
      .from('pitch_schedules')
      .select('id, day_of_week, opens_at, closes_at, slot_duration_minutes')
      .eq('pitch_id', id)
      .order('day_of_week')
      .order('opens_at'),
    supabase
      .from('pitch_schedule_overrides')
      .select('id, override_date, is_closed, opens_at, closes_at, reason')
      .eq('pitch_id', id)
      // Past exceptions are noise — they cannot be acted on and they push
      // the ones that matter off the screen.
      .gte('override_date', today)
      .order('override_date')
      .order('opens_at'),
  ]);

  const venueName =
    (pitch.venue as unknown as { name: string } | null)?.name ?? '—';

  return (
    <AppShell viewer={viewer}>
      <PageHead
        title={t.schedule.title}
        meta={`${pitch.name} · ${venueName}`}
        actions={
          <Link href="/pitches" className="btn btn-secondary">
            {t.schedule.backToPitches}
          </Link>
        }
      />
      {/* An exception REPLACES its date's weekly hours — that is how
          get_available_slots resolves it. "Hours minus exceptions" read as
          if special hours were added on top, so an owner opening early for
          a tournament lost the evening without knowing. */}
      <p className="page-intro">{t.schedule.intro}</p>

      <div className="stack">
        <WeeklySchedule pitchId={id} windows={(windows ?? []) as Window[]} />
        <h2 className="page-title" style={{ fontSize: 22, marginTop: 8 }}>
          {t.schedule.exceptions}
        </h2>
        <Overrides
          pitchId={id}
          today={today}
          windows={(windows ?? []) as Window[]}
          overrides={(overrides ?? []) as Override[]}
        />
      </div>
    </AppShell>
  );
}
