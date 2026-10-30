import type { ReactNode } from 'react';

import type { AppLinkSource } from '@/lib/app-link';
import type { Locale, StatCopy, StepCopy } from '@/lib/content/types';
import { localePath } from '@/lib/paths';
import { APP_URL, mailto } from '@/lib/site';
import { tokens } from '@/lib/tokens';

/**
 * Load-reveal wrapper. Reveals fire once on load and never on scroll, so the
 * page holds still after it arrives — see docs/motion-spec-site.md. The
 * stagger is `animation-delay` only; there is no JS and no observer.
 */
export function Reveal({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className ? `reveal ${className}` : 'reveal'} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** Mono caps with a leading rule — the "unboxed" audience label (option 6c). */
export function Eyebrow({ label, color = tokens.primary }: { label: string; color?: string }) {
  return (
    <span className="eyebrow" style={{ color }}>
      <span className="eyebrow__rule" />
      {label}
    </span>
  );
}

/** Mono caps with no rule, for the page-level kicker above a headline. */
export function Kicker({ label, color = tokens.primary }: { label: string; color?: string }) {
  return (
    <p
      className="mono"
      style={{
        fontSize: 12,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color,
        margin: '0 0 18px',
        fontWeight: 500,
      }}
    >
      {label}
    </p>
  );
}

const RAIL_COLORS = [tokens.primary, tokens.pitch, tokens.sun];

export function StatRail({ stats }: { stats: StatCopy[] }) {
  return (
    <dl className="rail">
      {stats.map((stat, i) => (
        <div className="rail__cell" key={stat.value + stat.label}>
          <dt className="rail__value" style={{ color: RAIL_COLORS[i % RAIL_COLORS.length] }}>
            {stat.value}
          </dt>
          <dd className="rail__label" style={{ margin: 0 }}>
            {stat.label}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Four claims rendered as a numbered sequence with a spine line, so the page
 * reads as a process rather than a list of assertions.
 */
export function Process({ steps }: { steps: StepCopy[] }) {
  return (
    <ol className="process">
      {steps.map((step, i) => (
        <li className="process__item" key={step.title}>
          <span className="process__num" aria-hidden="true">
            {String(i + 1).padStart(2, '0')}
          </span>
          <div>
            <h2 className="t-section" style={{ marginBottom: 8 }}>
              {step.title}
            </h2>
            <p className="prose" style={{ margin: 0, fontSize: 15.5, maxWidth: '46rem' }}>
              {step.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** ✎-style warning strip. Keeps its container deliberately: it is a warning,
 * not a tag, and it should keep shouting. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="notice" role="note">
      <span aria-hidden="true">▲</span>
      <span>{children}</span>
    </p>
  );
}

/**
 * Closing contact block. Every CTA on the site is a direct line to the founder
 * rather than a signup form — onboarding is founder-mediated and there is no
 * waitlist backend by design (docs/plans/site.md).
 */
export function ContactCta({
  title,
  body,
  label,
  note,
  subject,
}: {
  title: string;
  body: string;
  label: string;
  note?: string;
  subject: string;
}) {
  return (
    <section
      className="card"
      style={{
        background: tokens.primarySoft,
        textAlign: 'center',
        marginTop: 56,
      }}
    >
      <h2 className="t-section" style={{ color: tokens.primaryDeep }}>
        {title}
      </h2>
      <p
        className="prose"
        style={{ fontSize: 15, margin: '10px auto 20px', maxWidth: '34rem' }}
      >
        {body}
      </p>
      <a className="btn btn--wide press" href={mailto(subject)}>
        {label}
      </a>
      {note ? (
        <p style={{ fontSize: 12.5, color: tokens.ink3, margin: '14px 0 0' }}>{note}</p>
      ) : null}
    </section>
  );
}

/** The small chalk-field tile used inside the home fork rows. */
export function FieldTile({ dark = false }: { dark?: boolean }) {
  const bg = dark ? tokens.primary : tokens.primarySoft;
  const stroke = dark ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.9)';
  return (
    <div
      className="fork__art"
      style={{ height: 96, borderRadius: 20, overflow: 'hidden', background: bg }}
    >
      <svg
        viewBox="0 0 362 170"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block' }}
        aria-hidden="true"
      >
        <rect x="0" y="0" width="362" height="170" fill={bg} />
        <rect x="18" y="16" width="326" height="138" fill="none" stroke={stroke} strokeWidth="3" />
        <circle cx="181" cy="85" r="34" fill="none" stroke={stroke} strokeWidth="3" />
        <line x1="181" y1="16" x2="181" y2="154" stroke={stroke} strokeWidth="3" />
      </svg>
    </div>
  );
}

/**
 * The player call-to-action.
 *
 * Renders a download button when `APP_URL` is set, and the founder contact line
 * while it is null. The fallback is the point: a player CTA that goes nowhere
 * is worse than one that goes somewhere modest, and the site should never ship
 * a button pointing at a URL nobody has published yet.
 *
 * The button goes through /download, which counts the press (`from`, a closed
 * list) and redirects to `APP_URL` — see app/[locale]/download/route.ts.
 */
export function AppCta({
  downloadLabel,
  contactLabel,
  subject,
  from,
  locale,
  onDark = false,
  source,
}: {
  downloadLabel: string;
  contactLabel: string;
  subject: string;
  from: AppLinkSource;
  locale: Locale;
  onDark?: boolean;
  /** The tag the page was reached with, handed on to /download (lib/scan-source.ts). */
  source?: string;
}) {
  const style = onDark ? { background: tokens.sun, color: tokens.ink } : undefined;

  if (APP_URL) {
    return (
      <a
        className="btn btn--wide press"
        href={localePath(locale, `/download?from=${from}${source ? `&s=${encodeURIComponent(source)}` : ''}`)}
        style={style}
      >
        {downloadLabel} →
      </a>
    );
  }

  return (
    <a className="btn btn--wide press" href={mailto(subject)} style={style}>
      {contactLabel}
    </a>
  );
}
