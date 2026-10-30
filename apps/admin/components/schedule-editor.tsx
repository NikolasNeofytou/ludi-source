'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';

import { useCopy, useLocale } from '@/components/locale-provider';
import { FieldError, SubmitButton, useKeptAction } from '@/components/ui/form';
import type { AdminCopy, Locale } from '@/lib/copy';
import { formatDayLabel } from '@/lib/format';
import {
  addOverride,
  addScheduleWindow,
  deleteOverride,
  deleteScheduleWindow,
  updateScheduleWindow,
} from '@/lib/schedule-actions';
import {
  SLOT_DURATIONS,
  dayOfWeekOfKey,
  defaultSlotMinutes,
  type FormState,
} from '@/lib/schemas';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';

export type Window = {
  id: string;
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  slot_duration_minutes: number;
};

export type Override = {
  id: string;
  override_date: string;
  is_closed: boolean;
  opens_at: string | null;
  closes_at: string | null;
  reason: string | null;
};

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

// A window that closes at midnight is stored as 24:00 (see closesHhmm in
// schemas.ts), which <input type="time"> cannot display — it would render
// blank. So it goes back into the input as 00:00, the value that saves it.
const closesInput = (t: string) => (hhmm(t) === '24:00' ? '00:00' : hhmm(t));

// In prose, 24:00 reads better as "midnight".
const range = (opens: string | null, closes: string | null, midnight: string) =>
  `${hhmm(opens)}–${hhmm(closes) === '24:00' ? midnight : hhmm(closes)}`;

// 'Sat 19 Sep'. Noon UTC is the same calendar date in Nicosia whatever the
// offset, so the key cannot slide onto the neighbouring day.
const dateLabel = (dateKey: string, locale: Locale) =>
  formatDayLabel(`${dateKey}T12:00:00Z`, locale);

// The support address in a message becomes a mailto link, so "email Ludi
// at …" is one tap rather than a copy-paste.
function withSupportLink(message: string) {
  const at = message.indexOf(SUPPORT_EMAIL);
  if (at === -1) return message;
  return (
    <>
      {message.slice(0, at)}
      <a href={SUPPORT_MAILTO} style={{ fontWeight: 600 }}>
        {SUPPORT_EMAIL}
      </a>
      {message.slice(at + SUPPORT_EMAIL.length)}
    </>
  );
}

// Every mutating form shows its result right beside it. The messages that
// matter here are the refusals — "3 bookings fall inside this window:
// LDN-… " — so they get the same prominence as an error, not a toast that
// disappears before it has been read.
function Banner({ state }: { state: FormState }) {
  if (state.status === 'error') {
    return (
      <p role="alert" className="auth-error">
        {withSupportLink(state.message)}
        {state.link ? (
          <>
            {' '}
            <Link href={state.link.href} style={{ fontWeight: 600 }}>
              {state.link.label}
            </Link>
          </>
        ) : null}
      </p>
    );
  }
  if (state.status === 'success') {
    return (
      <p role="status" className="form-ok">
        {state.message}
      </p>
    );
  }
  return null;
}

// Remove takes a whole window of bookable slots away in one tap, so it asks
// first. Declining cancels the submit before anything is sent.
function confirmFirst(
  question: string,
  submit: (e: FormEvent<HTMLFormElement>) => void,
) {
  return (e: FormEvent<HTMLFormElement>) => {
    if (!window.confirm(question)) {
      e.preventDefault();
      return;
    }
    submit(e);
  };
}

// <input type="time"> cannot produce 24:00, and read literally 00:00 is
// before every opening time. So a CLOSING time of 00:00 means midnight at
// the end of the day; the hint says so whenever the field reads 00:00, so
// nobody wonders whether the pitch shuts at the start of the day instead.
function ClosesAt({
  defaultValue,
  errors,
  label,
}: {
  defaultValue: string;
  errors?: string[];
  label?: string;
}) {
  const t = useCopy();
  const [value, setValue] = useState(defaultValue);
  const input = (
    <input
      type="time"
      name="closes_at"
      className="input"
      defaultValue={defaultValue}
      onChange={(e) => setValue(e.target.value)}
      required
      aria-label={label ? undefined : t.schedule.closesAt}
    />
  );
  const after = (
    <>
      {value === '00:00' ? <span className="field-hint">{t.schedule.midnightHint}</span> : null}
      <FieldError errors={errors} />
    </>
  );
  if (label) {
    return (
      <label className="field">
        <span className="field-label">{label}</span>
        {input}
        {after}
      </label>
    );
  }
  return (
    <span className="field">
      {input}
      {after}
    </span>
  );
}

