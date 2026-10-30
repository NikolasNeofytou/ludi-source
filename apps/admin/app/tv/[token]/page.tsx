import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { TvScreen, type TvData } from '@/components/tv-screen';
import { joinUrl, qrSvg, screenUrl, venueUrl } from '@/lib/screen-link';
import { createClient } from '@/lib/supabase/server';

// The public screen of a venue's day (plans/cfa-grassroots-saturday.md) — the
// lobby TV and anyone's phone, no sign-in. Everything it shows comes from
// public_venue_schedule(token): CFA matches in full, every other booking only
// as booked. An unknown link is a 404, not a hint that a venue exists.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ludi · Πρόγραμμα',
  robots: { index: false, follow: false },
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export default async function TvPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { token } = await params;
  const { day } = await searchParams;
  if (!/^[a-f0-9]{32,128}$/.test(token)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('public_venue_schedule', {
    p_token: token,
    p_date: day && DATE_KEY.test(day) ? day : null,
  });
  if (error) throw new Error(`tv: schedule failed: ${error.message}`);
  if (!data) notFound();

  // The same screen for a phone, from across the lobby.
  const schedule = data as TvData;
  const qr = await qrSvg(await screenUrl(token));

  // The wall (ADR-0043): each fixture still short of players gets a QR to
  // its invite, the same /f/<token> a WhatsApp forward carries.
  const joins = [...new Set(schedule.items.map((i) => i.join).filter((j): j is string => Boolean(j)))];
  const joinQr = Object.fromEntries(await Promise.all(joins.map(async (j) => [j, await qrSvg(joinUrl(j))] as const)));

  // A CFA day carries a second QR (plans/release-1-0.md E2): "follow your
  // child's team in Ludi" — the venue's page, which opens the app's venue
  // screen once the store build claims /v/*, and the site's page with Get
  // the app until then. The scan tag says it came from this screen.
  const followQr =
    schedule.slug && schedule.items.some((i) => i.kind === 'cfa')
      ? await qrSvg(`${venueUrl(schedule.slug)}?s=${schedule.slug}-cfa-tv`)
      : undefined;

  return <TvScreen data={schedule} qr={qr} joinQr={joinQr} followQr={followQr} />;
}
