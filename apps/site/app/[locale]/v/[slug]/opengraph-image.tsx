import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';

import { OG_SIZE, OgCard } from '@/components/og-card';
import { getCopy, locales } from '@/lib/content';
import type { Locale } from '@/lib/content/types';
import { fetchVenuePage, formatCourts } from '@/lib/venue';

import LocaleImage from '../../opengraph-image';

// The venue's own link preview (plans/instagram.md IG-3): its name, its town
// and its courts, for the bio link, a DM and the owner's *Your link*. No
// price and no open-games count (ADR-0055): the preview is cached for days,
// and the page reads both live. An unknown slug gets the site's own card.

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'A venue on Ludi';

export default async function VenueImage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  // A route handler: the locale layout's own check doesn't reach it.
  if (!(locales as readonly string[]).includes(locale)) notFound();
  const lang = locale as Locale;

  const venue = await fetchVenuePage(slug);
  if (!venue) return LocaleImage({ params: Promise.resolve({ locale: lang }) });

  const copy = getCopy(lang).venue;
  const city = lang === 'el' ? venue.city_name_gr : venue.city_name_en;

  return new ImageResponse(
    <OgCard
      kicker={city}
      title={[venue.name]}
      lines={[formatCourts(copy, venue)]}
      url={`ludi.football/v/${slug}`}
    />,
    size,
  );
}