function SlotOptions() {
  const t = useCopy();
  return (
    <>
      {SLOT_DURATIONS.map((d) => (
        <option key={d} value={d}>
          {t.common.minutes(d)}
        </option>
      ))}
    </>
  );
}

function WindowRow({ pitchId, row }: { pitchId: string; row: Window }) {
  const t = useCopy();
  const edit = useKeptAction(updateScheduleWindow);
  const del = useKeptAction(deleteScheduleWindow);

  return (
    <li className="sched-row">
      <form onSubmit={edit.onSubmit} className="sched-window">
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="pitch_id" value={pitchId} />
        <span className="field">
          <input
            type="time"
            name="opens_at"
            className="input"
            defaultValue={hhmm(row.opens_at)}
            required
            aria-label={t.schedule.opensAt}
          />
          <FieldError errors={edit.fieldErrors.opens_at} />
        </span>
        <span className="sched-dash">→</span>
        <ClosesAt
          defaultValue={closesInput(row.closes_at)}
          errors={edit.fieldErrors.closes_at}
        />
        <span className="field">
          <select
            name="slot_duration_minutes"
            className="input"
            defaultValue={String(row.slot_duration_minutes)}
            aria-label={t.schedule.slotLength}
          >
            <SlotOptions />
          </select>
          <FieldError errors={edit.fieldErrors.slot_duration_minutes} />
        </span>
        <SubmitButton label={t.common.save} pending={edit.pending} />
      </form>

      <form
        onSubmit={confirmFirst(
          t.schedule.confirmRemove(
            t.days.long[row.day_of_week]!,
            range(row.opens_at, row.closes_at, t.common.midnight),
          ),
          del.onSubmit,
        )}
      >
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="pitch_id" value={pitchId} />
        <button type="submit" className="btn btn-danger" disabled={del.pending}>
          {del.pending ? t.common.removing : t.common.remove}
        </button>
      </form>

      <div className="sched-messages">
        <Banner state={edit.state} />
        <Banner state={del.state} />
      </div>
    </li>
  );
}

// A prefilled row sitting under a saved window reads as a second window —
// an owner sees "10:00 → 23:00" then "09:00 → 23:00" and thinks the day
// opens at nine. So on a day that already has hours the form stays behind
// an explicit "Add another window", and folds away again once it saves.
// A closed day has nothing to confuse it with and shows the form straight.
function AddWindow({
  pitchId,
  day,
  hasWindows,
}: {
  pitchId: string;
  day: number;
  hasWindows: boolean;
}) {
  const t = useCopy();
  const { state, pending, onSubmit, fieldErrors } = useKeptAction(addScheduleWindow, {
    resetOnSuccess: true,
  });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (state.status === 'success') setExpanded(false);
  }, [state]);

  if (hasWindows && !expanded) {
    return (
      <>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setExpanded(true)}
        >
          {t.schedule.addAnother}
        </button>
        <Banner state={state} />
      </>
    );
  }

  return (
    <>
      <p className="form-section">
        {hasWindows ? t.schedule.anotherWindow : t.schedule.openThisDay}
      </p>
      <form onSubmit={onSubmit} className="sched-window">
        <input type="hidden" name="pitch_id" value={pitchId} />
        <input type="hidden" name="day_of_week" value={day} />
        <span className="field">
          <input
            type="time"
            name="opens_at"
            className="input"
            defaultValue="09:00"
            required
            aria-label={t.schedule.opensAt}
          />
          <FieldError errors={fieldErrors.opens_at} />
        </span>
        <span className="sched-dash">→</span>
        <ClosesAt defaultValue="23:00" errors={fieldErrors.closes_at} />
        <span className="field">
          <select
            name="slot_duration_minutes"
            className="input"
            defaultValue="60"
            aria-label={t.schedule.slotLength}
          >
            <SlotOptions />
          </select>
          <FieldError errors={fieldErrors.slot_duration_minutes} />
        </span>
        <SubmitButton label={t.schedule.addWindow} pending={pending} />
        {hasWindows ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setExpanded(false)}
          >
            {t.common.cancel}
          </button>
        ) : null}
      </form>
      <Banner state={state} />
    </>
  );
}

