'use client';

import { useCopy } from '@/components/locale-provider';
import { ActionForm } from '@/components/ui/form';
import { Field } from '@/components/ui/primitives';
import { openFillOffer } from '@/lib/fill-actions';

// The one input before the list: the price the hour is offered at. Empty
// means the usual price. Submitting opens the offer and goes to the list.
export function FillStartForm({
  pitchId,
  startsAt,
  endsAt,
}: {
  pitchId: string;
  startsAt: string;
  endsAt: string;
}) {
  const f = useCopy().fill;
  return (
    <ActionForm
      action={openFillOffer}
      submitLabel={f.start}
      hidden={{ pitch_id: pitchId, starts_at: startsAt, ends_at: endsAt }}
    >
      {() => (
        <Field label={f.priceLabel} hint={f.priceHint}>
          <input name="price" inputMode="decimal" className="input" placeholder="€" autoComplete="off" />
        </Field>
      )}
    </ActionForm>
  );
}
