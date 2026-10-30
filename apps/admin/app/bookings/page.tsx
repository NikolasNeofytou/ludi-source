import Link from 'next/link';
import { redirect } from 'next/navigation';

import { RefundBookingButton } from '@/components/refund-booking-modal';
import { WalkInCancelButton } from '@/components/walk-in-modal';
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
import { requireVenueAccess, scopeToViewer } from '@/lib/auth';
import {
  BOOKING_STATES,
  isBookingState,
  stateLabel,
  stateTone,
  type BookingState,
} from '@/lib/booking-states';
import { getCopy, type AdminCopy, type Locale } from '@/lib/copy';
import { formatDate, formatDateTime, formatEur, venueDayBoundsUtc } from '@/lib/format';
import {
  cancelledByLabel,
  rosterByBookingId,
  rosterName,
  takenByLabel,
  type RosterRow,
} from '@/lib/roster';
import { createClient } from '@/lib/supabase/server';
import { SUPPORT_MAILTO } from '@/lib/support';

const PAGE_SIZE = 50;

// Mirrors ALLOWED_PRIOR_STATES in admin-refund-booking Edge Function.
// Any state outside this set returns 409 INVALID_BOOKING_STATE, so hide
// the trigger rather than let the user click into a guaranteed failure.
// A partial refund leaves the booking in its state, so the button stays
// for the remainder.
const REFUNDABLE_STATES = new Set<BookingState>(['paid', 'confirmed', 'completed']);

// create-walk-in-booking's cancel accepts both: the hourly cron flips a
// walk-in to completed once it ends, and a mistyped one must stay
// correctable after that.
const WALK_IN_REMOVABLE_STATES = new Set<BookingState>(['confirmed', 'completed']);

// App bookings an owner may need Ludi to cancel, move or refund — the
// refund function is admin-only, so for owners this is a mail link, not a
// button. 'pending' is left out: it settles or expires within minutes.
const SUPPORTABLE_STATES = new Set<BookingState>([
  'collecting',
  'paid',
  'confirmed',
  'completed',
]);

type SearchParams = {
  q?: string;
  state?: string;
  from?: string;
  to?: string;
  venue?: string;
  page?: string;
};

type BookingRow = {
  id: string;
  code: string;
  state: BookingState;
  starts_at: string;
  ends_at: string;
  total_cents: number;
  cancellation_refund_cents: number | null;
  cancellation_policy: string;
  created_at: string;
  origin: 'app' | 'walk_in';
  is_split: boolean;
  user: { id: string; first_name: string; last_name: string } | null;
  pitch: {
    id: string;
    name: string;
    venue: { id: string; name: string } | null;
  } | null;
};

