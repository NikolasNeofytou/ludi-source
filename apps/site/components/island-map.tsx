'use client';

import dynamic from 'next/dynamic';

import type { VenuePin } from '@/lib/venue';

// The map library needs the window, so it loads only in the browser and
// only on pages that show a map; the page's text never waits for it.
const VenueMap = dynamic(() => import('@/components/venue-map').then((m) => m.VenueMap), {
  ssr: false,
  loading: () => <div style={{ height: 320, borderRadius: 16, background: 'rgba(16,24,28,0.04)' }} />,
});

export function IslandMap({
  pins,
  center,
  zoom,
  height,
  hrefPrefix,
  ariaLabel,
}: {
  pins: VenuePin[];
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: number;
  /** `/v/` or `/el/v/`: the locale's venue path. */
  hrefPrefix: string;
  ariaLabel: string;
}) {
  return (
    <VenueMap
      pins={pins}
      center={center}
      zoom={zoom}
      height={height}
      hrefFor={(slug) => `${hrefPrefix}${slug}`}
      ariaLabel={ariaLabel}
    />
  );
}
