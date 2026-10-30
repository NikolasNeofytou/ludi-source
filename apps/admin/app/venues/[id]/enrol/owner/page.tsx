import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EnrolSteps } from '@/components/enrol/steps';
import { OwnerAccess } from '@/components/owner-access';
import { AppShell, Card, PageHead } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { loadEnrolment, stepsDone } from '@/lib/enrol';
import { createClient } from '@/lib/supabase/server';

// Step 4 is the existing Owner access card, unchanged: the invite creates
// the account and the grant in one step (ADR-0024, 41n). The page around
// it only says what to read back and where to go next.
export default async function EnrolOwnerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireAdmin();
  const supabase = await createClient();
  const e = await loadEnrolment(supabase, id);
  if (!e) notFound();
  const done = stepsDone(e);

  return (
    <AppShell viewer={viewer}>
      <PageHead title="Enrol a venue" meta={`Step 4 of 5 — the owner · ${e.venue.name}`} />
      <EnrolSteps venueId={id} current="owner" done={done} />
      <p className="page-intro">
        Section B of the intake sheet. Read the email back to them before
        you send — the link is the account. They open it on their own
        phone; that first tap is the proof.
      </p>
      <Card>
        <OwnerAccess venueId={id} owners={e.owners} />
      </Card>
      <div className="filters-actions" style={{ marginTop: 16 }}>
        <Link
          href={`/venues/${id}/enrol/review`}
          className={done.owner ? 'btn btn-primary' : 'btn btn-secondary'}
        >
          {done.owner ? 'Continue to review' : 'Review without an owner'}
        </Link>
      </div>
    </AppShell>
  );
}
