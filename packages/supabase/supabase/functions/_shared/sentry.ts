// _shared/sentry.ts
// Sentry wiring for Edge Functions (ADR-0010). DSN-guarded: with no
// SENTRY_DSN in the environment, init is a no-op and captureException
// quietly does nothing, so local dev and CI need no DSN. PII is scrubbed
// at source via beforeSend/beforeBreadcrumb using the shared pure scrub().

import * as Sentry from '@sentry/deno';
import { scrub } from './scrub.ts';

let initialised = false;

/**
 * Initialise Sentry once per isolate. Safe to call at the top of every
 * function entrypoint — repeat calls and a missing DSN are both no-ops.
 */
export function initSentry(): void {
  if (initialised) return;
  const dsn = Deno.env.get('SENTRY_DSN');
  if (!dsn) return; // dormant until a DSN is provisioned — see ADR-0010

  Sentry.init({
    dsn,
    environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'development',
    // Never let Sentry auto-attach IPs, headers, or request bodies.
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    // Last line of defence: scrub every event and breadcrumb at source.
    beforeSend: (event) => scrub(event),
    beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
  });
  initialised = true;
}

/** Tag the current scope with a request correlation id (first 8 chars only). */
export function tagRequest(requestId: string): void {
  Sentry.setTag('request_id', requestId.slice(0, 8));
}

/**
 * Wrap a Deno HTTP handler so any thrown error is reported to Sentry and
 * flushed before the isolate can be frozen. The error is re-thrown so the
 * platform still returns its default 500 — wrapping changes observability,
 * not behaviour.
 */
export function withSentry(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  initSentry();
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (err) {
      Sentry.captureException(err);
      await Sentry.flush(2000);
      throw err;
    }
  };
}
