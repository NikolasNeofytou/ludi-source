import { cache } from 'react';

import type { Locale } from '@/lib/content/types';

// `app/[locale]/not-found.tsx` gets no params, and reading the locale from
// the middleware's header there would make every page on the site dynamic:
// Next renders the not-found boundary into each page's payload, so a
// `headers()` call in it runs on every prerender. The locale layout records
// its locale here instead. React's `cache` scopes this to one render, and the
// boundary always renders after the layout, since it is part of what the
// layout returns (its `children`), not a sibling rendered alongside it.
const store = cache((): { locale?: Locale } => ({}));

export function setRequestLocale(locale: Locale): void {
  store().locale = locale;
}

export function getRequestLocale(): Locale | undefined {
  return store().locale;
}
