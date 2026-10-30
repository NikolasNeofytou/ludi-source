import type { Metadata } from 'next';

import { LegalPage } from '@/components/legal-page';
import { getCopy, locales } from '@/lib/content';
import type { Locale } from '@/lib/content/types';
import { localePath } from '@/lib/paths';
import { CONTACT_EMAIL, SELLER } from '@/lib/site';

const seller = { ...SELLER, email: CONTACT_EMAIL };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: getCopy(locale).memberTerms(seller).metaTitle,
    robots: { index: false, follow: false },
    alternates: {
      languages: Object.fromEntries(locales.map((l) => [l, localePath(l, '/member/terms')])),
    },
  };
}

/** Ludi Member's terms: the Stripe account holder sells it in their own name (ADR-0052). */
export default async function MemberTermsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const copy = getCopy(locale);
  return (
    <LegalPage
      locale={locale}
      nav={copy.nav}
      currentPath="/member/terms"
      copy={copy.memberTerms(seller)}
    />
  );
}
