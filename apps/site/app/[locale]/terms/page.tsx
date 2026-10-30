import type { Metadata } from 'next';

import { LegalPage } from '@/components/legal-page';
import { getCopy, locales } from '@/lib/content';
import type { Locale } from '@/lib/content/types';
import { localePath } from '@/lib/paths';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: getCopy(locale).terms.metaTitle,
    alternates: {
      languages: Object.fromEntries(locales.map((l) => [l, localePath(l, '/terms')])),
    },
  };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const copy = getCopy(locale);
  return <LegalPage locale={locale} nav={copy.nav} currentPath="/terms" copy={copy.terms} />;
}
