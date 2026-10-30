import type { Metadata } from 'next';
import { after } from 'next/server';

import { InAppNote } from '@/components/in-app-note';
import { KeeperSignup } from '@/components/keeper-signup';
import { FloodlightStrip } from '@/components/larnaca-scene';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Kicker, Notice, Process, Reveal, StatRail } from '@/components/ui';
import { capture } from '@/lib/analytics';
import { getCopy, locales } from '@/lib/content';
import type { Locale } from '@/lib/content/types';
import { localePath } from '@/lib/paths';
import { parseScanSource } from '@/lib/scan-source';
import { tokens } from '@/lib/tokens';
import { requestAgent } from '@/lib/user-agent';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const copy = getCopy(locale).keepers;
  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: {
      languages: Object.fromEntries(locales.map((l) => [l, localePath(l, '/keepers')])),
    },
  };
}

/**
 * /keepers — the one page on the site with a structured ask.
 *
 * It exists because the first venue owner named goalkeeper scarcity as his
 * single biggest problem: games die for want of one, and the booking dies with
 * them (docs/plans/goalkeeper-trial.md). Recruiting keepers is therefore the
 * highest-value thing the site can do before the app is installable at all.
 *
 * Written for a stranger arriving from a shared link, not for someone browsing
 * the site — the offer is in the first line, and the form is reachable without
 * reading the four steps. A keeper we are recruiting is not yet a Ludi user, so
 * a link is the whole point: an app install would be the highest-friction ask
 * we could make of a volunteer.
 *
 * Deliberately not in the header nav. The nav carries the site's two-audience
 * fork (players / owners) and a keeper is a player; a third item there would
 * dilute the fork the home page is built around. It reaches people by being
 * pasted into a WhatsApp group, and is linked from /players and the footer for
 * anyone who arrives the long way round.
 */
export default async function KeepersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ s?: string | string[] }>;
}) {
  const { locale } = await params;
  const site = getCopy(locale);
  const { keepers } = site;

  // The KEEPER keyword DM and the keepers posters tag their links
  // (plans/instagram.md IG-1), so the page is counted like /get. Reading the
  // tag and the user agent renders it per request instead of at build time.
  const source = parseScanSource((await searchParams).s);
  const { platform, browser } = await requestAgent();
  after(() => capture('keepers_page_viewed', { locale, source, browser }));

  return (
    <div data-load>
      <SiteHeader locale={locale} nav={site.nav} currentPath="/keepers" />

      <main className="shell">
        <Reveal>
          <div style={{ marginBottom: 32 }}>
            <FloodlightStrip />
          </div>

          <section>
            <Kicker label={keepers.eyebrow} color={tokens.pitch} />
            <h1 className="t-page" style={{ maxWidth: '16ch' }}>
              {keepers.heroTitle}
            </h1>
            <p className="prose" style={{ fontSize: 18, maxWidth: '40rem', margin: '18px 0 0' }}>
              {keepers.heroSubtitle}
            </p>

            {/* The offer is free and the ask is a minute, so the way in sits
             * above the fold. Nobody should have to read four steps to find
             * the form on the page whose entire job is the form. */}
            <div style={{ marginTop: 26 }}>
              <a className="btn btn--wide press" href="#get-on-the-list">
                {keepers.formTitle} ↓
              </a>
            </div>

            <StatRail stats={keepers.stats} />

            <div style={{ marginTop: 28 }}>
              <Notice>{keepers.notice}</Notice>
            </div>
            <InAppNote
              copy={site.inApp}
              browser={browser}
              platform={platform}
              path={localePath(locale, source === 'direct' || source === 'other' ? '/keepers' : `/keepers?s=${source}`)}
            />
          </section>
        </Reveal>

        <Reveal delay={60}>
          <section style={{ marginTop: 56 }}>
            <Process steps={keepers.steps} />
          </section>

          <div id="get-on-the-list" style={{ scrollMarginTop: 24 }}>
            <KeeperSignup copy={keepers} />
          </div>
        </Reveal>
      </main>

      <SiteFooter locale={locale} nav={site.nav} />
    </div>
  );
}
