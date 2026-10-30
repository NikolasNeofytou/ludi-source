'use client';

import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import { useEffect } from 'react';

import { useCopy } from '@/components/locale-provider';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';

// Every page throws when a query fails — deliberately, so a half-loaded
// money page never renders as if it were whole. Before this file the throw
// landed on Next's bare "Application error" screen: no nav, no retry, no
// way back but the browser's. This is the same outcome with a way out.
//
// It renders inside the root layout but outside the page's AppShell (each
// page draws its own shell), so it carries its own links rather than the
// nav. `error.digest` is what the server logs and Sentry key on; showing
// it lets an owner quote it in an email without us exposing the message.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The nearest provider: the root layout's guest locale. AppShell's
  // account locale is below the error boundary, so a cookie set by the
  // switch is what keeps this page in the owner's language.
  const t = useCopy().errorPage;
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="centre">
      <h1 style={{ fontSize: 30 }}>{t.title}</h1>
      <p style={{ margin: 0, color: 'var(--ludi-ink2)', maxWidth: 460 }}>
        {t.body}
        <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
        {error.digest ? (
          <>
            {t.withCode}
            <code>{error.digest}</code>
          </>
        ) : null}
        .
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          {t.tryAgain}
        </button>
        <Link href="/" className="btn btn-secondary">
          {t.goToday}
        </Link>
      </div>
    </main>
  );
}
