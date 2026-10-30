import type { MetadataRoute } from 'next';

import { locales } from '@/lib/content';
import { localePath } from '@/lib/paths';
import { LISTED_ROUTES, SITE_URL } from '@/lib/site';
import { fetchVenueSlugs } from '@/lib/venue';

// Bumped by hand when page copy actually changes. A build-time `new Date()`
// would restamp every route on every deploy, which tells crawlers the whole
// site changed when nothing did.
const LAST_MODIFIED = new Date('2026-10-14');

// Home and /owners are the pages with a job to do (player awareness, owner
// pitch — docs/plans/site.md §Why this exists). /keepers carries the same
// weight: it is the site's one recruitment ask, and the goalkeeper shortage
// is what the first venue owner asked us to solve. Legal pages are required,
// not promoted. A venue's own page (plans/reach.md R1) sits just under the
// audience pages: it is the one a search for that venue should find.
const PRIORITY: Record<string, number> = {
  '/': 1,
  '/players': 0.8,
  '/keepers': 0.8,
  '/owners': 0.8,
  '/privacy': 0.3,
  '/terms': 0.3,
};
const VENUE_PRIORITY = 0.7;

function entry(route: string, priority: number): MetadataRoute.Sitemap {
  return locales.map((locale) => ({
    url: `${SITE_URL}${localePath(locale, route)}`,
    lastModified: LAST_MODIFIED,
    changeFrequency: 'monthly' as const,
    priority,
    alternates: {
      languages: Object.fromEntries(locales.map((l) => [l, `${SITE_URL}${localePath(l, route)}`])),
    },
  }));
}

// Served at /sitemap.xml. Each URL carries hreflang alternates for both
// locales so Google serves the Greek mirror to Greek speakers instead of
// treating /el/* as duplicate content. Venue pages are read from the
// backend at request time; without one (CI's build) the list is just the
// static routes.
//
// Per request, not at build: the first production build (2026-10-14)
// prerendered this with an empty venue list, and a venue added later must
// appear without a deploy. Crawlers fetch a sitemap rarely; one RPC each
// time is nothing.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await fetchVenueSlugs();
  return [
    ...LISTED_ROUTES.flatMap((route) => entry(route, PRIORITY[route] ?? 0.5)),
    ...slugs.flatMap((slug) => entry(`/v/${slug}`, VENUE_PRIORITY)),
  ];
}