export function WeeklySchedule({
  pitchId,
  windows,
}: {
  pitchId: string;
  windows: Window[];
}) {
  const t = useCopy();
  return (
    <div className="stack">
      {t.days.long.map((label, day) => {
        const forDay = windows
          .filter((w) => w.day_of_week === day)
          .sort((a, b) => a.opens_at.localeCompare(b.opens_at));
        return (
          <div key={day} className="card card-pad">
            <div className="sched-day">
              <h2 className="sched-day-name">{label}</h2>
              {forDay.length === 0 ? (
                <span className="page-meta">{t.schedule.closed}</span>
              ) : null}
            </div>
            {forDay.length ? (
              <ul className="sched-list">
                {forDay.map((w) => (
                  <WindowRow key={w.id} pitchId={pitchId} row={w} />
                ))}
              </ul>
            ) : null}
            <AddWindow pitchId={pitchId} day={day} hasWindows={forDay.length > 0} />
          </div>
        );
      })}
    </div>
  );
}

// What the picked date is being changed FROM. An exception replaces the
// date's regular hours rather than adding to them, and the owner should see
// what they are replacing before they replace it — and whether the date
// already carries an exception the new one must sit beside.
function DateHint({
  date,
  windows,
  overrides,
  t,
}: {
  date: string;
  windows: Window[];
  overrides: Override[];
  t: AdminCopy;
}) {
  if (!date) return null;
  const dow = dayOfWeekOfKey(date);
  const regular = windows
    .filter((w) => w.day_of_week === dow)
    .sort((a, b) => a.opens_at.localeCompare(b.opens_at));
  const existing = overrides.filter((o) => o.override_date === date);
  const dayName = t.days.long[dow]!;
  return (
    <span className="field-hint">
      {regular.length
        ? t.schedule.regularHours(
            dayName,
            regular.map((w) => range(w.opens_at, w.closes_at, t.common.midnight)).join(', '),
          )
        : t.schedule.normallyClosed(dayName)}
      {existing.length
        ? t.schedule.alreadyException(
            existing
              .map((o) =>
                o.is_closed
                  ? t.schedule.closedAllDay
                  : range(o.opens_at, o.closes_at, t.common.midnight),
              )
              .join(', '),
          )
        : null}
    </span>
  );
}

