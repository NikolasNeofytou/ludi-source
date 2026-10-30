'use client';

import { useActionState } from 'react';

// Leaf imports, not the '@/components/ui' barrel: the barrel re-exports
// AppShell, whose auth import reaches next/headers — poison for a client
// component. Same shape as venue-form.tsx.
import { InviteOwnerForm } from '@/components/invite-owner-form';
import { ActionForm, FieldError } from '@/components/ui/form';
import { Badge, Table, Td, Th } from '@/components/ui/primitives';
import { grantOwnerAccess, revokeOwnerAccess } from '@/lib/owner-actions';
import { VENUE_OWNER_ROLES, type FormState } from '@/lib/schemas';

export type OwnerRow = {
  user_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  owner_role: string;
  granted_at: string;
  // When the email invite went out; null for an account granted by phone.
  invited_at: string | null;
  last_sign_in_at: string | null;
};

const IDLE: FormState = { status: 'idle' };

// "today" / "yesterday" / "5 days ago". Day granularity on purpose: the
// question on a handover call is "is that link still alive", and invite
// links last hours, not weeks.
function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// One inline form per row rather than one shared ActionForm: each revoke
// needs its own pending state, and a shared success banner saying "Access
// removed" next to the wrong row would read as the wrong person removed.
function RevokeButton({
  venueId,
  userId,
  who,
}: {
  venueId: string;
  userId: string;
  who: string;
}) {
  const [state, formAction, pending] = useActionState(revokeOwnerAccess, IDLE);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        // A revoke locks a person out of their dashboard the moment it
        // lands — cheap to confirm, expensive to mis-click.
        if (!window.confirm(`Remove ${who}'s access to this venue?`)) {
          event.preventDefault();
        }
      }}
      style={{ display: 'inline' }}
    >
      <input type="hidden" name="venue_id" value={venueId} />
      <input type="hidden" name="user_id" value={userId} />
      <button type="submit" className="btn btn-secondary" disabled={pending}>
        {pending ? 'Removing…' : 'Remove'}
      </button>
      {state.status === 'error' ? (
        <span className="field-error" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

// Admin-only card on the venue edit page: who can sign into this venue's
// dashboard, and the two ways to add someone.
//
// Inviting by email (ADR-0024) is the current flow and comes first: it
// creates the account and grants access in one step, so it works for a
// person who has never touched Ludi. That matters more than it sounds —
// closing signup removed the self-serve step the old flow depended on, so
// without this there is no way to onboard a new owner at all.
//
// Granting by phone stays below it. It only works for an account that
// already exists, but owners provisioned that way still sign in that way,
// and a working door costs nothing to leave open.
export function OwnerAccess({
  venueId,
  owners,
}: {
  venueId: string;
  owners: OwnerRow[];
}) {
  return (
    <div className="stack">
      {owners.length === 0 ? (
        <p className="page-intro" style={{ margin: 0 }}>
          Nobody can sign into this venue&rsquo;s dashboard yet.
        </p>
      ) : (
        <Table
          head={
            <>
              <Th>Who</Th>
              <Th>Contact</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Since</Th>
              <Th>{' '}</Th>
            </>
          }
        >
          {owners.map((o) => {
            const name = `${o.first_name} ${o.last_name}`.trim();
            const who =
              name || o.email || (o.phone ? `+${o.phone}` : 'this account');
            return (
              <tr key={o.user_id}>
                <Td label="Who">{name || <em>No name yet</em>}</Td>
                <Td label="Contact">
                  {o.email ?? (o.phone ? `+${o.phone}` : '—')}
                </Td>
                <Td label="Role">
                  <Badge tone={o.owner_role === 'owner' ? 'info' : 'neutral'}>
                    {o.owner_role}
                  </Badge>
                </Td>
                {/* "Invited" and "signed in" look identical without this, and
                    the difference is the whole handover call. */}
                <Td label="Status">
                  {o.last_sign_in_at ? (
                    <Badge tone="good">signed in</Badge>
                  ) : (
                    <>
                      <Badge tone="warn">invite pending</Badge>
                      {o.invited_at ? (
                        // Relative to now: server and browser can land either
                        // side of a day boundary, so the text may differ.
                        <span
                          className="field-hint"
                          style={{ display: 'block' }}
                          suppressHydrationWarning
                        >
                          Invited {daysAgo(o.invited_at)}
                        </span>
                      ) : null}
                    </>
                  )}
                </Td>
                <Td label="Since">
                  {new Date(o.granted_at).toLocaleDateString('en-GB')}
                </Td>
                <Td label="">
                  <RevokeButton venueId={venueId} userId={o.user_id} who={who} />
                </Td>
              </tr>
            );
          })}
        </Table>
      )}

      {/* Re-inviting doesn't help here: the account already exists and has
          access, so invite-venue-owner takes the grant-only path and refuses
          with ALREADY_GRANTED — no new email. Signing in by email does send
          one (the account exists, so shouldCreateUser:false lets it through). */}
      {owners.some((o) => !o.last_sign_in_at && o.email) ? (
        <p className="field-hint" style={{ margin: 0 }}>
          Invite links expire after a while. If theirs has, don&rsquo;t invite
          again — they already have access, so no new email goes out. Ask them
          to open the dashboard&rsquo;s sign-in page (<code>/login</code>) and
          enter that same email; it sends a fresh link.
        </p>
      ) : null}

      <div>
        <p className="form-section">Invite by email</p>
        <InviteOwnerForm venueId={venueId} />
      </div>

      <p className="form-section">Or grant an account that already exists</p>
      <ActionForm
        action={grantOwnerAccess}
        submitLabel="Grant access"
        hidden={{ venue_id: venueId }}
        resetOnSuccess
      >
        {(errors) => (
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Phone number</span>
              <input
                name="phone"
                type="tel"
                className="input"
                placeholder="+35799123456"
                required
                maxLength={32}
              />
              <span className="field-hint">
                Only for an account that already exists — someone who signed
                in by phone before sign-up closed. For anyone new, use
                &ldquo;Invite by email&rdquo; above.
              </span>
              <FieldError errors={errors.phone} />
            </label>
            <label className="field">
              <span className="field-label">Role</span>
              <select name="owner_role" className="input" defaultValue="owner">
                {VENUE_OWNER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <FieldError errors={errors.owner_role} />
            </label>
          </div>
        )}
      </ActionForm>
    </div>
  );
}
