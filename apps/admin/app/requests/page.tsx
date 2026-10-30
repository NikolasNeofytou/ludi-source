import { redirect } from 'next/navigation';

import { AppShell, Card, PageHead } from '@/components/ui';
import { DeskCard, type DeskItem } from '@/components/desk-card';
import { DeskPasteForm } from '@/components/desk-paste-form';
import type { WalkInPitch } from '@/components/walk-in-modal';
import { requireVenueAccess } from '@/lib/auth';
import { parseBookingRequest, type DeskCourt } from '@/lib/booking-request';
import { getCopy, intlTag } from '@/lib/copy';
import { venueToday, venueWallClockToIso } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

// The booking desk (plans/whatsapp-desk.md, ADR-0046): every booking
// message a venue received — pasted, or arriving on its connected WhatsApp
// number — read into a proposal beside the message, checked against the
// courts that are actually free, one tap from the ordinary walk-in form.
//
// Owner and manager: taking bookings is the day (ADR-0041). An admin is
// the processor of these messages and is sent to /venues.

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  source: 'paste' | 'whatsapp';
  sender_name: string | null;
  sender_phone: string | null;
  sender_phone_e164: string | null;
  body: string;
  received_at: string;
  status: 'new' | 'booked' | 'declined' | 'dismissed';
  booking: { code: string; starts_at: string; pitch: { name: string } | null } | null;
};

