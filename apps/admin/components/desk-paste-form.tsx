'use client';

import { useCopy } from '@/components/locale-provider';
import { ActionForm } from '@/components/ui/form';
import { Field } from '@/components/ui/primitives';
import { pasteRequest } from '@/lib/desk-actions';

// A booking message copied from WhatsApp (or anywhere) into the desk. The
// name and number are optional; with a number the reply is one tap.
export function DeskPasteForm({ venueId }: { venueId: string }) {
  const d = useCopy().desk;
  return (
    <ActionForm action={pasteRequest} submitLabel={d.pasteSubmit} hidden={{ venue_id: venueId }} resetOnSuccess>
      {() => (
        <>
          <p className="fill-muted">{d.pasteHint}</p>
          <Field label={d.pasteBody}>
            <textarea name="body" className="input fill-message" rows={4} maxLength={2000} required />
          </Field>
          <div className="desk-paste-who">
            <Field label={d.pasteName}>
              <input name="sender_name" className="input" maxLength={120} autoComplete="off" />
            </Field>
            <Field label={d.pastePhone}>
              <input name="sender_phone" className="input" maxLength={30} inputMode="tel" autoComplete="off" />
            </Field>
          </div>
        </>
      )}
    </ActionForm>
  );
}
