import type { Metadata } from 'next';

import { FloodlightStrip } from '@/components/larnaca-scene';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { ContactCta, Kicker, Notice, Process, Reveal, StatRail } from '@/components/ui';
import { getCopy, locales } from '@/lib/content';
import type { Locale, RoadmapStageCopy, StageState } from '@/lib/content/types';
import { localePath } from '@/lib/paths';
import { tokens } from '@/lib/tokens';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const copy = getCopy(locale).owners;
  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: {
      languages: Object.fromEntries(locales.map((l) => [l, localePath(l, '/owners')])),
    },
  };
}

const STATE_COLOR: Record<StageState, string> = {
  built: tokens.pitch,
  building: tokens.sun,
  planned: tokens.ink3,
  later: tokens.ink3,
};

/**
 * The one page with a real ask, so it carries the weight the site used to
 * spread across four routes: the owner pitch, then what is actually built,
 * then who is behind it. `/roadmap` and `/about` folded in here rather than
 * standing alone — an owner deciding whether to trust a one-person operation
 * asks both questions on this page, not on two others.
 */
export default async function OwnersPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const site = getCopy(locale);
  const { owners, roadmap, about } = site;

  return (
    <div data-load>
      <SiteHeader locale={locale} nav={site.nav} currentPath="/owners" />

      <main className="shell">
        <Reveal>
          <div style={{ marginBottom: 32 }}>
            <FloodlightStrip />
          </div>

          <section>
            <Kicker label={owners.eyebrow} />
            <h1 className="t-page" style={{ maxWidth: '18ch' }}>
              {owners.heroTitle}
            </h1>
            <p className="prose" style={{ fontSize: 18, maxWidth: '40rem', margin: '18px 0 0' }}>
              {owners.heroSubtitle}
            </p>
            {owners.notice ? (
              <div style={{ marginTop: 20, maxWidth: '40rem' }}>
                <Notice>{owners.notice}</Notice>
              </div>
            ) : null}
            <StatRail stats={owners.stats} />
          </section>
        </Reveal>

        <Reveal delay={60}>
          <section style={{ marginTop: 56 }}>
            <Process steps={owners.steps} />
          </section>

          {/* What's actually built. Owners ask this before they ask anything
           * else, and the honest answer is a selling point: only the
           * foundation is done, and the site says so. */}
          <section style={{ marginTop: 64, maxWidth: '46rem' }}>
            <Kicker label={roadmap.eyebrow} />
            <h2 className="t-section" style={{ marginBottom: 10 }}>
              {roadmap.heroTitle}
            </h2>
            <Notice>{roadmap.notice}</Notice>
            <div style={{ marginTop: 28 }}>
              {roadmap.stages.map((stage) => (
                <Stage key={stage.title} stage={stage} />
              ))}
            </div>
          </section>

          {/* Who you'd actually be dealing with. */}
          <section style={{ marginTop: 64, maxWidth: '46rem' }}>
            <Kicker label={about.eyebrow} />
            <h2 className="t-section" style={{ marginBottom: 10 }}>
              {about.heroTitle}
            </h2>
            <p className="prose" style={{ fontSize: 15.5, margin: 0 }}>
              {about.heroSubtitle}
            </p>
            <p
              className="mono"
              style={{
                marginTop: 18,
                fontSize: 12.5,
                color: tokens.ink3,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span style={{ color: tokens.ink, fontWeight: 700 }}>{about.bylineName}</span>
              <span className="tag__sep" aria-hidden="true" />
              <span>{about.bylinePlace}</span>
            </p>

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 26, marginTop: 30 }}
            >
              {about.sections.map((section) => (
                <div key={section.title}>
                  <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>
                    {section.title}
                  </h3>
                  <p className="prose" style={{ margin: 0, fontSize: 15 }}>
                    {section.body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <ContactCta
            title={owners.ctaTitle}
            body={owners.ctaBody}
            label={owners.ctaLabel}
            note={owners.ctaNote}
            subject="Ludi — pitch owner interest"
          />
        </Reveal>
      </main>

      <SiteFooter locale={locale} nav={site.nav} />
    </div>
  );
}

function Stage({ stage }: { stage: RoadmapStageCopy }) {
  const color = STATE_COLOR[stage.state];

  return (
    <section style={{ marginBottom: 26 }}>
      <span className="tag tag--strong" style={{ color }}>
        <span className="tag__dot" style={{ background: color }} />
        {stage.marker}
      </span>
      <h3 style={{ fontSize: 17, fontWeight: 600, margin: '10px 0 6px' }}>{stage.title}</h3>
      {stage.body ? (
        <p className="prose" style={{ margin: '0 0 10px', fontSize: 15 }}>
          {stage.body}
        </p>
      ) : null}
      {stage.items.length > 0 ? (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
          }}
        >
          {stage.items.map((item) => (
            <li
              key={item}
              className="prose"
              style={{ fontSize: 14.5, display: 'flex', gap: 11, alignItems: 'flex-start' }}
            >
              <span
                aria-hidden="true"
                style={{
                  marginTop: 8,
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: color,
                  flex: 'none',
                }}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
