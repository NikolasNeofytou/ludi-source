import Link from 'next/link';

import { EndSeriesForm, StandingForm, type StandingCourt } from '@/components/standing-form';
import { AppShell, Badge, Card, EmptyState, PageHead } from '@/components/ui';
import { requireVenueAccess, scopeToViewer } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import { venueToday } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

// Standing bookings — the owner's recurring walk-ins (plans/standing-
// bookings.md, ADR-0033). Listed per venue with what is ahead, what was
// skipped and why; created and ended from here. The instances themselves
// live on Bookings, the Calendar and the day sheet like any walk-in.

type SeriesRow = {
  id: string;
  venue_id: string;
  name: string;
  phone: string | null;
  weekdays: number[];
  starts_time: string;
  duration_minutes: number;
  starts_on: string;
  ends_on: string | null;
  created_at: string;
};

type SkipRow = { series_id: string; pitch_id: string; on_date: string; reason: string };

const ORDER = [1, 2, 3, 4, 5, 6, 0];

export default async function StandingPage() {
  const viewer = await requireVenueAccess();
  const scope = scopeToViewer(viewer);
  const t = getCopy(viewer.locale);
  const today = venueToday();
  const supabase = await createClient();

  let courtQuery = supabase
    .from('pitches')
    .select('id, name, type, venue_id')
    .eq('is_active', true)
    .order('name');
  if (scope) courtQuery = courtQuery.in('venue_id', scope);
  let seriesQuery = supabase
    .from('booking_series')
    .select('id, venue_id, name, phone, weekdays, starts_time, duration_minutes, starts_on, ends_on, created_at')
    .order('created_at', { ascending: false });
  if (scope) seriesQuery = seriesQuery.in('venue_id', scope);

  const [{ data: courtRows, error: courtError }, { data: seriesRows, error: seriesError }] =
    await Promise.all([courtQuery, seriesQuery]);
  if (courtError) throw new Error(`standing: courts failed: ${courtError.message}`);
  if (seriesError) throw new Error(`standing: series failed: ${seriesError.message}`);

  const courts = (courtRows ?? []) as StandingCourt[];
  const series = (seriesRows ?? []) as SeriesRow[];
  const courtName = new Map(courts.map((c) => [c.id, c.name]));
  const venueName = new Map(viewer.venues.map((v) => [v.id, v.name]));

  // Per series: its courts, what is still ahead, and the skips.
  const ids = series.map((s) => s.id);
  let pitchesOf = new Map<string, string[]>();
  let ahead = new Map<string, number>();
  let skips = new Map<string, SkipRow[]>();
  if (ids.length) {
    const [{ data: sp }, { data: inst }, { data: sk }] = await Promise.all([
      supabase.from('booking_series_pitches').select('series_id, pitch_id').in('series_id', ids),
      supabase
        .from('bookings')
        .select('series_id')
        .in('series_id', ids)
        .eq('state', 'confirmed')
        .gte('starts_at', new Date().toISOString()),
      supabase
        .from('booking_series_skips')
        .select('series_id, pitch_id, on_date, reason')
        .in('series_id', ids)
        .gte('on_date', today)
        .order('on_date'),
    ]);
    pitchesOf = new Map();
    for (const r of sp ?? []) {
      const list = pitchesOf.get(r.series_id as string) ?? [];
      list.push(courtName.get(r.pitch_id as string) ?? '?');
      pitchesOf.set(r.series_id as string, list);
    }
    ahead = new Map();
    for (const r of inst ?? []) {
      ahead.set(r.series_id as string, (ahead.get(r.series_id as string) ?? 0) + 1);
    }
    skips = new Map();
    for (const r of (sk ?? []) as SkipRow[]) {
      skips.set(r.series_id, [...(skips.get(r.series_id) ?? []), r]);
    }
  }

  const live = series.filter((s) => !s.ends_on || s.ends_on >= today);
  const ended = series.filter((s) => s.ends_on && s.ends_on < today);

  return (
    <AppShell viewer={viewer}>
      <PageHead
        title={t.standing.title}
        meta={t.standing.live(live.length)}
        actions={
          <Link href="/calendar" className="btn btn-secondary">
            {t.standing.calendar}
          </Link>
        }
      />
      <p className="page-intro">{t.standing.intro}</p>

      <div className="stack">
        <Card>
          <p className="form-section">{t.standing.newSeries}</p>
          <StandingForm venues={viewer.venues} courts={courts} today={today} />
        </Card>

        {live.length === 0 ? (
          <EmptyState>{t.standing.empty}</EmptyState>
        ) : (
          live.map((s) => (
            <Card key={s.id}>
              <div className="standing-head">
                <div>
                  <strong>{s.name}</strong>
                  {viewer.isAdmin || viewer.venues.length > 1 ? (
                    <span className="field-hint"> · {venueName.get(s.venue_id) ?? '—'}</span>
                  ) : null}
                  <div className="field-hint">
                    {(pitchesOf.get(s.id) ?? []).join(', ') || t.standing.noCourts} ·{' '}
                    {ORDER.filter((d) => s.weekdays.includes(d))
                      .map((d) => t.days.short[d])
                      .join(' ')}{' '}
                    · {s.starts_time.slice(0, 5)} {t.standing.forDuration}{' '}
                    {s.duration_minutes % 60 === 0
                      ? t.common.hoursLong(s.duration_minutes / 60)
                      : t.common.minutes(s.duration_minutes)}{' '}
                    · {t.standing.from(s.starts_on)}
                    {s.ends_on ? t.standing.until(s.ends_on) : t.standing.openEnded}
                    {s.phone ? ` · ${s.phone}` : ''}
                  </div>
                </div>
                <div className="standing-stats">
                  <Badge tone="good">{t.standing.ahead(ahead.get(s.id) ?? 0)}</Badge>
                  {(skips.get(s.id) ?? []).length ? (
                    <Badge tone="warn">{t.standing.skipped(skips.get(s.id)!.length)}</Badge>
                  ) : null}
                </div>
              </div>
              {(skips.get(s.id) ?? []).length ? (
                <ul className="standing-skips">
                  {skips.get(s.id)!.slice(0, 8).map((k) => (
                    <li key={`${k.pitch_id}|${k.on_date}`}>
                      {k.on_date} · {courtName.get(k.pitch_id) ?? '?'} — {k.reason}
                    </li>
                  ))}
                  {skips.get(s.id)!.length > 8 ? (
                    <li>{t.standing.andMore(skips.get(s.id)!.length - 8)}</li>
                  ) : null}
                </ul>
              ) : null}
              <div style={{ marginTop: 12 }}>
                <EndSeriesForm seriesId={s.id} name={s.name} today={today} />
              </div>
            </Card>
          ))
        )}

        {ended.length ? (
          <Card>
            <p className="form-section">{t.standing.ended}</p>
            <ul className="enrol-saved">
              {ended.map((s) => (
                <li key={s.id}>
                  <strong>{s.name}</strong>
                  <span>
                    {(pitchesOf.get(s.id) ?? []).join(', ')} · {s.starts_on} → {s.ends_on}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
