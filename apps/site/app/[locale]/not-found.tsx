import { NotFoundPage } from '@/components/not-found-page';
import { getRequestLocale } from '@/lib/request-locale';

/**
 * The 404 for an explicit `notFound()` under a locale — today, a venue slug
 * that doesn't exist (`/v/<typo>`, or a retired venue on a printed QR).
 *
 * The only boundary above this one is Next's unbranded built-in at the app
 * root, since the root 404 is `global-not-found.tsx`, which never catches a
 * thrown `notFound()`. Here it sits inside the locale layout's <html lang>.
 *
 * Next 15 never server-renders this boundary: the response is a 404 whose
 * HTML is Next's empty error shell, and the browser draws this from the page
 * payload once the scripts load. That is how Next handles any `notFound()`
 * thrown by a page; only a URL that matches no route (global-not-found.tsx)
 * comes back as server-rendered HTML.
 *
 * A not-found file gets no params, and the middleware's locale header is off
 * limits here — see lib/request-locale.ts — so the layout hands it the locale.
 */
export default function LocaleNotFound() {
  return <NotFoundPage locale={getRequestLocale() ?? 'en'} />;
}
