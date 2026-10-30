import Link from 'next/link';

import { PitchToggleButton } from '@/components/pitch-toggle-modal';
import {
  AppShell,
  Badge,
  Card,
  EmptyState,
  Field,
  PageHead,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { ownsAnyVenue, requireVenueAccess, scopeToViewer } from '@/lib/auth';
import { getCopy, type AdminCopy } from '@/lib/copy';
import { formatEur } from '@/lib/format';
import { RowId } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

const PAGE_SIZE = 50;

type SearchParams = {
  q?: string;
  status?: 'verified' | 'unverified' | 'inactive' | '';
  venue?: string;
  page?: string;
  // Set by createPitch's redirect — the pitch just added.
  created?: string;
};

type PitchRow = {
  id: string;
  name: string;
  type: string;
  surface: string;
  price_per_hour_cents: number;
  is_verified: boolean;
  is_active: boolean;
  venue: {
    id: string;
    name: string;
    stripe_account_status: string;
  } | null;
};

const STATUS_KEY = {
  '': 'statusAll',
  verified: 'statusVerified',
  unverified: 'statusUnverified',
  inactive: 'statusInactive',
} as const satisfies Record<NonNullable<SearchParams['status']>, keyof AdminCopy['pitches']>;

function buildHref(
  current: SearchParams,
  override: Partial<SearchParams>,
): string {
  // `created` is a one-off banner, not a filter — paging on must drop it.
  const merged: Record<string, string | undefined> = {
    ...current,
    created: undefined,
    ...override,
  };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v) sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `/pitches?${qs}` : '/pitches';
}

