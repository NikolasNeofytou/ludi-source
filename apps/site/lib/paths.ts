import type { Locale } from './content/types';

// English is unprefixed (`/`, `/owners`); Greek is prefixed (`/el`, `/el/owners`).
// Keep in sync with middleware.ts, which implements this same mapping for requests.
export function localePath(locale: Locale, path: string): string {
  if (locale === 'en') return path;
  return path === '/' ? '/el' : `/el${path}`;
}
