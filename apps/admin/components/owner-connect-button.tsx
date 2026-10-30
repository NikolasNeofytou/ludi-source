'use client';

// 41m — the owner's own "set up payments" CTA, rendered inside the setup
// checklist's Payment setup step (and on Earnings while onboarding is
// unfinished). Invokes venue-connect-onboard (owner-gated since 2026-08-31)
// and sends the owner straight into Stripe's hosted KYC; return/refresh
// land back on the page that sent them. Contrast the admin's
// VenueConnectButton, which copies the link to forward — here the owner IS
// the person Stripe wants to talk to, so we just go.

import { useState, type CSSProperties } from 'react';

import { useCopy } from '@/components/locale-provider';
import type { AdminCopy } from '@/lib/copy';
import { readEdgeError } from '@/lib/edge-error';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';
import { createClient } from '@/lib/supabase/client';
import { tokens } from '@/lib/tokens';

export function OwnerConnectButton({
  venueId,
  hasAccount,
  label,
  returnPath = '/',
}: {
  venueId: string;
  hasAccount: boolean;
  // Overrides the default 'Set up payments' / 'Continue setup'.
  label?: string;
  returnPath?: string;
}) {
  const t = useCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const back = `${window.location.origin}${returnPath}`;
      const { data, error: fnErr } = await supabase.functions.invoke(
        'venue-connect-onboard',
        {
          body: {
            venue_id: venueId,
            return_url: back,
            refresh_url: back,
          },
        },
      );
      if (fnErr) {
        setError(ownerFacingStripeError(await readEdgeError(fnErr), t));
        setBusy(false);
        return;
      }
      const out = data as { account_link_url: string };
      window.location.assign(out.account_link_url);
      // No setBusy(false) on success — we are navigating away, and a
      // re-enabled button behind the redirect invites a double-start.
    } catch {
      setError(ownerFacingStripeError('', t));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={start} disabled={busy} style={buttonStyle}>
        {busy
          ? t.stripe.opening
          : label ?? (hasAccount ? t.stripe.continueSetup : t.stripe.setUp)}
      </button>
      {error ? <StripeErrorNote message={error} /> : null}
    </>
  );
}

// What an owner sees when a Stripe button fails. Stripe's own wording
// ("Stripe error: …") and supabase-js's fallbacks ("Edge Function returned
// a non-2xx status code", "Failed to send a request to the Edge Function")
// mean nothing to a venue owner and give them nowhere to go, so they
// collapse to one plain sentence; a message the function wrote for people
// (a 403 "this is for the venue owner") is kept. Either way the note ends
// at the support inbox.
export function ownerFacingStripeError(raw: string, t: AdminCopy): string {
  const generic = !raw || /stripe error|edge function|failed to fetch/i.test(raw);
  if (generic) return t.stripe.noResponse;
  return raw.endsWith('.') ? raw : `${raw}.`;
}

export function StripeErrorNote({ message }: { message: string }) {
  const t = useCopy();
  return (
    <span
      role="alert"
      style={{ color: tokens.alertDeep, display: 'block', fontSize: 13, marginTop: 4 }}
    >
      {message}
      {t.stripe.stillStuck}
      <a href={SUPPORT_MAILTO} style={{ color: 'inherit' }}>
        {SUPPORT_EMAIL}
      </a>
      .
    </span>
  );
}

const buttonStyle: CSSProperties = {
  background: 'none',
  border: `1px solid ${tokens.primary}`,
  borderRadius: 8,
  color: tokens.primaryDeep,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
  padding: '2px 10px',
};
