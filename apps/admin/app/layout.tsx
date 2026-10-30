import { JetBrains_Mono, Literata } from 'next/font/google';
import type { Metadata } from 'next';

import './globals.css';
import { LocaleProvider } from '@/components/locale-provider';
import { getCopy, htmlLang } from '@/lib/copy';
import { guestLocale } from '@/lib/locale';
import { tokensToCssVars } from '@/lib/tokens';

// Literata, not Fraunces — the same call `apps/site` made, for the same
// reason and now for a second one.
//
// Fraunces ships latin/latin-ext/vietnamese only, no Greek, so every Greek
// heading silently falls back to a system serif (see the note in
// apps/site/app/[locale]/layout.tsx). That already mattered for the site;
// it matters more here, because #41 turns this app into a surface a
// Cypriot venue owner signs into, and the site is the first thing that
// owner ever saw. Matching it is continuity, not coincidence.
//
// Greek subset is loaded now rather than when the admin is translated:
// venue names, addresses and player names are Greek today, in a Latin UI.
const literata = Literata({
  subsets: ['latin', 'greek'],
  weight: ['500', '600'],
  variable: '--font-display',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'greek'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

// Owners read this tab title too — it was "Ludi Admin / Internal admin
// dashboard", which is what the founder calls it, not what a venue does.
// In the language this browser last chose (ADR-0037); the layout sits
// outside auth, so the cookie stands in for the account here.
export async function generateMetadata(): Promise<Metadata> {
  const t = getCopy(await guestLocale());
  return {
    title: t.meta.title,
    description: t.meta.description,
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The guest locale: what the sign-in page and the error pages render in.
  // AppShell re-provides the account's locale for every signed-in page.
  const locale = await guestLocale();
  return (
    <html lang={htmlLang(locale)} className={`${literata.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* The palette, emitted from lib/tokens.ts so globals.css can read
            it without the hex being duplicated a fifth time. See the note
            on tokensToCssVars(). */}
        <style dangerouslySetInnerHTML={{ __html: tokensToCssVars() }} />
      </head>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
