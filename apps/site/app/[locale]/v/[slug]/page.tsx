import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { after } from 'next/server';

import { InAppNote } from '@/components/in-app-note';
import { IslandMap } from '@/components/island-map';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Kicker, Notice, Reveal } from '@/components/ui';
import { capture } from '@/lib/analytics';
import { getCopy, locales } from '@/lib/content';
import type { Locale, VenuePageCopy } from '@/lib/content/types';
import { formatFixtureWhen } from '@/lib/fixture';
import { localePath } from '@/lib/paths';
import { carrySource, parseScanSource, scanVenue } from '@/lib/scan-source';
import { tokens } from '@/lib/tokens';
import { requestAgent } from '@/lib/user-agent';
import {
  fetchVenueOpenGames,
  fetchVenuePage,
  fetchVenuePins,
  formatAddress,
  formatCourts,
  formatFromPrice,
  formatHour,
  openBucket,
  pinBucket,
  type VenueOpenGame,
} from '@/lib/venue';

/**
 * /v/<slug> — the venue's own page (plans/reach.md R1).
 *
 * The one page on the site about a single business: for the venue's
 * Instagram bio, its Google listing and the QR on its counter. It says
 * where the venue is, what it has and what it costs, then sends the
 * visitor into the app at that venue — or to the counter while the app
 * cannot take the booking. Indexed on purpose: the point is that a search
 * for the venue finds it.
 *
 * Everything shown is already public through the app's Discover screen or
 * the venue's lobby screen (its open games, ADR-0056); the page reads its
 * RPCs fresh and never a roster.
 */

