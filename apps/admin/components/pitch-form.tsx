'use client';

import { useCopy } from '@/components/locale-provider';
import { ActionForm, FieldError } from '@/components/ui/form';
import {
  PITCH_SURFACES,
  PITCH_TYPES,
  type FormState,
} from '@/lib/schemas';

export type VenueOption = { id: string; name: string };
export type LeafOption = { id: string; name: string; type: string };

export type PitchDefaults = {
  id?: string;
  venue_id: string;
  name: string;
  type: string;
  surface: string;
  price_per_hour_eur: string;
  amenities: string;
  components?: string[];
};

export function PitchForm({
  action,
  submitLabel,
  venues,
  defaults,
  lockVenue,
  leaves,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  venues: VenueOption[];
  defaults: PitchDefaults;
  // Editing never moves a pitch between venues — the column guard rejects
  // it and it is not a thing anyone wants to do by accident. Nothing is
  // posted for it either: updatePitch reads the venue from the pitch row.
  lockVenue?: boolean;
  // The courts this pitch may be made of (ADR-0032): leaves at its own
  // venue. Only the edit form offers it — the create form has no settled
  // venue to list leaves from.
  leaves?: LeafOption[];
}) {
  const t = useCopy();
  const f = t.pitches.form;
  const typeLabel = (type: string) =>
    (t.pitch.types as Record<string, string | undefined>)[type] ?? type;
  return (
    <ActionForm
      action={action}
      submitLabel={submitLabel}
      hidden={defaults.id ? { id: defaults.id } : undefined}
    >
      {(errors) => (
        <>
          <div className="form-grid">
            {lockVenue ? null : (
              <label className="field span-2">
                <span className="field-label">{f.venue}</span>
                <select
                  name="venue_id"
                  className="input"
                  defaultValue={defaults.venue_id}
                  required
                  // A single-venue owner has exactly one option; showing a
                  // dropdown of one is noise, but it still has to post.
                  disabled={venues.length === 1}
                >
                  {venues.length === 1 ? null : <option value="">{t.common.select}</option>}
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                {venues.length === 1 ? (
                  <input type="hidden" name="venue_id" value={venues[0]?.id} />
                ) : null}
                <FieldError errors={errors.venue_id} />
              </label>
            )}

            <label className="field span-2">
              <span className="field-label">{f.name}</span>
              <input
                name="name"
                className="input"
                defaultValue={defaults.name}
                required
                maxLength={120}
                placeholder={f.namePlaceholder}
              />
              <FieldError errors={errors.name} />
            </label>

            <label className="field">
              <span className="field-label">{f.type}</span>
              <select name="type" className="input" defaultValue={defaults.type} required>
                {PITCH_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t.pitch.types[type]}
                  </option>
                ))}
              </select>
              <FieldError errors={errors.type} />
            </label>

            <label className="field">
              <span className="field-label">{f.surface}</span>
              <select
                name="surface"
                className="input"
                defaultValue={defaults.surface}
                required
              >
                {PITCH_SURFACES.map((s) => (
                  <option key={s} value={s}>
                    {t.pitch.surfaces[s]}
                  </option>
                ))}
              </select>
              <FieldError errors={errors.surface} />
            </label>

            <label className="field">
              <span className="field-label">{f.price}</span>
              <input
                name="price_per_hour_eur"
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={defaults.price_per_hour_eur}
                required
              />
              <FieldError errors={errors.price_per_hour_eur} />
            </label>

            <label className="field">
              <span className="field-label">{f.amenities}</span>
              <input
                name="amenities"
                className="input"
                defaultValue={defaults.amenities}
                placeholder={f.amenitiesPlaceholder}
              />
              <span className="field-hint">{f.amenitiesHint}</span>
              <FieldError errors={errors.amenities} />
            </label>
          </div>

          {leaves ? (
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <span className="field-label">{f.madeOf}</span>
              <input type="hidden" name="has_components" value="1" />
              {leaves.length === 0 ? (
                <span className="field-hint">{f.noLeaves}</span>
              ) : (
                <div className="made-of">
                  {leaves.map((l) => (
                    <label key={l.id} className="made-of-option">
                      <input
                        type="checkbox"
                        name="components"
                        value={l.id}
                        defaultChecked={defaults.components?.includes(l.id)}
                      />{' '}
                      {l.name} <span className="field-hint">({typeLabel(l.type)})</span>
                    </label>
                  ))}
                </div>
              )}
              <span className="field-hint">{f.madeOfHint}</span>
              <FieldError errors={errors.components} />
            </fieldset>
          ) : null}
        </>
      )}
    </ActionForm>
  );
}
