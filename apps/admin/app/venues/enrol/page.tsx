import { EnrolSteps } from '@/components/enrol/steps';
import { AppShell, Card, PageHead } from '@/components/ui';
import { VenueForm, type CityRef } from '@/components/venue-form';
import { requireAdmin } from '@/lib/auth';
import { enrolVenue } from '@/lib/enrol-actions';
import { createClient } from '@/lib/supabase/server';

// Step 1 of the counter flow (plans/venue-enrol.md). Creates the venue
// inactive and moves on to its courts; the inactive row is the draft
// (ADR-0031).
export default async function EnrolVenuePage() {
  const viewer = await requireAdmin();
  const supabase = await createClient();

  const { data: cities, error } = await supabase
    .from('cities')
    .select('id, name_en')
    .order('name_en', { ascending: true });
  if (error) throw new Error(`enrol: city list failed: ${error.message}`);

  return (
    <AppShell viewer={viewer}>
      <PageHead title="Enrol a venue" meta="Step 1 of 5 — the venue" />
      <EnrolSteps venueId={null} current="venue" done={{}} />
      <p className="page-intro">
        Section A of the intake sheet. The venue stays hidden from players
        until you publish it at the end, so nothing here is visible yet. If
        you are standing at the venue, <strong>Use my location</strong> puts
        the pin where you are.
      </p>
      <Card>
        <VenueForm
          action={enrolVenue}
          submitLabel="Save and add courts"
          isAdmin
          mode="enrol"
          cities={(cities ?? []) as CityRef[]}
          defaults={{
            name: '',
            address: '',
            contact_phone: '',
            contact_email: '',
            lat: '',
            lng: '',
            city_id: '',
            take_rate_bps: '1000',
            cancellation_policy: 'standard',
            is_active: false,
            slug: '',
          }}
        />
      </Card>
    </AppShell>
  );
}
