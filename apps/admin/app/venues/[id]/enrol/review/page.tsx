import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EnableCityForm } from '@/components/enrol/enable-city-form';
import { PublishForm } from '@/components/enrol/publish-form';
import { EnrolSteps } from '@/components/enrol/steps';
import { VerifyAll } from '@/components/enrol/verify-all';
import { AppShell, Badge, Card, PageHead } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { loadEnrolment, stepsDone, type Enrolment } from '@/lib/enrol';
import { formatEur } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

// Step 5: everything on one screen, and what is still owed by whom. The
// flow cannot end at "bookable" — the verify guard holds every court
// unverified until the venue's Stripe account is active — so it ends at
// "published, awaiting payments" and says exactly that.
export default async function EnrolReviewPage({
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
  const outstanding = outstandingItems(e);
  const unverified = e.pitches.filter((p) => !p.is_verified);
  // Mounted whenever payments are active, even with nothing left to verify:
  // the component keeps its outcome across the refresh that follows a run,
  // so a refused court stays on screen after the others turn verified.
  const canVerify = e.venue.stripe_account_status === 'active' && e.pitches.length > 0;

  return (
    <AppShell viewer={viewer}>
      <PageHead title="Enrol a venue" meta={`Step 5 of 5 — review · ${e.venue.name}`} />
      <EnrolSteps venueId={id} current="review" done={done} />

      <div className="stack">
        <Card>
          <p className="form-section">Venue</p>
          <dl className="review-list">
            <dt>Name</dt>
            <dd>{e.venue.name}</dd>
            <dt>Address</dt>
            <dd>{e.venue.address}</dd>
            <dt>City</dt>
            <dd>
              {e.venue.city?.name_en ?? '—'}{' '}
              {e.venue.city && !e.venue.city.is_enabled ? (
                <Badge tone="warn">not enabled for players</Badge>
              ) : null}
            </dd>
            <dt>Public contact</dt>
            <dd>
              {e.contact.contact_phone ?? '—'} · {e.contact.contact_email ?? '—'}
            </dd>
            <dt>Pin</dt>
            <dd className="mono">
              {e.venue.lat == null || e.venue.lng == null
                ? '—'
                : `${e.venue.lat.toFixed(5)}, ${e.venue.lng.toFixed(5)}`}
            </dd>
            <dt>Commission</dt>
            <dd>
              {e.contact.take_rate_bps == null ? '—' : `${e.contact.take_rate_bps / 100}%`} on app
              bookings · none on walk-ins
            </dd>
            <dt>Cancellation</dt>
            <dd>{e.venue.cancellation_policy}</dd>
          </dl>
          <p className="field-hint">
            <Link href={`/venues/${id}/edit`}>Edit the venue</Link>
          </p>
        </Card>

        <Card>
          <p className="form-section">Courts and hours</p>
          {e.pitches.length === 0 ? (
            <p className="page-intro" style={{ margin: 0 }}>
              No courts. <Link href={`/venues/${id}/enrol/courts`}>Add them</Link>.
            </p>
          ) : (
            <ul className="enrol-saved">
              {e.pitches.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong>
                  <span>
                    {p.type} · {p.surface} · {formatEur(p.price_per_hour_cents)}/h ·{' '}
                    {p.made_of.length ? `made of ${p.made_of.join(' + ')} · ` : ''}
                    {p.windows === 0 ? (
                      <Badge tone="warn">no hours</Badge>
                    ) : (
                      `${p.windows} ${p.windows === 1 ? 'window' : 'windows'}`
                    )}
                    {' · '}
                    <Badge tone={p.is_verified ? 'good' : 'neutral'}>
                      {p.is_verified ? 'verified' : 'unverified'}
                    </Badge>
                  </span>
                  <Link href={`/pitches/${p.id}/schedule`}>Hours</Link>
                </li>
              ))}
            </ul>
          )}
          {canVerify ? (
            <div style={{ marginTop: 16 }}>
              <VerifyAll
                courts={unverified.map((p) => ({ id: p.id, name: p.name }))}
                venueName={e.venue.name}
              />
            </div>
          ) : null}
        </Card>

        <Card>
          <p className="form-section">Owner</p>
          {e.owners.length === 0 ? (
            <p className="page-intro" style={{ margin: 0 }}>
              Nobody can sign in yet.{' '}
              <Link href={`/venues/${id}/enrol/owner`}>Invite the owner</Link>.
            </p>
          ) : (
            <ul className="enrol-saved">
              {e.owners.map((o) => {
                const name = `${o.first_name} ${o.last_name}`.trim();
                return (
                  <li key={o.user_id}>
                    <strong>{name || o.email || '—'}</strong>
                    <span>
                      {o.email ?? (o.phone ? `+${o.phone}` : '—')} · {o.owner_role} ·{' '}
                      {o.last_sign_in_at ? (
                        <Badge tone="good">signed in</Badge>
                      ) : (
                        <Badge tone="warn">invite pending</Badge>
                      )}
                    </span>
                    <Link href={`/venues/${id}/enrol/owner`}>Access</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <p className="form-section">Still to do — and by whom</p>
          <ul className="review-todo">
            {outstanding.map((item) => (
              <li key={item.text}>
                <Badge tone={item.who === 'owner' ? 'info' : item.who === 'founder' ? 'warn' : 'neutral'}>
                  {item.who}
                </Badge>{' '}
                {item.text}
                {item.key === 'city' && e.venue.city ? (
                  <div style={{ marginTop: 8 }}>
                    <EnableCityForm
                      venueId={id}
                      cityId={e.venue.city.id}
                      cityName={e.venue.city.name_en}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 16 }}>
            <PublishForm venueId={id} published={e.venue.is_active} />
          </div>
          <p className="field-hint" style={{ marginTop: 8 }}>
            Publishing makes the venue visible to players in an enabled city.
            Courts appear only once verified, and verification waits for the
            owner&rsquo;s Stripe account — so today the venue is published,
            not yet bookable. Say that plainly at the counter.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}

type Todo = { who: 'owner' | 'founder' | 'Ludi'; text: string; key?: 'city' };

function outstandingItems(e: Enrolment): Todo[] {
  const items: Todo[] = [];
  if (e.pitches.length === 0) {
    items.push({ who: 'founder', text: 'Add the courts.' });
  } else if (e.pitches.some((p) => p.windows === 0)) {
    items.push({
      who: 'founder',
      text: `Set hours for ${e.pitches.filter((p) => p.windows === 0).map((p) => p.name).join(', ')}.`,
    });
  }
  if (e.owners.length === 0) {
    items.push({ who: 'founder', text: 'Invite the owner — nobody can sign in.' });
  } else if (e.owners.every((o) => !o.last_sign_in_at)) {
    items.push({
      who: 'owner',
      text: 'Open the invite email and tap Sign in — on their own phone, now.',
    });
  }
  if (e.venue.stripe_account_status !== 'active') {
    items.push({
      who: 'owner',
      text:
        'Set up payments from the checklist on Today (Stripe KYC — a queue of days, so start it today). ' +
        'Until it clears no court can be verified.',
    });
  }
  if (e.pitches.length && e.pitches.some((p) => !p.is_verified)) {
    const n = e.pitches.filter((p) => !p.is_verified).length;
    items.push({
      who: 'Ludi',
      text:
        e.venue.stripe_account_status === 'active'
          ? `Payments are active — verify the ${n === 1 ? 'court' : `${n} courts`} from the Courts card above once the owner has confirmed prices and hours.`
          : 'Verify the courts — from the Courts card above — once payments are active and the owner has confirmed prices and hours.',
    });
  }
  if (e.venue.city && !e.venue.city.is_enabled) {
    items.push({
      who: 'founder',
      key: 'city',
      text: `${e.venue.city.name_en} is not enabled for players — the app filters on it. Your call:`,
    });
  }
  if (!e.venue.is_active) {
    items.push({ who: 'founder', text: 'Publish the venue (below).' });
  }
  if (items.length === 0) {
    items.push({ who: 'Ludi', text: 'Nothing. Hang the print.' });
  }
  return items;
}
