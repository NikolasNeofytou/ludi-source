'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { readEdgeError } from '@/lib/edge-error';
import { createClient } from '@/lib/supabase/client';
import { tokens } from '@/lib/tokens';

const MIN_REASON = 10;
const MAX_REASON = 500;

export type PitchToggleAction = 'verify' | 'activate' | 'deactivate';

type Props = {
  pitchId: string;
  pitchName: string;
  venueName: string;
  action: PitchToggleAction;
  // Surface the reason verification can fail BEFORE the modal opens, so the
  // operator gets context (e.g. "venue not Stripe-active yet") inline rather
  // than from the function's 409.
  disabledReason?: string;
};

const ACTION_COPY: Record<
  PitchToggleAction,
  { label: string; verb: string; preview: (name: string) => string; tone: 'pitch' | 'terra' }
> = {
  verify: {
    label: 'Verify',
    verb: 'Verifying',
    preview: (n) => `Mark ${n} as verified. Players will see it in Discover once active too.`,
    tone: 'pitch',
  },
  activate: {
    label: 'Activate',
    verb: 'Activating',
    preview: (n) => `Make ${n} active. It becomes bookable if also verified.`,
    tone: 'pitch',
  },
  deactivate: {
    label: 'Deactivate',
    verb: 'Deactivating',
    preview: (n) => `Hide ${n} from Discover. Existing bookings are unaffected.`,
    tone: 'terra',
  },
};

export function PitchToggleButton(props: Props) {
  const [open, setOpen] = useState(false);
  const copy = ACTION_COPY[props.action];
  const disabled = Boolean(props.disabledReason);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={props.disabledReason}
        style={{
          ...triggerButtonStyle,
          color: copy.tone === 'terra' ? tokens.alertDeep : tokens.ink2,
          borderColor: copy.tone === 'terra' ? tokens.alert : tokens.lineBold,
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {copy.label}
      </button>
      {open && <PitchToggleModal {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function PitchToggleModal({
  pitchId,
  pitchName,
  venueName,
  action,
  onClose,
}: Props & { onClose: () => void }) {
  const router = useRouter();
  const copy = ACTION_COPY[action];

  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One key per modal mount — same shape as admin-refund. Server treats it
  // as optional but uses it to dedupe a duplicate submit if the network
  // hiccups between request and ack.
  const idempotencyKeyRef = useRef<string | null>(null);
  if (idempotencyKeyRef.current === null) {
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const reasonLen = reason.trim().length;
  const canSubmit =
    !submitting && reasonLen >= MIN_REASON && reasonLen <= MAX_REASON;

  async function submit() {
    if (!canSubmit || idempotencyKeyRef.current === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: fnErr } = await supabase.functions.invoke('admin-toggle-pitch', {
        body: { pitch_id: pitchId, action, reason: reason.trim() },
        headers: { 'Idempotency-Key': idempotencyKeyRef.current },
      });
      if (fnErr) {
        setError(await readEdgeError(fnErr));
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pitch-toggle-dialog-title"
      style={overlayStyle}
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <h2 id="pitch-toggle-dialog-title" style={{ fontSize: 20, margin: '0 0 8px' }}>
          {copy.label} pitch
        </h2>
        <p style={{ margin: '0 0 16px', color: tokens.ink3, fontSize: 14 }}>
          <strong style={{ color: tokens.ink2 }}>{pitchName}</strong>
          {' · '}
          {venueName}
        </p>

        <p style={previewStyle}>{copy.preview(pitchName)}</p>

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
            placeholder="Why is this change being made? (min 10 chars; goes to admin_actions audit)"
            disabled={submitting}
            style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
            autoFocus
          />
        </label>

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
            onClick={submit}
            disabled={!canSubmit}
            style={{
              ...primaryButtonStyle(copy.tone),
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? `${copy.verb}…` : copy.label}
          </button>
        </div>
      </div>
    </div>
  );
}

const triggerButtonStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: `1px solid ${tokens.lineBold}`,
  background: 'transparent',
  fontSize: 13,
  fontWeight: 500,
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
  maxWidth: 480,
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

function primaryButtonStyle(tone: 'pitch' | 'terra'): CSSProperties {
  const isDanger = tone === 'terra';
  return {
    padding: '8px 16px',
    borderRadius: 8,
    border: `1px solid ${isDanger ? tokens.alert : tokens.primaryDeep}`,
    background: isDanger ? tokens.alert : tokens.primary,
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
  };
}

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
