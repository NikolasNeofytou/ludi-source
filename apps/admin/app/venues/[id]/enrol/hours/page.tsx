import Link from 'next/link';
import { notFound } from 'next/navigation';

import { HoursGrid } from '@/components/enrol/hours-grid';
import { EnrolSteps } from '@/components/enrol/steps';
import { AppShell, Card, EmptyState, PageHead } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { loadEnrolment, stepsDone } from '@/lib/enrol';
import { createClient } from '@/lib/supabase/server';

export default async function EnrolHoursPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const e = await loadEnrolment(supabase, id);
  if (!e) notFound();

  return (
    <AppShell viewer={viewer}>
      <PageHead title="Enrol a venue" meta={`Step 3 of 5 — hours · ${e.venue.name}`} />
      <EnrolSteps venueId={id} current="hours" done={stepsDone(e)} />
      <p className="page-intro">
        The venue&rsquo;s week, once, for every court. Players can book any
        free slot inside these hours.
      </p>
      {e.pitches.length === 0 ? (
        <EmptyState>
          No courts yet — <Link href={`/venues/${id}/enrol/courts`}>add them first</Link>.
        </EmptyState>
      ) : (
        <Card>
          <HoursGrid
            venueId={id}
            courts={e.pitches.map((p) => ({ id: p.id, name: p.name, windows: p.windows }))}
          />
        </Card>
      )}
    </AppShell>
  );
}
