'use client';

// MapPicker — set a venue's coordinates by dragging a pin or searching an
// address, instead of typing two six-decimal numbers into number fields.
//
// Why this exists: the venue form asked for latitude and longitude directly.
// A venue owner does not know their coordinates, and a mistyped digit is not
// obviously wrong — 34.9186 and 34.8186 both look plausible and are 11km
// apart. "Open in Maps" is a shipped feature, so a wrong pin sends players to
// the wrong gate. The failure is silent at entry and expensive later.
//
// The number inputs are KEPT, not replaced. They stay the source of truth the
// server action reads (`lat` / `lng`, unchanged), and the map writes into
// them. So there are three ways to set the same value — drag, search, type —
// and nothing downstream had to change. Typing is still the precise path when
// someone has exact coordinates from Maps.
//
// A tap on the map does NOT move the pin by itself. This form is mostly
// opened to fix a phone number, often on a phone, where a stray tap while
// scrolling past the map would silently relocate the venue. A tap offers
// "Move pin here" at that spot instead; dragging the pin stays one gesture
// because nobody drags a pin by accident.
//
// Leaflet + OpenStreetMap rather than Mapbox: see ADR-0020. Short version —
// this is an internal data-entry aid, not the brand-styled player map ADR-0008
// chose Mapbox for, and it needs no API key, no account and no cost.

import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { useCopy } from '@/components/locale-provider';

/** Larnaca. Used only when a form has no coordinates at all. */
const FALLBACK = { lat: 34.9163, lng: 33.6329 };

/**
 * Leaflet's default marker icon is loaded from a relative image path that
 * bundlers rewrite, so the stock marker renders as a broken image. Drawing
 * the pin as an inline SVG divIcon avoids the asset pipeline entirely.
 */
const PIN = L.divIcon({
  className: 'map-pin',
  html: `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 11 15 27 15 27s15-16 15-27c0-8.3-6.7-15-15-15z" fill="#175E77"/>
    <circle cx="15" cy="15" r="5.5" fill="#F2F4F3"/>
  </svg>`,
  iconSize: [30, 42],
  iconAnchor: [15, 42],
});

function round6(n: number): string {
  return n.toFixed(6);
}

/**
 * A typed coordinate, or null while it is still half-typed ("", "-") or
 * out of range. Accepts a comma decimal, which is what a Greek-locale
 * keyboard offers first.
 */
function parseCoord(raw: string, limit: number): number | null {
  const t = raw.trim().replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) && Math.abs(v) <= limit ? v : null;
}

