import type { CSSProperties } from 'react';
import Link from 'next/link';

import { PrintButton } from '@/components/print-button';
import { AppShell, EmptyState, PageHead } from '@/components/ui';
import { requireVenueAccess } from '@/lib/auth';
import { saturdayOnOrAfter } from '@/lib/cfa';
import { getCopy, intlTag } from '@/lib/copy';
import { qrSvg, screenUrl, venueUrl } from '@/lib/screen-link';
import { venueToday } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { venueMark, type VenueMark } from '@/lib/venue-marks';

// The CFA programme on the wall (plans/cfa-grassroots-saturday.md): a list by
// kick-off, because coaches read down by time to find their court. Greek on
// paper whatever the account says, like the day sheet. Team names only — the
// CFA publishes them; no children, no phones.

type SearchParams = { venue?: string; day?: string };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const GREEK_DAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

export default async function ProgrammePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const viewer = await requireVenueAccess();
  const params = await searchParams;
  const t = getCopy(viewer.locale);
  const venue = viewer.venues.find((v) => v.id === params.venue) ?? viewer.venues[0] ?? null;
  const day = params.day && DATE_KEY.test(params.day) ? params.day : saturdayOnOrAfter(venueToday());

  const supabase = await createClient();
  const { data } = venue
    ? await supabase
        .from('cfa_matches')
        .select('id, kickoff, category, home_team, away_team, round_label, status, booking:bookings!inner ( state, pitch:pitches!inner ( name ) )')
        .eq('venue_id', venue.id)
        .eq('match_date', day)
        .order('kickoff')
    : { data: [] };
  const matches = ((data ?? []) as unknown as Array<{
    id: string;
    kickoff: string;
    category: string;
    home_team: string;
    away_team: string;
    round_label: string;
    status: string;
    booking: { state: string; pitch: { name: string } | null } | null;
  }>)
    .filter((m) => m.booking && m.booking.state !== 'cancelled')
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff) || (a.booking?.pitch?.name ?? '').localeCompare(b.booking?.pitch?.name ?? '', undefined, { numeric: true }));

  // The live programme, one scan from the paper on the wall.
  let qr: string | null = null;
  // and the venue's page, where a parent follows their child's team in the
  // app (plans/release-1-0.md E2); the scan tag says it came off the paper
  let followQr: string | null = null;
  // the venue's own mark heads the paper when it has one
  let mark: VenueMark | null = null;
  if (venue && matches.length) {
    const [{ data: token }, { data: venueRow }] = await Promise.all([
      supabase.rpc('venue_display_token', { p_venue_id: venue.id }),
      supabase.from('venues').select('slug').eq('id', venue.id).maybeSingle(),
    ]);
    if (token) qr = await qrSvg(`${await screenUrl(token as string)}?day=${day}`);
    const slug = (venueRow as { slug: string | null } | null)?.slug;
    if (slug) followQr = await qrSvg(`${venueUrl(slug)}?s=${slug}-cfa-print`);
    mark = venueMark(slug);
  }

  const [y, mo, d] = day.split('-');
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const round = matches[0]?.round_label ?? '';
  const longDay = new Intl.DateTimeFormat(intlTag(viewer.locale), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));

  return (
    <AppShell viewer={viewer}>
      <PageHead
        title={t.cfa.programme}
        meta={`${venue?.name ?? ''} · ${longDay}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <PrintButton />
            {venue ? (
              <Link href={`/calendar/cfa?venue=${venue.id}&day=${day}`} className="btn btn-secondary">
                {t.cfa.title}
              </Link>
            ) : null}
            {venue ? (
              <Link href={`/calendar/screen?venue=${venue.id}`} className="btn btn-secondary">
                {t.screen.title}
              </Link>
            ) : null}
          </span>
        }
      />
      {matches.length === 0 ? (
        <EmptyState>{t.cfa.noMatches}</EmptyState>
      ) : (
        <>
          <div className="daysheet-head print-only programme-head">
            {qr ? (
              <div className="programme-qr">
                <div dangerouslySetInnerHTML={{ __html: qr }} />
                <span>ΖΩΝΤΑΝΑ ΣΤΟ ΚΙΝΗΤΟ</span>
              </div>
            ) : null}
            {followQr ? (
              <div className="programme-qr">
                <div dangerouslySetInnerHTML={{ __html: followQr }} />
                <span>ΑΚΟΛΟΥΘΗΣΤΕ ΤΗΝ ΟΜΑΔΑ ΣΑΣ</span>
              </div>
            ) : null}
            {mark ? (
              <img
                className="programme-mark"
                src={mark.src}
                alt={venue?.name ?? ''}
                style={{ '--mark-clear': mark.clear } as CSSProperties}
              />
            ) : null}
            <div className="daysheet-title">
              ΚΟΠ GRASSROOTS <span>{round.toUpperCase()}</span>
            </div>
            <div className="daysheet-fields">
              <span>
                <b>ΓΗΠΕΔΟ</b> {venue?.name}
              </span>
              <span>
                <b>ΗΜΕΡΑ</b> {GREEK_DAYS[dow]} {`${d}/${mo}/${y}`}
              </span>
              <span className="daysheet-stamp">Ludi · {venueToday()}</span>
            </div>
          </div>
          <div className="card calendar-card" style={{ padding: 0 }}>
            <div className="calendar-scroll">
              <table className="programme">
                <thead>
                  <tr>
                    <th>ΩΡΑ</th>
                    <th>ΓΗΠΕΔΟ</th>
                    <th>ΚΑΤΗΓΟΡΙΑ</th>
                    <th>ΓΗΠΕΔΟΥΧΟΣ</th>
                    <th>ΦΙΛΟΞΕΝΟΥΜΕΝΗ</th>
                    <th className="programme-notes">ΠΑΡΑΤΗΡΗΣΕΙΣ</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m, i) => (
                    <tr key={m.id} className={i > 0 && matches[i - 1]!.kickoff !== m.kickoff ? 'programme-newtime' : ''}>
                      <td className="mono">{m.kickoff.slice(0, 5)}</td>
                      <td>{m.booking?.pitch?.name}</td>
                      <td>{m.category}</td>
                      <td>{m.home_team}</td>
                      <td>{m.away_team}</td>
                      <td className="programme-notes">{m.status === 'postponed' ? 'ΑΝΑΒΟΛΗ' : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
