import type { Metadata } from 'next';

import { LegalPage } from '@/components/legal-page';
import { getCopy, locales } from '@/lib/content';
import type { Locale } from '@/lib/content/types';
import { localePath } from '@/lib/paths';
import { CAMPEONE_OFFPEAK, SELLER } from '@/lib/site';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: getCopy(locale).cupTerms(null, null).metaTitle,
    robots: { index: false, follow: false },
    alternates: {
      languages: Object.fromEntries(locales.map((l) => [l, localePath(l, '/member/cup')])),
    },
  };
}

/**
 * The member cup and free-match rules: the written promotion terms the
 * Campeone memorandum (clause 5.5) and Ν. 156(Ι)/2004 s.9 require before the
 * promotion starts. Winners are decided by results and counts only; there is
 * no draw (Lotteries Law, Cap. 74).
 */
export default async function CupTermsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const copy = getCopy(locale);
  return (
    <LegalPage
      locale={locale}
      nav={copy.nav}
      currentPath="/member/cup"
      copy={copy.cupTerms(CAMPEONE_OFFPEAK ? CAMPEONE_OFFPEAK[locale] : null, SELLER.name)}
    />
  );
}
