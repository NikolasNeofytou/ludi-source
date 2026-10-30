import type { Metadata } from 'next';
import { after } from 'next/server';

import { InAppNote } from '@/components/in-app-note';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { ContactCta, Kicker, Reveal } from '@/components/ui';
import { capture } from '@/lib/analytics';
import { getCopy } from '@/lib/content';
import type { GetCopy, Locale } from '@/lib/content/types';
import { localePath } from '@/lib/paths';
import { parseScanSource } from '@/lib/scan-source';
import { APP_URL, mailto } from '@/lib/site';
import { tokens } from '@/lib/tokens';
import { requestAgent } from '@/lib/user-agent';

/**
 * /get — what a stranger sees the instant they scan the flyer.
 *
 * Every printed poster and the wallet-pass QR encode `ludi.football/get`
 * (print QRs add `?s=<venue>-<piece>`, lib/scan-source.ts) (see `next.config.mjs`'s comment on the route it used to be:
 * a bare redirect straight into Apple's generic TestFlight help page, with
 * no Ludi branding and nothing at all for an Android visitor). This is the
 * replacement: a real, branded page that says what Ludi is in one line,
 * then gives each platform an actual next step. The iOS button resolves
 * `APP_DOWNLOAD_URL` → `APP_URL`, same chain the old redirect used, so the
 * App Store cutover is still the one-line env edit the launch plan built.
 *
 * Deliberately not in ROUTES/sitemap/nav, same posture as `/f/<token>` —
 * reached only by scanning something, never browsed to.
 */

// Which block leads (iOS vs Android) depends on the request's user-agent —
// this must never be served from a cache.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const copy = getCopy(locale).get;
  return { title: copy.metaTitle, description: copy.metaDescription };
}

function IosBlock({ copy }: { copy: GetCopy }) {
  // Same fallback chain the old `/get` redirect used: `APP_DOWNLOAD_URL`
  // (Vercel env, flips without a commit — the App Store cutover this was
  // built for) over `APP_URL` (the committed constant `AppCta` elsewhere
  // on the site reads). Kept independent of `AppCta` so that fast path
  // still works even though this page no longer *is* a redirect.
  const href = process.env.APP_DOWNLOAD_URL || APP_URL;

  return (
    <div className="card" style={{ padding: 26 }}>
      {href ? (
        <a className="btn btn--wide press" href={href}>
          {copy.downloadLabel} →
        </a>
      ) : (
        <a className="btn btn--wide press" href={mailto(copy.contactSubject)}>
          {copy.contactLabel}
        </a>
      )}
      <p className="prose" style={{ fontSize: 13.5, color: tokens.ink3, margin: '16px 0 0', maxWidth: '32rem' }}>
        {copy.iosNote}
      </p>
    </div>
  );
}

function AndroidBlock({ copy }: { copy: GetCopy }) {
  return (
    <ContactCta
      title={copy.androidTitle}
      body={copy.androidBody}
      label={copy.androidLabel}
      note={copy.androidNote}
      subject={copy.androidSubject}
    />
  );
}

export default async function GetPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ s?: string | string[] }>;
}) {
  const { locale } = await params;
  const source = parseScanSource((await searchParams).s);
  const site = getCopy(locale);
  const copy = site.get;

  const { platform, browser } = await requestAgent();

  after(() => capture('get_landing_viewed', { platform, locale, source, browser }));

  const blocks =
    platform === 'android'
      ? [<AndroidBlock key="android" copy={copy} />, <IosBlock key="ios" copy={copy} />]
      : [<IosBlock key="ios" copy={copy} />, <AndroidBlock key="android" copy={copy} />];

  return (
    <div data-load>
      <SiteHeader locale={locale} nav={site.nav} currentPath="/" />

      <main className="shell">
        <Reveal>
          <section>
            <Kicker label={copy.eyebrow} color={tokens.pitch} />
            <h1 className="t-page" style={{ maxWidth: '18ch' }}>
              {copy.title}
            </h1>
            <p className="prose" style={{ fontSize: 18, maxWidth: '40rem', margin: '18px 0 0' }}>
              {copy.body}
            </p>

            <div style={{ display: 'grid', gap: 20, maxWidth: '34rem', marginTop: 34 }}>{blocks}</div>
            <InAppNote
              copy={site.inApp}
              browser={browser}
              platform={platform}
              path={localePath(locale, source === 'direct' || source === 'other' ? '/get' : `/get?s=${source}`)}
            />
          </section>
        </Reveal>
      </main>

      <SiteFooter locale={locale} nav={site.nav} />
    </div>
  );
}
