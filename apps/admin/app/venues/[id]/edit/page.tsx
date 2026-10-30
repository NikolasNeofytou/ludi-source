import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OwnerAccess, type OwnerRow } from '@/components/owner-access';
import { AppShell, Card, PageHead } from '@/components/ui';
import { CameraAdmin, type CameraRow } from '@/components/camera-admin';
import { VenueLinkCard } from '@/components/venue-link-card';
import { connectWhatsAppNumber } from '@/lib/desk-actions';
import { setFillEnabled } from '@/lib/fill-actions';
import { VenueForm, type CityRef } from '@/components/venue-form';
import { updateVenue } from '@/lib/actions';
import { canManageMoney, requireVenueAccess } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import { createClient } from '@/lib/supabase/server';

// Editing a venue is open to its owner — the commercial block inside the
// form is what stays with the Ludi team.
export default async function EditVenuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale);

  // Not just a nicety over RLS: `venues` is publicly readable when active,
  // so without this an owner could load the edit form for someone else's
  // venue and only discover it was refused on submit.
  if (!viewer.isAdmin && !viewer.venues.some((v) => v.id === id)) notFound();

  const supabase = await createClient();
  const [{ data: venue, error }, { data: privateRow, error: privateError }] =
    await Promise.all([
      supabase
        .from('venues')
        .select(
          // lat/lng are PostgREST computed columns (migration 20260822000004).
          // Selecting `coords` directly returns hex EWKB, which is unusable as
          // a number input's default value.
          'id, name, address, lat, lng, city_id, cancellation_policy, is_active, stripe_account_status, slug',
        )
        .eq('id', id)
        .maybeSingle(),
      // Contacts and the take rate are not readable off `venues` (migration
      // 20260913000005); the view returns this venue's row to its owners,
      // managers and admins only.
      supabase
        .from('v_venue_private')
        .select('contact_phone, contact_email, take_rate_bps')
        .eq('venue_id', id)
        .maybeSingle<{
          contact_phone: string | null;
          contact_email: string | null;
          take_rate_bps: number | null;
        }>(),
    ]);
  if (error) throw new Error(`edit venue: load failed: ${error.message}`);
  if (privateError) {
    throw new Error(`edit venue: private load failed: ${privateError.message}`);
  }
  if (!venue) notFound();

  let cities: CityRef[] = [];
  let owners: OwnerRow[] = [];
  let fillOn: { enabled_at: string } | null = null;
  let waNumber: { phone_number_id: string; display_phone: string } | null = null;
  let courts: { id: string; name: string }[] = [];
  let cameras: CameraRow[] = [];
  if (viewer.isAdmin) {
    // Court cameras (ADR-0042): the venue's courts and their cameras.
    const { data: courtRows } = await supabase
      .from('pitches')
      .select('id, name')
      .eq('venue_id', id)
      .order('name', { ascending: true });
    courts = (courtRows ?? []) as { id: string; name: string }[];
    if (courts.length) {
      const { data: camRows } = await supabase
        .from('v_court_cameras')
        .select('id, pitch_id, device_ref, health, last_seen_at')
        .is('retired_at', null)
        .in('pitch_id', courts.map((c) => c.id));
      cameras = (camRows ?? []).map((c) => ({
        ...(c as Omit<CameraRow, 'pitch_name'>),
        pitch_name: courts.find((p) => p.id === c.pitch_id)?.name ?? '',
      }));
    }
    const { data: wa } = await supabase
      .from('venue_whatsapp_numbers')
      .select('phone_number_id, display_phone')
      .eq('venue_id', id)
      .maybeSingle<{ phone_number_id: string; display_phone: string }>();
    waNumber = wa;
    const { data: fill } = await supabase
      .from('venue_fill_enabled')
      .select('enabled_at')
      .eq('venue_id', id)
      .maybeSingle<{ enabled_at: string }>();
    fillOn = fill;

    const { data } = await supabase
      .from('cities')
      .select('id, name_en')
      .order('name_en', { ascending: true });
    cities = (data ?? []) as CityRef[];

    // Who can sign into this venue's dashboard. RPC rather than a join
    // because the identifying phone lives only in auth.users — see
    // migration 20260827000001. Admin-gated inside the function.
    const { data: ownerRows, error: ownersError } = await supabase.rpc(
      'admin_list_venue_owners',
      { p_venue_id: id },
    );
    if (ownersError) {
      throw new Error(`edit venue: owner list failed: ${ownersError.message}`);
    }
    owners = (ownerRows ?? []) as OwnerRow[];
  }

  return (
    <AppShell viewer={viewer}>
      <PageHead title={t.venue.editTitle} meta={venue.name} />
      {viewer.isAdmin ? null : (
        <p className="page-intro">
          {t.venue.ownerIntro}
          {/* Payouts are self-serve since 41m — the owner runs Stripe
              onboarding from Today's checklist. A manager can't (see
              canManageMoney), so they are pointed at the owner instead. */}
          {venue.stripe_account_status === 'active' ? (
            t.venue.payoutsActive
          ) : canManageMoney(viewer, venue.id) ? (
            <>
              {t.venue.payoutsFromChecklistBefore}
              <Link href="/">{t.venue.payoutsFromChecklistLink}</Link>
              {t.venue.payoutsFromChecklistAfter}
            </>
          ) : (
            t.venue.payoutsByOwner
          )}
        </p>
      )}
      {!viewer.isAdmin && venue.slug ? (
        <VenueLinkCard slug={venue.slug} venueName={venue.name} locale={viewer.locale} />
      ) : null}
      <Card>
        <VenueForm
          action={updateVenue}
          submitLabel={t.venue.save}
          isAdmin={viewer.isAdmin}
          cities={cities}
          defaults={{
            id: venue.id,
            name: venue.name ?? '',
            address: venue.address ?? '',
            contact_phone: privateRow?.contact_phone ?? '',
            contact_email: privateRow?.contact_email ?? '',
            lat: venue.lat == null ? '' : String(venue.lat),
            lng: venue.lng == null ? '' : String(venue.lng),
            city_id: venue.city_id ?? '',
            // This object is serialised into the page for the client form,
            // so an owner's copy must not carry the take rate at all — not
            // rendering the field is not enough.
            take_rate_bps: viewer.isAdmin
              ? String(privateRow?.take_rate_bps ?? 1000)
              : '',
            cancellation_policy: venue.cancellation_policy ?? 'standard',
            is_active: Boolean(venue.is_active),
            slug: viewer.isAdmin ? (venue.slug ?? '') : '',
          }}
        />
      </Card>
      {viewer.isAdmin ? (
        <>
          <PageHead title="Owner access" meta="Who can sign into this venue's dashboard" />
          <Card>
            <OwnerAccess venueId={venue.id} owners={owners} />
          </Card>
          {/* Fill the hour (ADR-0045). Ludi ranks the venue's contacts for
              the owner only once its Schedule B names that use — switch it
              on after the amended schedule is signed, not before. */}
          <PageHead
            title="Fill the hour"
            meta={fillOn ? `On since ${new Date(fillOn.enabled_at).toLocaleDateString('en-GB')}` : 'Off'}
          />
          <Card>
            <form action={setFillEnabled} className="stack">
              <input type="hidden" name="venue_id" value={venue.id} />
              <input type="hidden" name="on" value={fillOn ? 'off' : 'on'} />
              <p className="fill-muted">
                The owner offers an empty hour to the regulars who played it before, each one a
                WhatsApp from his own phone. Switch on only once the venue&apos;s signed Schedule B
                names this use (paragraph B.2).
              </p>
              <div className="filters-actions">
                <button type="submit" className={fillOn ? 'btn btn-secondary' : 'btn btn-primary'}>
                  {fillOn ? 'Switch off' : 'Switch on'}
                </button>
              </div>
            </form>
          </Card>
          {/* The booking desk (ADR-0046): the venue's WhatsApp Business
              number on the Cloud API. Messages to it land in /requests.
              Connect only once the venue's Schedule B lists Meta as a
              sub-processor; an empty id disconnects. */}
          <PageHead
            title="WhatsApp desk"
            meta={waNumber ? `Connected · ${waNumber.display_phone}` : 'Not connected — pasting still works'}
          />
          <Card>
            <form action={connectWhatsAppNumber} className="stack">
              <input type="hidden" name="venue_id" value={venue.id} />
              <label className="field">
                <span className="field-label">Phone number ID (Meta)</span>
                <input
                  name="phone_number_id"
                  className="input"
                  inputMode="numeric"
                  defaultValue={waNumber?.phone_number_id ?? ''}
                  placeholder="Leave empty to disconnect"
                />
              </label>
              <label className="field">
                <span className="field-label">Number as the owner knows it</span>
                <input name="display_phone" className="input" defaultValue={waNumber?.display_phone ?? ''} placeholder="+357 99 000000" />
              </label>
              <div className="filters-actions">
                <button type="submit" className="btn btn-secondary">
                  Save
                </button>
              </div>
            </form>
          </Card>
          {/* Court cameras (ADR-0042). A court with a camera offers players
              the recording switch; register one only once it is mounted,
              the sign is up, and counsel has answered (plans/court-cameras.md). */}
          <PageHead
            title="Court cameras"
            meta={cameras.length ? `${cameras.length} on ${courts.length} courts` : 'None'}
          />
          <Card>
            <CameraAdmin venueId={venue.id} cameras={cameras} courts={courts} />
          </Card>
        </>
      ) : null}
    </AppShell>
  );
}
