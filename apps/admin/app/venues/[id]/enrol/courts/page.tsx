import { notFound } from 'next/navigation';

import { CourtsTable } from '@/components/enrol/courts-table';
import { EnrolSteps } from '@/components/enrol/steps';
import { AppShell, Card, PageHead } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { loadEnrolment, stepsDone } from '@/lib/enrol';
import { createClient } from '@/lib/supabase/server';

export default async function EnrolCourtsPage({
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
      <PageHead title="Enrol a venue" meta={`Step 2 of 5 — courts · ${e.venue.name}`} />
      <EnrolSteps venueId={id} current="courts" done={stepsDone(e)} />
      <p className="page-intro">
        Section C of the intake sheet, one row per court — what the app will
        sell. Everything saves together; hours come next.
      </p>
      <Card>
        <CourtsTable venueId={id} saved={e.pitches} />
      </Card>
    </AppShell>
  );
}
