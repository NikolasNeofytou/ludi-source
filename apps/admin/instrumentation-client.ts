// instrumentation-client.ts — browser runtime init (ADR-0010).
// DSN-guarded via `enabled`: with no DSN, Sentry stays dormant.
import * as Sentry from '@sentry/nextjs';

import { scrub } from './lib/scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development',
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  // Every payload that leaves, not only errors (audit C4): with traces
  // sampled, transaction names, request URLs and span descriptions carry
  // /tv/<token> links and ?token_hash= / ?code= sign-in secrets.
  beforeSend: (event) => scrub(event),
  beforeSendTransaction: (event) => scrub(event),
  beforeSendSpan: (span) => scrub(span),
  beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
});

// Required by @sentry/nextjs to instrument App Router client navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
