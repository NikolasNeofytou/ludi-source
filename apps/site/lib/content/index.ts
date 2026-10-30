import { notFound } from 'next/navigation';

import { el } from './el';
import { en } from './en';
import type { Locale, SiteCopy } from './types';

const dictionaries: Record<Locale, SiteCopy> = { en, el };

export function getCopy(locale: Locale): SiteCopy {
  // `locale` is the `[locale]` URL segment, typed but never checked: a path
  // with a dot in it (`/wp-login.php`) skips the middleware and arrives with
  // the filename as its locale. The layout 404s it too, but pages render in
  // parallel with the layout, so each page would still throw on the missing
  // copy. Every page asks for its copy first, so here it stays a 404.
  if (!isLocale(locale)) notFound();
  return dictionaries[locale];
}

export function otherLocale(locale: Locale): Locale {
  return locale === 'en' ? 'el' : 'en';
}

export const locales: Locale[] = ['en', 'el'];

export function isLocale(value: string | null): value is Locale {
  return value !== null && (locales as string[]).includes(value);
}

export type { Locale, SiteCopy } from './types';
