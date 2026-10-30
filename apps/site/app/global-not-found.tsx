import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { NotFoundPage } from '@/components/not-found-page';
import { getCopy, isLocale } from '@/lib/content';
import type { Locale } from '@/lib/content/types';
import { fontVariables } from '@/lib/fonts';
import { LOCALE_HEADER } from '@/lib/site';

import './[locale]/globals.css';

/**
 * The 404 for a URL that matches no route: `/xx`, `/el/owners/nope`, and
 * dotted paths like `/wp-login.php` that skip the middleware.
 *
 * `global-not-found` (experimental.globalNotFound in next.config.mjs), not a
 * root `not-found.tsx`, for two reasons. This app has no `app/layout.tsx`, so
 * Next wrapped a root not-found in a default layout of its own and the page
 * went out with two <html> tags; this file renders with no layout around it.
 * And a root not-found is rendered into every page's payload, so its
 * `headers()` call below kept every page on the site from prerendering. This
 * file only ever renders for the 404 itself.
 *
 * Locale comes from the header the middleware stamps, since there is no
 * `[locale]` param out here. A dotted path never reaches the middleware, so
 * it gets English.
 *
 * An explicit `notFound()` under a locale is `app/[locale]/not-found.tsx`.
 */
async function requestLocale(): Promise<Locale> {
  const header = (await headers()).get(LOCALE_HEADER);
  return isLocale(header) ? header : 'en';
}

export async function generateMetadata(): Promise<Metadata> {
  const { notFound } = getCopy(await requestLocale());
  return { title: `${notFound.title} — Ludi` };
}

export default async function GlobalNotFound() {
  const locale = await requestLocale();

  return (
    <html lang={locale} className={fontVariables}>
      <body>
        <NotFoundPage locale={locale} />
      </body>
    </html>
  );
}
