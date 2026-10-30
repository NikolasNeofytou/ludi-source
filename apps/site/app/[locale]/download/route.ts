import { after, NextResponse, type NextRequest } from 'next/server';

import { capture } from '@/lib/analytics';
import { parseAppLinkSource } from '@/lib/app-link';
import { localePath } from '@/lib/paths';
import { parseScanSource } from '@/lib/scan-source';
import { APP_URL } from '@/lib/site';

/**
 * /download?from=<button> — every "Get the app" button on the site comes
 * through here, so a press is counted the same anonymous way as a scan of
 * /get (lib/analytics.ts): server-side, no cookie, no client JS, a random
 * one-time id. Then straight on to the store. Without it the site could
 * count scans and venue views but never the one thing the home page is for.
 *
 * Disallowed in robots.ts so crawlers following the buttons don't count.
 * While there is no public build (`APP_URL` null) it falls back to /get,
 * which knows what to say instead.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale: segment } = await params;
  const locale = segment === 'el' ? 'el' : 'en';

  if (!APP_URL) {
    return NextResponse.redirect(new URL(localePath(locale, '/get'), request.url), 302);
  }

  const from = parseAppLinkSource(request.nextUrl.searchParams.get('from'));
  const source = parseScanSource(request.nextUrl.searchParams.get('s') ?? undefined);
  after(() => capture('app_link_clicked', { from, locale, source }));
  return NextResponse.redirect(APP_URL, 302);
}