// Hours and "bookable" change with the day; never serve from a cache.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const copy = getCopy(locale).venue;
  const venue = await fetchVenuePage(slug);
  if (!venue) return { title: copy.notFoundTitle, robots: { index: false, follow: false } };
  const city = locale === 'el' ? venue.city_name_gr : venue.city_name_en;
  return {
    title: copy.metaTitle(venue.name),
    description: copy.metaDescription(venue.name, city),
    alternates: {
      languages: Object.fromEntries(locales.map((l) => [l, localePath(l, `/v/${slug}`)])),
    },
  };
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 16, padding: '12px 0', borderBottom: `1px solid ${tokens.line}` }}>
      <span
        className="mono"
        style={{
          fontSize: 12,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: tokens.ink3,
          minWidth: 92,
          paddingTop: 3,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 17, color: tokens.ink, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

/**
 * The venue's open games (plans/instagram.md IG-2, ADR-0056): the games its
 * lobby screen shows, each a link to its invite page carrying the tag that
 * brought the visitor. `#open` is where an Instagram DM's link lands.
 */
function OpenGames({
  copy,
  locale,
  games,
  source,
}: {
  copy: VenuePageCopy;
  locale: Locale;
  games: VenueOpenGame[];
  /** The tag each game's link carries on (lib/scan-source.ts carrySource). */
  source: string;
}) {
  return (
    <section id="open" style={{ marginTop: 34, maxWidth: '40rem', scrollMarginTop: 24 }}>
      <h2 style={{ fontSize: 22, margin: '0 0 8px' }}>{copy.openTitle}</h2>
      <p className="prose" style={{ margin: '0 0 14px' }}>
        {games.length > 0 ? copy.openBody : copy.openNone}
      </p>
      {games.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: `1px solid ${tokens.lineBold}` }}>
          {games.map((g) => (
            <li key={g.invite_token} style={{ borderBottom: `1px solid ${tokens.line}` }}>
              <a
                href={localePath(locale, `/f/${encodeURIComponent(g.invite_token)}?s=${encodeURIComponent(source)}`)}
                className="press"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '4px 16px',
                  padding: '14px 0',
                  color: tokens.ink,
                  textDecoration: 'none',
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>
                    {formatFixtureWhen(locale, g.starts_at, g.ends_at)}
                  </span>
                  <span style={{ fontSize: 15, color: tokens.ink2 }}>
                    {copy.pitchTypes[g.pitch_type] ?? g.pitch_type} · {copy.openWanted(g.gk_open, g.outfield_open)}
                  </span>
                </span>
                <span style={{ fontSize: 15, fontWeight: 600, color: tokens.primary }}>{copy.openSee} →</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default async function VenuePageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
  searchParams: Promise<{ s?: string | string[] }>;
}) {
  const { locale, slug } = await params;
  // A scan that brought someone here (the CFA follow QR, plans/release-1-0.md
  // E2) is handed on to "Get the app" when it is this venue's known tag;
  // anything else is the page's own button.
  // Ludi's own channels (an Instagram DM, the bio) are handed on too
  // (plans/instagram.md IG-1); another venue's piece never is.
  const scanned = parseScanSource((await searchParams).s);
  const venue = await fetchVenuePage(slug);
  if (!venue) notFound();
  const getTag = carrySource(scanned, `${slug}-page`, slug);
  const { platform, browser } = await requestAgent();
  const games = await fetchVenueOpenGames(slug);

  const site = getCopy(locale);
  const copy = site.venue;
  const city = locale === 'el' ? venue.city_name_gr : venue.city_name_en;

  after(() =>
    capture('venue_page_viewed', {
      locale,
      venue: scanVenue(slug),
      bookable: venue.bookable,
      source: scanned,
      browser,
      open: openBucket(games),
    }),
  );

  // The venue on the island (plans/maps.md M3): this one centred, the
  // others around it, each a link to its own page.
  const pins = venue.lat != null && venue.lng != null ? await fetchVenuePins() : [];
  if (pins.length > 0) after(() => capture('map_shown', { surface: 'venue', locale, pins: pinBucket(pins.length) }));

  const hours =
    venue.opens_today && venue.closes_today
      ? copy.hoursValue(formatHour(venue.opens_today), formatHour(venue.closes_today))
      : copy.hoursClosed;

  return (
    <div data-load>
      <SiteHeader locale={locale} nav={site.nav} currentPath="/" />

      <main className="shell">
        <Reveal>
          <section>
            <Kicker label={city} color={tokens.pitch} />
            <h1 className="t-page" style={{ maxWidth: '18ch' }}>
              {venue.name}
            </h1>
            <p className="prose" style={{ fontSize: 18, maxWidth: '40rem', margin: '18px 0 0' }}>
              {formatAddress(venue.address)}
            </p>

            <div style={{ maxWidth: '40rem', marginTop: 26, borderTop: `1px solid ${tokens.lineBold}` }}>
              <DetailRow label={copy.courtsLabel} value={formatCourts(copy, venue)} />
              {venue.from_price_cents != null ? (
                <DetailRow label={copy.fromLabel} value={copy.fromValue(formatFromPrice(venue.from_price_cents, locale))} />
              ) : null}
              <DetailRow label={copy.hoursLabel} value={hours} />
              {venue.contact_phone ? <DetailRow label={copy.phoneLabel} value={venue.contact_phone} /> : null}
            </div>

            {pins.length > 0 && venue.lat != null && venue.lng != null ? (
              <div style={{ marginTop: 20, maxWidth: '40rem' }}>
                <IslandMap
                  pins={pins}
                  center={{ lat: venue.lat, lng: venue.lng }}
                  zoom={13}
                  height={240}
                  hrefPrefix={localePath(locale, '/v/')}
                  ariaLabel={copy.mapAria}
                />
              </div>
            ) : null}

            {games !== null ? <OpenGames copy={copy} locale={locale} games={games} source={getTag} /> : null}

            <div style={{ marginTop: 20, maxWidth: '40rem' }}>
              <Notice>{venue.bookable ? copy.bookableBody : copy.counterBody}</Notice>
            </div>

            {/* "Open in Ludi" uses the app's own scheme, which today's build
             * already answers for a venue; the universal link follows the
             * store build (plans/reach.md R0). "Get the app" carries the
             * scan tag so the page can be judged like a printed piece. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 26 }}>
              <a className="btn btn--wide press" href={`ludi://venue/${venue.venue_id}`}>
                {copy.openInApp} →
              </a>
              <a
                className="btn press"
                href={localePath(locale, `/get?s=${encodeURIComponent(getTag)}`)}
                style={{ background: tokens.surface, color: tokens.ink, border: `1px solid ${tokens.lineBold}` }}
              >
                {copy.getApp}
              </a>
            </div>
            <p className="mono" style={{ fontSize: 13, color: tokens.ink3, margin: '14px 0 0' }}>
              {copy.getNote}
            </p>
            <InAppNote
              copy={site.inApp}
              browser={browser}
              platform={platform}
              path={localePath(locale, `/v/${slug}${scanned === 'direct' || scanned === 'other' ? '' : `?s=${scanned}`}`)}
            />
          </section>
        </Reveal>
      </main>

      <SiteFooter locale={locale} nav={site.nav} />
    </div>
  );
}
