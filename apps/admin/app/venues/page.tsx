
import {
  VenueConnectButton,
  type VenueStripeStatus,
} from '@/components/venue-connect-modal';
import Link from 'next/link';

import {
  AppShell,
  Badge,
  Card,
  EmptyState,
  PageHead,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

type VenueRow = {
  id: string;
  name: string;
  stripe_account_status: VenueStripeStatus;
  is_active: boolean;
  city: { name_en: string } | null;
};

type PrivateRow = {
  venue_id: string;
  stripe_account_id: string | null;
  take_rate_bps: number | null;
};

export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const viewer = await requireAdmin();
  const { created } = await searchParams;

  const supabase = await createClient();

  // The take rate and Stripe account id are not readable off `venues`
  // (migration 20260913000005) — they come from v_venue_private, which
  // returns every row to an admin. Joined here by id rather than embedded.
  const [{ data, error }, { data: privateData, error: privateError }] =
    await Promise.all([
      supabase
        .from('venues')
        .select(
          `
          id, name, stripe_account_status, is_active,
          city:cities ( name_en )
        `,
        )
        .order('name', { ascending: true }),
      supabase
        .from('v_venue_private')
        .select('venue_id, stripe_account_id, take_rate_bps'),
    ]);
  if (error) {
    throw new Error(`venues: list failed: ${error.message}`);
  }
  if (privateError) {
    throw new Error(`venues: private list failed: ${privateError.message}`);
  }

  const venues = (data ?? []) as unknown as VenueRow[];
  const privateById = new Map(
    ((privateData ?? []) as PrivateRow[]).map((p) => [p.venue_id, p]),
  );
  const total = venues.length;
  const createdVenue = created ? venues.find((v) => v.id === created) : undefined;

  return (
    <AppShell viewer={viewer}>
      <PageHead
        title="Venues"
        meta={`${total.toLocaleString()} total`}
        actions={
          <Link href="/venues/enrol" className="btn btn-primary">
            Enrol a venue
          </Link>
        }
      />

      <p className="page-intro">
        Venues take payment through Stripe Connect. A venue must reach{' '}
        <strong>active</strong> before its pitches can be verified and booked.
        Use “Onboard with Stripe” to create the connected account and hand the
        owner a hosted KYC link.
      </p>

      {createdVenue ? (
        <p role="status" className="form-ok" style={{ marginBottom: 16 }}>
          <strong>{createdVenue.name}</strong> is published. What is still
          owed, and by whom, is on its{' '}
          <Link href={`/venues/${createdVenue.id}/enrol/review`}>review page</Link>.
        </p>
      ) : null}

      {venues.length === 0 ? (
        <EmptyState>No venues yet.</EmptyState>
      ) : (
        <Card pad={false}>
          <Table
            head={
              <>
                <Th>Venue</Th>
                <Th>City</Th>
                <Th numeric>Take rate</Th>
                <Th>Stripe status</Th>
                <Th numeric>Connect</Th>
              </>
            }
          >
            {venues.map((v) => {
              const priv = privateById.get(v.id);
              return (
                <tr key={v.id}>
                  <Td label="Venue">
                    <strong>{v.name}</strong>
                    {!v.is_active && (
                      <span
                        style={{
                          color: 'var(--ludi-ink3)',
                          fontSize: 12,
                          marginLeft: 6,
                        }}
                      >
                        (inactive)
                      </span>
                    )}
                  </Td>
                  <Td label="City">{v.city?.name_en ?? '—'}</Td>
                  <Td label="Take rate" numeric>
                    {priv?.take_rate_bps == null ? '—' : formatBps(priv.take_rate_bps)}
                  </Td>
                  <Td label="Stripe">
                    <StatusBadge status={v.stripe_account_status} />
                    {priv?.stripe_account_id && (
                      <span
                        className="mono"
                        style={{
                          display: 'block',
                          color: 'var(--ludi-ink3)',
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        {priv.stripe_account_id}
                      </span>
                    )}
                  </Td>
                  <Td label="" numeric>
                    <Link
                      href={
                        v.is_active ? `/venues/${v.id}/edit` : `/venues/${v.id}/enrol/review`
                      }
                      className="btn btn-secondary"
                      style={{ marginRight: 6 }}
                    >
                      {v.is_active ? 'Edit' : 'Continue enrolment'}
                    </Link>
                    {v.is_active ? (
                      <Link
                        href={`/venues/${v.id}/enrol/review`}
                        className="btn btn-secondary"
                        style={{ marginRight: 6 }}
                        title="What is still owed, and by whom — verify courts from here"
                      >
                        Review
                      </Link>
                    ) : null}
                    <VenueConnectButton
                      venueId={v.id}
                      venueName={v.name}
                      status={v.stripe_account_status}
                      hasAccount={Boolean(priv?.stripe_account_id)}
                    />
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
    </AppShell>
  );
}

const STATUS_TONE: Record<VenueStripeStatus, 'good' | 'warn' | 'alert' | 'neutral'> = {
  active: 'good',
  pending: 'warn',
  restricted: 'alert',
  disabled: 'neutral',
};

function StatusBadge({ status }: { status: VenueStripeStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? 'warn'}>{status}</Badge>;
}

// 1000 bps = 10%. Drop the decimal for whole percentages.
function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}
