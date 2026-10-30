import Link from 'next/link';
import type { ReactNode } from 'react';

import { Badge, Card } from '@/components/ui/primitives';
import { getCopy, type Locale } from '@/lib/copy';

// The owner's self-serve onboarding path (ADR-0019: the dashboard IS the
// intake form). The founder creates a stub venue and grants access; the
// owner fills in courts, prices and hours here, in whatever order and at
// whatever pace suits them. This card turns that from tribal knowledge
// into visible steps, and disappears the moment everything is done.
//
// One card per venue — a multi-venue owner's second venue has its own
// courts, hours and Stripe account, and pooling them would tick a step
// for a venue that hasn't done it.
//
// Server component — every done/undone state is computed from the data
// the owner can already read under RLS, so it can never claim something
// the dashboard wouldn't show.

export type SetupStep = {
  label: string;
  detail: ReactNode;
  done: boolean;
  href?: string;
  linkLabel?: string;
  // An interactive affordance for steps a plain link can't start (the
  // Payment setup step invokes an Edge Function). Rendered instead of the
  // href link while the step is open.
  action?: ReactNode;
};

// Whether the card has anything to say. The page filters on this so a
// finished venue leaves no empty slot in the layout.
export function setupHasWork(steps: SetupStep[], notes: ReactNode[] = []): boolean {
  return notes.length > 0 || steps.some((s) => !s.done);
}

export function SetupChecklist({
  locale,
  venueName,
  steps,
  live = false,
  notes = [],
}: {
  locale: Locale;
  venueName: string;
  steps: SetupStep[];
  // Players can already book at least one court here. The remaining steps
  // are then loose ends, not a gate — saying "before players can book" to
  // an owner whose phone is ringing with bookings would be false.
  live?: boolean;
  // One-liners for a live venue — a new court waiting for review — that
  // must not reopen the whole checklist.
  notes?: ReactNode[];
}) {
  if (!setupHasWork(steps, notes)) return null;
  const t = getCopy(locale);
  const remaining = steps.filter((s) => !s.done).length;

  if (remaining === 0) {
    return (
      <Card>
        <div className="stack" style={{ gap: 8 }}>
          <strong style={{ fontSize: 15 }}>{venueName}</strong>
          {notes.map((note, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <Badge tone="info">{t.common.inReview}</Badge>
              <span style={{ color: 'var(--ludi-ink2)', fontSize: 14 }}>{note}</span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  const summary = live ? t.checklist.liveLeft(remaining) : t.checklist.gateLeft(remaining);

  return (
    <Card>
      <div className="stack" style={{ gap: 14 }}>
        <div>
          <strong style={{ fontSize: 16 }}>{t.checklist.setUp(venueName)}</strong>
          <p style={{ margin: '4px 0 0', color: 'var(--ludi-ink2)', fontSize: 14 }}>
            {summary} {t.checklist.fillIn}
          </p>
        </div>

        {steps.map((step) => (
          <div
            key={step.label}
            style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}
          >
            <Badge tone={step.done ? 'good' : 'warn'}>
              {step.done ? t.checklist.done : t.checklist.todo}
            </Badge>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ opacity: step.done ? 0.6 : 1 }}>
                <strong>{step.label}</strong>
                <span style={{ color: 'var(--ludi-ink2)' }}> — {step.detail}</span>
              </span>{' '}
              {!step.done && step.action ? (
                step.action
              ) : !step.done && step.href ? (
                <Link href={step.href}>{step.linkLabel ?? t.checklist.open}</Link>
              ) : null}
            </div>
          </div>
        ))}

        {notes.map((note, i) => (
          <div
            key={`note-${i}`}
            style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}
          >
            <Badge tone="info">{t.common.inReview}</Badge>
            <span style={{ color: 'var(--ludi-ink2)', fontSize: 14 }}>{note}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
