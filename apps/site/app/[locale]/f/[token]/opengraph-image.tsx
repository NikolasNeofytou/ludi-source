import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';

import { OG_SIZE, OgCard } from '@/components/og-card';
import { getCopy, locales } from '@/lib/content';
import type { Locale } from '@/lib/content/types';
import { fetchFixturePreview, fixtureState, formatFixtureWhen } from '@/lib/fixture';

import LocaleImage from '../../opengraph-image';

// The game's own link preview (plans/instagram.md IG-3): when, where and the
// format, so an invite forwarded on WhatsApp or sent in an Instagram DM
// unfurls as the game. No seat count (ADR-0055): the preview is cached for
// days and the count would outlive itself. A game that has kicked off, been
// called off, or never existed gets the site's own card, so a dead link
// unfurls without apologising (ADR-0025).

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'A Ludi match invite';

export default async function FixtureImage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  // A route handler: the locale layout's own check doesn't reach it.
  if (!(locales as readonly string[]).includes(locale)) notFound();
  const lang = locale as Locale;

  const result = await fetchFixturePreview(token);
  const state = result.kind === 'ok' ? fixtureState(result.preview) : null;
  if (result.kind !== 'ok' || (state !== 'open' && state !== 'full')) {
    return LocaleImage({ params: Promise.resolve({ locale: lang }) });
  }

  const p = result.preview;
  const copy = getCopy(lang).fixture;
  const city = lang === 'el' ? p.city_name_gr : p.city_name_en;
  // "Πέμπτη 22 Οκτωβρίου · 21:00–22:00": the day and the time on lines of their own.
  const [day = '', time = ''] = formatFixtureWhen(lang, p.starts_at, p.ends_at).split(' · ');

  return new ImageResponse(
    <OgCard
      kicker={copy.eyebrow}
      title={[day, time]}
      lines={[`${p.venue_name} · ${city}`]}
      chip={copy.pitchTypes[p.pitch_type]}
      url="ludi.football"
    />,
    size,
  );
}
