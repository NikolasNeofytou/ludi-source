'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// The last resort, for an error in the root layout itself — app/error.tsx
// cannot catch those because it renders inside that layout. It replaces
// the whole document, so no fonts, tokens or globals.css: plain inline
// styles only. Sentry's Next.js SDK expects this file to exist.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f4f4f4',
          color: '#1b1f22',
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 24 }}>Ludi didn&apos;t load</h1>
          <p style={{ color: '#4a5358' }}>
            Try again in a moment. If it keeps happening, email
            nikolas@ludi.football
            {error.digest ? ` with the code ${error.digest}` : ''}.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: 0,
              background: '#2f6f8f',
              color: '#fff',
              fontSize: 14,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
