'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import { tokens } from '@/lib/tokens';
import type { VenuePin } from '@/lib/venue';

// The island on the site (plans/maps.md M3): live venues as pins on
// MapLibre with OpenFreeMap's tiles. No key, no account, no per-user fee;
// OpenStreetMap's attribution comes with the style. A pin links to the
// venue's page. Client-only: the map needs the window, and the page's
// text renders without it.

const STYLE = 'https://tiles.openfreemap.org/styles/positron';

export function VenueMap({
  pins,
  center,
  zoom,
  height = 320,
  hrefFor,
  ariaLabel,
}: {
  pins: VenuePin[];
  /** Framed to the pins when absent. */
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: number;
  hrefFor: (slug: string) => string;
  ariaLabel: string;
}) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current || pins.length === 0) return;
    const map = new maplibregl.Map({
      container: el.current,
      style: STYLE,
      center: center ? [center.lng, center.lat] : [pins[0]!.lng, pins[0]!.lat],
      zoom: zoom ?? 8,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    if (!center && pins.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      for (const p of pins) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding: 48, maxZoom: 11, duration: 0 });
    }

    const markers = pins.map((p) => {
      const dot = document.createElement('a');
      dot.href = hrefFor(p.slug);
      dot.title = p.name;
      dot.setAttribute('aria-label', p.name);
      dot.style.cssText =
        `display:block;width:22px;height:22px;border-radius:11px;background:${tokens.surface};` +
        `box-shadow:0 1px 3px rgba(16,24,28,.25);position:relative;`;
      const core = document.createElement('span');
      core.style.cssText =
        `position:absolute;left:5px;top:5px;width:12px;height:12px;border-radius:6px;` +
        `background:${p.bookable ? tokens.terracotta : tokens.ink3};`;
      dot.appendChild(core);
      const popup = new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(
        `<a href="${hrefFor(p.slug)}" style="font-weight:600;color:${tokens.ink}">${escapeHtml(p.name)}</a>`,
      );
      return new maplibregl.Marker({ element: dot }).setLngLat([p.lng, p.lat]).setPopup(popup).addTo(map);
    });

    return () => {
      markers.forEach((m) => m.remove());
      map.remove();
    };
  }, [pins, center, zoom, hrefFor]);

  return (
    <div
      ref={el}
      role="region"
      aria-label={ariaLabel}
      style={{ height, borderRadius: 16, overflow: 'hidden', border: `1px solid ${tokens.line}` }}
    />
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
