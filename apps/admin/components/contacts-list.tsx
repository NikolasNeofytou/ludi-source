'use client';

import { useEffect, useId, useState } from 'react';

// Leaf imports, not the '@/components/ui' barrel: the barrel re-exports
// AppShell, whose auth import reaches next/headers — poison for a client
// component. Same shape as venue-people.tsx.
import { useCopy } from '@/components/locale-provider';
import { ActionForm, FieldError, useKeptAction } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/primitives';
import { deleteAllContacts, deleteContact, saveContact } from '@/lib/contact-actions';
import type { FormState } from '@/lib/schemas';

// Slice B of plans/owner-contacts.md — the owner's page onto his regulars:
// the list, a correction, an addition, a download, and the right to delete
// it all. The list mostly fills itself from walk-ins (slice A), so this is
// housekeeping, not data entry — the plan put it after the booking form's
// typeahead for exactly that reason.

export type ContactRow = {
  id: string;
  display_name: string;
  phone: string | null;
  phone_e164: string | null;
  note: string | null;
  source: 'counter' | 'manual' | 'backfill' | 'csv' | 'google';
};

// "+35799123456" → "+357 99 123456", the way a Cypriot writes it.
function showPhone(c: ContactRow): string {
  const e = c.phone_e164;
  if (e && e.startsWith('+357') && e.length === 12) return `+357 ${e.slice(4, 6)} ${e.slice(6)}`;
  return e ?? c.phone ?? '';
}

function Row({ venueId, c }: { venueId: string; c: ContactRow }) {
  const t = useCopy().contacts;
  const formId = useId();
  const [editing, setEditing] = useState(false);
  const save = useKeptAction(saveContact);
  const remove = useKeptAction(deleteContact);

  // Leave edit mode once the save lands; the page re-renders the new values.
  useEffect(() => {
    if (save.state.status === 'success') setEditing(false);
  }, [save.state]);

  const who = c.display_name || showPhone(c);

  if (editing) {
    return (
      <tr>
        <Td label={t.th.name}>
          {/* The inputs sit in cells and join the form by its id — a form
              cannot wrap a table row, and a row of inputs is what an edit
              in a table should look like. */}
          <input
            form={formId}
            name="display_name"
            defaultValue={c.display_name}
            maxLength={120}
            className="input"
            aria-label={t.add.name}
          />
          <input
            form={formId}
            name="note"
            defaultValue={c.note ?? ''}
            maxLength={280}
            className="input"
            placeholder={t.add.notePlaceholder}
            aria-label={t.add.note}
            style={{ marginTop: 6 }}
          />
          <FieldError errors={save.fieldErrors.display_name} />
        </Td>
        <Td label={t.th.phone}>
          <input
            form={formId}
            name="phone"
            type="tel"
            defaultValue={c.phone ?? ''}
            maxLength={30}
            className="input"
            aria-label={t.add.phone}
          />
        </Td>
        <Td label={t.th.from}>{t.source[c.source]}</Td>
        <Td label="">
          <form id={formId} onSubmit={save.onSubmit} style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="hidden" name="venue_id" value={venueId} />
            <input type="hidden" name="contact_id" value={c.id} />
            <button type="submit" className="btn btn-primary" disabled={save.pending}>
              {t.save}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={save.pending}>
              {t.cancel}
            </button>
          </form>
          {save.state.status === 'error' ? (
            <span className="field-error" role="alert" style={{ display: 'block' }}>
              {save.state.message}
            </span>
          ) : null}
        </Td>
      </tr>
    );
  }

  return (
    <tr>
      <Td label={t.th.name}>
        {c.display_name || <em>{showPhone(c)}</em>}
        {c.note ? (
          <span className="field-hint" style={{ display: 'block' }}>
            {c.note}
          </span>
        ) : null}
      </Td>
      <Td label={t.th.phone}>
        {c.phone_e164 || c.phone ? (
          <a href={`tel:${c.phone_e164 ?? c.phone}`}>{showPhone(c)}</a>
        ) : (
          '—'
        )}
      </Td>
      <Td label={t.th.from}>
        <span className="field-hint">{t.source[c.source]}</span>
      </Td>
      <Td label="">
        <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
            {t.edit}
          </button>
          <form
            onSubmit={(e) => {
              // A deletion cannot be undone from here — cheap to confirm.
              if (!window.confirm(t.confirmDelete(who))) {
                e.preventDefault();
                return;
              }
              remove.onSubmit(e);
            }}
            style={{ display: 'inline' }}
          >
            <input type="hidden" name="venue_id" value={venueId} />
            <input type="hidden" name="contact_id" value={c.id} />
            <button type="submit" className="btn btn-secondary" disabled={remove.pending}>
              {remove.pending ? t.deleting : t.delete}
            </button>
          </form>
        </span>
        {remove.state.status === 'error' ? (
          <span className="field-error" role="alert" style={{ display: 'block' }}>
            {remove.state.message}
          </span>
        ) : null}
      </Td>
    </tr>
  );
}

