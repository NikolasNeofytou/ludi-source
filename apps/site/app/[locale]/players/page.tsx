import type { Metadata } from 'next';

import Link from 'next/link';
import { after } from 'next/server';

import { IslandMap } from '@/components/island-map';
import { FloodlightStrip } from '@/components/larnaca-scene';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { AppCta, Kicker, Process, Reveal, StatRail } from '@/components/ui';
import { capture } from '@/lib/analytics';
import { getCopy, locales } from '@/lib/content';
import type { Locale } from '@/lib/content/types';
import { localePath } from '@/lib/paths';
import { tokens } from '@/lib/tokens';
import { fetchVenuePins, pinBucket } from '@/lib/venue';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const copy = getCopy(locale).players;
  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: {
      languages: Object.fromEntries(locales.map((l) => [l, localePath(l, '/players')])),
    },
  };
}

/**
 * The player counterpart to /owners, restored at equal weight.
 *
 * It was folded into a home room earlier because it restated that room with no
 * added substance. What earns it a route again is a call-to-action that
 * completes the journey: a player can now be sent somewhere. Until
 * `site.APP_URL` is set that CTA falls back to the contact line — see AppCta.
 *
 * Floodlights breathe in the header strip; nothing else on the page moves. The
 * home hero owns the movement, so deeper pages hold still and the reading does
 * the work.
 */
export default async function PlayersPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const site = getCopy(locale);
  const { players } = site;
  // The island (plans/maps.md M3): every venue with a page, as a pin.
  const pins = await fetchVenuePins();
  if (pins.length > 0) after(() => capture('map_shown', { surface: 'players', locale, pins: pinBucket(pins.length) }));

  return (
    <div data-load>
      <SiteHeader locale={locale} nav={site.nav} currentPath="/players" />

      <main className="shell">
        <Reveal>
          <div style={{ marginBottom: 32 }}>
            <FloodlightStrip />
          </div>

          <section>
            <Kicker label={players.eyebrow} color={tokens.pitch} />
            <h1 className="t-page" style={{ maxWidth: '18ch' }}>
              {players.heroTitle}
            </h1>
            <p className="prose" style={{ fontSize: 18, maxWidth: '40rem', margin: '18px 0 0' }}>
              {players.heroSubtitle}
            </p>

            {/* The action sits above the fold, not only at the page end — a
             * player who already knows what Ludi is should not have to read
             * four steps to find the way in. */}
            <div style={{ marginTop: 26 }}>
              <AppCta
                downloadLabel={players.downloadLabel ?? players.ctaLabel}
                contactLabel={players.ctaLabel}
                subject="Ludi — player interest"
                from="players-hero"
                locale={locale}
              />
            </div>

            <StatRail stats={players.stats} />

            {/* A keeper is a player, so /keepers is reached from here rather
             * than from a third item in the two-audience nav. The offer does
             * the work: free football is worth a line on the players page. */}
            <p style={{ fontSize: 14, color: tokens.ink3, margin: '26px 0 0' }}>
              {site.keepers.nudgeBody}{' '}
              <Link
                href={localePath(locale, '/keepers')}
                style={{ color: tokens.pitchDeep, fontWeight: 600 }}
              >
                {site.keepers.nudgeLabel} →
              </Link>
            </p>
          </section>
        </Reveal>

        <Reveal delay={60}>
          <section style={{ marginTop: 56 }}>
            <Process steps={players.steps} />
          </section>

          {pins.length > 0 ? (
            <section style={{ marginTop: 56 }}>
              <h2 className="t-section">{site.venue.islandTitle}</h2>
              <p className="prose" style={{ margin: '8px 0 18px', maxWidth: '40rem' }}>
                {site.venue.islandBody}
              </p>
              <IslandMap pins={pins} hrefPrefix={localePath(locale, '/v/')} ariaLabel={site.venue.mapAria} />
            </section>
          ) : null}

          <section
            className="card"
            style={{ background: tokens.pitchSoft, textAlign: 'center', marginTop: 56 }}
          >
            <h2 className="t-section" style={{ color: tokens.pitchDeep }}>
              {players.ctaTitle}
            </h2>
            <p
              className="prose"
              style={{ fontSize: 15, margin: '10px auto 20px', maxWidth: '34rem' }}
            >
              {players.ctaBody}
            </p>
            <AppCta
              downloadLabel={players.downloadLabel ?? players.ctaLabel}
              contactLabel={players.ctaLabel}
              subject="Ludi — player interest"
              from="players-close"
              locale={locale}
            />
            {players.ctaNote ? (
              <p style={{ fontSize: 12.5, color: tokens.ink3, margin: '14px 0 0' }}>
                {players.ctaNote}
              </p>
            ) : null}
          </section>
        </Reveal>
      </main>

      <SiteFooter locale={locale} nav={site.nav} />
    </div>
  );
}
