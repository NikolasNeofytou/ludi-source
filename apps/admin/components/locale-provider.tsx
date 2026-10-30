'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { getCopy, type AdminCopy, type Locale } from '@/lib/copy';

// Carries the locale STRING to client components (ADR-0037). Not the
// dictionary: both dictionaries are plain modules, so a client component
// gets the right words on its first frame with no fetch. The root layout
// provides the guest locale (cookie → browser); AppShell re-provides the
// account's, which wins for every signed-in page.
const LocaleContext = createContext<Locale>('en');

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useCopy(): AdminCopy {
  return getCopy(useContext(LocaleContext));
}
