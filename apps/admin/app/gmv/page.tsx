import Link from 'next/link';

import { GmvChart, type GmvDay } from '@/components/gmv-chart';
import { AppShell, Card, PageHead, Stat } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { VENUE_TZ, addDaysToKey, formatEur, venueToday } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

const RANGE_OPTIONS = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number]['key'];
const DEFAULT_RANGE: RangeKey = '30';

type SearchParams = { range?: string };

type GmvViewRow = {
  day: string;
  gross_cents: number | string | null;
  refunded_cents: number | string | null;
  net_cents: number | string | null;
  payments_count: number | null;
  bookings_count: number | null;
};

export default async function GmvPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requireAdmin();
  const params = await searchParams;
  const rangeKey: RangeKey =
    RANGE_OPTIONS.find((r) => r.key === params.range)?.key ?? DEFAULT_RANGE;
  const days = RANGE_OPTIONS.find((r) => r.key === rangeKey)!.days;

  const todayLocal = venueToday();
  const fromLocal = addDaysToKey(todayLocal, -(days - 1));

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('v_gmv_daily')
    .select('day, gross_cents, refunded_cents, net_cents, payments_count, bookings_count')
    .gte('day', fromLocal)
    .lte('day', todayLocal)
    .order('day', { ascending: true });
  if (error) {
    throw new Error(`gmv: view query failed: ${error.message}`);
  }

  const rows = (data ?? []) as GmvViewRow[];

  // Fill missing days with zeros so the chart shows continuous time, not
  // just the days that happened to have payments.
  const series = densify(fromLocal, todayLocal, rows);

  // Totals come from the raw rows — densified zero-days can't contribute to
  // counts and would just add no-op zeros to the sum.
  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + numericCents(r.gross_cents),
      refunded: acc.refunded + numericCents(r.refunded_cents),
      net: acc.net + numericCents(r.net_cents),
      payments: acc.payments + (r.payments_count ?? 0),
      bookings: acc.bookings + (r.bookings_count ?? 0),
    }),
    { gross: 0, refunded: 0, net: 0, payments: 0, bookings: 0 },
  );

  return (
    <AppShell viewer={viewer}>
      <PageHead
        title="Revenue"
        meta={`${fromLocal} → ${todayLocal} · ${VENUE_TZ}`}
      />

      <div className="stack">
        <nav aria-label="Time range" className="pills">
          {RANGE_OPTIONS.map((r) => (
            <Link
              key={r.key}
              href={r.key === DEFAULT_RANGE ? '/gmv' : `/gmv?range=${r.key}`}
              className="pill"
              aria-current={r.key === rangeKey ? 'page' : undefined}
            >
              {r.label}
            </Link>
          ))}
        </nav>

        <section className="stats">
          <Stat label="Gross" value={formatEur(totals.gross)} />
          <Stat label="Refunded" value={formatEur(totals.refunded)} />
          <Stat label="Net" value={formatEur(totals.net)} />
          <Stat label="Payments" value={formatCount(totals.payments)} />
          <Stat label="Bookings" value={formatCount(totals.bookings)} />
        </section>

        <Card>
          <GmvChart series={series} />
        </Card>

        <p className="footnote">
          Money paid through Ludi only &mdash; app bookings charged by Stripe.
          Walk-ins venues take at the desk are not counted here (they are on
          each venue&rsquo;s Earnings). Buckets are <strong>{VENUE_TZ}</strong>{' '}
          local dates so totals align with venue operating days, not UTC.
          Refunds are attributed to the original payment&rsquo;s date.
          Pending, failed, and cancelled payments are excluded. Net is before
          Ludi&rsquo;s fee.
        </p>
      </div>
    </AppShell>
  );
}

// Pinned to en-GB rather than the runtime default. An unqualified
// toLocaleString() renders with whatever locale the *server* process has
// and again with the *browser's* — a hydration mismatch waiting for the
// first four-figure number. format.ts and the chart's day labels already
// pin both locale and timezone; these two counts were the only formatting
// left unpinned.
function formatCount(n: number): string {
  return n.toLocaleString('en-GB');
}

function densify(fromIso: string, toIso: string, rows: GmvViewRow[]): GmvDay[] {
  const byDay = new Map<string, GmvViewRow>();
  for (const r of rows) byDay.set(r.day, r);

  const out: GmvDay[] = [];
  for (let day = fromIso; day <= toIso; day = addDaysToKey(day, 1)) {
    const row = byDay.get(day);
    out.push({
      day,
      gross_cents: numericCents(row?.gross_cents),
      refunded_cents: numericCents(row?.refunded_cents),
      net_cents: numericCents(row?.net_cents),
    });
  }
  return out;
}

// Aggregates over bigint columns come back as strings via PostgREST. Coerce
// defensively rather than scattering Number() at every read site.
function numericCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}
