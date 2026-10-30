import type { Metadata } from 'next';
import Link from 'next/link';

import { AppStory } from '@/components/app-story';
import { FloodlitHero } from '@/components/floodlit-hero';
import { LarnacaScene } from '@/components/larnaca-scene';
import { Overture } from '@/components/overture';
import { Room, Rooms } from '@/components/rooms';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { AppCta, Eyebrow, Kicker } from '@/components/ui';
import { getCopy, locales } from '@/lib/content';
import { HOME_VENUES, rooms as roomsCopy } from '@/lib/content/rooms';
import type { Locale, StatCopy } from '@/lib/content/types';
import { localePath } from '@/lib/paths';
import { APP_URL, mailto } from '@/lib/site';
import { tokens } from '@/lib/tokens';
import { fetchVenueCards, formatCourts, formatFromPrice } from '@/lib/venue';

// Rendered per visit, never cached on Vercel. The page was never actually
// static: every site page renders on demand (the 2026-10-16 build
// prerenders none of them), so the old hourly `revalidate` only added Data
// Cache writes for the two venue cards. See lib/venue.ts and the
// 2026-10-16 entry in docs/JOURNAL.md.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const copy = getCopy(locale).home;
  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: {
      languages: Object.fromEntries(locales.map((l) => [l, localePath(l, '/')])),
    },
  };
}

