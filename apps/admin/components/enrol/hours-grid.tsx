'use client';

import Link from 'next/link';
import { useState } from 'react';

import { FieldError, SubmitButton, useKeptAction } from '@/components/ui/form';
import { enrolHours } from '@/lib/enrol-actions';
import { DAY_NAMES, SLOT_DURATIONS } from '@/lib/schemas';

// Step 3: one weekly grid for the venue, applied to every court that has
// no hours yet, in one statement. Per-court differences belong to the
// per-pitch editor afterwards — this sets the venue's week, it does not
// edit a court's.
//
// Days are shown Monday-first (how an owner says their week) but posted
// with the table's day_of_week, where Sunday is 0.

type Day = { day: number; closed: boolean; opens: string; closes: string };

const ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export type HoursCourt = { id: string; name: string; windows: number };

export function HoursGrid({
  venueId,
  courts,
}: {
  venueId: string;
  courts: HoursCourt[];
}) {
  const [days, setDays] = useState<Day[]>(() =>
    ORDER.map((day) => ({ day, closed: false, opens: '15:00', closes: '22:00' })),
  );
  const [slot, setSlot] = useState('60');
  const { state, pending, onSubmit, fieldErrors } = useKeptAction(enrolHours);

  const targets = courts.filter((c) => c.windows === 0);
  const already = courts.filter((c) => c.windows > 0);

  const set = (day: number, patch: Partial<Day>) =>
    setDays((ds) => ds.map((d) => (d.day === day ? { ...d, ...patch } : d)));
  const copyFrom = (src: number, to: readonly number[]) =>
    setDays((ds) => {
      const s = ds.find((d) => d.day === src);
      if (!s) return ds;
      return ds.map((d) =>
        to.includes(d.day) ? { ...d, closed: s.closed, opens: s.opens, closes: s.closes } : d,
      );
    });

  // Field errors come back keyed by posted index, which is the Monday-first
  // position, not the day number.
  const err = (i: number, field: string) => fieldErrors[`days.${i}.${field}`];

  return (
    <form onSubmit={onSubmit} className="stack">
      <input type="hidden" name="venue_id" value={venueId} />

      {state.status === 'error' ? (
        <p role="alert" className="auth-error">
          {state.message}
          {fieldErrors.days ? ` ${fieldErrors.days[0]}` : ''}
        </p>
      ) : null}

      <p className="page-intro" style={{ margin: 0 }}>
        {targets.length === 0 ? (
          <>Every court already has hours.</>
        ) : (
          <>
            Applies to{' '}
            <strong>{targets.map((c) => c.name).join(', ')}</strong>.
          </>
        )}
        {already.length ? (
          <>
            {' '}
            Already set, left alone:{' '}
            {already.map((c, i) => (
              <span key={c.id}>
                {i ? ', ' : ''}
                <Link href={`/pitches/${c.id}/schedule`}>{c.name}</Link>
              </span>
            ))}
            .
          </>
        ) : null}
      </p>

      <div className="filters-actions" style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => copyFrom(1, [2, 3, 4, 5, 6, 0])}
        >
          All days like Monday
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => copyFrom(1, [2, 3, 4, 5])}
        >
          Tue–Fri like Monday
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => copyFrom(6, [0])}>
          Sunday like Saturday
        </button>
      </div>

      <div className="hours-grid">
        {days.map((d, i) => (
          <div key={d.day} className={d.closed ? 'hours-row hours-row-closed' : 'hours-row'}>
            <input type="hidden" name={`days[${i}][day_of_week]`} value={d.day} />
            <span className="hours-day">{DAY_NAMES[d.day]}</span>
            <label className="hours-closed">
              <input
                type="checkbox"
                name={`days[${i}][closed]`}
                value="true"
                checked={d.closed}
                onChange={(e) => set(d.day, { closed: e.target.checked })}
              />{' '}
              Closed
            </label>
            <label className="field">
              <span className="field-label">Opens</span>
              <input
                type="time"
                name={`days[${i}][opens_at]`}
                className="input"
                value={d.opens}
                onChange={(e) => set(d.day, { opens: e.target.value })}
                disabled={d.closed}
                required={!d.closed}
              />
              <FieldError errors={err(i, 'opens_at')} />
            </label>
            <label className="field">
              <span className="field-label">Closes</span>
              <input
                type="time"
                name={`days[${i}][closes_at]`}
                className="input"
                value={d.closes}
                onChange={(e) => set(d.day, { closes: e.target.value })}
                disabled={d.closed}
                required={!d.closed}
              />
              {d.closes === '00:00' && !d.closed ? (
                <span className="field-hint">00:00 = midnight</span>
              ) : null}
              <FieldError errors={err(i, 'closes_at')} />
            </label>
          </div>
        ))}
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">Slot length</span>
          <select
            name="slot_duration_minutes"
            className="input"
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
          >
            {SLOT_DURATIONS.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
          <FieldError errors={fieldErrors.slot_duration_minutes} />
        </label>
      </div>

      <div className="filters-actions">
        <SubmitButton
          label={targets.length ? 'Save hours and continue' : 'Continue'}
          pending={pending}
        />
        {targets.length === 0 ? (
          <Link href={`/venues/${venueId}/enrol/owner`} className="btn btn-secondary">
            Skip to the owner
          </Link>
        ) : null}
      </div>
      <p className="field-hint">
        A court that opens differently — later on Sundays, a split morning
        and evening — gets that from Pitches → Hours after this. Closed days
        write nothing.
      </p>
    </form>
  );
}
