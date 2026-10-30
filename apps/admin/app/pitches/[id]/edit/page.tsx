import { notFound, redirect } from 'next/navigation';

import { AppShell, Badge, Card, PageHead } from '@/components/ui';
import { PitchForm } from '@/components/pitch-form';
import { updatePitch } from '@/lib/actions';
import { loadComponents, loadLeafOptions } from '@/lib/components';
import { ownsAnyVenue, requireVenueAccess } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import { createClient } from '@/lib/supabase/server';

export default async function EditPitchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireVenueAccess();
  // Owner-only (ADR-0041): what a court is and costs is not the shift's
  // to change. The pitches INSERT/UPDATE policies are the gate; this
  // stops a manager reaching a form whose save would be refused.
  if (!viewer.isAdmin && !ownsAnyVenue(viewer)) redirect('/pitches');
  const t = getCopy(viewer.locale);

  const supabase = await createClient();
  const { data: pitch, error } = await supabase
    .from('pitches')
    .select(
      'id, venue_id, name, type, surface, price_per_hour_cents, amenities, is_verified, is_active',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`edit pitch: load failed: ${error.message}`);
  if (!pitch) notFound();

  // `pitches` is publicly readable when bookable, so the row loading is not
  // evidence the caller may edit it. Same check the action repeats.
  if (!viewer.isAdmin && !viewer.venues.some((v) => v.id === pitch.venue_id)) {
    notFound();
  }

  const [leaves, components] = await Promise.all([
    loadLeafOptions(supabase, pitch.venue_id, pitch.id),
    loadComponents(supabase, pitch.id),
  ]);

  return (
    <AppShell viewer={viewer}>
      <PageHead
        title={t.pitches.editTitle}
        meta={
          <>
            <Badge tone={pitch.is_verified ? 'good' : 'warn'}>
              {pitch.is_verified ? t.pitch.verified : t.pitch.unverified}
            </Badge>{' '}
            <Badge tone={pitch.is_active ? 'info' : 'alert'}>
              {pitch.is_active ? t.pitch.active : t.pitch.inactive}
            </Badge>
          </>
        }
      />
      <p className="page-intro">{t.pitches.editIntro}</p>
      <Card>
        <PitchForm
          action={updatePitch}
          submitLabel={t.pitches.save}
          venues={viewer.venues}
          lockVenue
          leaves={leaves}
          defaults={{
            id: pitch.id,
            venue_id: pitch.venue_id,
            name: pitch.name ?? '',
            type: pitch.type ?? '5-a-side',
            surface: pitch.surface ?? 'turf',
            price_per_hour_eur: (
              (pitch.price_per_hour_cents ?? 0) / 100
            ).toFixed(2),
            amenities: (pitch.amenities ?? []).join(', '),
            components,
          }}
        />
      </Card>
    </AppShell>
  );
}
