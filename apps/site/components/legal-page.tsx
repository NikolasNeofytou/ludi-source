import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import type { LegalCopy, Locale, NavCopy } from '@/lib/content/types';
import { tokens } from '@/lib/tokens';

export function LegalPage({
  locale,
  nav,
  currentPath,
  copy,
}: {
  locale: Locale;
  nav: NavCopy;
  currentPath: string;
  copy: LegalCopy;
}) {
  return (
    <>
      <SiteHeader locale={locale} nav={nav} currentPath={currentPath} />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 24px 64px' }}>
        <div
          style={{
            marginBottom: 24,
            padding: 16,
            borderRadius: 8,
            background: tokens.sunSoft,
            color: tokens.sunDeep,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>{copy.bannerLabel}</strong> {copy.bannerBody}
        </div>

        <h1 style={{ fontSize: 36, letterSpacing: -0.5, margin: '0 0 8px', color: tokens.ink }}>
          {copy.title}
        </h1>
        <p style={{ color: tokens.ink3, fontSize: 14, margin: '0 0 32px' }}>{copy.updated}</p>

        <div style={{ color: tokens.ink2, fontSize: 16, lineHeight: 1.7 }}>
          {copy.sections.map((section) => (
            <section key={section.title} style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 20, color: tokens.ink, marginBottom: 8 }}>{section.title}</h2>
              {section.paragraphs?.map((p) => (
                <p key={p} style={{ margin: '0 0 8px' }}>
                  {p}
                </p>
              ))}
              {section.bullets && (
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {section.bullets.map((b) => (
                    <li key={b} style={{ marginBottom: 4 }}>
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </main>
      <SiteFooter locale={locale} nav={nav} />
    </>
  );
}
