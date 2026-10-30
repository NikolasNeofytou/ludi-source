// src/lib/sentry.ts
// Sentry wiring for the mobile app (ADR-0010). DSN-guarded: with no
// EXPO_PUBLIC_SENTRY_DSN, init is a no-op so local dev and PR builds need no
// DSN. Initialised independently of the GDPR consent modal — crash reporting
// is legitimate-interest service stability, not analytics (PostHog #24 is the
// consent-gated one). PII is scrubbed at source via beforeSend/beforeBreadcrumb.

import * as Sentry from '@sentry/react-native';

import { scrub } from './scrub';

let initialised = false;

/** Initialise Sentry once. Missing DSN → no-op (dormant until provisioned). */
export function initSentry(): void {
  if (initialised) return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? 'development',
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrub(event),
    beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
  });
  initialised = true;
}

/**
 * Tag (or clear) the current user. Only the opaque user id reaches Sentry —
 * never name, phone, or email (those stay out of Sentry's user context per
 * ADR-0010). Pass null on sign-out.
 */
export function setSentryUser(id: string | null): void {
  Sentry.setUser(id ? { id } : null);
}
