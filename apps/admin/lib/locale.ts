import { cookies, headers } from 'next/headers';

import { LOCALE_COOKIE, isLocale, type Locale } from '@/lib/copy';

// Where the language comes from when there is no account to ask (ADR-0037):
// the cookie the switch sets, else the browser, else English. Signed-in
// pages never call this — `requireVenueAccess()` reads the account.
export async function guestLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return fromAcceptLanguage((await headers()).get('accept-language'));
}

// 'el' anywhere in the list wins — a Cypriot phone set to Greek says
// `el-CY,el;q=0.9,en;q=0.8`, and we would rather greet a Greek-speaking
// stranger in Greek than the reverse.
export function fromAcceptLanguage(header: string | null): Locale {
  if (!header) return 'en';
  return /(^|,)\s*el(-|;|,|$)/i.test(header) ? 'gr' : 'en';
}
