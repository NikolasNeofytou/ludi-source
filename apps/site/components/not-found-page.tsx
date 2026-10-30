import Link from 'next/link';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Kicker } from '@/components/ui';
import { getCopy } from '@/lib/content';
import type { Locale } from '@/lib/content/types';
import { localePath } from '@/lib/paths';
import { tokens } from '@/lib/tokens';

/**
 * The branded 404 — "That one went wide" — inside a document's <body>.
 *
 * Two files render it. `app/[locale]/not-found.tsx` catches an explicit
 * `notFound()` under a locale (an unknown venue slug: `/v/<typo>` from a
 * printed QR) and sits inside the locale layout's <html>.
 * `app/global-not-found.tsx` takes every URL that matches no route at all
 * and carries its own <html>.
 */
export function NotFoundPage({ locale }: { locale: Locale }) {
  const site = getCopy(locale);
  const { notFound } = site;

  // The two things anyone lost on this site actually wants, rather than an
  // apology: get me home, or get me to the page for whoever I am.
  const destinations = [
    { href: '/', label: notFound.homeLabel, primary: true },
    { href: '/owners', label: notFound.ownersLabel, primary: false },
  ];

  return (
    <div data-load>
      <SiteHeader locale={locale} nav={site.nav} currentPath="/" />

      <main className="shell" style={{ minHeight: '50vh' }}>
        <section className="reveal" style={{ paddingTop: 40, maxWidth: '40rem' }}>
          <Kicker label={notFound.code} color={tokens.terracotta} />
          <h1 className="t-page">{notFound.title}</h1>
          <p className="prose" style={{ fontSize: 17, margin: '16px 0 28px' }}>
            {notFound.body}
          </p>

          <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {destinations.map((destination) => (
              <Link
                key={destination.href}
                href={localePath(locale, destination.href)}
                className="btn press"
                style={
                  destination.primary
                    ? undefined
                    : {
                        background: tokens.surface,
                        color: tokens.ink,
                        boxShadow: '0 1px 3px rgba(16,24,28,0.06)',
                      }
                }
              >
                {destination.label}
              </Link>
            ))}
          </nav>
        </section>
      </main>

      <SiteFooter locale={locale} nav={site.nav} />
    </div>
  );
}
