'use client';

import { useState } from 'react';

import { useCopy } from '@/components/locale-provider';
import { ActionForm, FieldError, SubmitButton, useKeptAction } from '@/components/ui/form';
import { createSeries, endSeries } from '@/lib/series-actions';

// The standing booking form (plans/standing-bookings.md): the academy on
// courts 1–3, Monday to Friday, 16:00 for two hours, until June. Courts are
// the chosen venue's; weekdays are ticks, Monday first.

export type StandingCourt = { id: string; name: string; type: string; venue_id: string };
export type StandingVenue = { id: string; name: string };

const ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DURATIONS = [60, 90, 120, 150, 180, 240] as const;

export function StandingForm({
  venues,
  courts,
  today,
}: {
  venues: StandingVenue[];
  courts: StandingCourt[];
  today: string;
}) {
  const t = useCopy();
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '');
  const { state, pending, onSubmit, fieldErrors } = useKeptAction(createSeries, { resetOnSuccess: true });
  const venueCourts = courts.filter((c) => c.venue_id === venueId);
  const courtType = (type: string) =>
    (t.pitch.types as Record<string, string | undefined>)[type] ?? type;

  return (
    <form onSubmit={onSubmit} className="stack">
      {state.status === 'error' ? (
        <p role="alert" className="auth-error">
          {state.message}
        </p>
      ) : null}
      {state.status === 'success' ? (
        <p role="status" className="form-ok">
          {state.message}
        </p>
      ) : null}

      <div className="form-grid">
        {venues.length > 1 ? (
          <label className="field span-2">
            <span className="field-label">{t.standing.form.venue}</span>
            <select
              name="venue_id"
              className="input"
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
              required
            >
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="venue_id" value={venueId} />
        )}

        <label className="field">
          <span className="field-label">{t.standing.form.who}</span>
          <input
            name="name"
            className="input"
            placeholder={t.standing.form.whoPlaceholder}
            maxLength={120}
            required
            autoComplete="off"
          />
          <span className="field-hint">{t.standing.form.whoHint}</span>
          <FieldError errors={fieldErrors.name} />
        </label>
        <label className="field">
          <span className="field-label">{t.standing.form.phone}</span>
          <input
            name="phone"
            className="input"
            type="tel"
            placeholder={t.standing.form.phonePlaceholder}
            maxLength={30}
          />
          <FieldError errors={fieldErrors.phone} />
        </label>
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <span className="field-label">{t.standing.form.courts}</span>
        {venueCourts.length === 0 ? (
          <span className="field-hint">{t.standing.form.noCourtsHere}</span>
        ) : (
          <div className="made-of">
            {venueCourts.map((c) => (
              <label key={c.id} className="made-of-option">
                <input type="checkbox" name="pitch_ids" value={c.id} /> {c.name}{' '}
                <span className="field-hint">({courtType(c.type)})</span>
              </label>
            ))}
          </div>
        )}
        <FieldError errors={fieldErrors.pitch_ids} />
      </fieldset>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <span className="field-label">{t.standing.form.days}</span>
        <div className="made-of">
          {ORDER.map((d) => (
            <label key={d} className="made-of-option">
              <input type="checkbox" name="weekdays" value={d} defaultChecked={d >= 1 && d <= 5} />{' '}
              {t.days.long[d]}
            </label>
          ))}
        </div>
        <FieldError errors={fieldErrors.weekdays} />
      </fieldset>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">{t.standing.form.kickOff}</span>
          <input name="starts_time" className="input" type="time" defaultValue="16:00" required />
          <FieldError errors={fieldErrors.starts_time} />
        </label>
        <label className="field">
          <span className="field-label">{t.standing.form.duration}</span>
          <select name="duration_minutes" className="input" defaultValue="120">
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {m % 60 === 0 ? t.common.hoursLong(m / 60) : t.common.minutes(m)}
              </option>
            ))}
          </select>
          <FieldError errors={fieldErrors.duration_minutes} />
        </label>
        <label className="field">
          <span className="field-label">{t.standing.form.from}</span>
          <input name="starts_on" className="input" type="date" defaultValue={today} min={today} required />
          <FieldError errors={fieldErrors.starts_on} />
        </label>
        <label className="field">
          <span className="field-label">{t.standing.form.until}</span>
          <input name="ends_on" className="input" type="date" min={today} />
          <span className="field-hint">{t.standing.form.untilHint}</span>
          <FieldError errors={fieldErrors.ends_on} />
        </label>
      </div>

      <div className="filters-actions">
        <SubmitButton label={t.standing.form.submit} pending={pending} />
      </div>
      <p className="field-hint">{t.standing.form.footer}</p>
    </form>
  );
}

export function EndSeriesForm({ seriesId, name, today }: { seriesId: string; name: string; today: string }) {
  const t = useCopy();
  return (
    <ActionForm
      action={endSeries}
      submitLabel={t.standing.form.end}
      hidden={{ series_id: seriesId }}
    >
      {(errors) => (
        <div className="filters-actions" style={{ alignItems: 'flex-end' }}>
          <label className="field">
            <span className="field-label">{t.standing.form.lastDayFor(name)}</span>
            <input name="ends_on" className="input" type="date" defaultValue={today} />
            <FieldError errors={errors.ends_on} />
          </label>
        </div>
      )}
    </ActionForm>
  );
}
