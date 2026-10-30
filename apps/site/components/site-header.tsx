import Link from 'next/link';

import { LudiMark } from '@/components/ludi-mark';

import type { Locale, NavCopy } from '@/lib/content/types';
import { localePath } from '@/lib/paths';

export function SiteHeader({
  locale,
  nav,
  currentPath,
}: {
  locale: Locale;
  nav: NavCopy;
  currentPath: string;
}) {
  // Two items, two audiences. The nav is the clearest signal that this is a
  // two-sided site rather than an owner pitch with a player paragraph.
  const links = [
    { href: '/players', label: nav.playersLink },
    { href: '/owners', label: nav.ownersLink },
  ];

  return (
    <div className="shell">
      <header className="site-header">
        {/* Horizontal lockup — the mark at lockup density beside the wordmark,
         * with clear space equal to the mark's base width. Four planes here;
         * seven is app-icon only. */}
        <Link href={localePath(locale, '/')} className="site-header__mark">
          <LudiMark size={28} density="lockup" rounded />
          <span>Ludi</span>
        </Link>

        <nav className="site-nav" aria-label={nav.navLabel}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={localePath(locale, link.href)}
              className="site-nav__link"
              aria-current={currentPath === link.href ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Both locales are always rendered as links so the switch is one tap
         * and crawlable, rather than a label plus a link. */}
        <div className="lang" role="group" aria-label={nav.switcherLabel}>
          <Link
            href={localePath('en', currentPath)}
            className="lang__opt"
            aria-current={locale === 'en'}
            hrefLang="en"
          >
            EN
          </Link>
          <Link
            href={localePath('el', currentPath)}
            className="lang__opt"
            aria-current={locale === 'el'}
            hrefLang="el"
          >
            ΕΛ
          </Link>
        </div>
      </header>
    </div>
  );
}
