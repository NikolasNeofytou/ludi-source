import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AppShell, Card, PageHead } from '@/components/ui';
import { FillList, type FillCandidate } from '@/components/fill-list';
import { requireVenueAccess } from '@/lib/auth';
import { getCopy, intlTag } from '@/lib/copy';
import { formatEur, venueDateKey } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

// Fill the hour, step two (plans/fill-the-hour.md, ADR-0045): who to ask,
// best first, each a tap that opens the owner's own WhatsApp with the
// message written. The page says whether the hour is still free and, once
// it is not, whether someone he asked took it.

export const dynamic = 'force-dynamic';

export default async function FillOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale);
  const f = t.fill;
  if (viewer.isAdmin) redirect('/venues');

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const supabase = await createClient();
  // RLS: the venue's owner reads its offers and nobody else does.
  const { data: offer } = await supabase
    .from('fill_offers')
    .select('id, venue_id, pitch_id, starts_at, ends_at, price_cents, pitch:pitches ( name, price_per_hour_cents ), venue:venues ( name )')
    .eq('id', id)
    .maybeSingle<{
      id: string;
      venue_id: string;
      pitch_id: string;
      starts_at: string;
      ends_at: string;
      price_cents: number | null;
      pitch: { name: string; price_per_hour_cents: number } | null;
      venue: { name: string } | null;
    }>();
  if (!offer || !offer.pitch) notFound();

  const [stateRes, candRes, optedRes] = await Promise.all([
    supabase.rpc('fill_hour_state', { p_offer_id: offer.id }),
    supabase.rpc('fill_hour_candidates', { p_offer_id: offer.id }),
    supabase
      .from('venue_contacts')
      .select('id, display_name')
      .eq('venue_id', offer.venue_id)
      .not('offers_opt_out_at', 'is', null)
      .order('display_name')
      .limit(50),
  ]);
  // Codes, not messages: these rows are people's names and numbers.
  if (stateRes.error) throw new Error(`fill: state failed (${stateRes.error.code || 'unknown'})`);
  if (candRes.error) throw new Error(`fill: candidates failed (${candRes.error.code || 'unknown'})`);

  const state = (stateRes.data ?? [])[0] as
    | { filled: boolean; filled_by_asked: boolean; booking_code: string | null; asked: number }
    | undefined;
  const candidates = (candRes.data ?? []) as FillCandidate[];
  const opted = (optedRes.data ?? []) as { id: string; display_name: string }[];

  const minutes = Math.round((Date.parse(offer.ends_at) - Date.parse(offer.starts_at)) / 60_000);
  const usual = Math.round((offer.pitch.price_per_hour_cents * minutes) / 60);
  const tag = intlTag(viewer.locale);
  const at = new Date(offer.starts_at);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag, { timeZone: 'Europe/Nicosia', ...o }).format(at);
  const weekday = fmt({ weekday: 'long' });
  const dayMonth = fmt({ day: 'numeric', month: 'numeric' });
  const time = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const priceText =
    offer.price_cents !== null && offer.price_cents < usual
      ? f.priceDeal(formatEur(offer.price_cents, viewer.locale), formatEur(usual, viewer.locale))
      : f.priceUsual(formatEur(offer.price_cents ?? usual, viewer.locale));

  const status = state?.filled
    ? state.filled_by_asked
      ? f.statusFilledAsked(state.booking_code ?? '')
      : f.statusFilledOther(state.booking_code ?? '')
    : f.statusOpen(state?.asked ?? 0);

  return (
    <AppShell viewer={viewer}>
      <PageHead title={f.title} meta={offer.venue?.name} />
      <div className="stack">
        <Card>
          <div className="fill-slot">
            <strong>{f.slot(offer.pitch.name, `${weekday} ${dayMonth} · ${time}`)}</strong>
            <span className={state?.filled ? 'badge badge-good' : 'badge badge-info'}>{status}</span>
          </div>
        </Card>
        <FillList
          offerId={offer.id}
          filled={Boolean(state?.filled)}
          candidates={candidates}
          opted={opted}
          context={{
            court: offer.pitch.name,
            when: f.whenPhrase(weekday, dayMonth, time),
            price: priceText,
            venue: offer.venue?.name ?? '',
          }}
        />
        <p>
          <Link href={`/calendar?date=${venueDateKey(at)}`} className="fill-quiet">
            {f.backToCalendar}
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
