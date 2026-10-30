import type { Metadata } from 'next';
import { after } from 'next/server';

import { InAppNote } from '@/components/in-app-note';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { AppCta, Kicker, Notice, Reveal } from '@/components/ui';
import { capture } from '@/lib/analytics';
import { getCopy } from '@/lib/content';
import type { FixtureInviteCopy, Locale } from '@/lib/content/types';
import {
  fetchFixturePreview,
  fetchInviteRecorded,
  fixtureState,
  formatFixtureWhen,
  type FixturePreview,
  keeperOpen,
  seatsOpen,
} from '@/lib/fixture';
import { localePath } from '@/lib/paths';
import { parseScanSource, type ScanSource } from '@/lib/scan-source';
import { tokens } from '@/lib/tokens';
import { requestAgent } from '@/lib/user-agent';

// Spots-open changes with every join; this page must not lie from a cache.
export const dynamic = 'force-dynamic';
// The locale layout pins `dynamicParams = false` for its own two-value
// segment; the token segment is unbounded by construction and overrides.
export const dynamicParams = true;

/**
 * /f/<token> — the invite that survives the missing app (C1).
 *
 * The other half of `apps/mobile/app/f/[token].tsx`: the same invite link,
 * for the person who cannot open it in an app they do not have. Renders the
 * `fixture_preview()` fields and a way to the app — nothing else. A preview
 * and a funnel, never a surface: no login, no names, no index (ADR-0025).
 *
 * Deliberately not in ROUTES/sitemap/nav — an invite is a capability
 * (ADR-0021), reached only by being sent it.
 */

