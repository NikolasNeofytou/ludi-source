import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Kicker, Process, Reveal, StatRail } from '@/components/ui';
import { getCopy, locales } from '@/lib/content';
import type { Locale } from '@/lib/content/types';
import { localePath } from '@/lib/paths';
import { contactLink, MEMBER_PAYMENT_LINK, MEMBER_PORTAL_LINK, MEMBER_SALE_OPEN, SELLER } from '@/lib/site';
import { tokens } from '@/lib/tokens';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const copy = getCopy(locale).member;
  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    // Reached by the QR at Campeone, not by search, until the sale opens.
    robots: MEMBER_SALE_OPEN ? undefined : { index: false, follow: false },
    alternates: {
      languages: Object.fromEntries(locales.map((l) => [l, localePath(l, '/member')])),
    },
  };
}

/**
 * /member — Ludi Member, the founding membership (docs/plans/ludi-member.md,
 * Phase 0).
 *
 * The site has no backend (docs/plans/site.md), so the sale is a Stripe
 * Payment Link and cancelling is Stripe's customer portal. Until both links
 * exist and the seller's name and address are set (`SELLER` in lib/site.ts),
 * the page offers a prepared message to join the
 * founding list instead of a buy button: a consumer sale needs the trader
 * identified before anyone pays.
 *
 * Not in the header nav or the sitemap yet. It reaches people from the QR on
 * the poster at Campeone.
 */
export default async function MemberPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const site = getCopy(locale);
  const { member } = site;

  return (
    <div data-load>
      <SiteHeader locale={locale} nav={site.nav} currentPath="/member" />

      <main className="shell">
        <Reveal>
          <section>
            <Kicker label={member.eyebrow} color={tokens.pitch} />
            <h1 className="t-page" style={{ maxWidth: '16ch' }}>
              {member.heroTitle}
            </h1>
            <p className="prose" style={{ fontSize: 18, maxWidth: '40rem', margin: '18px 0 0' }}>
              {member.heroSubtitle}
            </p>

            <div style={{ marginTop: 26 }}>
              <a className="btn btn--wide press" href="#join">
                {MEMBER_SALE_OPEN ? member.buyLabel : member.preSaleLabel} ↓
              </a>
            </div>

            <StatRail stats={member.stats} />
          </section>
        </Reveal>

        <Reveal delay={60}>
          <section style={{ marginTop: 56 }}>
            <h2 className="t-section" style={{ marginBottom: 18 }}>
              {member.perksTitle}
            </h2>
            <div
              style={{
                display: 'grid',
                gap: 16,
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
              }}
            >
              {member.perks.map((perk) => (
                <article className="card" key={perk.title} style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
                  <h3 style={{ fontSize: 18, margin: 0, color: tokens.ink }}>{perk.title}</h3>
                  <p className="prose" style={{ margin: 0, fontSize: 15 }}>
                    {perk.body}
                  </p>
                  <p
                    className="mono"
                    style={{
                      margin: 0,
                      fontSize: 11.5,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: tokens.pitch,
                    }}
                  >
                    {perk.when}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section style={{ marginTop: 56 }}>
            <h2 className="t-section" style={{ marginBottom: 18 }}>
              {member.stepsTitle}
            </h2>
            <Process steps={member.steps} />
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 className="t-section" style={{ marginBottom: 10 }}>
              {member.notIncludedTitle}
            </h2>
            <ul className="prose" style={{ margin: 0, paddingLeft: 20, fontSize: 15.5 }}>
              {member.notIncluded.map((line) => (
                <li key={line} style={{ marginBottom: 6 }}>
                  {line}
                </li>
              ))}
            </ul>
          </section>

          <section
            id="join"
            className="card"
            style={{ marginTop: 48, scrollMarginTop: 24, background: tokens.primarySoft, display: 'grid', gap: 14 }}
          >
            {MEMBER_SALE_OPEN && MEMBER_PAYMENT_LINK ? (
              <>
                <h2 className="t-section" style={{ color: tokens.primaryDeep, margin: 0 }}>
                  {member.heroTitle}
                </h2>
                <div>
                  <a className="btn btn--wide press" href={MEMBER_PAYMENT_LINK} rel="noopener">
                    {member.buyLabel}
                  </a>
                </div>
                <p className="prose" style={{ margin: 0, fontSize: 14 }}>
                  {member.buyNote}
                </p>
              </>
            ) : (
              <>
                <h2 className="t-section" style={{ color: tokens.primaryDeep, margin: 0 }}>
                  {member.preSaleTitle}
                </h2>
                <p className="prose" style={{ margin: 0, fontSize: 15.5 }}>
                  {member.preSaleBody}
                </p>
                <div>
                  <a
                    className="btn btn--wide press"
                    href={contactLink(member.preSaleTitle, member.preSaleMessage)}
                    rel="noopener"
                  >
                    {member.preSaleLabel}
                  </a>
                </div>
              </>
            )}

            <p style={{ margin: 0, fontSize: 14, display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
              <Link href={localePath(locale, '/member/terms')} style={{ color: tokens.primaryDeep }}>
                {member.termsLink}
              </Link>
              <Link href={localePath(locale, '/member/cup')} style={{ color: tokens.primaryDeep }}>
                {member.cupTermsLink}
              </Link>
              {MEMBER_PORTAL_LINK ? (
                <a href={MEMBER_PORTAL_LINK} rel="noopener" style={{ color: tokens.primaryDeep }}>
                  {member.manageLabel}
                </a>
              ) : null}
            </p>
            {MEMBER_PORTAL_LINK ? null : (
              <p className="prose" style={{ margin: 0, fontSize: 13.5 }}>
                {member.manageFallback}
              </p>
            )}
            <p className="prose" style={{ margin: 0, fontSize: 13.5, color: tokens.ink3 }}>
              {member.soldBy(SELLER.name)}
            </p>
          </section>
        </Reveal>
      </main>

      <SiteFooter locale={locale} nav={site.nav} />
    </div>
  );
}
