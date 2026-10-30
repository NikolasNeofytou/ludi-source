'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useLocale } from '@/components/locale-provider';
import { getCopy } from '@/lib/copy';
import { createClient } from '@/lib/supabase/client';

// Slice C of plans/venue-staff.md — the owner adds his own staff.
//
// The owner's half of invite-owner-form.tsx, and it calls the same
// `invite-venue-owner` Edge Function for the same reason: creating an
// auth account needs the service-role key, and this app must not hold
// one (ADR-0019, ADR-0024). What differs is not the transport but the
// authority — the function decides, from the caller's JWT, that this is
// an owner of this venue and therefore may add a `manager` and only a
// manager.
//
// So `owner_role` is not a field here. There is no select to leave on
// the wrong value, and the one thing an owner may not do is not
// rendered as something he may do and then refused.
//
// The function speaks English (FUTURE.md parks "Edge Function messages
// in the owner's language"). Its error CODES are stable, so the ones an
// owner can actually provoke are mapped to copy here and the raw message
// is the fallback — a Greek owner should not meet an English sentence
// for anything he did on purpose.

type Result = { invited: boolean; email: string };

export function InviteManagerForm({ venueId }: { venueId: string }) {
  const router = useRouter();
  const locale = useLocale();
  const t = getCopy(locale).access.invite;

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  // Their dashboard's language, not the owner's (ADR-0037) — but his own
  // is the right guess, since he is about to hand them the tablet.
  const [staffLocale, setStaffLocale] = useState<'en' | 'gr'>(locale);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // POSSIBLE_DUPLICATE is not a failure: the venue has somebody who signs
  // in by phone and no email, and inviting might mint a second account
  // for the same human. Held apart from `error` because it needs a
  // deliberate second click, not a red line.
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function invite(confirmNewPerson: boolean) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setDuplicate(null);
    setResult(null);
    try {
      const supabase = createClient();
      const { data, error: fnErr } = await supabase.functions.invoke(
        'invite-venue-owner',
        {
          body: {
            venue_id: venueId,
            email: email.trim(),
            // Not from a field. See the note above.
            owner_role: 'manager',
            preferred_locale: staffLocale,
            ...(firstName.trim() ? { first_name: firstName.trim() } : {}),
            ...(lastName.trim() ? { last_name: lastName.trim() } : {}),
            ...(confirmNewPerson ? { confirm_new_person: true } : {}),
          },
        },
      );
      if (fnErr) {
        const failure = await readEdgeFailure(fnErr, t.failed);
        if (failure.code === 'POSSIBLE_DUPLICATE') {
          setDuplicate(failure.message);
        } else if (failure.code === 'ALREADY_GRANTED') {
          setError(t.alreadyGranted);
        } else if (failure.code === 'GRANT_CAP_REACHED') {
          setError(t.capReached);
        } else if (failure.code === 'OWNER_ROLE_NOT_YOURS') {
          // Unreachable from this form, which never sends 'owner'. Mapped
          // anyway: if it ever fires, the honest sentence is better than
          // the function's English one.
          setError(t.notYours);
        } else {
          setError(failure.message);
        }
        return;
      }
      const invited = Boolean((data as { invited?: boolean })?.invited);
      setResult({ invited, email: email.trim() });
      setEmail('');
      setFirstName('');
      setLastName('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void invite(false);
      }}
    >
      <p className="form-section">{t.title}</p>
      <p className="field-hint" style={{ marginTop: 0 }}>
        {t.lead}
      </p>

      <div className="form-grid">
        <label className="field span-2">
          <span className="field-label">{t.email}</span>
          <input
            type="email"
            className="input"
            required
            maxLength={254}
            placeholder="staff@gipedo.cy"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
          <span className="field-hint">{t.emailHint}</span>
        </label>
        <label className="field">
          <span className="field-label">{t.firstName}</span>
          <input
            type="text"
            className="input"
            maxLength={60}
            placeholder={t.optional}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={submitting}
          />
        </label>
        <label className="field">
          <span className="field-label">{t.lastName}</span>
          <input
            type="text"
            className="input"
            maxLength={60}
            placeholder={t.optional}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={submitting}
          />
        </label>
        <label className="field">
          <span className="field-label">{t.language}</span>
          <select
            className="input"
            value={staffLocale}
            onChange={(e) => setStaffLocale(e.target.value === 'en' ? 'en' : 'gr')}
            disabled={submitting}
          >
            <option value="gr">Ελληνικά</option>
            <option value="en">English</option>
          </select>
          <span className="field-hint">{t.languageHint}</span>
        </label>
      </div>

      {error ? (
        <p role="alert" className="auth-error">
          {error}
        </p>
      ) : null}

      {duplicate ? (
        <div role="alert" className="stack" style={{ gap: '0.5rem' }}>
          <p className="auth-error" style={{ margin: 0 }}>
            {duplicate}
          </p>
          <div>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={submitting}
              onClick={() => void invite(true)}
            >
              {submitting ? t.submitting : t.duplicateAnyway}
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <p role="status" className="form-ok">
          {result.invited ? t.sent(result.email) : t.granted(result.email)}
        </p>
      ) : null}

      <div>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? t.submitting : t.submit}
        </button>
      </div>
    </form>
  );
}

// supabase-js wraps non-2xx into FunctionsHttpError with `context` set to
// the underlying Response. Surface the function's own code — the caller
// maps the ones an owner can provoke — and its message as the fallback.
async function readEdgeFailure(
  err: unknown,
  fallbackMessage: string,
): Promise<{ code: string | null; message: string }> {
  const fallback = err instanceof Error ? err.message : fallbackMessage;
  const ctx = (err as { context?: unknown }).context;
  if (!(ctx instanceof Response)) return { code: null, message: fallback };
  try {
    const body = (await ctx.json()) as { error?: string; message?: string };
    return { code: body.error ?? null, message: body.message ?? fallback };
  } catch {
    return { code: null, message: fallback };
  }
}