function buildHref(
  current: SearchParams,
  override: Partial<SearchParams>,
): string {
  const merged: Record<string, string | undefined> = { ...current, ...override };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v) sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `/bookings?${qs}` : '/bookings';
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requireVenueAccess();
  const params = await searchParams;
  const scope = scopeToViewer(viewer);
  const t = getCopy(viewer.locale);
  const { locale } = viewer;

  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();

  // The filter's venue list is the viewer's scope, not a query. `venues`
  // is public-readable when active (venues_select_public_or_owner_or_admin),
  // so querying it here would offer a venue owner every other active venue
  // in the dropdown.
  const venues = viewer.venues;

  let query = supabase
    .from('bookings')
    .select(
      `
      id, code, state, starts_at, ends_at, total_cents,
      cancellation_refund_cents, cancellation_policy, created_at,
      origin, is_split,
      user:users ( id, first_name, last_name ),
      pitch:pitches!inner (
        id, name,
        venue:venues!inner ( id, name )
      )
    `,
      { count: 'exact' },
    )
    .order('starts_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (params.q) query = query.ilike('code', `%${params.q}%`);
  if (params.state && isBookingState(params.state)) {
    query = query.eq('state', params.state);
  }
  // The dates are the owner's calendar days in Nicosia — what the Today
  // week-ahead and the schedule editor link here with — so a 00:30 Saturday
  // kick-off files under Saturday, not under UTC's Friday. A malformed
  // date is dropped rather than handed to Postgres.
  if (params.from && isDateKey(params.from)) {
    query = query.gte('starts_at', venueDayBoundsUtc(params.from).start);
  }
  if (params.to && isDateKey(params.to)) {
    query = query.lt('starts_at', venueDayBoundsUtc(params.to).end);
  }
  if (params.venue) query = query.eq('pitch.venue_id', params.venue);
  // Redundant with bookings_select_self_or_owner_or_admin, which has no
  // public branch — kept because ADR-0019's stated risk is cross-venue
  // leakage, and a policy gaining a public branch later should not
  // silently widen this page.
  if (scope) query = query.in('pitch.venue_id', scope);

  const { data, count, error, status } = await query;
  if (error) {
    // Past the end: the list shrank under a filtered page 3 (a cancel, a
    // refund) and PostgREST answers 416 for an offset beyond the last row.
    // Land on the last page that exists instead of erroring.
    if (status === 416 || error.code === 'PGRST103') {
      redirect(buildHref(params, { page: lastPageFrom416(error.details, page) }));
    }
    // The code, not the message — a thrown message travels to logs and
    // error reporting, and a query error can quote the filter values.
    throw new Error(`bookings: list failed (${error.code || 'unknown'})`);
  }

  const bookings = (data ?? []) as unknown as BookingRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Same end-of-list case, answered with 200 and no rows instead of 416.
  if (bookings.length === 0 && page > totalPages) {
    redirect(
      buildHref(params, { page: totalPages > 1 ? String(totalPages) : undefined }),
    );
  }

  // Names (and near-kickoff phones) via v_venue_booking_roster — the users
  // join above is RLS-null for owners; the view is what closes gap 2.
  const roster = await rosterByBookingId(
    supabase,
    bookings.map((b) => b.id),
  );

  return (
    <AppShell viewer={viewer}>
      <PageHead title={t.bookings.title} meta={t.common.totalCount(total)} />

      <div className="stack">
        <Card pad={false}>
          <form method="GET" className="filters">
            <Field label={t.bookings.code}>
              <input
                type="text"
                name="q"
                defaultValue={params.q ?? ''}
                placeholder={t.bookings.codePlaceholder}
                className="input"
              />
            </Field>
            <Field label={t.bookings.state}>
              <select name="state" defaultValue={params.state ?? ''} className="input">
                <option value="">{t.common.all}</option>
                {BOOKING_STATES.map((s) => (
                  <option key={s} value={s}>
                    {stateLabel(s, locale)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.bookings.startsFrom}>
              <input
                type="date"
                name="from"
                defaultValue={params.from ?? ''}
                className="input"
              />
            </Field>
            <Field label={t.bookings.startsTo}>
              <input
                type="date"
                name="to"
                defaultValue={params.to ?? ''}
                className="input"
              />
            </Field>
            <Field label={t.bookings.venue}>
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
              <Link href="/bookings" className="btn btn-secondary">
                {t.common.reset}
              </Link>
            </div>
          </form>
        </Card>

        {bookings.length === 0 ? (
          <EmptyState>
            {hasAnyFilter(params) ? t.bookings.emptyFiltered : t.bookings.empty}
          </EmptyState>
        ) : (
          <Card pad={false}>
            <Table
              head={
                <>
                  <Th>{t.bookings.thCode}</Th>
                  <Th>{t.bookings.thState}</Th>
                  <Th>{t.bookings.thStarts}</Th>
                  <Th>{t.bookings.thPitchVenue}</Th>
                  <Th>{t.bookings.thPlayer}</Th>
                  <Th numeric>{t.bookings.thTotal}</Th>
                  <Th>{t.bookings.thCreated}</Th>
                  <Th numeric>{t.bookings.thActions}</Th>
                </>
              }
            >
              {bookings.map((b) => (
                <tr key={b.id}>
                  <Td label={t.bookings.thCode}>
                    <span className="mono" style={{ fontWeight: 500 }}>
                      {b.code}
                    </span>
                  </Td>
                  <Td label={t.bookings.thState}>
                    <Badge tone={stateTone(b.state)}>{stateLabel(b.state, locale)}</Badge>
                  </Td>
                  <Td label={t.bookings.thStarts}>{formatDateTime(b.starts_at, locale)}</Td>
                  <Td label={t.today.thPitch}>
                    {b.pitch?.name ?? t.common.dash}
                    <span style={{ color: 'var(--ludi-ink3)' }}>
                      {' · '}
                      {b.pitch?.venue?.name ?? t.common.dash}
                    </span>
                  </Td>
                  <Td label={t.bookings.thPlayer}>
                    {playerCell(b, roster.get(b.id), t, viewer.user.id, locale)}
                  </Td>
                  <Td label={t.bookings.thTotal} numeric>
                    {formatEur(b.total_cents, locale)}
                  </Td>
                  <Td label={t.bookings.thCreated}>{formatDate(b.created_at, locale)}</Td>
                  <Td label="" numeric>
                    {actionsCell(b, viewer.isAdmin, t)}
                  </Td>
                </tr>
              ))}
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

function hasAnyFilter(p: SearchParams): boolean {
  return Boolean(p.q || p.state || p.from || p.to || p.venue);
}

// 'YYYY-MM-DD' naming a real day — the pattern alone lets '2026-02-31'
// through, which JS quietly rolls over to 3 March.
function isDateKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s;
}

// The page to land on after a 416. PostgREST says how many rows there are
// in the details ("… but there are only 12 rows"); if that wording ever
// changes, page 1 is always a valid fallback (offset 0 never 416s), and
// the guard stops a redirect from pointing back at the page that failed.
function lastPageFrom416(details: string | null | undefined, failed: number): string | undefined {
  const rows = Number(/only (\d+) rows?/.exec(details ?? '')?.[1]);
  const last = Number.isFinite(rows) ? Math.ceil(rows / PAGE_SIZE) : 1;
  return last > 1 && last < failed ? String(last) : undefined;
}

function actionsCell(b: BookingRow, isAdmin: boolean, t: AdminCopy) {
  if (b.origin === 'walk_in') {
    // No Stripe money behind a walk-in — the refund modal would fail
    // against its synthetic intent id. Owners and admins alike un-book
    // through the walk-in path.
    return WALK_IN_REMOVABLE_STATES.has(b.state) ? (
      <WalkInCancelButton bookingId={b.id} bookingCode={b.code} />
    ) : null;
  }
  if (isAdmin) {
    // Split fixtures refund share-by-share; admin-refund-booking refuses
    // them with a 409, so no trigger.
    return REFUNDABLE_STATES.has(b.state) && !b.is_split ? (
      <RefundBookingButton
        bookingId={b.id}
        bookingCode={b.code}
        totalCents={b.total_cents}
        alreadyRefundedCents={b.cancellation_refund_cents ?? 0}
      />
    ) : null;
  }
  return SUPPORTABLE_STATES.has(b.state) ? (
    <a href={supportHref(b)} style={{ fontSize: 13 }}>
      {t.bookings.needHelp}
    </a>
  ) : null;
}

// A prefilled subject so the email arrives already saying which booking:
// venue, pitch, kick-off, and code plus a short id (the code alone is
// what the owner sees; the id is what Ludi looks up). No player details.
// English on purpose: the founder reads it, and greps his inbox for it.
function supportHref(b: BookingRow): string {
  const subject = [
    `Booking ${b.code} (${b.id.slice(0, 8)})`,
    b.pitch?.venue?.name,
    b.pitch?.name,
    formatDateTime(b.starts_at),
  ]
    .filter(Boolean)
    .join(' · ');
  return `${SUPPORT_MAILTO}?subject=${encodeURIComponent(subject)}`;
}

function playerCell(
  b: BookingRow,
  r: RosterRow | undefined,
  t: AdminCopy,
  viewerId: string,
  locale: Locale,
) {
  // The users(...) fallback is for APP bookings only. On a walk-in,
  // bookings.user_id is the STAFF MEMBER who took it, not the customer —
  // so falling back to it would print the counter's name in the player
  // column whenever the roster row was missing, and an admin (who can read
  // users) would see exactly that. Slice E makes the staff member a named
  // thing of their own, below; the two must never share a cell.
  const name =
    rosterName(r) ??
    (b.origin !== 'walk_in' && b.user
      ? `${b.user.first_name} ${b.user.last_name}`.trim()
      : '') ??
    '';
  const takenBy = takenByLabel(r, viewerId, locale);
  const cancelledBy = b.state === 'cancelled' ? cancelledByLabel(r, viewerId, locale) : null;
  return (
    <>
      {name || t.common.dash}
      {b.origin === 'walk_in' ? (
        <>
          {' '}
          <Badge tone="info">{t.common.walkIn}</Badge>
        </>
      ) : null}
      {r?.organiser_phone ? (
        <div style={{ fontSize: 13, color: 'var(--ludi-ink2)' }}>
          <a href={`tel:+${r.organiser_phone}`}>+{r.organiser_phone}</a>
        </div>
      ) : null}
      {/* Slice E — who took the €60. Its own line, in the quiet colour:
          it answers a question asked afterwards, not one asked at the
          counter, so it should never compete with the customer's name. */}
      {takenBy || cancelledBy ? (
        <div style={{ fontSize: 13, color: 'var(--ludi-ink2)' }}>
          {takenBy}
          {takenBy && cancelledBy ? ' · ' : null}
          {cancelledBy}
        </div>
      ) : null}
    </>
  );
}
