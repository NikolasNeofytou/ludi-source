import type { Metadata } from 'next';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Kicker, Reveal } from '@/components/ui';
import { getCopy } from '@/lib/content';
import type { Locale } from '@/lib/content/types';
import { tokens } from '@/lib/tokens';

// The nonce is unbounded by construction; the locale layout pins
// `dynamicParams = false` for its own segment, as /f/<token> also overrides.
export const dynamicParams = true;

/**
 * /auth/callback/<nonce> — a magic link that opened in a browser.
 *
 * The other half of `apps/mobile/src/lib/auth-providers.ts`: the app sends
 * magic links to this https path because only Ludi can claim it (the AASA
 * file, Android App Links), so on the phone that asked, the link opens the
 * app before this page loads. This page is for when it does not — another
 * device, a mail app's own browser, Ludi not installed.
 *
 * It never signs anyone in, and it never hands the link's `token_hash` to
 * the `ludi://` scheme: that token is a credential on its own, and any app
 * can register the scheme (security audit 2026-10-19). A PKCE `code` is
 * different — it is worthless without the verifier stored on the phone that
 * asked — so that one, and only that one, gets an "Open in Ludi" button.
 *
 * Nothing about the request is recorded, and the referrer is withheld so
 * the link's query never leaves in a Referer header.
 */

const NONCE = /^[0-9a-f]{32}$/;
const PKCE_CODE = /^[0-9a-f-]{36}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: getCopy(locale).signInLink.metaTitle,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function SignInLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; nonce: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, nonce } = await params;
  const query = await searchParams;
  const site = getCopy(locale);
  const copy = site.signInLink;

  const code = typeof query.code === 'string' ? query.code : null;
  const handOff =
    NONCE.test(nonce) && code && PKCE_CODE.test(code)
      ? `ludi://callback/${nonce}?code=${encodeURIComponent(code)}`
      : null;

  return (
    <div data-load>
      <SiteHeader locale={locale} nav={site.nav} currentPath="/" />

      <main className="shell">
        <Reveal>
          <section>
            <Kicker label={copy.eyebrow} color={tokens.primary} />
            <h1 className="t-page" style={{ maxWidth: '18ch' }}>
              {copy.title}
            </h1>
            <p className="prose" style={{ fontSize: 18, maxWidth: '40rem', margin: '18px 0 0' }}>
              {copy.body}
            </p>
            <ol className="prose" style={{ maxWidth: '40rem', margin: '22px 0 0', paddingLeft: 22, lineHeight: 1.6 }}>
              {copy.steps.map((step) => (
                <li key={step} style={{ marginBottom: 8 }}>
                  {step}
                </li>
              ))}
            </ol>
            {handOff ? (
              <div style={{ marginTop: 26 }}>
                <a className="btn press" href={handOff}>
                  {copy.openInApp}
                </a>
              </div>
            ) : null}
          </section>
        </Reveal>
      </main>

      <SiteFooter locale={locale} nav={site.nav} />
    </div>
  );
}
