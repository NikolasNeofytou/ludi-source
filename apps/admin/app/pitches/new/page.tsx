import { redirect } from 'next/navigation';

import { AppShell, Card, EmptyState, PageHead } from '@/components/ui';
import { PitchForm } from '@/components/pitch-form';
import { createPitch } from '@/lib/actions';
import { ownsAnyVenue, requireVenueAccess } from '@/lib/auth';
import { getCopy } from '@/lib/copy';

export default async function NewPitchPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string }>;
}) {
  const viewer = await requireVenueAccess();
  // Owner-only (ADR-0041): what a court is and costs is not the shift's
  // to change. The pitches INSERT/UPDATE policies are the gate; this
  // stops a manager reaching a form whose save would be refused.
  if (!viewer.isAdmin && !ownsAnyVenue(viewer)) redirect('/pitches');
  const { venue } = await searchParams;
  const t = getCopy(viewer.locale);

  // Never pre-pick a venue for someone who sees more than one. The first
  // venue in the list was Camares for every admin, on a form about to
  // receive another venue's court. `?venue=` carries an explicit choice.
  const preset = venue && viewer.venues.some((v) => v.id === venue) ? venue : '';
  const defaultVenueId = viewer.venues.length === 1 ? viewer.venues[0]!.id : preset;

  // An admin with no venues yet has nowhere to put a pitch. Say so rather
  // than render a form whose only dropdown is empty.
  if (viewer.venues.length === 0) {
    return (
      <AppShell viewer={viewer}>
        <PageHead title={t.pitches.newTitle} />
        <EmptyState>{t.pitches.needVenueFirst}</EmptyState>
      </AppShell>
    );
  }

  return (
    <AppShell viewer={viewer}>
      <PageHead title={t.pitches.newTitle} />
      <p className="page-intro">
        {t.pitches.newIntroBefore}
        <strong>{t.pitches.newIntroEm}</strong>
        {t.pitches.newIntroAfter}
      </p>
      <Card>
        <PitchForm
          action={createPitch}
          submitLabel={t.pitches.create}
          venues={viewer.venues}
          defaults={{
            venue_id: defaultVenueId,
            name: '',
            type: '5-a-side',
            surface: 'turf',
            price_per_hour_eur: '',
            amenities: '',
          }}
        />
      </Card>
    </AppShell>
  );
}
