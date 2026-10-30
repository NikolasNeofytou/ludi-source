import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { GmvChart, type GmvDay } from '@/components/gmv-chart';
import { OwnerConnectButton } from '@/components/owner-connect-button';
import { StripeDashboardButton } from '@/components/stripe-dashboard-button';
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
import { canManageMoney, ownsAnyVenue, requireVenueAccess } from '@/lib/auth';
import { getCopy, type AdminCopy } from '@/lib/copy';
import { VENUE_TZ, addDaysToKey, formatEur, venueToday } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';

// `/earnings` answers Maria's question 3: "how much did I make, and when?"
// (M6 #41h, reading #41g's v_venue_earnings_daily.)
//
// Both audiences use it (ADR-0019): an owner sees their venue(s), the admin
// sees every venue — the per-venue breakdown /gmv never had. The view does
// the scoping (owner-or-admin predicate, ADR-0013 shape), so this page
// never filters for access, only by date.
//
// The headline is split in two because the money arrives two ways, and a
// single "your earnings" figure invited the owner to expect all of it from
// Stripe:
//   - Paid through Ludi — app bookings after refunds and Ludi's fee. This
//     is what Stripe pays out. The fee is charged only on what the venue
//     kept (agreement clause 6.4): the view scales each booking's fee by
//     its un-refunded fraction, matching Stripe's pro-rata fee refund to
//     within a cent (ADR-0026 amendment).
//   - Taken at venue — walk-ins, cash/card at the desk. No Ludi fee
//     (payments_offline_no_fee), never refunded through Ludi (a cancelled
//     walk-in's payment row leaves the view), never paid out by Stripe.
// Total earnings is the sum — the view's venue_net_cents, which spans
// both methods. Payout timing is a Stripe Connect question, not answered
// here.

const RANGE_OPTIONS = [
  { key: '7', label: 'last7', days: 7 },
  { key: '30', label: 'last30', days: 30 },
  { key: '90', label: 'last90', days: 90 },
] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number]['key'];
const DEFAULT_RANGE: RangeKey = '30';

type SearchParams = { range?: string };

type PayoutRow = {
  stripe_payout_id: string;
  amount_cents: number;
  status: 'paid' | 'failed';
  arrival_date: string | null;
  failure_message: string | null;
  venues: { name: string } | null;
};

type EarningsRow = {
  venue_id: string;
  venue_name: string;
  day: string;
  gross_cents: number | string | null;
  refunded_cents: number | string | null;
  fee_cents: number | string | null;
  net_cents: number | string | null;
  venue_net_cents: number | string | null;
  payments_count: number | null;
  bookings_count: number | null;
  offline_gross_cents: number | string | null;
  offline_fee_cents: number | string | null;
};

type Totals = {
  gross: number;
  refunded: number;
  fee: number;
  venueNet: number;
  bookings: number;
  offlineGross: number;
  offlineFee: number;
};

const ZERO_TOTALS: Totals = {
  gross: 0,
  refunded: 0,
  fee: 0,
  venueNet: 0,
  bookings: 0,
  offlineGross: 0,
  offlineFee: 0,
};

// Walk-in money is the offline gross less its fee (always 0 since
// 20260912000001); offline rows are never refunded through Ludi, so the
// view's refunded column is all online.
function takenAtVenue(t: Totals): number {
  return t.offlineGross - t.offlineFee;
}

// Online, after refunds and Ludi's fee — the part Stripe pays out.
function paidThroughLudi(t: Totals): number {
  return t.venueNet - takenAtVenue(t);
}

type VenueStripeRow = {
  id: string;
  name: string;
  stripe_account_status: 'pending' | 'active' | 'restricted' | 'disabled';
};

