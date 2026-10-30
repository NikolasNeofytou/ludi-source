import { redirect } from 'next/navigation';

import { InviteManagerForm } from '@/components/invite-manager-form';
import { VenuePeople, type PersonRow } from '@/components/venue-people';
import { AppShell, Card, EmptyState, PageHead } from '@/components/ui';
import { requireVenueAccess } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import { createClient } from '@/lib/supabase/server';

// Access — who can sign into this venue, and adding someone who can
// (plans/venue-staff.md, slices A, B and C). Until this page existed,
// venue_owners_select_self_or_admin let an owner read his own membership
// row and nothing else, so the answer to "who else has a key to my
// venue" lived only with the founder — and so did the key itself.
//
// Owner-only, and only for the venues where the viewer is the `owner`:
//   * a manager runs the venue's day (data-model.md: "everything an owner
//     does except the venue's money") and does not decide who holds a key;
//   * an admin has /venues/[id]/edit, which lists the same people and can
//     also make an OWNER — this page would otherwise mean "every venue on
//     the platform", which is not what it is for.
// Every refusal is enforced below this page — inside venue_people() and
// revoke_venue_person(), and inside invite-venue-owner for the grant.
// What happens here is routing, per ADR-0019.

export default async function AccessPage() {
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale);

  if (viewer.isAdmin) redirect('/venues');
  const owned = viewer.venues.filter((v) => v.role === 'owner');
  if (owned.length === 0) redirect('/');

  const supabase = await createClient();
  const results = await Promise.all(
    owned.map(async (venue) => {
      const { data, error } = await supabase.rpc('venue_people', {
        p_venue_id: venue.id,
      });
      if (error) {
        throw new Error(`access: venue_people(${venue.id}) failed: ${error.message}`);
      }
      return { venue, people: (data ?? []) as PersonRow[] };
    }),
  );

  const total = results.reduce((n, r) => n + r.people.length, 0);

  return (
    <AppShell viewer={viewer}>
      <PageHead title={t.access.title} meta={t.access.people(total)} />
      <p className="page-intro">{t.access.intro}</p>

      <div className="stack">
        {results.map(({ venue, people }) => (
          <Card key={venue.id}>
            {owned.length > 1 ? (
              <p className="form-section">{venue.name}</p>
            ) : null}
            {people.length === 0 ? (
              // Not reachable while the viewer is himself on the list, but
              // a venue whose last grant went elsewhere should say so
              // rather than render an empty table.
              <EmptyState>{t.access.empty}</EmptyState>
            ) : (
              <VenuePeople
                venueId={venue.id}
                people={people}
                viewerId={viewer.user.id}
              />
            )}
          </Card>
        ))}

        {/* One form per venue rather than a venue picker: an owner with two
            venues is adding someone to one of them, and picking the wrong
            row from a dropdown is a key handed to the wrong building. */}
        {results.map(({ venue }) => (
          <Card key={`invite-${venue.id}`}>
            {owned.length > 1 ? (
              <p className="form-section">{venue.name}</p>
            ) : null}
            <InviteManagerForm venueId={venue.id} />
          </Card>
        ))}

        {/* The one thing this page cannot do, said once rather than only
            when he tries it. */}
        <p className="field-hint">{t.access.addSomeone}</p>
      </div>
    </AppShell>
  );
}