const DEFAULT_MINUTES = 60;
const OFFSETS = [-120, -60, 60, 120];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale);
  const d = t.desk;
  if (viewer.isAdmin) redirect('/venues');
  if (viewer.venues.length === 0) redirect('/');

  const params = await searchParams;
  const venue = viewer.venues.find((v) => v.id === params.venue) ?? viewer.venues[0]!;
  const supabase = await createClient();

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [courtsRes, waitingRes, handledRes, numberRes] = await Promise.all([
    supabase
      .from('pitches')
      .select('id, name, type, price_per_hour_cents')
      .eq('venue_id', venue.id)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('venue_inbox')
      .select('id, source, sender_name, sender_phone, sender_phone_e164, body, received_at, status, booking:bookings ( code, starts_at, pitch:pitches ( name ) )')
      .eq('venue_id', venue.id)
      .eq('status', 'new')
      .order('received_at', { ascending: true })
      .limit(50),
    supabase
      .from('venue_inbox')
      .select('id, source, sender_name, sender_phone, sender_phone_e164, body, received_at, status, booking:bookings ( code, starts_at, pitch:pitches ( name ) )')
      .eq('venue_id', venue.id)
      .neq('status', 'new')
      .gte('handled_at', weekAgo)
      .order('handled_at', { ascending: false })
      .limit(30),
    supabase.from('venue_whatsapp_numbers').select('display_phone').eq('venue_id', venue.id).maybeSingle(),
  ]);
  // Codes, not messages: these rows carry customers' names and numbers.
  if (waitingRes.error) throw new Error(`requests: list failed (${waitingRes.error.code || 'unknown'})`);
  if (handledRes.error) throw new Error(`requests: handled failed (${handledRes.error.code || 'unknown'})`);

  const courts = (courtsRes.data ?? []) as (DeskCourt & { price_per_hour_cents: number })[];
  const pitches: WalkInPitch[] = courts.map((c) => ({
    id: c.id,
    venueId: venue.id,
    name: c.name,
    venueName: venue.name,
    pricePerHourCents: c.price_per_hour_cents,
  }));

  const today = venueToday();
  const [hh, mm] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Nicosia',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date())
    .split(':')
    .map(Number);
  const nowMinutes = (hh ?? 0) * 60 + (mm ?? 0);
  const tag = intlTag(viewer.locale);

  const freeAt = async (date: string, minutes: number, length: number): Promise<string[]> => {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const startsAt = venueWallClockToIso(date, time);
    const endsAt = new Date(Date.parse(startsAt) + length * 60_000).toISOString();
    if (Date.parse(startsAt) <= Date.now()) return [];
    const { data } = await supabase.rpc('desk_free_courts', {
      p_venue_id: venue.id,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
    });
    return ((data ?? []) as { pitch_id: string }[]).map((r) => r.pitch_id);
  };

  const read = async (row: Row): Promise<DeskItem> => {
    const p = parseBookingRequest(row.body, { today, nowMinutes, courts });
    const length = p.durationMin ?? DEFAULT_MINUTES;
    let free: string[] = [];
    let chosen: string | null = null;
    let requestedTaken = false;
    const alternatives: string[] = [];
    let when: string | null = null;
    if (p.date && p.time) {
      const [h, m] = p.time.split(':').map(Number);
      const minutes = (h ?? 0) * 60 + (m ?? 0);
      const fits = (id: string) => !p.format || courts.find((c) => c.id === id)?.type === p.format;
      free = (await freeAt(p.date, minutes, length)).filter(fits);
      if (p.courtId) {
        requestedTaken = !free.includes(p.courtId);
        chosen = requestedTaken ? (free[0] ?? null) : p.courtId;
      } else {
        chosen = free[0] ?? null;
      }
      if (!chosen) {
        for (const off of OFFSETS) {
          const alt = minutes + off;
          if (alt < 8 * 60 || alt > 23 * 60) continue;
          if ((await freeAt(p.date, alt, length)).some(fits)) {
            alternatives.push(`${String(Math.floor(alt / 60)).padStart(2, '0')}:${String(alt % 60).padStart(2, '0')}`);
          }
        }
        alternatives.sort();
      }
      const at = new Date(venueWallClockToIso(p.date, p.time));
      const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag, { timeZone: 'Europe/Nicosia', ...o }).format(at);
      when = t.fill.whenPhrase(fmt({ weekday: 'long' }), fmt({ day: 'numeric', month: 'numeric' }), p.time);
    }
    return {
      ...row,
      proposal: {
        date: p.date,
        time: p.time,
        minutes: length,
        explicitMinutes: p.durationMin !== null,
        requestedCourtId: p.courtId,
        requestedTaken,
        courtId: chosen,
        confidence: p.confidence,
        alternatives,
        when,
      },
    };
  };

  const waiting = await Promise.all(((waitingRes.data ?? []) as unknown as Row[]).map(read));
  const handled = await Promise.all(((handledRes.data ?? []) as unknown as Row[]).map(read));
  const connected = numberRes.data?.display_phone ?? null;

  return (
    <AppShell viewer={viewer}>
      <PageHead title={d.title} meta={d.waiting(waiting.length)} />
      <p className="page-intro">{d.intro}</p>
      <div className="stack">
        {viewer.venues.length > 1 ? (
          <form method="get" className="filters">
            <label className="field">
              <span className="field-label">{t.contacts.venue}</span>
              <select name="venue" defaultValue={venue.id} className="input">
                {viewer.venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="filters-actions">
              <button type="submit" className="btn btn-secondary">
                {t.contacts.search}
              </button>
            </div>
          </form>
        ) : null}

        <p className="desk-number fill-muted">{connected ? d.connected(connected) : d.notConnected}</p>

        {waiting.length === 0 ? (
          <Card>
            <p className="fill-muted">{d.empty}</p>
          </Card>
        ) : (
          waiting.map((item) => (
            <DeskCard
              key={item.id}
              item={item}
              courts={courts}
              pitches={pitches}
              venueName={venue.name}
              connected={Boolean(connected)}
            />
          ))
        )}

        <Card>
          <h2 className="fill-title">{d.pasteTitle}</h2>
          <DeskPasteForm venueId={venue.id} />
        </Card>

        {handled.length > 0 ? (
          <>
            <h2 className="fill-title desk-recent">{d.recentTitle}</h2>
            {handled.map((item) => (
              <DeskCard
                key={item.id}
                item={item}
                courts={courts}
                pitches={pitches}
                venueName={venue.name}
                connected={Boolean(connected)}
              />
            ))}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