export default async function EarningsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requireVenueAccess();
  // Owner-only since ADR-0041. A manager runs the day and does not see
  // what the day earned — not the gross, and above all not Ludi's
  // commission. The real gate is underneath: v_venue_earnings_daily and
  // venue_payouts both answer a manager with nothing, so without this the
  // page would render as a convincing set of zeroes.
  if (!viewer.isAdmin && !ownsAnyVenue(viewer)) redirect('/');
  const params = await searchParams;
  const t = getCopy(viewer.locale);
  const { locale } = viewer;
  const eur = (cents: number) => formatEur(cents, locale);
  const rangeKey: RangeKey =
    RANGE_OPTIONS.find((r) => r.key === params.range)?.key ?? DEFAULT_RANGE;
  const days = RANGE_OPTIONS.find((r) => r.key === rangeKey)!.days;

  const todayLocal = venueToday();
  const fromLocal = addDaysToKey(todayLocal, -(days - 1));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_venue_earnings_daily')
    .select(
      'venue_id, venue_name, day, gross_cents, refunded_cents, fee_cents, net_cents, venue_net_cents, payments_count, bookings_count, offline_gross_cents, offline_fee_cents',
    )
    .gte('day', fromLocal)
    .lte('day', todayLocal)
    .order('day', { ascending: true });
  if (error) throw new Error(`earnings: view query failed: ${error.message}`);

  const rows = (data ?? []) as EarningsRow[];

  // 41l: the payout mirror (webhook-written venue_payouts). RLS is
  // owner-or-admin with no public branch, so no explicit scope filter.
  // Deliberately not range-filtered — "when do I get paid?" is about the
  // latest payouts, whatever range the earnings chart shows.
  const { data: payoutData, error: payoutErr } = await supabase
    .from('venue_payouts')
    .select(
      'stripe_payout_id, amount_cents, status, arrival_date, failure_message, venues ( name )',
    )
    .order('arrival_date', { ascending: false })
    .limit(10);
  if (payoutErr) {
    throw new Error(`earnings: payouts query failed: ${payoutErr.message}`);
  }
  const payouts = (payoutData ?? []) as unknown as PayoutRow[];

  // Which Stripe control each of the viewer's venues gets (owners and
  // managers only — the admin has /venues for this). The dashboard login
  // only exists once onboarding is submitted; before that the honest
  // control is the onboarding one. stripe_account_id is private to
  // v_venue_private since 20260913000005.
  const payoutControls: {
    venue: VenueStripeRow;
    hasAccount: boolean;
    canManage: boolean;
  }[] = [];
  if (!viewer.isAdmin && viewer.venues.length) {
    const ids = viewer.venues.map((v) => v.id);
    const [{ data: venueData }, { data: privateData }] = await Promise.all([
      supabase
        .from('venues')
        .select('id, name, stripe_account_status')
        .in('id', ids)
        .order('name'),
      supabase
        .from('v_venue_private')
        .select('venue_id, stripe_account_id')
        .in('venue_id', ids),
    ]);
    const accounts = new Map(
      ((privateData ?? []) as { venue_id: string; stripe_account_id: string | null }[]).map(
        (p) => [p.venue_id, Boolean(p.stripe_account_id)],
      ),
    );
    for (const venue of (venueData ?? []) as VenueStripeRow[]) {
      payoutControls.push({
        venue,
        hasAccount: accounts.get(venue.id) ?? false,
        canManage: canManageMoney(viewer, venue.id),
      });
    }
  }

  const totals = rows.reduce<Totals>(
    (acc, r) => ({
      gross: acc.gross + numericCents(r.gross_cents),
      refunded: acc.refunded + numericCents(r.refunded_cents),
      fee: acc.fee + numericCents(r.fee_cents),
      venueNet: acc.venueNet + numericCents(r.venue_net_cents),
      bookings: acc.bookings + (r.bookings_count ?? 0),
      offlineGross: acc.offlineGross + numericCents(r.offline_gross_cents),
      offlineFee: acc.offlineFee + numericCents(r.offline_fee_cents),
    }),
    ZERO_TOTALS,
  );

  // Chart series: per-day sums across the viewer's venues (an owner with
  // one venue gets that venue's series unchanged). Its green "kept" part is
  // venue_net — after refunds AND Ludi's fee, walk-ins included — so the
  // bars add up to the Total earnings figure above them.
  const series = densify(fromLocal, todayLocal, rows);

  // Per-venue breakdown earns its place only when there is more than one
  // venue to break down (admin, or a rare multi-venue owner).
  const byVenue = new Map<string, { name: string; t: Totals }>();
  for (const r of rows) {
    const v = byVenue.get(r.venue_id) ?? { name: r.venue_name, t: { ...ZERO_TOTALS } };
    v.t.gross += numericCents(r.gross_cents);
    v.t.refunded += numericCents(r.refunded_cents);
    v.t.fee += numericCents(r.fee_cents);
    v.t.venueNet += numericCents(r.venue_net_cents);
    v.t.bookings += r.bookings_count ?? 0;
    v.t.offlineGross += numericCents(r.offline_gross_cents);
    v.t.offlineFee += numericCents(r.offline_fee_cents);
    byVenue.set(r.venue_id, v);
  }
  const venueRows = [...byVenue.values()].sort((a, b) => b.t.venueNet - a.t.venueNet);
  const showBreakdown = viewer.isAdmin || byVenue.size > 1;
  const showPayoutVenue = viewer.isAdmin || viewer.venues.length > 1;
  const multiControl = payoutControls.length > 1;

  return (
    <AppShell viewer={viewer}>
      <PageHead
        title={t.earnings.title}
        meta={`${fromLocal} → ${todayLocal} · ${VENUE_TZ}`}
      />

      <div className="stack">
        <nav aria-label={t.earnings.timeRange} className="pills">
          {RANGE_OPTIONS.map((r) => (
            <Link
              key={r.key}
              href={r.key === DEFAULT_RANGE ? '/earnings' : `/earnings?range=${r.key}`}
              className="pill"
              aria-current={r.key === rangeKey ? 'page' : undefined}
            >
              {t.earnings[r.label]}
            </Link>
          ))}
        </nav>

        {/* Two rows: what the venue earned and how it arrives, then how the
            Ludi part was made up. One row of seven tiles wrapped to a lone
            tile and buried the one number an owner came for. */}
        <section className="stats" aria-label={t.earnings.ariaStats}>
          <Stat label={t.earnings.paidThroughLudi} value={eur(paidThroughLudi(totals))} />
          <Stat label={t.earnings.takenAtVenue} value={eur(takenAtVenue(totals))} />
          <Stat
            label={viewer.isAdmin ? t.earnings.venuesTotal : t.earnings.totalEarnings}
            value={eur(totals.venueNet)}
          />
          <Stat label={t.earnings.bookings} value={totals.bookings.toLocaleString('en-GB')} />
        </section>
        <section className="stats" aria-label={t.earnings.ariaBreakdown}>
          <Stat
            label={t.earnings.playersPaid}
            value={eur(totals.gross - totals.offlineGross)}
          />
          <Stat label={t.earnings.refunded} value={eur(totals.refunded)} />
          <Stat label={t.earnings.ludiFee} value={eur(totals.fee)} />
        </section>

        {rows.length === 0 ? (
          <EmptyState>{t.earnings.empty}</EmptyState>
        ) : (
          <Card>
            <GmvChart
              series={series}
              keptLabel={viewer.isAdmin ? t.earnings.keptVenues : t.earnings.keptYours}
              copy={t.earnings.chart}
              locale={locale}
            />
          </Card>
        )}

        {showBreakdown && venueRows.length > 0 ? (
          <Card pad={false}>
            <Table
              head={
                <>
                  <Th>{t.earnings.thVenue}</Th>
                  <Th numeric>{t.earnings.thPaidInApp}</Th>
                  <Th numeric>{t.earnings.thRefunded}</Th>
                  <Th numeric>{t.earnings.thFee}</Th>
                  <Th numeric>{t.earnings.thThrough}</Th>
                  <Th numeric>{t.earnings.thAtVenue}</Th>
                  <Th numeric>{t.earnings.thTotal}</Th>
                  <Th numeric>{t.earnings.thBookings}</Th>
                </>
              }
            >
              {venueRows.map((v) => (
                <tr key={v.name}>
                  <Td label={t.earnings.thVenue}>{v.name}</Td>
                  <Td label={t.earnings.thPaidInApp} numeric>
                    {eur(v.t.gross - v.t.offlineGross)}
                  </Td>
                  <Td label={t.earnings.thRefunded} numeric>
                    {v.t.refunded ? eur(v.t.refunded) : t.common.dash}
                  </Td>
                  <Td label={t.earnings.thFee} numeric>
                    {eur(v.t.fee)}
                  </Td>
                  <Td label={t.earnings.thThrough} numeric>
                    {eur(paidThroughLudi(v.t))}
                  </Td>
                  <Td label={t.earnings.thAtVenue} numeric>
                    {takenAtVenue(v.t) ? eur(takenAtVenue(v.t)) : t.common.dash}
                  </Td>
                  <Td label={t.earnings.thTotal} numeric>
                    {eur(v.t.venueNet)}
                  </Td>
                  <Td label={t.earnings.thBookings} numeric>
                    {v.t.bookings}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        ) : null}

        <Card>
          <div className="stack" style={{ gap: 12 }}>
            <div
              style={{
                alignItems: 'baseline',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                justifyContent: 'space-between',
              }}
            >
              <strong>{t.earnings.payouts}</strong>
              {payoutControls.length === 1 && payoutControls[0] ? (
                <div>
                  <PayoutControl {...payoutControls[0]} t={t} />
                </div>
              ) : null}
            </div>
            {multiControl ? (
              <div className="stack" style={{ gap: 8 }}>
                {payoutControls.map((c) => (
                  <div key={c.venue.id}>
                    <PayoutControl {...c} t={t} named />
                  </div>
                ))}
              </div>
            ) : null}
            {payouts.length === 0 ? (
              <EmptyState>{t.earnings.noPayouts}</EmptyState>
            ) : (
              <Table
                head={
                  <>
                    <Th>{t.earnings.thArrives}</Th>
                    {showPayoutVenue ? <Th>{t.earnings.thVenue}</Th> : null}
                    <Th numeric>{t.earnings.thAmount}</Th>
                    <Th>{t.earnings.thStatus}</Th>
                  </>
                }
              >
                {payouts.map((p) => (
                  <tr key={p.stripe_payout_id}>
                    <Td label={t.earnings.thArrives}>{p.arrival_date ?? t.common.dash}</Td>
                    {showPayoutVenue ? (
                      <Td label={t.earnings.thVenue}>{p.venues?.name ?? t.common.dash}</Td>
                    ) : null}
                    <Td label={t.earnings.thAmount} numeric>
                      {eur(p.amount_cents)}
                    </Td>
                    <Td label={t.earnings.thStatus}>
                      <Badge tone={p.status === 'paid' ? 'good' : 'alert'}>
                        {p.status === 'paid' ? t.earnings.statusPaid : t.earnings.statusFailed}
                      </Badge>
                      {p.status === 'failed' && p.failure_message ? (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 12,
                            marginTop: 2,
                          }}
                        >
                          {p.failure_message}
                        </span>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        </Card>

        <p className="footnote">{footnote(t, viewer.isAdmin)}</p>
      </div>
    </AppShell>
  );
}

// The footnote names the timezone in bold; the dictionary carries the
// sentence and the page splits it around the one word that is not text.
function footnote(t: AdminCopy, admin: boolean): ReactNode {
  const text = t.earnings.footnote({ tz: VENUE_TZ, admin });
  const at = text.indexOf(VENUE_TZ);
  if (at === -1) return text;
  return (
    <>
      {text.slice(0, at)}
      <strong>{VENUE_TZ}</strong>
      {text.slice(at + VENUE_TZ.length)}
    </>
  );
}

// The Stripe control for one venue on the Payouts card. `named` labels it
// with the venue for a multi-venue owner, who gets one per venue.
function PayoutControl({
  venue,
  hasAccount,
  canManage,
  t,
  named = false,
}: {
  venue: VenueStripeRow;
  hasAccount: boolean;
  canManage: boolean;
  t: AdminCopy;
  named?: boolean;
}) {
  const prefix = named ? <strong>{venue.name}: </strong> : null;
  const note = (text: ReactNode) => (
    <span style={{ color: 'var(--ludi-ink2)', fontSize: 13 }}>
      {prefix}
      {text}
    </span>
  );

  if (!canManage) return note(t.earnings.ownerManages);

  switch (venue.stripe_account_status) {
    case 'active':
    case 'restricted':
      return (
        <StripeDashboardButton
          venueId={venue.id}
          label={named ? t.earnings.openInStripe(venue.name) : undefined}
        />
      );
    case 'disabled':
      return note(
        <>
          {t.earnings.disabledBefore}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
          {t.earnings.disabledAfter}
        </>,
      );
    case 'pending':
    default:
      return (
        <OwnerConnectButton
          venueId={venue.id}
          hasAccount={hasAccount}
          returnPath="/earnings"
          label={named ? t.earnings.finishSetupFor(venue.name) : t.earnings.finishSetup}
        />
      );
  }
}

// Sum the (possibly multi-venue) rows into one series point per day, and
// fill the quiet days with zeros so the chart shows continuous time.
// net_cents here is venue_net (after Ludi's fee), not the view's
// gross − refunded net_cents, so the chart matches the headline.
function densify(fromIso: string, toIso: string, rows: EarningsRow[]): GmvDay[] {
  const empty = (day: string): GmvDay => ({
    day,
    gross_cents: 0,
    refunded_cents: 0,
    fee_cents: 0,
    net_cents: 0,
  });
  const byDay = new Map<string, GmvDay>();
  for (const r of rows) {
    const d = byDay.get(r.day) ?? empty(r.day);
    d.gross_cents += numericCents(r.gross_cents);
    d.refunded_cents += numericCents(r.refunded_cents);
    d.fee_cents = (d.fee_cents ?? 0) + numericCents(r.fee_cents);
    d.net_cents += numericCents(r.venue_net_cents);
    byDay.set(r.day, d);
  }

  const out: GmvDay[] = [];
  for (let day = fromIso; day <= toIso; day = addDaysToKey(day, 1)) {
    out.push(byDay.get(day) ?? empty(day));
  }
  return out;
}

// Aggregates over bigint columns come back as strings via PostgREST.
function numericCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}
