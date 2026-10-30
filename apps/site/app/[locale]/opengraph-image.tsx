import { ImageResponse } from 'next/og';

import { getCopy, locales } from '@/lib/content';
import type { Locale } from '@/lib/content/types';
import { tokens } from '@/lib/tokens';

// One image per locale, prerendered at build time alongside the pages.
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// A route handler, so the locale layout's own `dynamicParams = false` and
// its locale check don't reach it: `/wp-login.php/opengraph-image` would
// otherwise run this function with an unknown locale. These two images are
// the only ones there are, so anything else is a 404 without rendering.
export const dynamicParams = false;

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Ludi — book football pitches in Cyprus';

// Rendered by satori, which supports flexbox only — every container with
// more than one child needs an explicit `display: flex`. Type is the
// built-in default face rather than Literata: pulling a webfont in here
// would make every build depend on a network fetch, and the image carries
// its weight through colour and scale instead.
export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const { home } = getCopy(locale);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: tokens.primaryDeep,
          padding: '80px 88px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 128,
              fontWeight: 700,
              color: '#FFFFFF',
              letterSpacing: -4,
              lineHeight: 1,
            }}
          >
            Ludi
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 44,
              color: tokens.primarySoft,
              lineHeight: 1.3,
              maxWidth: 880,
            }}
          >
            {home.heroSubtitle}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 999,
              background: tokens.sun,
              marginRight: 18,
            }}
          />
          <div style={{ fontSize: 32, color: '#FFFFFF' }}>{home.eyebrow}</div>
        </div>
      </div>
    ),
    size,
  );
}
