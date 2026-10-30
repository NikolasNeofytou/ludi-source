'use client';

// 41l — one-time Stripe Express Dashboard login for a venue owner. An
// Express account has no Stripe login of its own; this button asks
// venue-express-login to mint a link and follows it. Balance, next payout
// date, payout history and bank details all live behind it — the Earnings
// page shows the mirror, Stripe stays the source of truth.
//
// Only render it for a venue whose owner has submitted Stripe onboarding
// (status active or restricted): before that there is no dashboard to log
// in to and the function answers 409.

import { useState, type CSSProperties } from 'react';

import { useCopy } from '@/components/locale-provider';
import {
  StripeErrorNote,
  ownerFacingStripeError,
} from '@/components/owner-connect-button';
import { readEdgeError } from '@/lib/edge-error';
import { createClient } from '@/lib/supabase/client';
import { tokens } from '@/lib/tokens';

export function StripeDashboardButton({
  venueId,
  label,
}: {
  venueId: string;
  label?: string;
}) {
  const t = useCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: fnErr } = await supabase.functions.invoke(
        'venue-express-login',
        { body: { venue_id: venueId } },
      );
      if (fnErr) {
        setError(ownerFacingStripeError(await readEdgeError(fnErr), t));
        setBusy(false);
        return;
      }
      const out = data as { login_url: string };
      // Login links are single-use: navigate rather than window.open, so a
      // popup blocker can never eat the one link we minted. No
      // setBusy(false) on success — we are navigating away.
      window.location.assign(out.login_url);
    } catch {
      setError(ownerFacingStripeError('', t));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={open} disabled={busy} style={buttonStyle}>
        {busy ? t.stripe.opening : (label ?? t.stripe.openDashboard)}
      </button>
      {error ? <StripeErrorNote message={error} /> : null}
    </>
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
