import Link from 'next/link';

import type { Locale, NavCopy } from '@/lib/content/types';
import { localePath } from '@/lib/paths';
import { HELP_EMAIL } from '@/lib/site';
import { tokens } from '@/lib/tokens';

export function SiteFooter({ locale, nav }: { locale: Locale; nav: NavCopy }) {
  return (
    <div className="shell">
      <footer
        style={{
          marginTop: 56,
          padding: '28px 0 40px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          fontSize: 13,
          color: tokens.ink3,
          borderTop: `1px solid ${tokens.line}`,
        }}
      >
        <span>{nav.footerRights}</span>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <Link href={localePath(locale, '/keepers')} style={{ color: tokens.ink3 }}>
            {nav.keepersLink}
          </Link>
          <Link href={localePath(locale, '/privacy')} style={{ color: tokens.ink3 }}>
            {nav.privacyLink}
          </Link>
          <Link href={localePath(locale, '/terms')} style={{ color: tokens.ink3 }}>
            {nav.termsLink}
          </Link>
          <a href={`mailto:${HELP_EMAIL}`} style={{ color: tokens.ink3 }}>
            {HELP_EMAIL}
          </a>
        </nav>
      </footer>
    </div>
  );
}