/** Keeps the map centred when the pin moves via search or typing. */
function Recentre({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
  return null;
}

/** A click on the map proposes a spot; it takes a second tap to move the pin. */
function ClickToPropose({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export interface MapPickerProps {
  /** Initial values, as strings because they come from form defaults. */
  lat: string;
  lng: string;
  /** Pre-fills the address search box so the first search is one click. */
  addressHint?: string;
  /** Offer "Use my location" — for the counter flow, where the person holding the phone is standing on the pin. */
  locate?: boolean;
}

interface Hit {
  label: string;
  lat: number;
  lng: number;
}

export function MapPicker({ lat, lng, addressHint, locate = false }: MapPickerProps) {
  const t = useCopy().venue.map;
  const initial = useMemo(() => {
    const la = Number.parseFloat(lat);
    const ln = Number.parseFloat(lng);
    return Number.isFinite(la) && Number.isFinite(ln) ? { lat: la, lng: ln } : FALLBACK;
  }, [lat, lng]);

  const [pos, setPos] = useState(initial);
  // What the number fields show, kept apart from `pos`. Formatting the pin's
  // position into the field on every keystroke made typing impossible — "3"
  // became "3.000000" before the "4" could land. The field holds exactly what
  // was typed; the pin follows whenever it parses; the field is tidied to
  // 6 dp on blur, or when the pin moves some other way.
  const [latText, setLatText] = useState(() => round6(initial.lat));
  const [lngText, setLngText] = useState(() => round6(initial.lng));
  // Where the map was tapped, awaiting "Move pin here". See the header.
  const [candidate, setCandidate] = useState<{ lat: number; lng: number } | null>(null);
  // Stable across re-renders: react-leaflet re-opens a Popup whenever its
  // `position` changes identity, and a fresh array every render would close
  // it the moment anything else on the form re-rendered.
  const candidatePos = useMemo<L.LatLngTuple | null>(
    () => (candidate ? [candidate.lat, candidate.lng] : null),
    [candidate],
  );
  const [query, setQuery] = useState(addressHint ?? '');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const place = useCallback((la: number, ln: number) => {
    setPos({ lat: la, lng: ln });
    setLatText(round6(la));
    setLngText(round6(ln));
    setHits([]);
    setCandidate(null);
  }, []);

  /**
   * Nominatim, OpenStreetMap's geocoder. Deliberately search-on-submit rather
   * than search-as-you-type: its usage policy asks for at most one request a
   * second, and a keystroke-triggered search would breach that immediately.
   */
  const search = useCallback(async () => {
    const q = query.trim();
    if (q.length < 3) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSearching(true);
    setSearchError(null);
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', q);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '5');
      // Cyprus only — every venue is here, and it keeps a search for a common
      // street name from returning the same road in six other countries.
      url.searchParams.set('countrycodes', 'cy');
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) throw new Error(`geocoder returned ${res.status}`);
      const raw: unknown = await res.json();
      const list = Array.isArray(raw) ? raw : [];
      const parsed: Hit[] = list.flatMap((r) => {
        const o = r as { display_name?: unknown; lat?: unknown; lon?: unknown };
        const la = Number.parseFloat(String(o.lat));
        const ln = Number.parseFloat(String(o.lon));
        if (!Number.isFinite(la) || !Number.isFinite(ln)) return [];
        return [{ label: String(o.display_name ?? t.unnamed), lat: la, lng: ln }];
      });
      setHits(parsed);
      if (parsed.length === 0) setSearchError(t.noMatch);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setSearchError(t.unavailable);
    } finally {
      setSearching(false);
    }
  }, [query, t]);

  // The device's own fix, high accuracy on: a phone at the counter is
  // within a few metres of the gate, which is better than any search hit.
  const locateMe = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setSearchError(t.noGeolocation);
      return;
    }
    setLocating(true);
    setSearchError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        place(p.coords.latitude, p.coords.longitude);
        setLocating(false);
      },
      () => {
        setSearchError(t.locationDenied);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }, [place, t]);

  return (
    <div className="map-picker">
      {locate ? (
        <div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={locateMe}
            disabled={locating}
          >
            {locating ? t.locating : t.useLocation}
          </button>
        </div>
      ) : null}
      <div className="map-picker-search">
        <input
          className="input"
          type="search"
          value={query}
          placeholder={t.searchPlaceholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // The picker lives inside the venue <form>; Enter here must search,
            // not submit the whole form and create the venue.
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
        />
        <button type="button" className="btn-secondary" onClick={() => void search()} disabled={searching}>
          {searching ? t.searching : t.search}
        </button>
      </div>

      {searchError ? <p className="field-hint map-picker-error">{searchError}</p> : null}

      {hits.length > 0 ? (
        <ul className="map-picker-hits">
          {hits.map((h) => (
            <li key={`${h.lat},${h.lng}`}>
              <button type="button" className="map-picker-hit" onClick={() => place(h.lat, h.lng)}>
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="map-picker-canvas">
        <MapContainer
          center={[initial.lat, initial.lng]}
          zoom={15}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker
            position={[pos.lat, pos.lng]}
            icon={PIN}
            draggable
            eventHandlers={{
              dragend(e) {
                const m = e.target as L.Marker;
                const p = m.getLatLng();
                place(p.lat, p.lng);
              },
            }}
          />
          <ClickToPropose onPick={(la, ln) => setCandidate({ lat: la, lng: ln })} />
          {candidate && candidatePos ? (
            <Popup
              position={candidatePos}
              // Closed by its ×, or by tapping elsewhere on the map (which
              // proposes the new spot instead).
              eventHandlers={{ remove: () => setCandidate(null) }}
            >
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => place(candidate.lat, candidate.lng)}
              >
                {t.movePin}
              </button>
            </Popup>
          ) : null}
          <Recentre lat={pos.lat} lng={pos.lng} />
        </MapContainer>
      </div>

      <p className="field-hint">{t.hint}</p>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">{t.latitude}</span>
          {/* Text, not type="number": a number input reports a value it
              can't parse yet (a lone "-", a comma decimal) as empty, which
              fights the raw-text state above. */}
          <input
            name="lat"
            className="input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={latText}
            onChange={(e) => {
              setLatText(e.target.value);
              const v = parseCoord(e.target.value, 90);
              if (v !== null) setPos((p) => ({ ...p, lat: v }));
            }}
            // Whatever parsed last is where the pin is; show that, tidied.
            // Anything unparseable falls back to the pin rather than posting.
            onBlur={() => setLatText(round6(pos.lat))}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">{t.longitude}</span>
          <input
            name="lng"
            className="input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={lngText}
            onChange={(e) => {
              setLngText(e.target.value);
              const v = parseCoord(e.target.value, 180);
              if (v !== null) setPos((p) => ({ ...p, lng: v }));
            }}
            onBlur={() => setLngText(round6(pos.lng))}
            required
          />
        </label>
      </div>
    </div>
  );
}

export default MapPicker;