function AddException({
  pitchId,
  today,
  windows,
  overrides,
}: {
  pitchId: string;
  today: string;
  windows: Window[];
  overrides: Override[];
}) {
  const t = useCopy();
  const { state, pending, onSubmit, fieldErrors } = useKeptAction(addOverride, {
    resetOnSuccess: true,
  });
  // Tracked only to drive the hints and the slot-length default; the
  // inputs themselves stay uncontrolled so the form reset clears them.
  const [date, setDate] = useState('');
  const [special, setSpecial] = useState(false);
  // null until the owner picks a length themselves — until then it follows
  // the picked date's weekday.
  const [slotChoice, setSlotChoice] = useState<number | null>(null);

  useEffect(() => {
    if (state.status === 'success') {
      setDate('');
      setSpecial(false);
      setSlotChoice(null);
    }
  }, [state]);

  const slot =
    slotChoice ?? defaultSlotMinutes(windows, date ? dayOfWeekOfKey(date) : -1);

  return (
    <div className="card card-pad">
      <p className="form-section">{t.schedule.addException}</p>
      <form onSubmit={onSubmit} className="form-grid">
        <input type="hidden" name="pitch_id" value={pitchId} />
        <label className="field">
          <span className="field-label">{t.schedule.date}</span>
          <input
            type="date"
            name="override_date"
            className="input"
            min={today}
            required
            onChange={(e) => setDate(e.target.value)}
          />
          <DateHint date={date} windows={windows} overrides={overrides} t={t} />
          <FieldError errors={fieldErrors.override_date} />
        </label>
        <label className="field">
          <span className="field-label">{t.schedule.onThisDate}</span>
          <select
            name="is_closed"
            className="input"
            defaultValue="true"
            onChange={(e) => setSpecial(e.target.value === '')}
          >
            <option value="true">{t.schedule.closedAllDay[0]!.toUpperCase() + t.schedule.closedAllDay.slice(1)}</option>
            <option value="">{t.schedule.specialHours}</option>
          </select>
          <FieldError errors={fieldErrors.is_closed} />
        </label>

        {special ? (
          <>
            <p className="field-hint span-2" style={{ margin: 0 }}>
              {t.schedule.specialHint}
            </p>
            <label className="field">
              <span className="field-label">{t.schedule.opensAt}</span>
              <input type="time" name="opens_at" className="input" required />
              <FieldError errors={fieldErrors.opens_at} />
            </label>
            <ClosesAt defaultValue="" errors={fieldErrors.closes_at} label={t.schedule.closesAt} />
            <label className="field">
              <span className="field-label">{t.schedule.slotLength}</span>
              <select
                name="slot_duration_minutes"
                className="input"
                value={String(slot)}
                onChange={(e) => setSlotChoice(Number(e.target.value))}
              >
                <SlotOptions />
              </select>
              <FieldError errors={fieldErrors.slot_duration_minutes} />
            </label>
          </>
        ) : null}

        <label className="field span-2">
          <span className="field-label">{t.schedule.reason}</span>
          <input
            name="reason"
            className="input"
            maxLength={200}
            placeholder={t.schedule.reasonPlaceholder}
          />
          <FieldError errors={fieldErrors.reason} />
        </label>
        <div className="span-2">
          <SubmitButton label={t.schedule.submitException} pending={pending} />
        </div>
      </form>
      <Banner state={state} />
    </div>
  );
}

// Each row owns its result. With one banner shared by every row, a second
// tap on Remove came back "That exception no longer exists." above the
// whole list; now the button is disabled while the first is in flight, and
// the row — and anything it had to say — goes away with the exception.
function ExceptionRow({ pitchId, override: o }: { pitchId: string; override: Override }) {
  const t = useCopy();
  const locale = useLocale();
  const { state, pending, onSubmit } = useKeptAction(deleteOverride);
  const what = o.is_closed
    ? t.schedule.closedAllDay
    : range(o.opens_at, o.closes_at, t.common.midnight);

  return (
    <li className="sched-row">
      <span>
        <strong>{dateLabel(o.override_date, locale)}</strong> {what}
        {o.reason ? (
          <span style={{ color: 'var(--ludi-ink3)' }}> · {o.reason}</span>
        ) : null}
      </span>
      <form
        onSubmit={confirmFirst(
          t.schedule.confirmRemoveException(dateLabel(o.override_date, locale), what),
          onSubmit,
        )}
      >
        <input type="hidden" name="id" value={o.id} />
        <input type="hidden" name="pitch_id" value={pitchId} />
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? t.common.removing : t.common.remove}
        </button>
      </form>
      <div className="sched-messages">
        <Banner state={state} />
      </div>
    </li>
  );
}

export function Overrides({
  pitchId,
  today,
  windows,
  overrides,
}: {
  pitchId: string;
  today: string;
  windows: Window[];
  overrides: Override[];
}) {
  const t = useCopy();
  return (
    <div className="stack">
      <AddException
        pitchId={pitchId}
        today={today}
        windows={windows}
        overrides={overrides}
      />

      <div className="card card-pad">
        <p className="form-section">{t.schedule.upcoming}</p>
        {overrides.length === 0 ? (
          <p className="page-meta">{t.schedule.none}</p>
        ) : (
          <ul className="sched-list">
            {overrides.map((o) => (
              <ExceptionRow key={o.id} pitchId={pitchId} override={o} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
