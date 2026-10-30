import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site';

// Served at /robots.txt. The middleware matcher excludes anything containing
// a dot, so this path is not rewritten into a locale segment.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Invite landings are capabilities, not pages (ADR-0025). They also
      // send per-page noindex; this keeps crawlers from even fetching them.
      // /download counts a press of "Get the app"; a crawler is not one.
      disallow: ['/f/', '/el/f/', '/download', '/el/download'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
