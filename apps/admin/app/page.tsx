import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { OwnerConnectButton } from '@/components/owner-connect-button';
import { ShiftRefresh } from '@/components/shift-refresh';
import {
  SetupChecklist,
  setupHasWork,
  type SetupStep,
} from '@/components/setup-checklist';
import {
  WalkInButton,
  WalkInCancelButton,
  type WalkInPitch,
} from '@/components/walk-in-modal';
import {
  AppShell,
  Badge,
  Card,
  EmptyState,
  PageHead,
  Stat,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { VenueLinkCard } from '@/components/venue-link-card';
import {
  canManageMoney,
  ownsAnyVenue,
  requireVenueAccess,
  scopeToViewer,
  type Viewer,
} from '@/lib/auth';
import {
  SLOT_HOLDING_STATES,
  stateLabel,
  stateTone,
  type BookingState,
} from '@/lib/booking-states';
import { getCopy, type AdminCopy } from '@/lib/copy';
import {
  addDaysToKey,
  formatDayLabel,
  formatEur,
  formatTime,
  venueDateKey,
  venueDayBoundsUtc,
  venueToday,
} from '@/lib/format';
import {
  rosterAddonsLabel,
  rosterByBookingId,
  rosterName,
  takenByLabel,
  type RosterRow,
} from '@/lib/roster';
import { createClient } from '@/lib/supabase/server';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';

// `/` is the operations view — "is anyone booked tonight?", answered the
// moment the app opens, on a phone, for both audiences (ADR-0019): an
// owner sees their venue's day, the admin sees every venue's. /bookings
// stays the searchable record; this page is today and the week ahead.
//
// One query serves the whole page: slot-holding bookings from the start of
// today through the end of the seventh day ahead, grouped in TS by their
// Europe/Nicosia calendar date (venueDateKey). The days themselves are
// calendar arithmetic on date keys (addDaysToKey), never 24-hour steps of
// time — those skip or repeat a day across a DST change. The repo rule is
// that wall-clock maths lives in the DB or in Intl, never hand-offset.

const LOOKAHEAD_DAYS = 7;

type TodayRow = {
  id: string;
  code: string;
  state: BookingState;
  starts_at: string;
  ends_at: string;
  total_cents: number;
  // Slice F: where the money for this booking is — at the counter, already
  // through Ludi, or in the app. Read off the booking itself rather than
  // the roster view so the shift's most important line never depends on a
  // second query having caught up.
  origin: 'app' | 'walk_in';
  prepaid: boolean;
  user: { first_name: string; last_name: string } | null;
  pitch: { id: string; name: string; venue: { id: string; name: string } | null } | null;
};

// States whose money is real for the day's number. Pending is on the
// schedule (it holds the slot) but not in the till.
const PAID_STATES = new Set<BookingState>(['paid', 'confirmed', 'completed']);

function hoursOf(rows: TodayRow[]): number {
  const ms = rows.reduce(
    (sum, b) => sum + (Date.parse(b.ends_at) - Date.parse(b.starts_at)),
    0,
  );
  return ms / (60 * 60 * 1000);
}

function eurosOf(rows: TodayRow[]): number {
  return rows
    .filter((b) => PAID_STATES.has(b.state))
    .reduce((sum, b) => sum + b.total_cents, 0);
}

function playerLabel(b: TodayRow, roster: RosterRow | undefined, booked: string): string {
  // Name comes from v_venue_booking_roster (41g/41h, ADR-0023) for owners
  // and admins alike; the users join is the fallback for any row the view
  // hasn't caught up with. "Booked" is honest; "—" would read as a bug.
  const fromRoster = rosterName(roster);
  if (fromRoster) return fromRoster;
  if (!b.user) return booked;
  const name = `${b.user.first_name} ${b.user.last_name}`.trim();
  return name || booked;
}

// Slice F — how far ahead "Now and next" looks. Four hours is one
// evening shift's worth of kick-offs at a five-a-side venue, and it is the
// window the research pass named.
const NEXT_WINDOW_MS = 4 * 60 * 60 * 1000;

// Where this booking's money is, in the words a counter needs. The one
// that matters is "collect": a walk-in not prepaid through Ludi is paid at
// the venue, so somebody at the counter has to take it.
//
// Two things this deliberately does NOT know, and so does not say:
//   * whether the cash was actually taken. No column records it — the
//     offline payment row is written as succeeded when the walk-in is
//     created — and inventing that state is the till, which the plan
//     deferred. So "collect" is shown only while the game has not ended:
//     an instruction about the future, never a claim about the past.
//   * a prepaid DEPOSIT. bookings.prepaid (20260917000003) is a flag, not
//     an amount, and nothing creates a prepaid walk-in yet — the payment
//     link is unbuilt. When it lands, "Prepaid" may need to become
//     "Collect the rest".
function paymentLine(b: TodayRow, t: AdminCopy, locale: Viewer['locale'], nowMs: number): string | null {
  if (b.state === 'collecting') return t.today.collecting;
  if (b.origin === 'walk_in') {
    if (b.prepaid) return t.today.prepaid;
    if (Date.parse(b.ends_at) <= nowMs) return null;
    return t.today.collect(formatEur(b.total_cents, locale));
  }
  if (b.state === 'paid' || b.state === 'confirmed' || b.state === 'completed') {
    return t.today.paidInApp;
  }
  return null;
}

export default async function TodayPage() {
  const viewer = await requireVenueAccess();
  const scope = scopeToViewer(viewer);
  const t = getCopy(viewer.locale);
  const { locale } = viewer;
  const formatHours = t.common.hoursShort;
  const now = new Date();
  const todayKey = venueToday();
  const weekKeys = Array.from({ length: LOOKAHEAD_DAYS }, (_, i) =>
    addDaysToKey(todayKey, i + 1),
  );
  const windowStart = venueDayBoundsUtc(todayKey).start;
  const windowEnd = venueDayBoundsUtc(addDaysToKey(todayKey, LOOKAHEAD_DAYS)).end;

  const supabase = await createClient();
  let query = supabase
    .from('bookings')
    .select(
      `
      id, code, state, starts_at, ends_at, total_cents, origin, prepaid,
      user:users ( first_name, last_name ),
      pitch:pitches!inner (
        id, name,
        venue:venues!inner ( id, name )
      )
    `,
    )
    .in('state', [...SLOT_HOLDING_STATES])
    .gte('starts_at', windowStart)
    .lt('starts_at', windowEnd)
    .order('starts_at', { ascending: true });
  // Same belt-and-braces as /bookings: bookings RLS has no public branch,
  // but ADR-0019's stated risk is cross-venue leakage, so scope explicitly.
  if (scope) query = query.in('pitch.venue_id', scope);

  const { data, error } = await query;
  if (error) throw new Error(`today: load failed: ${error.message}`);
  const rows = (data ?? []) as unknown as TodayRow[];

  // Names, windowed phones, and door extras for the rows on screen.
  const roster = await rosterByBookingId(supabase, rows.map((b) => b.id));

  // Pitch list for the walk-in modal (41k). Owner-scoped like everything
  // else; price rides along so the modal can prefill the desk price.
  let pitchQuery = supabase
    .from('pitches')
    .select('id, name, price_per_hour_cents, venue:venues!inner ( id, name )')
    .eq('is_active', true)
    .order('name');
  if (scope) pitchQuery = pitchQuery.in('venue_id', scope);
  const { data: walkInPitchRows } = await pitchQuery;
  const walkInPitches: WalkInPitch[] = (
    (walkInPitchRows ?? []) as unknown as Array<{
      id: string;
      name: string;
      price_per_hour_cents: number;
      venue: { id: string; name: string } | null;
    }>
  ).map((p) => ({
    id: p.id,
    venueId: p.venue?.id,
    name: p.name,
    venueName: p.venue?.name ?? '—',
    pricePerHourCents: p.price_per_hour_cents,
  }));

  const byDay = new Map<string, TodayRow[]>();
  for (const b of rows) {
    const key = venueDateKey(new Date(b.starts_at));
    const bucket = byDay.get(key);
    if (bucket) bucket.push(b);
    else byDay.set(key, [b]);
  }

  const today = byDay.get(todayKey) ?? [];
  const nextUp = today.find(
    (b) => Date.parse(b.starts_at) >= now.getTime() && b.state !== 'completed',
  );

  const showVenue = viewer.isAdmin || viewer.venues.length > 1;

  // Slice F — "Now and next": what is on this minute and what kicks off
  // in the next four hours, across midnight if the shift runs that late.
  // From `rows`, not `today`, for exactly that reason; instant arithmetic,
  // not wall-clock, so a DST change cannot shift the window.
  const nowMs = now.getTime();
  const soon = rows.filter(
    (b) =>
      Date.parse(b.ends_at) > nowMs &&
      Date.parse(b.starts_at) < nowMs + NEXT_WINDOW_MS &&
      b.state !== 'completed',
  );

  // The day's and the week's booked value are the owner's (ADR-0041: a
  // manager runs the day, and does not see what it earned). Said plainly:
  // this is PRESENTATION, not a boundary — a manager reads each booking's
  // total, because he collects it, so he could add them up himself. What
  // the database withholds from him is the earnings view, the payouts and
  // the take rate; what this withholds is the page being about money.
  const showValue = viewer.isAdmin || ownsAnyVenue(viewer);

  // The self-serve onboarding checklist (owners and managers only — the
  // admin knows the drill, and across all venues it would be noise). One
  // per venue, computed from what the caller can read under RLS; see
  // components/setup-checklist.tsx.
  // Skipped for a manager, and not only because v_venue_private answers
  // him with nothing since ADR-0041 (which would render every step as
  // "not done"). Getting a venue onto Ludi — Stripe, contacts, the first
  // court — is the owner's job, not the evening shift's.
  const setups = !viewer.isAdmin && ownsAnyVenue(viewer) && scope
    ? await loadSetups(supabase, viewer, scope)
    : [];

  // The booking desk (ADR-0046): how many requests are waiting, across the
  // venues the caller works at. RLS answers a manager too; an admin is not
  // shown customers' messages.
  let deskWaiting = 0;
  if (!viewer.isAdmin && viewer.venues.length > 0) {
    const { count } = await supabase
      .from('venue_inbox')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new');
    deskWaiting = count ?? 0;
  }

  // The venue's own link (plans/reach.md R1): shown to the venue's people
  // on the page they open every day, once Ludi has set a slug.
  let links: { id: string; name: string; slug: string }[] = [];
  if (!viewer.isAdmin && viewer.venues.length > 0) {
    const { data } = await supabase
      .from('venues')
      .select('id, name, slug')
      .in('id', viewer.venues.map((v) => v.id))
      .not('slug', 'is', null)
      .order('name');
    links = (data ?? []) as { id: string; name: string; slug: string }[];
  }

  return (
    <AppShell viewer={viewer}>
      <ShiftRefresh />
      <PageHead
        title={t.today.title}
        meta={
          // The breathe dot is the entry plate's live tell carried to the one
          // page whose numbers are current-by-definition. Nothing else earns it.
          <>
            <span className="live-dot breathe" aria-hidden />
            {formatDayLabel(now.toISOString(), locale)}
          </>
        }
        actions={
          // Wraps: the Greek for "New walk-in" is three words, and three
          // buttons abreast overran a phone.
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/bookings" className="btn btn-secondary">
              {t.today.allBookings}
            </Link>
            <Link href="/standing" className="btn btn-secondary">
              {t.today.standing}
            </Link>
            <WalkInButton pitches={walkInPitches} />
          </span>
        }
      />

      <div className="stack">
        {deskWaiting > 0 ? (
          <Link href="/requests" className="desk-today">
            {t.desk.todayLine(deskWaiting)}
          </Link>
        ) : null}
        {setups.length ? (
          <div className="rise stack" style={{ '--i': 0 } as React.CSSProperties}>
            {setups.map((s) => (
              <SetupChecklist
                key={s.venueId}
                locale={locale}
                venueName={s.venueName}
                steps={s.steps}
                live={s.live}
                notes={s.notes}
              />
            ))}
          </div>
        ) : null}
        {links.map((v) => (
          <VenueLinkCard key={v.id} slug={v.slug} venueName={v.name} locale={locale} />
        ))}
        {/* Slice F. First on the page, above the numbers: a counter
            needs "who is on Court 2 and have they paid" before it needs
            "how many hours today". Big enough to read from across a desk,
            and one row per booking so a phone does not reflow it. */}
        <section className="rise" style={{ '--i': 1 } as React.CSSProperties}>
          <p className="form-section" style={{ marginTop: 0 }}>
            {t.today.nowNext}
          </p>
          {soon.length === 0 ? (
            <p className="field-hint" style={{ margin: 0 }}>
              {t.today.nowNextEmpty}
            </p>
          ) : (
            <Card>
              <div className="stack" style={{ gap: 14 }}>
                {soon.map((b) => {
                  const r = roster.get(b.id);
                  const onNow = Date.parse(b.starts_at) <= nowMs;
                  const minutes = Math.max(
                    1,
                    Math.round((Date.parse(b.starts_at) - nowMs) / 60_000),
                  );
                  const pay = paymentLine(b, t, locale, nowMs);
                  const collect = b.origin === 'walk_in' && !b.prepaid && pay !== null;
                  return (
                    <div
                      key={b.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(84px, auto) 1fr',
                        gap: 12,
                        alignItems: 'baseline',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1 }}>
                          {formatTime(b.starts_at)}
                        </div>
                        <div style={{ marginTop: 4 }}>
                          {onNow ? (
                            <Badge tone="good">{t.today.onNow}</Badge>
                          ) : (
                            <span className="field-hint">{t.today.startsIn(minutes)}</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 600 }}>
                          {b.pitch?.name ?? t.common.dash}
                          {showVenue && b.pitch?.venue ? (
                            <span className="field-hint"> · {b.pitch.venue.name}</span>
                          ) : null}
                        </div>
                        <div>
                          {playerLabel(b, r, t.common.booked)}
                          <span style={{ color: 'var(--ludi-ink2)' }}>
                            {' '}· {t.today.endsAt(formatTime(b.ends_at))}
                          </span>
                        </div>
                        {r?.organiser_phone ? (
                          <div>
                            <a href={`tel:+${r.organiser_phone}`}>+{r.organiser_phone}</a>
                          </div>
                        ) : null}
                        {pay ? (
                          <div style={{ marginTop: 4 }}>
                            <Badge tone={collect ? 'warn' : 'neutral'}>{pay}</Badge>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </section>

        <section
          className="stats rise"
          style={{ '--i': 2 } as React.CSSProperties}
        >
          <Stat label={t.today.statBookings} value={today.length} />
          <Stat label={t.today.statHours} value={formatHours(hoursOf(today))} />
          {showValue ? (
            <Stat label={t.today.statValue} value={formatEur(eurosOf(today), locale)} />
          ) : null}
          <Stat
            label={t.today.statNext}
            value={nextUp ? formatTime(nextUp.starts_at) : t.common.dash}
          />
        </section>

        {today.length === 0 ? (
          <div className="rise" style={{ '--i': 3 } as React.CSSProperties}>
            <EmptyState>{t.today.empty}</EmptyState>
          </div>
        ) : (
          <div className="rise" style={{ '--i': 3 } as React.CSSProperties}>
          <Card pad={false}>
            <Table
              head={
                <>
                  <Th>{t.today.thTime}</Th>
                  {showVenue ? <Th>{t.today.thVenue}</Th> : null}
                  <Th>{t.today.thPitch}</Th>
                  <Th>{t.today.thPlayer}</Th>
                  <Th>{t.today.thState}</Th>
                  <Th numeric>{t.today.thTotal}</Th>
                </>
              }
            >
              {today.map((b) => {
                const past = Date.parse(b.ends_at) < now.getTime();
                const r = roster.get(b.id);
                const extras = rosterAddonsLabel(r, locale);
                // Slice E. On Today this is the handover line — "ask Maria,
                // she booked it" — so only who took it, not who cancelled:
                // Today lists what is still on.
                const takenBy = takenByLabel(r, viewer.user.id, locale);
                return (
                  <tr key={b.id} style={past ? { opacity: 0.55 } : undefined}>
                    <Td label={t.today.thTime}>
                      {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                    </Td>
                    {showVenue ? (
                      <Td label={t.today.thVenue}>{b.pitch?.venue?.name ?? t.common.dash}</Td>
                    ) : null}
                    <Td label={t.today.thPitch}>{b.pitch?.name ?? t.common.dash}</Td>
                    <Td label={t.today.thPlayer}>
                      {playerLabel(b, r, t.common.booked)}
                      <span style={{ color: 'var(--ludi-ink2)' }}> · {b.code}</span>
                      {r?.origin === 'walk_in' ? (
                        <>
                          {' '}
                          <Badge tone="info">{t.common.walkIn}</Badge>
                        </>
                      ) : null}
                      {r?.organiser_phone || extras || takenBy ? (
                        <div style={{ fontSize: 13, color: 'var(--ludi-ink2)' }}>
                          {r?.organiser_phone ? (
                            <a href={`tel:+${r.organiser_phone}`}>
                              +{r.organiser_phone}
                            </a>
                          ) : null}
                          {r?.organiser_phone && extras ? ' · ' : null}
                          {extras}
                          {(r?.organiser_phone || extras) && takenBy ? ' · ' : null}
                          {takenBy}
                        </div>
                      ) : null}
                      {r?.origin === 'walk_in' &&
                      (b.state === 'confirmed' || b.state === 'completed') ? (
                        <div style={{ marginTop: 4 }}>
                          <WalkInCancelButton bookingId={b.id} bookingCode={b.code} />
                        </div>
                      ) : null}
                    </Td>
                    <Td label={t.today.thState}>
                      <Badge tone={stateTone(b.state)}>{stateLabel(b.state, locale)}</Badge>
                    </Td>
                    <Td label={t.today.thTotal} numeric>
                      {formatEur(b.total_cents, locale)}
                      {(() => {
                        // Slice F: the same line as "Now and next", so the
                        // whole day reads the same way — quiet here, since
                        // the block above is where the counter looks.
                        const pay = paymentLine(b, t, locale, nowMs);
                        return pay ? (
                          <div style={{ fontSize: 12, color: 'var(--ludi-ink2)' }}>{pay}</div>
                        ) : null;
                      })()}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
          </div>
        )}

        <div className="rise" style={{ '--i': 4 } as React.CSSProperties}>
        <PageHead title={t.today.weekAhead} />
        <Card pad={false}>
          <Table
            head={
              <>
                <Th>{t.today.thDay}</Th>
                <Th numeric>{t.today.thBookings}</Th>
                <Th numeric>{t.today.thHours}</Th>
                {showValue ? <Th numeric>{t.today.thValue}</Th> : null}
              </>
            }
          >
            {weekKeys.map((key) => {
              const day = byDay.get(key) ?? [];
              return (
                <tr key={key}>
                  <Td label={t.today.thDay}>
                    <Link href={`/bookings?from=${key}&to=${key}`}>
                      {formatDayLabel(`${key}T12:00:00Z`, locale)}
                    </Link>
                  </Td>
                  <Td label={t.today.thBookings} numeric>
                    {day.length || t.common.dash}
                  </Td>
                  <Td label={t.today.thHours} numeric>
                    {day.length ? formatHours(hoursOf(day)) : t.common.dash}
                  </Td>
                  {showValue ? (
                    <Td label={t.today.thValue} numeric>
                      {day.length ? formatEur(eurosOf(day), locale) : t.common.dash}
                    </Td>
                  ) : null}
                </tr>
              );
            })}
          </Table>
        </Card>
        </div>
      </div>
    </AppShell>
  );
}

type VenueSetup = {
  venueId: string;
  venueName: string;
  steps: SetupStep[];
  live: boolean;
  notes: ReactNode[];
};

type SetupVenueRow = {
  id: string;
  name: string;
  address: string | null;
  stripe_account_status: 'pending' | 'active' | 'restricted' | 'disabled';
};

type SetupPrivateRow = {
  venue_id: string;
  contact_phone: string | null;
  contact_email: string | null;
  stripe_account_id: string | null;
};

type SetupPitchRow = {
  id: string;
  name: string;
  venue_id: string;
  is_verified: boolean;
  is_active: boolean;
};

async function loadSetups(
  supabase: SupabaseClient,
  viewer: Viewer,
  scope: string[],
): Promise<VenueSetup[]> {
  const t = getCopy(viewer.locale).checklist;
  // Contacts and the Stripe account id are not on `venues` for anyone but
  // the service role — they come from v_venue_private, which returns only
  // the caller's own venues.
  const [{ data: venueRows }, { data: privateRows }, { data: pitchRows }] =
    await Promise.all([
      supabase
        .from('venues')
        .select('id, name, address, stripe_account_status')
        .in('id', scope)
        .order('name'),
      supabase
        .from('v_venue_private')
        .select('venue_id, contact_phone, contact_email, stripe_account_id')
        .in('venue_id', scope),
      supabase
        .from('pitches')
        .select('id, name, venue_id, is_verified, is_active')
        .in('venue_id', scope)
        .eq('is_active', true)
        .order('name'),
    ]);
  const privates = new Map(
    ((privateRows ?? []) as SetupPrivateRow[]).map((p) => [p.venue_id, p]),
  );
  const pitches = (pitchRows ?? []) as SetupPitchRow[];

  let scheduledIds = new Set<string>();
  if (pitches.length) {
    const { data: schedRows } = await supabase
      .from('pitch_schedules')
      .select('pitch_id')
      .in('pitch_id', pitches.map((p) => p.id));
    scheduledIds = new Set((schedRows ?? []).map((s) => s.pitch_id as string));
  }

  const setups = ((venueRows ?? []) as SetupVenueRow[]).map((venue) => {
    const priv = privates.get(venue.id);
    const courts = pitches.filter((p) => p.venue_id === venue.id);
    const hasCourts = courts.length > 0;
    const allScheduled = hasCourts && courts.every((p) => scheduledIds.has(p.id));
    // One verified, active court is a venue players can book. From then
    // on a court added later is a note, not a reason to reopen the card.
    const live = courts.some((p) => p.is_verified);
    const notes: ReactNode[] = live
      ? courts
          .filter((p) => !p.is_verified)
          .map((p) => (
            <span key={p.id}>
              {t.newCourtBefore}
              <strong>{p.name}</strong>
              {t.newCourtAfter}
            </span>
          ))
      : [];

    const steps: SetupStep[] = [
      {
        label: t.venueDetails,
        detail: t.venueDetailsHint,
        done:
          Boolean(venue.address?.trim()) &&
          Boolean(priv?.contact_phone?.trim() || priv?.contact_email?.trim()),
        // The owner's venue-edit page, not the admin-only /venues list —
        // an owner following that link would bounce off requireAdmin.
        href: `/venues/${venue.id}/edit`,
        linkLabel: t.check,
      },
      {
        label: t.addCourts,
        detail: t.addCourtsHint,
        done: hasCourts,
        href: '/pitches/new',
        linkLabel: t.addACourt,
      },
      {
        label: t.weeklyHours,
        detail: t.weeklyHoursHint,
        done: allScheduled,
        href: '/pitches',
        linkLabel: t.openCourts,
      },
      paymentStep(
        venue,
        Boolean(priv?.stripe_account_id),
        canManageMoney(viewer, venue.id),
        t,
      ),
      {
        label: t.review,
        detail: t.reviewHint,
        done: live,
      },
    ];

    return { venueId: venue.id, venueName: venue.name, steps, live, notes };
  });

  return setups.filter((s) => setupHasWork(s.steps, s.notes));
}

// A pitch physically cannot be verified while the venue's Stripe account
// is anything but active (tg_pitches_verify_guard), and KYC is the owner's
// action — so the step must say what Stripe is waiting on instead of
// promising "no action needed" forever. Since 41m the owner starts (and
// resumes) it themselves; a manager can see the state but not act on it.
//
// `pending` covers both "never finished onboarding" and "submitted, Stripe
// still reviewing" (41o's mapping can't tell them apart from the row), so
// its copy allows for both; Stripe's hosted page shows which on resume.
function paymentStep(
  venue: SetupVenueRow,
  hasAccount: boolean,
  canManage: boolean,
  t: AdminCopy['checklist'],
): SetupStep {
  const label = t.payment;
  const ownerOnly = (
    <span style={{ color: 'var(--ludi-ink3)', fontSize: 13 }}>{t.ownerDoes}</span>
  );
  switch (venue.stripe_account_status) {
    case 'active':
      return {
        label,
        detail: t.payActiveHint,
        done: true,
      };
    case 'restricted':
      return {
        label,
        detail: t.payRestrictedHint,
        done: false,
        action: canManage ? (
          <OwnerConnectButton venueId={venue.id} hasAccount label={t.sendStripeDetails} />
        ) : (
          ownerOnly
        ),
      };
    case 'disabled':
      return {
        label,
        detail: (
          <>
            {t.payDisabledBefore}
            <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
            {t.payDisabledAfter}
          </>
        ),
        done: false,
      };
    case 'pending':
    default:
      return {
        label,
        detail: hasAccount ? t.payPendingReviewHint : t.payPendingHint,
        done: false,
        action: canManage ? (
          <OwnerConnectButton venueId={venue.id} hasAccount={hasAccount} />
        ) : (
          ownerOnly
        ),
      };
  }
}