export default async function PitchesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requireVenueAccess();
  // A manager reads this page — he has to quote a price at the counter —
  // and changes nothing on it. What a court is and costs is the owner's
  // (ADR-0041), enforced by the pitches INSERT/UPDATE policies; the two
  // affordances below just stop him meeting a refusal.
  const mayEdit = viewer.isAdmin || ownsAnyVenue(viewer);
  const params = await searchParams;
  const scope = scopeToViewer(viewer);
  const t = getCopy(viewer.locale);
  const { locale } = viewer;
  const typeLabel = (type: string) =>
    (t.pitch.types as Record<string, string | undefined>)[type] ?? type;
  const surfaceLabel = (surface: string) =>
    (t.pitch.surfaces as Record<string, string | undefined>)[surface] ?? surface;

  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();

  const venues = viewer.venues;

  let query = supabase
    .from('pitches')
    .select(
      `
      id, name, type, surface, price_per_hour_cents, is_verified, is_active,
      venue:venues!inner ( id, name, stripe_account_status )
    `,
      { count: 'exact' },
    )
    .order('is_active', { ascending: false })
    .order('is_verified', { ascending: false })
    .order('name', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (params.q) query = query.ilike('name', `%${params.q}%`);
  if (params.venue) query = query.eq('venue_id', params.venue);
  // NOT redundant. pitches_select_bookable_or_owner_or_admin has a PUBLIC
  // branch — `is_pitch_bookable(id)` — so RLS alone shows a venue owner
  // every active, verified pitch on the platform. This filter is what
  // actually scopes the page for a non-admin. See ADR-0019.
  if (scope) query = query.in('venue_id', scope);
  if (params.status === 'verified') {
    query = query.eq('is_verified', true).eq('is_active', true);
  } else if (params.status === 'unverified') {
    query = query.eq('is_verified', false).eq('is_active', true);
  } else if (params.status === 'inactive') {
    query = query.eq('is_active', false);
  }

  const { data, count, error } = await query;
  if (error) {
    throw new Error(`pitches: list failed: ${error.message}`);
  }

  const pitches = (data ?? []) as unknown as PitchRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Which listed pitches have at least one weekly window. A pitch without
  // one is invisible to players however verified it is, and nothing else on
  // this page would tell the owner that.
  let scheduled = new Set<string>();
  if (pitches.length) {
    const { data: schedRows, error: schedError } = await supabase
      .from('pitch_schedules')
      .select('pitch_id')
      .in('pitch_id', pitches.map((p) => p.id));
    if (schedError) {
      throw new Error(`pitches: schedule lookup failed: ${schedError.message}`);
    }
    scheduled = new Set((schedRows ?? []).map((s) => s.pitch_id as string));
  }

  // Court cameras (ADR-0042): the owner sees his cameras' health, never
  // footage. RLS scopes the view to his courts.
  const cameraOf = new Map<string, 'online' | 'offline' | 'never'>();
  if (pitches.length) {
    const { data: cams } = await supabase
      .from('v_court_cameras')
      .select('pitch_id, health')
      .is('retired_at', null)
      .in('pitch_id', pitches.map((p) => p.id));
    for (const c of cams ?? []) cameraOf.set(c.pitch_id as string, c.health as 'online' | 'offline' | 'never');
  }

  // What each listed composite is made of, by name (ADR-0032). Members may
  // be on another page of the list, so their names are looked up, not
  // taken from `pitches`.
  const madeOf = new Map<string, string[]>();
  if (pitches.length) {
    const { data: comps } = await supabase
      .from('pitch_components')
      .select('parent_pitch_id, child_pitch_id')
      .in('parent_pitch_id', pitches.map((p) => p.id));
    const childIds = [...new Set((comps ?? []).map((c) => c.child_pitch_id as string))];
    const nameOf = new Map<string, string>();
    if (childIds.length) {
      const { data: kids } = await supabase.from('pitches').select('id, name').in('id', childIds);
      for (const k of kids ?? []) nameOf.set(k.id as string, k.name as string);
    }
    for (const c of comps ?? []) {
      const list = madeOf.get(c.parent_pitch_id as string) ?? [];
      list.push(nameOf.get(c.child_pitch_id as string) ?? '?');
      madeOf.set(c.parent_pitch_id as string, list);
    }
  }

  // The pitch createPitch just redirected here with. Looked up on its own
  // rather than found in `pitches`: it need not be on this page, or match
  // whatever filter is applied. Scoped like the list, for the same reason.
  let createdPitch: { id: string; name: string } | null = null;
  if (params.created && RowId.safeParse(params.created).success) {
    let createdQuery = supabase
      .from('pitches')
      .select('id, name')
      .eq('id', params.created);
    if (scope) createdQuery = createdQuery.in('venue_id', scope);
    const { data: row } = await createdQuery.maybeSingle<{
      id: string;
      name: string;
    }>();
    createdPitch = row ?? null;
  }

  return (
    <AppShell viewer={viewer}>
      <PageHead
        title={t.pitches.title}
        meta={t.common.totalCount(total)}
        actions={
          mayEdit ? (
            <Link href="/pitches/new" className="btn btn-primary">
              {t.pitches.newPitch}
            </Link>
          ) : undefined
        }
      />

      <div className="stack">
        {createdPitch ? (
          <p role="status" className="form-ok">
            <strong>{t.pitches.courtAdded}</strong>
            {t.pitches.courtAddedBody(createdPitch.name)}
            <Link href={`/pitches/${createdPitch.id}/schedule`}>{t.pitches.setHoursLink}</Link>
          </p>
        ) : null}

        <Card pad={false}>
          <form method="GET" className="filters">
            <Field label={t.pitches.name}>
              <input
                type="text"
                name="q"
                defaultValue={params.q ?? ''}
                placeholder={t.pitches.namePlaceholder}
                className="input"
              />
            </Field>
            <Field label={t.pitches.status}>
              <select name="status" defaultValue={params.status ?? ''} className="input">
                {(['', 'verified', 'unverified', 'inactive'] as const).map((s) => (
                  <option key={s} value={s}>
                    {t.pitches[STATUS_KEY[s]]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.pitches.venue}>
              <select name="venue" defaultValue={params.venue ?? ''} className="input">
                <option value="">{t.common.all}</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="filters-actions">
              <button type="submit" className="btn btn-primary">
                {t.common.filter}
              </button>
              <Link href="/pitches" className="btn btn-secondary">
                {t.common.reset}
              </Link>
            </div>
          </form>
        </Card>

        {pitches.length === 0 ? (
          <EmptyState>
            {hasAnyFilter(params) ? t.pitches.emptyFiltered : t.pitches.empty}
          </EmptyState>
        ) : (
          <Card pad={false}>
            <Table
              head={
                <>
                  <Th>{t.pitches.thPitch}</Th>
                  <Th>{t.pitches.thVenue}</Th>
                  <Th>{t.pitches.thTypeSurface}</Th>
                  <Th numeric>{t.pitches.thPrice}</Th>
                  <Th>{t.pitches.thStatus}</Th>
                  <Th numeric>{t.pitches.thActions}</Th>
                </>
              }
            >
              {pitches.map((p) => {
                const venueActive = p.venue?.stripe_account_status === 'active';
                const verifyDisabledReason = p.is_verified
                  ? undefined
                  : !venueActive
                    ? `Venue Stripe status is "${p.venue?.stripe_account_status ?? 'unknown'}". Verify after the venue completes Connect onboarding.`
                    : undefined;
                return (
                  <tr key={p.id}>
                    <Td label={t.pitches.thPitch}>
                      <strong>{p.name}</strong>
                      {madeOf.get(p.id)?.length ? (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 12,
                            color: 'var(--ludi-ink2)',
                          }}
                        >
                          {t.pitch.madeOf(madeOf.get(p.id)!.join(' + '))}
                        </span>
                      ) : null}
                    </Td>
                    <Td label={t.pitches.thVenue}>
                      {p.venue?.name ?? t.common.dash}
                      <span
                        style={{
                          color: 'var(--ludi-ink3)',
                          fontSize: 12,
                          marginLeft: 6,
                        }}
                      >
                        {t.pitches.stripeStatus(p.venue?.stripe_account_status ?? t.common.dash)}
                      </span>
                    </Td>
                    <Td label={t.pitches.thTypeSurface}>
                      {typeLabel(p.type)}
                      <span style={{ color: 'var(--ludi-ink3)' }}> · {surfaceLabel(p.surface)}</span>
                    </Td>
                    <Td label={t.pitches.thPrice} numeric>
                      {formatEur(p.price_per_hour_cents, locale)}
                    </Td>
                    <Td label={t.pitches.thStatus}>
                      <StatusBadges
                        isVerified={p.is_verified}
                        isActive={p.is_active}
                        t={t}
                      />
                      {cameraOf.has(p.id) ? (
                        <span
                          style={{
                            display: 'block',
                            marginTop: 4,
                            fontSize: 12,
                            color: cameraOf.get(p.id) === 'offline' ? 'var(--ludi-alert-deep)' : 'var(--ludi-ink2)',
                          }}
                        >
                          {t.pitches.camera(cameraOf.get(p.id)!)}
                        </span>
                      ) : null}
                      {scheduled.has(p.id) ? null : (
                        <span
                          style={{
                            display: 'block',
                            marginTop: 4,
                            fontSize: 12,
                            color: 'var(--ludi-ink2)',
                          }}
                        >
                          {t.pitches.noHoursYet}
                          <Link href={`/pitches/${p.id}/schedule`}>{t.pitches.setHoursLink}</Link>
                        </span>
                      )}
                    </Td>
                    <Td label="" numeric>
                      <div
                        style={{
                          display: 'inline-flex',
                          gap: 6,
                          flexWrap: 'wrap',
                          justifyContent: 'flex-end',
                        }}
                      >
                        <Link
                          href={`/pitches/${p.id}/schedule`}
                          className="btn btn-secondary"
                        >
                          {t.common.hours}
                        </Link>
                        {mayEdit && (
                          <Link
                            href={`/pitches/${p.id}/edit`}
                            className="btn btn-secondary"
                          >
                            {t.common.edit}
                          </Link>
                        )}
                        {viewer.isAdmin && !p.is_verified && (
                          <PitchToggleButton
                            pitchId={p.id}
                            pitchName={p.name}
                            venueName={p.venue?.name ?? '—'}
                            action="verify"
                            disabledReason={verifyDisabledReason}
                          />
                        )}
                        {viewer.isAdmin && p.is_active ? (
                          <PitchToggleButton
                            pitchId={p.id}
                            pitchName={p.name}
                            venueName={p.venue?.name ?? '—'}
                            action="deactivate"
                          />
                        ) : viewer.isAdmin ? (
                          <PitchToggleButton
                            pitchId={p.id}
                            pitchName={p.name}
                            venueName={p.venue?.name ?? '—'}
                            action="activate"
                          />
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        )}

        {totalPages > 1 && (
          <nav
            aria-label={t.common.pagination}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 14,
              color: 'var(--ludi-ink2)',
            }}
          >
            <span>{t.common.pageOf(page, totalPages)}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {page > 1 ? (
                <Link
                  href={buildHref(params, {
                    page: page - 1 === 1 ? undefined : String(page - 1),
                  })}
                  className="btn btn-secondary"
                >
                  {t.common.prev}
                </Link>
              ) : (
                <span className="btn btn-secondary" style={{ opacity: 0.4 }}>
                  {t.common.prev}
                </span>
              )}
              {page < totalPages ? (
                <Link
                  href={buildHref(params, { page: String(page + 1) })}
                  className="btn btn-secondary"
                >
                  {t.common.next}
                </Link>
              ) : (
                <span className="btn btn-secondary" style={{ opacity: 0.4 }}>
                  {t.common.next}
                </span>
              )}
            </div>
          </nav>
        )}
      </div>
    </AppShell>
  );
}

function StatusBadges({
  isVerified,
  isActive,
  t,
}: {
  isVerified: boolean;
  isActive: boolean;
  t: AdminCopy;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <Badge tone={isVerified ? 'good' : 'warn'}>
        {isVerified ? t.pitch.verified : t.pitch.unverified}
      </Badge>
      <Badge tone={isActive ? 'info' : 'alert'}>
        {isActive ? t.pitch.active : t.pitch.inactive}
      </Badge>
    </div>
  );
}

function hasAnyFilter(p: SearchParams): boolean {
  return Boolean(p.q || p.status || p.venue);
}