function spotsLine(copy: FixtureInviteCopy, p: FixturePreview): string {
  const open = seatsOpen(p);
  if (open === 1) return copy.spotsOne;
  return copy.spotsMany.replace('{n}', String(open));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale; token: string }>;
}): Promise<Metadata> {
  const { locale, token } = await params;
  const copy = getCopy(locale).fixture;
  const result = await fetchFixturePreview(token);

  // The OG card says what the preview says, no more: venue, time, format,
  // spots. Never names, never the booking code. Invalid and error states
  // share the generic card so a dead link unfurls without apologising.
  let title = copy.metaTitle;
  let description = copy.metaDescription;
  if (result.kind === 'ok' && fixtureState(result.preview) === 'open') {
    const p = result.preview;
    title = `${copy.pitchTypes[p.pitch_type]} — ${p.venue_name}`;
    const keeper = keeperOpen(p) ? ` · ${copy.keeperNeeded}` : '';
    description = `${formatFixtureWhen(locale, p.starts_at, p.ends_at)} · ${spotsLine(copy, p)}${keeper}`;
  }

  // No explicit `openGraph` key: og/twitter title and description derive
  // from `title`/`description`, and setting the object here would replace —
  // not merge with — the inherited chain, silently dropping the layout's
  // site_name/type and this segment's own og:image (opengraph-image.tsx,
  // plans/instagram.md IG-3), which is what makes the WhatsApp unfurl a
  // card rather than a bare link.
  return {
    title,
    description,
    robots: { index: false, follow: false },
  };
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 16, padding: '12px 0', borderBottom: `1px solid ${tokens.line}` }}>
      <span
        className="mono"
        style={{
          fontSize: 12,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: tokens.ink3,
          minWidth: 72,
          paddingTop: 3,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 17, color: tokens.ink, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

/** Title + body — what the full/started/off/invalid/error states share. */
function Plain({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h1 className="t-page" style={{ maxWidth: '18ch' }}>
        {title}
      </h1>
      <p className="prose" style={{ fontSize: 18, maxWidth: '40rem', margin: '18px 0 0' }}>
        {body}
      </p>
    </>
  );
}

function InstallBlock({
  copy,
  locale,
  token,
  source,
}: {
  copy: FixtureInviteCopy;
  locale: Locale;
  token?: string;
  source: ScanSource;
}) {
  return (
    <div style={{ marginTop: 34 }}>
      <h2 style={{ fontSize: 22, margin: '0 0 8px' }}>{copy.installTitle}</h2>
      <p className="prose" style={{ maxWidth: '40rem', margin: '0 0 20px' }}>
        {copy.installBody}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <AppCta
          downloadLabel={copy.downloadLabel}
          contactLabel={copy.contactLabel}
          subject={copy.contactSubject}
          from="invite"
          locale={locale}
          source={source === 'direct' || source === 'other' ? undefined : source}
        />
        {token ? (
          // Works today for anyone who already has the app; becomes largely
          // decorative once the associated domain propagates and iOS opens
          // the app before this page ever loads (W2/W3).
          <a className="btn press" href={`ludi://f/${token}`} style={{ background: tokens.surface, color: tokens.ink, border: `1px solid ${tokens.lineBold}` }}>
            {copy.openInApp}
          </a>
        ) : null}
      </div>
      <p className="mono" style={{ fontSize: 13, color: tokens.ink3, margin: '14px 0 0' }}>
        {copy.tapAgain}
      </p>
    </div>
  );
}

export default async function FixtureInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; token: string }>;
  searchParams: Promise<{ s?: string | string[] }>;
}) {
  const { locale, token } = await params;
  // A Story card, a keyword DM or the venue's page tags the link
  // (plans/instagram.md IG-1); the tag is counted and handed to the store button.
  const source = parseScanSource((await searchParams).s);
  const { platform, browser } = await requestAgent();
  const site = getCopy(locale);
  const copy = site.fixture;
  const result = await fetchFixturePreview(token);
  const state = result.kind === 'ok' ? fixtureState(result.preview) : result.kind;
  const recorded = state === 'open' ? await fetchInviteRecorded(token) : false;

  // Counted after the response is sent, never blocking it. State and locale
  // only — the funnel needs "how many landings, in which state", not who.
  after(() => capture('invite_landing_viewed', { state, locale, source, browser }));

  return (
    <div data-load>
      <SiteHeader locale={locale} nav={site.nav} currentPath="/" />

      <main className="shell">
        <Reveal>
          <section>
            <Kicker label={copy.eyebrow} color={tokens.pitch} />

            {state === 'open' && result.kind === 'ok' ? (
              <>
                <h1 className="t-page" style={{ maxWidth: '18ch' }}>
                  {copy.joinTitle}
                </h1>

                <div style={{ maxWidth: '40rem', marginTop: 26, borderTop: `1px solid ${tokens.lineBold}` }}>
                  <DetailRow
                    label={copy.whenLabel}
                    value={formatFixtureWhen(locale, result.preview.starts_at, result.preview.ends_at)}
                  />
                  <DetailRow
                    label={copy.whereLabel}
                    value={`${result.preview.venue_name} · ${result.preview.pitch_name}, ${
                      locale === 'el' ? result.preview.city_name_gr : result.preview.city_name_en
                    }`}
                  />
                  <DetailRow label={copy.formatLabel} value={copy.pitchTypes[result.preview.pitch_type]} />
                </div>

                <div style={{ marginTop: 20, maxWidth: '40rem' }}>
                  <Notice>
                    {spotsLine(copy, result.preview)}
                    {keeperOpen(result.preview) ? ` — ${copy.keeperNeeded}` : ''}
                  </Notice>
                </div>

                {recorded ? (
                  <p className="prose" style={{ maxWidth: '40rem', margin: '16px 0 0', fontSize: 15 }}>
                    {copy.recordedNotice}
                  </p>
                ) : null}

                <InstallBlock copy={copy} locale={locale} token={token} source={source} />
              </>
            ) : null}

            {state === 'full' ? (
              <>
                <Plain title={copy.fullTitle} body={copy.fullBody} />
                <InstallBlock copy={copy} locale={locale} source={source} />
              </>
            ) : null}

            {state === 'started' ? (
              <>
                <Plain title={copy.startedTitle} body={copy.startedBody} />
                <InstallBlock copy={copy} locale={locale} source={source} />
              </>
            ) : null}

            {state === 'off' ? (
              <>
                <Plain title={copy.offTitle} body={copy.offBody} />
                <InstallBlock copy={copy} locale={locale} source={source} />
              </>
            ) : null}

            {/* A revoked token and a made-up one get the same page, and it
             * offers nothing to probe — a dead link must not leak whether it
             * ever existed (ADR-0025). */}
            {state === 'invalid' ? <Plain title={copy.invalidTitle} body={copy.invalidBody} /> : null}

            {state === 'error' ? <Plain title={copy.errorTitle} body={copy.errorBody} /> : null}

            {state !== 'invalid' && state !== 'error' ? (
              <InAppNote
                copy={site.inApp}
                browser={browser}
                platform={platform}
                path={localePath(
                  locale,
                  `/f/${token}${source === 'direct' || source === 'other' ? '' : `?s=${source}`}`,
                )}
              />
            ) : null}
          </section>
        </Reveal>
      </main>

      <SiteFooter locale={locale} nav={site.nav} />
    </div>
  );
}
