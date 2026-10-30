import Link from 'next/link';

import { ENROL_STEPS, type EnrolStep } from '@/lib/enrol';

// The stepper for the counter flow. Plain links: a finished step is a URL
// you can go back to, an unfinished one is not yet reachable (its page
// would only say "add courts first"). Nothing here is state — `done` is
// read from the rows on every page (ADR-0031).
export function EnrolSteps({
  venueId,
  current,
  done,
}: {
  venueId: string | null;
  current: EnrolStep;
  done: Partial<Record<EnrolStep, boolean>>;
}) {
  return (
    <ol className="enrol-steps" aria-label="Enrolment steps">
      {ENROL_STEPS.map((s, i) => {
        const isCurrent = s.key === current;
        const isDone = Boolean(done[s.key]);
        const href =
          venueId && s.key !== 'venue'
            ? `/venues/${venueId}/enrol/${s.key}`
            : venueId
              ? `/venues/${venueId}/edit`
              : '/venues/enrol';
        const reachable = isDone || isCurrent || (venueId !== null && s.key !== 'review');
        const className = [
          'enrol-step',
          isCurrent ? 'enrol-step-current' : '',
          isDone ? 'enrol-step-done' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const body = (
          <>
            <span className="enrol-step-num" aria-hidden>
              {isDone && !isCurrent ? '✓' : i + 1}
            </span>
            <span className="enrol-step-label">{s.label}</span>
          </>
        );
        return (
          <li key={s.key} className={className} aria-current={isCurrent ? 'step' : undefined}>
            {reachable && !isCurrent ? <Link href={href}>{body}</Link> : <span>{body}</span>}
          </li>
        );
      })}
    </ol>
  );
}
