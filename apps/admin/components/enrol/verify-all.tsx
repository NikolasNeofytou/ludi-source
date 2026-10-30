'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { readEdgeError } from '@/lib/edge-error';
import { createClient } from '@/lib/supabase/client';

// Verify every unverified court of a venue with one reason. This is NOT a
// new way to verify a pitch: it calls admin-toggle-pitch once per court,
// sequentially, so each verification keeps the function's Stripe guard,
// its audit row and its idempotency key. Twelve clicks become one; the
// audit trail is twelve rows, as it should be.
//
// Partial failure is shown per court, never hidden — a court that refused
// (already verified by someone else, a concurrent change) is listed with
// the function's own message.

const MIN_REASON = 10;
const MAX_REASON = 500;

type Court = { id: string; name: string };
type Outcome = { id: string; name: string; ok: boolean; message?: string };

export function VerifyAll({ courts, venueName }: { courts: Court[]; venueName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Outcome[] | null>(null);

  const reasonLen = reason.trim().length;
  const canSubmit = !running && reasonLen >= MIN_REASON && reasonLen <= MAX_REASON;
  const n = courts.length;

  async function run() {
    if (!canSubmit) return;
    setRunning(true);
    const supabase = createClient();
    const outcomes: Outcome[] = [];
    for (const c of courts) {
      const { error } = await supabase.functions.invoke('admin-toggle-pitch', {
        body: { pitch_id: c.id, action: 'verify', reason: reason.trim() },
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      outcomes.push(
        error
          ? { id: c.id, name: c.name, ok: false, message: await readEdgeError(error) }
          : { id: c.id, name: c.name, ok: true },
      );
      setDone([...outcomes]);
    }
    setRunning(false);
    router.refresh();
  }

  if (done && !running) {
    const okCount = done.filter((o) => o.ok).length;
    const failed = done.filter((o) => !o.ok);
    return (
      <div className="stack" style={{ gap: 6 }}>
        <p role="status" className={failed.length ? 'auth-error' : 'form-ok'} style={{ margin: 0 }}>
          Verified {okCount} of {done.length} {done.length === 1 ? 'court' : 'courts'}
          {failed.length ? ` — ${failed.length} refused:` : '.'}
        </p>
        {failed.length ? (
          <ul className="review-todo">
            {failed.map((f) => (
              <li key={f.id}>
                <strong>{f.name}</strong> — {f.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  if (courts.length === 0) return null;

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Verify {n === 1 ? 'the court' : `${n} courts`}
      </button>
    );
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <p className="field-hint" style={{ margin: 0 }}>
        Marks {n === 1 ? courts[0]!.name : `${courts.map((c) => c.name).join(', ')}`} at{' '}
        {venueName} as verified — players see them in Discover from now. One reason for
        all; every court gets its own audit row.
      </p>
      <label className="field">
        <span className="field-label">
          Reason{' '}
          <span style={{ color: reasonLen < MIN_REASON ? 'var(--ludi-alert-deep)' : undefined }}>
            ({reasonLen}/{MAX_REASON})
          </span>
        </span>
        <textarea
          className="input"
          rows={2}
          value={reason}
          maxLength={MAX_REASON}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Owner confirmed prices and hours at the counter; Stripe active"
          disabled={running}
          autoFocus
        />
      </label>
      {running && done ? (
        <p role="status" className="field-hint" style={{ margin: 0 }}>
          Verifying… {done.length} of {n}
        </p>
      ) : null}
      <div className="filters-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setOpen(false)}
          disabled={running}
        >
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {running ? 'Verifying…' : `Verify ${n === 1 ? 'court' : `${n} courts`}`}
        </button>
      </div>
    </form>
  );
}
