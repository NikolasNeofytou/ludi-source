// Local UI primitives for the admin (M6 #41c).
//
// Why here and not in `packages/ui-web/`: ADR-0007 gates that extraction
// on three components genuinely shared between `apps/admin` and
// `apps/site`. Checked 2026-08-22 — `apps/site/components/ui.tsx` exports
// Reveal, Eyebrow, Kicker, StatRail, Process, Notice, ContactCta,
// FieldTile and AppCta, none of which overlap with a Table or a Badge.
// The trigger is still 0/3, so this stays in-app on purpose.
//
// Styling lives in app/globals.css rather than in style objects, because
// the shell is phone-first and inline styles cannot express a media
// query. Class names are plain (not CSS Modules) to match the convention
// `apps/site` already established.

import type { ReactNode } from 'react';

type Tone = 'neutral' | 'good' | 'warn' | 'alert' | 'info';

export function Card({
  children,
  pad = true,
  className,
}: {
  children: ReactNode;
  pad?: boolean;
  className?: string;
}) {
  return (
    <div className={[ 'card', pad ? 'card-pad' : '', className ?? '' ].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

export function PageHead({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <h1 className="page-title">{title}</h1>
      {meta ? <span className="page-meta">{meta}</span> : null}
      {actions ? <span style={{ marginLeft: 'auto' }}>{actions}</span> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Table({
  head,
  children,
}: {
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({
  children,
  numeric,
}: {
  children: ReactNode;
  numeric?: boolean;
}) {
  return <th className={numeric ? 'th num' : 'th'}>{children}</th>;
}

// `label` is what the cell is called in the header. Below 768px the table
// collapses to one card per row and this is what each value is labelled
// with, so it is required rather than optional — a cell with no label
// would render as an unexplained value on a phone. Pass '' deliberately
// for an actions cell, which reads as a full-width row instead.
export function Td({
  label,
  children,
  numeric,
}: {
  label: string;
  children: ReactNode;
  numeric?: boolean;
}) {
  // The value is always wrapped in one element. In card mode the cell is a
  // flex row of [label, value]; leaving `children` bare makes every text
  // node and span its own flex item, so a cell like `{type}<span> · {surface}</span>`
  // gets spread to opposite edges instead of reading as one value.
  return (
    <td className={numeric ? 'td num' : 'td'} data-label={label}>
      <span className="td-value">{children}</span>
    </td>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Stat({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="card empty">{children}</div>
  );
}
