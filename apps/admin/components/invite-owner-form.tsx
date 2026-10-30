'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { VENUE_OWNER_ROLES } from '@/lib/schemas';

// Invite a venue owner by email (ADR-0024).
//
// This calls the `invite-venue-owner` Edge Function rather than a server
// action, for the same reason refunds do: creating an auth account needs the
// service-role key, and the admin app must not hold one (ADR-0019). The
// function does invite-and-grant as one step, so there is no half-state
// where an account exists that nobody granted.

type Result = { invited: boolean; email: string };

export function InviteOwnerForm({ venueId }: { venueId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [ownerRole, setOwnerRole] = useState<string>('owner');
  // The dashboard's language for the account the invite creates
  // (ADR-0037). Greek unless the founder says otherwise at the counter.
  const [locale, setLocale] = useState<'en' | 'gr'>('gr');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The function refuses to invite while the venue has a phone-only owner
  // it can't rule out as the same human (POSSIBLE_DUPLICATE). Held apart
  // from `error` because it isn't one: it needs its own explanation and a
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
            owner_role: ownerRole,
            preferred_locale: locale,
            ...(firstName.trim() ? { first_name: firstName.trim() } : {}),
            ...(lastName.trim() ? { last_name: lastName.trim() } : {}),
            ...(confirmNewPerson ? { confirm_new_person: true } : {}),
          },
        },
      );
      if (fnErr) {
        const failure = await readEdgeFailure(fnErr);
        if (failure.code === 'POSSIBLE_DUPLICATE') {
          setDuplicate(failure.message);
        } else if (failure.code === 'ALREADY_GRANTED') {
          // Usually a re-invite after the first link expired. That can't
          // work (no email is sent to an existing grant), so say what does.
          setError(
            `${failure.message} If their invite link expired, ask them to ` +
              'sign in at /login with that email — it sends a fresh link.',
          );
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
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await invite(false);
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="form-grid">
        <label className="field span-2">
          <span className="field-label">Email address</span>
          <input
            type="email"
            className="input"
            required
            maxLength={254}
            placeholder="owner@theirvenue.cy"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
          <span className="field-hint">
            They get a sign-in link here. No account needed first — this
            creates one.
          </span>
        </label>
        <label className="field">
          <span className="field-label">First name</span>
          <input
            type="text"
            className="input"
            maxLength={60}
            placeholder="Optional"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={submitting}
          />
        </label>
        <label className="field">
          <span className="field-label">Last name</span>
          <input
            type="text"
            className="input"
            maxLength={60}
            placeholder="Optional"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={submitting}
          />
        </label>
        <label className="field">
          <span className="field-label">Role</span>
          <select
            className="input"
            value={ownerRole}
            onChange={(e) => setOwnerRole(e.target.value)}
            disabled={submitting}
          >
            {VENUE_OWNER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Dashboard language</span>
          <select
            className="input"
            value={locale}
            onChange={(e) => setLocale(e.target.value === 'en' ? 'en' : 'gr')}
            disabled={submitting}
          >
            <option value="gr">Ελληνικά</option>
            <option value="en">English</option>
          </select>
          <span className="field-hint">
            What they read after the first tap. They can switch it themselves.
          </span>
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
              {submitting
                ? 'Inviting…'
                : 'Invite anyway — this is a different person'}
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <p role="status" className="form-ok">
          {result.invited
            ? `Invite sent to ${result.email}. They can sign in as soon as they open it.`
            : `${result.email} already had a Ludi account — access granted, no email sent.`}
        </p>
      ) : null}

      <div>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Inviting…' : 'Invite'}
        </button>
      </div>
    </form>
  );
}

// supabase-js wraps non-2xx into FunctionsHttpError with `context` set to the
// underlying Response. Surface the function's own message when there is one,
// and its error code — POSSIBLE_DUPLICATE renders as a confirm step, not a
// failure.
async function readEdgeFailure(
  err: unknown,
): Promise<{ code: string | null; message: string }> {
  const fallback = err instanceof Error ? err.message : 'Invite failed';
  const ctx = (err as { context?: unknown }).context;
  if (!(ctx instanceof Response)) return { code: null, message: fallback };
  try {
    const body = (await ctx.json()) as { error?: string; message?: string };
    return { code: body.error ?? null, message: body.message ?? fallback };
  } catch {
    return { code: null, message: fallback };
  }
}
