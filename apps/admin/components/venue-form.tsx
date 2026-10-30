'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

import { useCopy } from '@/components/locale-provider';
import { ActionForm, FieldError } from '@/components/ui/form';

// Leaflet reaches for `window` at import time, so it cannot be server-rendered.
// The placeholder reserves the same height to stop the form jumping when the
// map arrives. Its one word is read through the dictionary by a component,
// because `loading` renders outside VenueForm's render and cannot call the
// hook itself.
function MapLoading() {
  const t = useCopy();
  return <div className="map-picker-canvas map-picker-loading">{t.venue.form.loadingMap}</div>;
}
const MapPicker = dynamic(() => import('@/components/map-picker').then((m) => m.MapPicker), {
  ssr: false,
  loading: () => <MapLoading />,
});
import {
  CANCELLATION_POLICIES,
  type FormState,
} from '@/lib/schemas';

export type CityRef = { id: string; name_en: string };

export type VenueDefaults = {
  id?: string;
  name: string;
  address: string;
  contact_phone: string;
  contact_email: string;
  lat: string;
  lng: string;
  city_id: string;
  take_rate_bps: string;
  cancellation_policy: string;
  is_active: boolean;
  slug: string;
};

// One component for create and edit, and for both audiences. `isAdmin`
// decides whether the commercial block renders at all — an owner never
// sees a take rate, and the action would drop it even if they posted one
// (see lib/actions.ts).
//
// `mode="enrol"` is step 1 of the counter flow: no Active field (the
// action forces inactive, ADR-0031) and a "Use my location" button on
// the map, because the founder is standing on the pin.
export function VenueForm({
  action,
  submitLabel,
  isAdmin,
  cities,
  defaults,
  mode = 'edit',
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  isAdmin: boolean;
  cities: CityRef[];
  defaults: VenueDefaults;
  mode?: 'edit' | 'enrol';
}) {
  const t = useCopy();
  const f = t.venue.form;
  const [bps, setBps] = useState(defaults.take_rate_bps);
  const pct = Number(bps);
  const pctLabel = Number.isFinite(pct) && bps !== '' ? `= ${pct / 100}%` : '';
  return (
    <ActionForm
      action={action}
      submitLabel={submitLabel}
      hidden={defaults.id ? { id: defaults.id } : undefined}
    >
      {(errors) => (
        <>
          <div className="form-grid">
            <label className="field span-2">
              <span className="field-label">{f.name}</span>
              <input
                name="name"
                className="input"
                defaultValue={defaults.name}
                required
                maxLength={120}
              />
              <FieldError errors={errors.name} />
            </label>

            <label className="field span-2">
              <span className="field-label">{f.address}</span>
              <input
                name="address"
                className="input"
                defaultValue={defaults.address}
                required
                maxLength={240}
              />
              <FieldError errors={errors.address} />
            </label>

            <label className="field">
              <span className="field-label">{f.phone}</span>
              <input
                name="contact_phone"
                className="input"
                type="tel"
                defaultValue={defaults.contact_phone}
                placeholder={f.phonePlaceholder}
              />
              <FieldError errors={errors.contact_phone} />
            </label>

            <label className="field">
              <span className="field-label">{f.email}</span>
              <input
                name="contact_email"
                className="input"
                type="email"
                defaultValue={defaults.contact_email}
              />
              <FieldError errors={errors.contact_email} />
            </label>

          </div>

          <div className="field">
            <span className="field-label">{f.whereItIs}</span>
            <MapPicker
              lat={defaults.lat}
              lng={defaults.lng}
              addressHint={defaults.address}
              locate={mode === 'enrol'}
            />
            <FieldError errors={errors.lat} />
            <FieldError errors={errors.lng} />
          </div>

          {isAdmin ? (
            <>
              <p className="form-section">{f.commercial}</p>
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">{f.city}</span>
                  <select
                    name="city_id"
                    className="input"
                    defaultValue={defaults.city_id}
                    required
                  >
                    <option value="">{t.common.select}</option>
                    {cities.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name_en}
                      </option>
                    ))}
                  </select>
                  <FieldError errors={errors.city_id} />
                </label>

                <label className="field">
                  <span className="field-label">{f.commission(pctLabel)}</span>
                  <input
                    name="take_rate_bps"
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={5000}
                    step={1}
                    value={bps}
                    onChange={(e) => setBps(e.target.value)}
                    required
                  />
                  <span className="field-hint">{f.commissionHint}</span>
                  <FieldError errors={errors.take_rate_bps} />
                </label>

                <label className="field">
                  <span className="field-label">{f.cancellationPolicy}</span>
                  <select
                    name="cancellation_policy"
                    className="input"
                    defaultValue={defaults.cancellation_policy}
                  >
                    {CANCELLATION_POLICIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <FieldError errors={errors.cancellation_policy} />
                </label>

                <label className="field">
                  <span className="field-label">{f.slug}</span>
                  <input
                    name="slug"
                    className="input"
                    defaultValue={defaults.slug}
                    placeholder="campeone"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                  <span className="field-hint">{f.slugHint}</span>
                  <FieldError errors={errors.slug} />
                </label>

                {mode === 'enrol' ? null : (
                  <label className="field">
                    <span className="field-label">{f.active}</span>
                    <select
                      name="is_active"
                      className="input"
                      defaultValue={defaults.is_active ? 'true' : ''}
                    >
                      <option value="true">{f.activeYes}</option>
                      <option value="">{f.activeNo}</option>
                    </select>
                    <span className="field-hint">{f.activeHint}</span>
                    <FieldError errors={errors.is_active} />
                  </label>
                )}
              </div>
            </>
          ) : null}
        </>
      )}
    </ActionForm>
  );
}
