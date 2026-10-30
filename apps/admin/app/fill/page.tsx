import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AppShell, Card, PageHead } from '@/components/ui';
import { FillStartForm } from '@/components/fill-start-form';
import { requireVenueAccess } from '@/lib/auth';
import { getCopy, intlTag } from '@/lib/copy';
import { formatEur, venueWallClockToIso } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

// Fill the hour, step one (plans/fill-the-hour.md, ADR-0045): the empty hour
// the owner tapped on the Calendar, and the price he wants to offer it at.
// Nothing is written until he asks to see his regulars — opening the page
// is not an offer.
//
// Owner-only, like the contact list it reads (ADR-0041). An admin is sent
// to /venues: Ludi is the processor of these lists and does not browse them.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

type SearchParams = { pitch?: string; date?: string; time?: string; duration?: string };

export default async function FillStartPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale);
  const f = t.fill;
  if (viewer.isAdmin) redirect('/venues');

  const params = await searchParams;
  if (!params.pitch || !DATE.test(params.date ?? '') || !TIME.test(params.time ?? '')) notFound();
  const duration = Math.min(240, Math.max(30, Number(params.duration) || 60));

  const supabase = await createClient();
  const { data: pitch } = await supabase
    .from('pitches')
    .select('id, name, price_per_hour_cents, venue_id, venue:venues ( name )')
    .eq('id', params.pitch)
    .maybeSingle<{
      id: string;
      name: string;
      price_per_hour_cents: number;
      venue_id: string;
      venue: { name: string } | null;
    }>();
  if (!pitch) notFound();

  const owns = viewer.venues.some((v) => v.id === pitch.venue_id && v.role === 'owner');
  const { data: enabled } = await supabase
    .from('venue_fill_enabled')
    .select('venue_id')
    .eq('venue_id', pitch.venue_id)
    .maybeSingle();

  const startsAt = venueWallClockToIso(params.date!, params.time!);
  const endsAt = new Date(Date.parse(startsAt) + duration * 60_000).toISOString();
  const started = Date.parse(startsAt) <= Date.now();
  const usual = Math.round((pitch.price_per_hour_cents * duration) / 60);
  const when = new Intl.DateTimeFormat(intlTag(viewer.locale), {
    timeZone: 'Europe/Nicosia',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(startsAt));

  return (
    <AppShell viewer={viewer}>
      <PageHead title={f.title} meta={pitch.venue?.name} />
      <p className="page-intro">{f.intro}</p>
      <div className="stack">
        <Card>
          <div className="fill-slot">
            <strong>{f.slot(pitch.name, when)}</strong>
            <span className="fill-muted">{f.usualPrice(formatEur(usual, viewer.locale))}</span>
          </div>
        </Card>
        <Card>
          {!owns ? (
            <p>{f.notOwner}</p>
          ) : !enabled ? (
            <p>{f.notEnabled}</p>
          ) : started ? (
            <p>{f.gone}</p>
          ) : (
            <FillStartForm pitchId={pitch.id} startsAt={startsAt} endsAt={endsAt} />
          )}
        </Card>
        <p>
          <Link href={`/calendar?date=${params.date}`} className="fill-quiet">
            {f.backToCalendar}
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
