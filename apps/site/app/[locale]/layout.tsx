import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import './globals.css';

import { isLocale, locales } from '@/lib/content';
import { fontVariables } from '@/lib/fonts';
import { setRequestLocale } from '@/lib/request-locale';
import { SITE_URL } from '@/lib/site';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const dynamicParams = false;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // The site's primary distribution is a shared link — a founder pasting
  // ludi.football into a pitch owner's WhatsApp. Per-page generateMetadata
  // supplies title/description; these are the shared defaults so an unfurled
  // link is never bare. See docs/ui/design-handoff-site-v1.md.
  openGraph: {
    type: 'website',
    siteName: 'Ludi',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // The middleware skips any path with a dot in it (static files), so
  // `/apple-touch-icon.png` or `/wp-login.php` arrives here un-rewritten with
  // the filename as its locale. `dynamicParams = false` 404s that for the
  // prerendered pages, but not for the force-dynamic ones (`/v`, `/f`,
  // `/get`), which render on demand. This makes any such path a 404 whatever
  // the page does; pages render in parallel with this layout, so `getCopy`
  // makes the same check to keep them from throwing on the missing copy
  // meanwhile.
  if (!isLocale(locale)) notFound();

  // For app/[locale]/not-found.tsx, which gets no params of its own.
  setRequestLocale(locale);

  return (
    <html lang={locale} className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
