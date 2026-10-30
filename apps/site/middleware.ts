import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { LOCALE_HEADER } from '@/lib/site';

// English is the default locale and lives unprefixed at `/`; Greek lives
// under `/el`. Both are implemented as `app/[locale]/*` routes, so every
// request needs a locale segment internally even though `/` shows no
// prefix in the browser. See docs/plans/site.md §Language.
//
// The resolved locale is also forwarded as a request header, because
// `app/global-not-found.tsx` renders outside the route-params tree and would
// otherwise have no way to know which language to apologise in.


export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/el' || pathname.startsWith('/el/')) {
    return NextResponse.next({
      request: { headers: withLocale(request, 'el') },
    });
  }

  if (pathname === '/en' || pathname.startsWith('/en/')) {
    // Canonical URLs never carry the /en prefix — redirect so there's one
    // URL per page (avoids duplicate-content SEO issues).
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(3) || '/';
    return NextResponse.redirect(url, 308);
  }

  const url = request.nextUrl.clone();
  url.pathname = `/en${pathname}`;
  return NextResponse.rewrite(url, {
    request: { headers: withLocale(request, 'en') },
  });
}

function withLocale(request: NextRequest, locale: 'en' | 'el'): Headers {
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  return headers;
}

export const config = {
  matcher: ['/((?!_next|\\.well-known|favicon\\.ico|.*\\..*).*)'],
};