export function ContactsTable({ venueId, contacts }: { venueId: string; contacts: ContactRow[] }) {
  const t = useCopy().contacts;
  return (
    <Table
      head={
        <>
          <Th>{t.th.name}</Th>
          <Th>{t.th.phone}</Th>
          <Th>{t.th.from}</Th>
          <Th>{' '}</Th>
        </>
      }
    >
      {contacts.map((c) => (
        <Row key={c.id} venueId={venueId} c={c} />
      ))}
    </Table>
  );
}

export function AddContactForm({ venueId }: { venueId: string }) {
  const t = useCopy().contacts;
  return (
    <ActionForm
      action={saveContact}
      submitLabel={t.add.submit}
      hidden={{ venue_id: venueId }}
      resetOnSuccess
    >
      {(errors) => (
        <div className="form-grid">
          <label className="field">
            <span className="field-label">{t.add.name}</span>
            <input name="display_name" className="input" maxLength={120} />
            <FieldError errors={errors.display_name} />
          </label>
          <label className="field">
            <span className="field-label">{t.add.phone}</span>
            <input name="phone" type="tel" className="input" maxLength={30} placeholder="+357 99 …" />
            <FieldError errors={errors.phone} />
          </label>
          <label className="field span-2">
            <span className="field-label">{t.add.note}</span>
            <input name="note" className="input" maxLength={280} placeholder={t.add.notePlaceholder} />
            <FieldError errors={errors.note} />
          </label>
        </div>
      )}
    </ActionForm>
  );
}

// Two steps, because one tap that empties the list is one tap too few.
export function DeleteAllContacts({ venueId, count }: { venueId: string; count: number }) {
  const t = useCopy().contacts;
  const [armed, setArmed] = useState(false);
  const { state, pending, onSubmit } = useKeptAction(deleteAllContacts);

  if (state.status === 'success') {
    return (
      <p role="status" className="form-ok" style={{ margin: 0 }}>
        {state.message}
      </p>
    );
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="field-hint" style={{ margin: 0 }}>
        {t.deleteAllHint}
      </p>
      {!armed ? (
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => setArmed(true)} disabled={count === 0}>
            {t.deleteAll(count)}
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="hidden" name="venue_id" value={venueId} />
          <strong>{t.deleteAllConfirm(count)}</strong>
          <button type="submit" className="btn btn-danger" disabled={pending}>
            {pending ? t.deleting : t.deleteAll(count)}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setArmed(false)} disabled={pending}>
            {t.cancel}
          </button>
        </form>
      )}
      {state.status === 'error' ? (
        <p role="alert" className="auth-error" style={{ margin: 0 }}>
          {(state as Extract<FormState, { status: 'error' }>).message}
        </p>
      ) : null}
    </div>
  );
}
