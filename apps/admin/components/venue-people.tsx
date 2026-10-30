'use client';

import { useActionState } from 'react';

// Leaf imports, not the '@/components/ui' barrel: the barrel re-exports
// AppShell, whose auth import reaches next/headers — poison for a client
// component. Same shape as owner-access.tsx.
import { useLocale } from '@/components/locale-provider';
import { Badge, Table, Td, Th } from '@/components/ui/primitives';
import { getCopy } from '@/lib/copy';
import { revokeVenuePerson } from '@/lib/people-actions';
import type { FormState } from '@/lib/schemas';

// Slice A of plans/venue-staff.md, the owner's half of owner-access.tsx.
// Same row shape (venue_people returns what admin_list_venue_owners
// returns), a narrower set of columns, and no grant form: inviting is
// still the founder's, and the two halves of "who holds a key" arrive in
// different versions on purpose.

export type PersonRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  owner_role: string;
  granted_at: string;
  invited_at: string | null;
  last_sign_in_at: string | null;
};

const IDLE: FormState = { status: 'idle' };

// One inline form per row rather than one shared action: each revoke
// needs its own pending state, and a shared banner saying "Access
// removed" next to the wrong row reads as the wrong person removed.
function RemoveButton({
  venueId,
  person,
  who,
  isSelf,
}: {
  venueId: string;
  person: PersonRow;
  who: string;
  isSelf: boolean;
}) {
  const t = getCopy(useLocale()).access;
  const [state, formAction, pending] = useActionState(revokeVenuePerson, IDLE);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        // Removing someone locks them out the moment it lands — cheap to
        // confirm, expensive to mis-click. Removing YOURSELF is the one
        // that cannot be undone from this page at all, so it says so.
        const question = isSelf ? t.confirmSelf : t.confirmRemove(who);
        if (!window.confirm(question)) event.preventDefault();
      }}
      style={{ display: 'inline' }}
    >
      <input type="hidden" name="venue_id" value={venueId} />
      <input type="hidden" name="user_id" value={person.user_id} />
      <button type="submit" className="btn btn-secondary" disabled={pending}>
        {pending ? t.removing : t.remove}
      </button>
      {state.status === 'error' ? (
        <span className="field-error" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function VenuePeople({
  venueId,
  people,
  viewerId,
}: {
  venueId: string;
  people: PersonRow[];
  viewerId: string;
}) {
  const locale = useLocale();
  const t = getCopy(locale).access;
  // Greek dates read dd/mm/yyyy either way; the tag keeps month names out
  // of it if this ever becomes a long format.
  const dateFmt = locale === 'gr' ? 'el-GR' : 'en-GB';

  return (
    <Table
      head={
        <>
          <Th>{t.who}</Th>
          <Th>{t.contact}</Th>
          <Th>{t.role}</Th>
          <Th>{t.status}</Th>
          <Th>{t.since}</Th>
          <Th>{' '}</Th>
        </>
      }
    >
      {people.map((p) => {
        const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
        const who = name || p.email || (p.phone ? `+${p.phone}` : t.thisAccount);
        const isSelf = p.user_id === viewerId;
        return (
          <tr key={p.user_id}>
            <Td label={t.who}>
              {name || <em>{t.noName}</em>}
              {isSelf ? (
                <span className="field-hint" style={{ display: 'block' }}>
                  {t.you}
                </span>
              ) : null}
            </Td>
            <Td label={t.contact}>
              {p.email ?? (p.phone ? `+${p.phone}` : '—')}
            </Td>
            <Td label={t.role}>
              <Badge tone={p.owner_role === 'owner' ? 'info' : 'neutral'}>
                {p.owner_role === 'owner' ? t.roleOwner : t.roleManager}
              </Badge>
            </Td>
            {/* "Invited" and "signed in" look identical without this, and
                the difference is whether the door is actually open. */}
            <Td label={t.status}>
              {p.last_sign_in_at ? (
                <Badge tone="good">{t.signedIn}</Badge>
              ) : (
                <Badge tone="warn">{t.invitePending}</Badge>
              )}
            </Td>
            <Td label={t.since}>
              {new Date(p.granted_at).toLocaleDateString(dateFmt)}
            </Td>
            <Td label="">
              <RemoveButton
                venueId={venueId}
                person={p}
                who={who}
                isSelf={isSelf}
              />
            </Td>
          </tr>
        );
      })}
    </Table>
  );
}
