'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { readEdgeError } from '@/lib/edge-error';
import { formatEur, parseEurosToCents } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { tokens } from '@/lib/tokens';

const MIN_REASON = 10;
const MAX_REASON = 500;

type Props = {
  bookingId: string;
  bookingCode: string;
  totalCents: number;
  alreadyRefundedCents: number;
};

export function RefundBookingButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={triggerButtonStyle}>
        Refund
      </button>
      {open && <RefundModal {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function RefundModal({
  bookingId,
  bookingCode,
  totalCents,
  alreadyRefundedCents,
  onClose,
}: Props & { onClose: () => void }) {
  const router = useRouter();
  const remaining = totalCents - alreadyRefundedCents;

  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [amountStr, setAmountStr] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set after a failure we can't read — a timeout, a dropped connection —
  // when the refund may have gone through. From then on the amount is
  // frozen and the key kept, so a retry can only replay the same refund,
  // never issue a second one (a re-typed "10" → "10.00" used to mint a new
  // key and pass every guard).
  const [uncertain, setUncertain] = useState(false);

  // One key per user-action. Held across retries so a network-blip retry
  // is deduped end-to-end (the function reuses it as the Stripe key). A
  // different amount is a different action and gets a new key — Stripe
  // refuses a key reused with other parameters, and replays the stored
  // result of one reused with the same.
  const idempotencyKeyRef = useRef<string | null>(null);
  if (idempotencyKeyRef.current === null) {
    idempotencyKeyRef.current = crypto.randomUUID();
  }
  function freshKey() {
    if (uncertain) return;
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const partialCents = mode === 'partial' ? parseEurosToCents(amountStr) : null;
  const refundCents = mode === 'full' ? remaining : (partialCents ?? 0);
  const reasonLen = reason.trim().length;

  const partialValid =
    partialCents !== null && partialCents > 0 && partialCents <= remaining;
  const canSubmit =
    !submitting &&
    reasonLen >= MIN_REASON &&
    reasonLen <= MAX_REASON &&
    (mode === 'full' ? remaining > 0 : partialValid);
  // The server cancels the booking only once the refunds add up to what was
  // paid; anything less leaves it standing, slot held.
  const cancels = refundCents >= remaining;

  async function submit() {
    if (!canSubmit || idempotencyKeyRef.current === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: fnErr } = await supabase.functions.invoke('admin-refund-booking', {
        body: {
          booking_id: bookingId,
          amount_cents: mode === 'full' ? null : partialCents,
          reason: reason.trim(),
        },
        headers: { 'Idempotency-Key': idempotencyKeyRef.current },
      });
      if (fnErr) {
        // Read the code before readEdgeError consumes the body.
        const code = await edgeErrorCode(fnErr);
        if (code === 'IDEMPOTENCY_MISMATCH') {
          // Only a successful refund is stored against a key, so this key
          // already moved money — the reason was edited after a retry
          // whose first attempt went through. Never re-key past it.
          setError('This refund already went through. Close and check the booking.');
          router.refresh();
          return;
        }
        setError(await readEdgeError(fnErr));
        // A coded error is the function itself answering, and every such
        // answer means no refund was made (after Stripe succeeds it only
        // returns 200). Re-key so the retry is a new attempt, not a replay
        // of Stripe's stored failure. Anything uncoded — a gateway timeout,
        // a relay failure — may have refunded, so the key stays.
        if (code) freshKey();
        else setUncertain(true);
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed');
      setUncertain(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="refund-dialog-title"
      style={overlayStyle}
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <h2 id="refund-dialog-title" style={{ fontSize: 20, margin: '0 0 8px' }}>
          Refund booking
        </h2>
        <p style={{ margin: '0 0 16px', color: tokens.ink3, fontSize: 14 }}>
          <span style={monoStyle}>{bookingCode}</span>
          {' · '}
          {formatEur(totalCents)} paid
          {alreadyRefundedCents > 0 ? (
            <>
              {' · '}
              {formatEur(alreadyRefundedCents)} already refunded,{' '}
              {formatEur(remaining)} left to refund
            </>
          ) : null}
        </p>

        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Refund amount</legend>
          <label style={radioRowStyle}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'full'}
              onChange={() => {
                setMode('full');
                freshKey();
              }}
              disabled={submitting || uncertain}
            />
            <span>
              {alreadyRefundedCents > 0 ? 'The rest' : 'Full refund'} ·{' '}
              {formatEur(remaining)}
            </span>
          </label>
          <label style={radioRowStyle}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'partial'}
              onChange={() => {
                setMode('partial');
                freshKey();
              }}
              disabled={submitting || uncertain}
            />
            <span>Partial refund</span>
          </label>
          {mode === 'partial' && (
            <div style={{ marginLeft: 26, marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: tokens.ink2 }}>€</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(e) => {
                    setAmountStr(e.target.value);
                    freshKey();
                  }}
                  placeholder="0.00"
                  style={{ ...inputStyle, width: 120 }}
                  disabled={submitting || uncertain}
                  autoFocus
                />
              </label>
              {amountStr && !partialValid && (
                <p style={errorTextStyle}>
                  Enter an amount between €0.01 and {formatEur(remaining)}.
                </p>
              )}
            </div>
          )}
        </fieldset>

        <label style={{ display: 'block', marginTop: 16 }}>
          <span style={fieldLabelStyle}>
            Reason{' '}
            <span
              style={{
                color: reasonLen < MIN_REASON ? tokens.alertDeep : tokens.ink3,
              }}
            >
              ({reasonLen}/{MAX_REASON})
            </span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={MAX_REASON}
            placeholder="Why is this refund being issued? (min 10 chars)"
            disabled={submitting}
            style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
          />
        </label>

        <p style={previewStyle}>
          Will refund <strong>{formatEur(refundCents)}</strong> to the customer. The
          venue and Ludi each give back their share of it: Ludi&apos;s fee on the
          refunded amount is returned too.
        </p>
        <p style={previewStyle}>
          {cancels
            ? 'This refunds everything left, so the booking is cancelled and the slot is freed.'
            : 'A partial refund keeps the booking: it still stands and the slot stays held.'}
        </p>

        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
            {uncertain
              ? ' We couldn’t confirm whether it went through, so the amount is locked: retrying can only repeat this same refund. To refund a different amount, close this and check the booking first.'
              : null}
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
            onClick={submit}
            disabled={!canSubmit}
            style={{
              ...primaryButtonStyle,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'Refunding…' : `Refund ${formatEur(refundCents)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// The function's error code ('STRIPE_ERROR', …) when the function itself
// answered, else null. Reads a clone, leaving the body for readEdgeError.
async function edgeErrorCode(err: unknown): Promise<string | null> {
  const ctx = (err as { context?: unknown }).context;
  if (!(ctx instanceof Response)) return null;
  try {
    const body = (await ctx.clone().json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

const triggerButtonStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: `1px solid ${tokens.lineBold}`,
  background: 'transparent',
  color: tokens.ink2,
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

// Scrolls inside the overlay like the walk-in card: on a phone with the
// keyboard up, a fixed-height card pushes the Refund button off-screen.
const cardStyle: CSSProperties = {
  // The modal renders inside the row's actions cell, which is right-aligned
  // on the phone card layout — without this every line inherits it.
  textAlign: 'left',
  width: '100%',
  maxWidth: 480,
  maxHeight: '90vh',
  overflowY: 'auto',
  background: tokens.surface,
  border: `1px solid ${tokens.line}`,
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 10px 30px rgba(26,24,20,0.18)',
};

const fieldsetStyle: CSSProperties = {
  border: `1px solid ${tokens.line}`,
  borderRadius: 8,
  padding: '12px 14px',
  margin: 0,
};

const legendStyle: CSSProperties = {
  padding: '0 6px',
  fontSize: 12,
  color: tokens.ink3,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const radioRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  cursor: 'pointer',
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

const monoStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontWeight: 500,
};

const primaryButtonStyle: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: `1px solid ${tokens.primaryDeep}`,
  background: tokens.primary,
  color: '#fff',
  fontSize: 14,
  fontWeight: 500,
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
  marginTop: 16,
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

const errorTextStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 13,
  color: tokens.alertDeep,
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 16,
};
