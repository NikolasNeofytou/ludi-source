'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { readEdgeError } from '@/lib/edge-error';
import { createClient } from '@/lib/supabase/client';
import { tokens } from '@/lib/tokens';

export type VenueStripeStatus = 'pending' | 'active' | 'restricted' | 'disabled';

type Props = {
  venueId: string;
  venueName: string;
  status: VenueStripeStatus;
  // Whether a Stripe Express account already exists (stripe_account_id set).
  // Distinguishes "first onboarding" from "resume / update".
  hasAccount: boolean;
};

type OnboardLink = {
  url: string;
  expiresAt: string;
  accountId: string;
};

// The trigger copy adapts to where the venue is in the Connect lifecycle.
function triggerLabel(status: VenueStripeStatus, hasAccount: boolean): string {
  if (status === 'active') return 'Re-onboard';
  if (hasAccount) return 'Resume onboarding';
  return 'Onboard with Stripe';
}

export function VenueConnectButton(props: Props) {
  const [open, setOpen] = useState(false);
  const isActive = props.status === 'active';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          ...triggerButtonStyle,
          color: isActive ? tokens.ink2 : tokens.primaryDeep,
          borderColor: isActive ? tokens.lineBold : tokens.primary,
        }}
      >
        {triggerLabel(props.status, props.hasAccount)}
      </button>
      {open && <VenueConnectModal {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function VenueConnectModal({
  venueId,
  venueName,
  status,
  hasAccount,
  onClose,
}: Props & { onClose: () => void }) {
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<OnboardLink | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  async function generate() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      // The KYC link is completed by the OWNER (the admin copies it to them),
      // so both URLs must land somewhere an owner may stand: Today. /venues
      // is requireAdmin and would bounce a signed-in owner to /locked.
      // refresh_url is hit if the hosted session expires mid-flow so Stripe
      // can re-mint.
      const origin = window.location.origin;
      const { data, error: fnErr } = await supabase.functions.invoke(
        'venue-connect-onboard',
        {
          body: {
            venue_id: venueId,
            return_url: `${origin}/`,
            refresh_url: `${origin}/`,
          },
        },
      );
      if (fnErr) {
        setError(await readEdgeError(fnErr));
        return;
      }
      const out = data as {
        account_link_url: string;
        expires_at: string;
        stripe_account_id: string;
      };
      setLink({
        url: out.account_link_url,
        expiresAt: out.expires_at,
        accountId: out.stripe_account_id,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to create onboarding link',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. insecure context) — the readonly input still
      // lets the operator select + copy manually.
    }
  }

  function done() {
    onClose();
    router.refresh();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="venue-connect-title"
      style={overlayStyle}
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <h2 id="venue-connect-title" style={{ fontSize: 20, margin: '0 0 8px' }}>
          Stripe Connect onboarding
        </h2>
        <p style={{ margin: '0 0 16px', color: tokens.ink3, fontSize: 14 }}>
          <strong style={{ color: tokens.ink2 }}>{venueName}</strong>
          {' · status '}
          <strong style={{ color: tokens.ink2 }}>{status}</strong>
        </p>

        {link === null ? (
          <>
            <p style={previewStyle}>
              {hasAccount
                ? 'A Stripe Express account already exists for this venue. Generate a fresh hosted link to continue or update its details.'
                : 'Creates a Stripe Express connected account for this venue and a hosted onboarding link. The owner completes identity + bank details on Stripe; the venue flips to “active” here automatically once Stripe approves.'}
            </p>

            {error && (
              <div role="alert" style={errorBannerStyle}>
                {error}
              </div>
            )}

            <div style={buttonRowStyle}>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                style={secondaryButtonStyle}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={generate}
                disabled={submitting}
                style={{
                  ...primaryButtonStyle,
                  opacity: submitting ? 0.6 : 1,
                  cursor: submitting ? 'wait' : 'pointer',
                }}
              >
                {submitting
                  ? 'Creating link…'
                  : hasAccount
                    ? 'Create new link'
                    : 'Create onboarding link'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ ...previewStyle, color: tokens.pitchDeep }}>
              Onboarding link ready — open it yourself or send it to the venue
              owner. It expires at {formatExpiry(link.expiresAt)}.
            </p>

            <span style={fieldLabelStyle}>Onboarding link</span>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                readOnly
                value={link.url}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  ...inputStyle,
                  flex: 1,
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  fontSize: 12,
                }}
              />
              <button type="button" onClick={copyLink} style={secondaryButtonStyle}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <p style={{ fontSize: 12, color: tokens.ink3, margin: '0 0 16px' }}>
              Stripe account <code>{link.accountId}</code>. The status here
              updates automatically once Stripe finishes verification.
            </p>

            <div style={buttonRowStyle}>
              <button type="button" onClick={done} style={secondaryButtonStyle}>
                Done
              </button>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  ...primaryButtonStyle,
                  textDecoration: 'none',
                  display: 'inline-block',
                }}
              >
                Open onboarding ↗
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'soon';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const triggerButtonStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: `1px solid ${tokens.lineBold}`,
  background: 'transparent',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(26,24,20,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 16,
};

const cardStyle: CSSProperties = {
  // The modal renders inside the row's actions cell, which is right-aligned
  // on the phone card layout — without this every line inherits it.
  textAlign: 'left',
  width: '100%',
  maxWidth: 520,
  background: tokens.surface,
  border: `1px solid ${tokens.line}`,
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 10px 30px rgba(26,24,20,0.18)',
};

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: tokens.ink3,
  marginBottom: 4,
};

const inputStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${tokens.lineBold}`,
  background: tokens.surface,
  color: tokens.ink,
  fontSize: 14,
  fontFamily: 'inherit',
};

const primaryButtonStyle: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: `1px solid ${tokens.primaryDeep}`,
  background: tokens.primary,
  color: '#fff',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const secondaryButtonStyle: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: `1px solid ${tokens.lineBold}`,
  background: 'transparent',
  color: tokens.ink2,
  fontSize: 14,
  cursor: 'pointer',
};

const previewStyle: CSSProperties = {
  marginTop: 4,
  marginBottom: 4,
  fontSize: 14,
  color: tokens.ink2,
};

const errorBannerStyle: CSSProperties = {
  marginTop: 12,
  padding: '10px 12px',
  borderRadius: 8,
  background: tokens.alertSoft,
  color: tokens.alertDeep,
  fontSize: 14,
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 16,
};