/**
 * Home as five snapped rooms: floodlit · chalk · ink · chalk · ink. The two
 * ink rooms are the two asks — owners, and the close. Each room holds one
 * heading, one paragraph and one widget; that cap is what keeps mandatory
 * snap from becoming a trap, and it matters more than the animation. Room 02
 * (the app story) spends its one widget on a single phone whose screen the
 * five steps beside it choose — still one widget. It replaced a Players room
 * of four cards telling the same Find/Book/Play arc one room earlier
 * (docs/plans/site.md, 2026-10-15).
 *
 * The deeper pages (/players, /owners, /v/<slug>) are unchanged — the rooms
 * summarise and link onward rather than replace them.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const site = getCopy(locale);
  const { home } = site;
  const copy = roomsCopy[locale];
  const venues = await fetchVenueCards(HOME_VENUES);

  const labels = [home.heroTitle, copy.story.title, copy.owners.title, copy.proof.title, copy.close.title];

  return (
    <>
      <Overture />

      <div className="home-header">
        <SiteHeader locale={locale} nav={site.nav} currentPath="/" />
      </div>

      <Rooms labels={labels}>
        {/* 01 — Hero. The claim, three numbers, over the floodlit cage: the
         * scene plays as you scroll through the room, the copy holds still. */}
        <FloodlitHero>
          <div className="rise">
            <Kicker label={home.eyebrow} color="#A3C9D3" />
          </div>
          <h1 className="t-hero rise" style={{ maxWidth: '16ch', color: '#F2F4F3' }}>
            {home.heroTitle}
          </h1>
          <p
            className="rise"
            style={{
              fontSize: 17,
              lineHeight: 1.6,
              maxWidth: '30rem',
              margin: '22px 0 0',
              color: 'rgba(242,244,243,0.82)',
            }}
          >
            {home.heroSubtitle}
          </p>
          <div className="rise floodlit__stats" style={{ marginTop: 34 }}>
            <FlatStats stats={home.stats} onDark />
          </div>
          <div className="rise" style={{ marginTop: 30 }}>
            <AppCta
              downloadLabel={site.players.downloadLabel ?? site.players.ctaLabel}
              contactLabel={site.players.ctaLabel}
              subject="Ludi — player interest"
              from="home-hero"
              locale={locale}
              onDark
            />
          </div>
          <p
            className="mono rise"
            style={{
              marginTop: 28,
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(242,244,243,0.6)',
            }}
          >
            {copy.scrollHint} ↓
          </p>
        </FloodlitHero>

        {/* 02 — The app, in real screens: the Find/Book/Join/Track/Play arc
         * with actual TestFlight screenshots — see docs/plans/site.md's
         * 2026-09-14 entry. The heading shares a column with the steps,
         * beside the one phone; the download sits under them. */}
        <Room index={1}>
          <AppStory
            panels={copy.story.panels}
            controls={copy.story.controls}
            action={
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
                <AppCta
                  downloadLabel={site.players.downloadLabel ?? site.players.ctaLabel}
                  contactLabel={site.players.ctaLabel}
                  subject="Ludi — player interest"
                  from="home-app"
                  locale={locale}
                />
                <Link
                  href={localePath(locale, '/players')}
                  style={{
                    color: tokens.ink2,
                    fontWeight: 600,
                    fontSize: 14,
                    textDecoration: 'none',
                    borderBottom: `1px solid ${tokens.lineBold}`,
                    paddingBottom: 2,
                  }}
                >
                  {copy.story.more} →
                </Link>
              </div>
            }
          >
            <div className="rise">
              <Eyebrow label={copy.story.eyebrow} color={tokens.primary} />
            </div>
            <h2 className="t-page rise" style={{ marginTop: 14 }}>
              {copy.story.title}
            </h2>
            <p className="prose rise" style={{ margin: '14px 0 0', maxWidth: '34rem' }}>
              {copy.story.body}
            </p>
          </AppStory>
        </Room>

        {/* 03 — Owners. The 90% ask. Ink, with the sweep. */}
        <Room index={2} ground="ink" sweep>
          <div className="rise">
            <Eyebrow label={copy.owners.eyebrow} color="#A3C9D3" />
          </div>
          <h2 className="t-page rise" style={{ marginTop: 14, color: '#F2F4F3' }}>
            {copy.owners.title}
          </h2>
          <p
            className="rise"
            style={{
              margin: '14px 0 0',
              maxWidth: '34rem',
              fontSize: 16,
              lineHeight: 1.6,
              color: 'rgba(242,244,243,0.78)',
            }}
          >
            {copy.owners.body}
          </p>
          <div
            className="rise"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 16,
              marginTop: 34,
            }}
          >
            {copy.owners.stats.map((stat, i) => (
              <div
                key={stat.label}
                style={{
                  background: 'rgba(242,244,243,0.06)',
                  border: '1px solid rgba(242,244,243,0.14)',
                  borderRadius: 16,
                  padding: 22,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-display), Georgia, serif',
                    fontSize: 30,
                    fontWeight: 600,
                    color: i === 0 ? tokens.sun : '#F2F4F3',
                  }}
                >
                  {stat.value}
                </div>
                <div
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    color: 'rgba(242,244,243,0.72)',
                    marginTop: 8,
                  }}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
          <div className="rise" style={{ marginTop: 30 }}>
            <Link
              className="btn press"
              href={localePath(locale, '/owners')}
              style={{ background: tokens.sun, color: tokens.ink }}
            >
              {copy.owners.cta} →
            </Link>
          </div>
        </Room>

        {/* 04 — Proof. Names only the venues in HOME_VENUES (lib/content/
         * rooms.ts), each with its owner's agreement, as cards that open
         * their own pages. With none loaded the room still reads. */}
        <Room index={3}>
          <div className="rise">
            <Eyebrow label={copy.proof.eyebrow} color={tokens.primary} />
          </div>
          <h2 className="t-page rise" style={{ marginTop: 14 }}>
            {copy.proof.title}
          </h2>
          <p className="prose rise" style={{ margin: '14px 0 0', maxWidth: '34rem' }}>
            {copy.proof.body}
          </p>
          {venues.length > 0 ? (
            <ul className="venue-cards rise">
              {venues.map((venue) => (
                <li key={venue.slug}>
                  <Link className="venue-card card lift" href={localePath(locale, `/v/${venue.slug}`)}>
                    <span className="mono venue-card__city">
                      {locale === 'el' ? venue.city_name_gr : venue.city_name_en}
                    </span>
                    <span className="venue-card__name">{venue.name}</span>
                    <span className="venue-card__line">{formatCourts(site.venue, venue)}</span>
                    {venue.from_price_cents != null ? (
                      <span className="venue-card__line">
                        {site.venue.fromLabel}{' '}
                        {site.venue.fromValue(formatFromPrice(venue.from_price_cents, locale))}
                      </span>
                    ) : null}
                    <span className="venue-card__open">{copy.proof.open} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <p
            className="rise"
            style={{ margin: '22px 0 0', fontSize: 13.5, color: tokens.ink3 }}
          >
            {copy.close.note}
          </p>
          <div className="rise" style={{ marginTop: 26 }}>
            <Link
              href={localePath(locale, '/owners')}
              style={{
                color: tokens.ink2,
                fontWeight: 600,
                fontSize: 14,
                textDecoration: 'none',
                borderBottom: `1px solid ${tokens.lineBold}`,
                paddingBottom: 2,
              }}
            >
              {copy.proof.cta} →
            </Link>
          </div>
        </Room>

        {/* 05 — The honest close. Ink on the mark's own ground, with the sweep.
         * A contact line, not a waitlist field: there is no capture backend by
         * design (docs/plans/site.md). */}
        <Room index={4} ground="deep" centred sweep>
          <div className="rise" style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: 180 }}>
              <LarnacaScene />
            </div>
          </div>
          <h2
            className="t-page rise"
            style={{ margin: '24px auto 0', color: '#F2F4F3', maxWidth: '18ch' }}
          >
            {copy.close.title}
          </h2>
          <p
            className="rise"
            style={{
              margin: '14px auto 0',
              maxWidth: '28rem',
              fontSize: 16,
              lineHeight: 1.6,
              color: 'rgba(242,244,243,0.72)',
            }}
          >
            {copy.close.body}
          </p>
          <div className="rise" style={{ marginTop: 28 }}>
            <a
              className="btn press"
              href={mailto('Ludi — keep me posted')}
              style={{ background: tokens.sun, color: tokens.ink }}
            >
              {copy.close.cta}
            </a>
          </div>
          {APP_URL ? (
            <p className="rise" style={{ margin: '20px 0 0', fontSize: 14, color: 'rgba(242,244,243,0.62)' }}>
              {copy.close.playerNote}{' '}
              <a
                href={localePath(locale, '/download?from=home-close')}
                style={{
                  color: '#F2F4F3',
                  fontWeight: 600,
                  textDecoration: 'none',
                  borderBottom: '1px solid rgba(242,244,243,0.35)',
                  paddingBottom: 2,
                }}
              >
                {copy.close.playerLink} →
              </a>
            </p>
          ) : null}
          <nav
            className="mono rise room__links"
            aria-label={site.nav.navLabel}
            style={{ marginTop: 44 }}
          >
            <Link href={localePath(locale, '/privacy')}>{site.nav.privacyLink}</Link>
            <Link href={localePath(locale, '/terms')}>{site.nav.termsLink}</Link>
          </nav>
        </Room>
      </Rooms>

      <div className="home-footer">
        <SiteFooter locale={locale} nav={site.nav} />
      </div>
    </>
  );
}

/** The hero rail without rules — three figures, spaced, per the room spec. */
function FlatStats({ stats, onDark = false }: { stats: StatCopy[]; onDark?: boolean }) {
  return (
    <dl
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: onDark ? 'flex-start' : 'center',
        gap: 44,
        margin: 0,
      }}
    >
      {stats.map((stat) => (
        <div key={stat.label}>
          <dt
            style={{
              fontFamily: 'var(--font-display), Georgia, serif',
              fontSize: 24,
              fontWeight: 600,
            }}
          >
            {stat.value}
          </dt>
          <dd
            className="mono"
            style={{
              margin: '4px 0 0',
              fontSize: 10.5,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: onDark ? 'rgba(242,244,243,0.62)' : tokens.ink3,
            }}
          >
            {stat.label}
          </dd>
        </div>
      ))}
    </dl>
  );
}
