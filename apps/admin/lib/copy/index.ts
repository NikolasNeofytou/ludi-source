import { el } from './el';
import { en } from './en';
import type { AdminCopy, Locale } from './types';

// The dashboard's two dictionaries (ADR-0037). Plain modules: a server
// component calls getCopy(viewer.locale); a client component reads the
// locale from LocaleProvider and calls the same function. Both dictionaries
// ship to the client — ~40 KB for an app with a handful of users, and no
// fetch stands between the first render and the right words.

const dictionaries: Record<Locale, AdminCopy> = { en, gr: el };

export const LOCALES: readonly Locale[] = ['en', 'gr'];

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'gr';
}

export function getCopy(locale: Locale): AdminCopy {
  return dictionaries[locale];
}

// The column says 'gr'; the web says 'el'. Mapped in one place.
export function htmlLang(locale: Locale): 'en' | 'el' {
  return locale === 'gr' ? 'el' : 'en';
}

// What Intl gets. en-GB for the English dashboard as before (day-first
// dates, £-free), el-GR for Greek (Πέμ 17 Σεπ, 1.234,50).
export function intlTag(locale: Locale): 'en-GB' | 'el-GR' {
  return locale === 'gr' ? 'el-GR' : 'en-GB';
}

// Mirrors the account's choice in the browser, so the sign-in page and the
// root layout's <html lang> — both outside auth — agree with the last
// account that signed in here. One year; the account is the source.
export const LOCALE_COOKIE = 'ludi_locale';

export type { AdminCopy, Locale } from './types';
