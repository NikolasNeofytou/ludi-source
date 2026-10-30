'use client';

// The front desk (M6 #41k): the UI over create-walk-in-booking (#41j).
// WalkInButton opens the create modal from the Today view; WalkInCancelButton
// un-books a mis-tap. Both call the Edge Function under the caller's own JWT
// — the function does the owner-or-admin gate and all money bookkeeping.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { ContactPicker } from '@/components/contact-picker';
import { useCopy, useLocale } from '@/components/locale-provider';
import { readEdgeError } from '@/lib/edge-error';
import {
  formatEur,
  parseEurosToCents,
  VENUE_TZ,
  venueToday,
  venueWallClockToIso,
} from '@/lib/format';
import { dayOfWeekOfKey } from '@/lib/schemas';
import { createSeries } from '@/lib/series-actions';
import { createClient } from '@/lib/supabase/client';
import { tokens } from '@/lib/tokens';

const DURATIONS = [60, 90, 120, 30] as const;
// A repeating block is an academy's afternoon as often as a group's hour.
const REPEAT_DURATIONS = [60, 90, 120, 150, 180, 240] as const;
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const BIBS_CENTS = 500;
const BALL_CENTS = 300;

export type WalkInPitch = {
  id: string;
  venueId?: string;
  name: string;
  venueName: string;
  pricePerHourCents: number;
};

// What the modal opens on. The Calendar passes the date on screen, and a
// tapped cell passes its court, date and hour too; Today passes nothing.
export type WalkInPrefill = {
  pitchId?: string;
  date?: string;
  time?: string;
  duration?: number;
  // The booking desk (ADR-0046) opens the form on the customer who asked.
  name?: string;
  phone?: string;
};

// Fill the hour (ADR-0045): the courts' venues where the viewer is the owner
// and Ludi switched it on. An empty cell on one of them offers the hour to
// the regulars as well as booking it.
export type FillVenues = ReadonlySet<string>;

export function WalkInButton({
  pitches,
  prefill,
}: {
  pitches: WalkInPitch[];
  prefill?: WalkInPrefill;
}) {
  const t = useCopy();
  const [open, setOpen] = useState(false);
  if (pitches.length === 0) return null;
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {t.walkIn.button}
      </button>
      {open && <WalkInModal pitches={pitches} prefill={prefill} onClose={() => setOpen(false)} />}
    </>
  );
}

// An empty cell on the Calendar: a quiet "+" that opens the walk-in modal on
// that court and hour. Screen only — on paper the cell stays blank for
// handwriting.
export function WalkInCell({
  pitches,
  prefill,
  label,
  fillVenues,
}: {
  pitches: WalkInPitch[];
  prefill: WalkInPrefill;
  label: string;
  fillVenues?: FillVenues;
}) {
  const [open, setOpen] = useState(false);
  if (pitches.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="calendar-add no-print"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        +
      </button>
      {open && (
        <WalkInModal pitches={pitches} prefill={prefill} fillVenues={fillVenues} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

// The booking desk's way in (ADR-0046): a button that opens the form on a
// request's proposal, and tells the desk the code once it is booked.
export function WalkInLauncher({
  pitches,
  prefill,
  label,
  className = 'btn btn-primary',
  onBooked,
}: {
  pitches: WalkInPitch[];
  prefill: WalkInPrefill;
  label: string;
  className?: string;
  onBooked: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (pitches.length === 0) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <WalkInModal pitches={pitches} prefill={prefill} onBooked={onBooked} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function WalkInModal({
  pitches,
  prefill,
  fillVenues,
  onBooked,
  onClose,
}: {
  pitches: WalkInPitch[];
  prefill?: WalkInPrefill;
  fillVenues?: FillVenues;
  onBooked?: (code: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const t = useCopy();
  const locale = useLocale();
  const eur = (cents: number) => formatEur(cents, locale);
  const multiVenue = new Set(pitches.map((p) => p.venueName)).size > 1;

  const [pitchId, setPitchId] = useState(
    pitches.find((p) => p.id === prefill?.pitchId)?.id ?? pitches[0]?.id ?? '',
  );
  const [date, setDate] = useState(() => prefill?.date ?? venueToday());
  const [time, setTime] = useState(() => prefill?.time ?? nextFullHourInVenueTz());
  const [duration, setDuration] = useState<number>(
    DURATIONS.includes(prefill?.duration as (typeof DURATIONS)[number]) ? prefill!.duration! : 60,
  );
  const [name, setName] = useState(prefill?.name ?? '');
  const [phone, setPhone] = useState(prefill?.phone ?? '');
  // The regular picked from the typeahead (plans/owner-contacts.md, slice
  // C), or null for a name typed fresh. ContactPicker clears it the moment
  // either field is edited, so it always agrees with what is on screen.
  const [contactId, setContactId] = useState<string | null>(null);
  const [bibs, setBibs] = useState(0);
  const [balls, setBalls] = useState(0);
  const [priceStr, setPriceStr] = useState('');
  const [priceDirty, setPriceDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Repeat every week — a standing booking (ADR-0033) made from the same
  // form: the day and court it was opened on, more of either if wanted.
  const [repeat, setRepeat] = useState(false);
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [repeatCourts, setRepeatCourts] = useState<string[]>([]);
  const [until, setUntil] = useState('');
  const [repeatDone, setRepeatDone] = useState<string | null>(null);

  // WalkInButton renders nothing for an empty pitch list, so `pitch` is
  // always found in practice; the fallback keeps the type checker honest.
  const pitch = pitches.find((p) => p.id === pitchId);

  // A contact belongs to one venue. If the court changes to another
  // venue's (an admin, or an owner of two), the pick no longer applies —
  // the booking would be refused, so drop it here instead.
  const pickedVenueRef = useRef(pitch?.venueId);
  useEffect(() => {
    if (pickedVenueRef.current !== pitch?.venueId) {
      pickedVenueRef.current = pitch?.venueId;
      setContactId(null);
    }
  }, [pitch?.venueId]);
  const computedBaseCents = Math.round(
    ((pitch?.pricePerHourCents ?? 0) * duration) / 60,
  );

  // The price field tracks the computed slot price until the owner types
  // their own number — from then on it IS the desk price (the override).
  useEffect(() => {
    if (!priceDirty) setPriceStr((computedBaseCents / 100).toFixed(2));
  }, [computedBaseCents, priceDirty]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // One idempotency key per distinct payload: an unchanged retry is deduped
  // end-to-end, an edited form is a new action and gets a fresh key —
  // without this, edit-then-retry would 409 IDEMPOTENCY_MISMATCH.
  const keyRef = useRef<{ hash: string; key: string } | null>(null);
  function keyFor(payloadJson: string): string {
    if (!keyRef.current || keyRef.current.hash !== payloadJson) {
      keyRef.current = { hash: payloadJson, key: crypto.randomUUID() };
    }
    return keyRef.current.key;
  }

  const priceCents = parseEurosToCents(priceStr);
  const priceValid = priceCents !== null && priceCents >= 100 && priceCents <= 500_000;
  const addonsCents = bibs * BIBS_CENTS + balls * BALL_CENTS;
  const totalCents = (priceValid ? priceCents : computedBaseCents) + addonsCents;
  const canSubmit =
    !submitting && !done && name.trim().length > 0 && priceValid && Boolean(date) && Boolean(time);
  const venueCourts = pitches.filter((p) => p.venueId && p.venueId === pitch?.venueId);
  const canRepeat = Boolean(pitch?.venueId);
  const canSubmitRepeat =
    !submitting &&
    !repeatDone &&
    name.trim().length > 0 &&
    Boolean(date) &&
    Boolean(time) &&
    repeatDays.length > 0 &&
    repeatCourts.length > 0;

  function toggleRepeat(on: boolean) {
    setRepeat(on);
    setError(null);
    if (on) {
      setRepeatDays(/^\d{4}-\d{2}-\d{2}$/.test(date) ? [dayOfWeekOfKey(date)] : []);
      setRepeatCourts(pitchId ? [pitchId] : []);
      if (!(REPEAT_DURATIONS as readonly number[]).includes(duration)) setDuration(120);
    } else if (!(DURATIONS as readonly number[]).includes(duration)) {
      setDuration(60);
    }
  }

  async function submitRepeat() {
    if (!canSubmitRepeat || !pitch?.venueId) return;
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('venue_id', pitch.venueId);
      fd.set('name', name.trim());
      fd.set('phone', phone.trim());
      if (contactId) fd.set('contact_id', contactId);
      repeatCourts.forEach((id) => fd.append('pitch_ids', id));
      repeatDays.forEach((d) => fd.append('weekdays', String(d)));
      fd.set('starts_time', time);
      fd.set('duration_minutes', String(duration));
      fd.set('starts_on', date);
      fd.set('ends_on', until);
      const res = await createSeries({ status: 'idle' }, fd);
      if (res.status === 'success') {
        setRepeatDone(res.message);
        router.refresh();
      } else if (res.status === 'error') {
        const first = res.fieldErrors ? Object.values(res.fieldErrors).flat()[0] : undefined;
        setError(first ? `${res.message} ${first}` : res.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.walkIn.failed);
    } finally {
      setSubmitting(false);
    }
  }

  // Logging a game after it was played is legitimate front-desk work, so a
  // past slot is allowed — just said out loud, in case it's a typo. Judged
  // on the slot's end, not kick-off: a game logged ten minutes in is the
  // desk's normal rhythm, not a past booking.
  const inPast = slotHasEnded(date, time, duration);

  async function submit() {
    if (!canSubmit || priceCents === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const startsAt = venueWallClockToIso(date, time);
      const endsAt = new Date(Date.parse(startsAt) + duration * 60_000).toISOString();
      const addons = [
        ...(bibs > 0 ? [{ code: 'bibs', quantity: bibs }] : []),
        ...(balls > 0 ? [{ code: 'ball_rental', quantity: balls }] : []),
      ];
      const body = {
        action: 'create',
        pitch_id: pitchId,
        starts_at: startsAt,
        ends_at: endsAt,
        customer_name: name.trim(),
        ...(phone.trim() ? { customer_phone: phone.trim() } : {}),
        ...(contactId ? { contact_id: contactId } : {}),
        addons,
        // Only an actually-changed price is an override; untouched means
        // "charge the list price" and the server computes the same number.
        ...(priceCents !== computedBaseCents
          ? { price_override_cents: priceCents }
          : {}),
      };
      const payloadJson = JSON.stringify(body);
      const supabase = createClient();
      const { data, error: fnErr } = await supabase.functions.invoke(
        'create-walk-in-booking',
        { body, headers: { 'Idempotency-Key': keyFor(payloadJson) } },
      );
      if (fnErr) {
        setError(await readEdgeError(fnErr));
        return;
      }
      const code = (data as { booking?: { code?: string } })?.booking?.code;
      setDone(code ?? 'booked');
      if (code) onBooked?.(code);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.walkIn.failed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="walkin-dialog-title"
      style={overlayStyle}
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <h2 id="walkin-dialog-title" style={{ fontSize: 20, margin: '0 0 4px' }}>
          {t.walkIn.title}
        </h2>
        <p style={{ margin: '0 0 16px', color: tokens.ink3, fontSize: 14 }}>
          {t.walkIn.subtitle}
        </p>

        {/* Fill the hour (ADR-0045): from an empty cell, on a venue where
            the viewer is the owner and Ludi switched it on, the hour can be
            offered to the regulars instead of waiting for the phone. */}
        {prefill?.time &&
        !done &&
        !repeatDone &&
        fillVenues?.has(pitches.find((p) => p.id === pitchId)?.venueId ?? '') &&
        Date.parse(venueWallClockToIso(date, time)) > Date.now() ? (
          <a
            className="walkin-fill fill-quiet"
            href={`/fill?pitch=${pitchId}&date=${date}&time=${time}&duration=${duration}`}
          >
            {t.fill.offerLink}
          </a>
        ) : null}

        {repeatDone ? (
          <>
            <p style={{ fontSize: 15 }}>{repeatDone}</p>
            <div style={buttonRowStyle}>
              <button type="button" onClick={onClose} style={primaryButtonStyle}>
                {t.common.done}
              </button>
            </div>
          </>
        ) : done ? (
          <>
            <p style={{ fontSize: 15 }}>
              {t.walkIn.bookedBefore}
              <span style={monoStyle}>{done}</span>
              {t.walkIn.bookedFor}
              <strong>{name.trim()}</strong>, {date} {time}.
            </p>
            <div style={buttonRowStyle}>
              <button type="button" onClick={onClose} style={primaryButtonStyle}>
                {t.common.done}
              </button>
            </div>
          </>
        ) : (
          <>
            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>{t.walkIn.pitch}</span>
              <select
                value={pitchId}
                onChange={(e) => setPitchId(e.target.value)}
                style={inputStyle}
                disabled={submitting}
              >
                {multiVenue
                  ? [...new Set(pitches.map((p) => p.venueName))].map((venue) => (
                      <optgroup key={venue} label={venue}>
                        {pitches
                          .filter((p) => p.venueName === venue)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · {eur(p.pricePerHourCents)}{t.common.perHour}
                            </option>
                          ))}
                      </optgroup>
                    ))
                  : pitches.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {eur(p.pricePerHourCents)}{t.common.perHour}
                      </option>
                    ))}
              </select>
            </label>

            {/* Date and time inputs carry a picker icon and won't shrink
                below their text, so three abreast overflows a phone-width
                card. Give each a floor and let Length wrap to its own line. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <label style={{ ...fieldStyle, flex: '1 1 140px' }}>
                <span style={fieldLabelStyle}>{t.walkIn.date}</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={inputStyle}
                  disabled={submitting}
                />
              </label>
              <label style={{ ...fieldStyle, flex: '1 1 110px' }}>
                <span style={fieldLabelStyle}>{t.walkIn.kickOff}</span>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  style={inputStyle}
                  disabled={submitting}
                />
              </label>
              <label style={{ ...fieldStyle, flex: '1 1 90px' }}>
                <span style={fieldLabelStyle}>{t.walkIn.length}</span>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  style={inputStyle}
                  disabled={submitting}
                >
                  {(repeat ? [...REPEAT_DURATIONS] : [...DURATIONS].sort((a, b) => a - b)).map((d) => (
                    <option key={d} value={d}>
                      {t.common.minutes(d)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {inPast && !repeat ? <p style={noteTextStyle}>{t.walkIn.inPast}</p> : null}

            <ContactPicker
              venueId={pitch?.venueId}
              name={name}
              phone={phone}
              contactId={contactId}
              onChange={(next) => {
                setName(next.name);
                setPhone(next.phone);
                setContactId(next.contactId);
              }}
              disabled={submitting}
              labels={{
                name: t.walkIn.customerName,
                namePlaceholder: t.walkIn.namePlaceholder,
                phone: t.walkIn.phone,
                phonePlaceholder: t.walkIn.phonePlaceholder,
              }}
              fieldStyle={fieldStyle}
              labelStyle={fieldLabelStyle}
              inputStyle={inputStyle}
            />

            {canRepeat ? (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={repeat}
                  onChange={(e) => toggleRepeat(e.target.checked)}
                  disabled={submitting}
                />
                <span>
                  <strong>{t.walkIn.repeat}</strong>
                  <span style={{ color: tokens.ink3 }}> · {t.walkIn.repeatWho}</span>
                </span>
              </label>
            ) : null}

            {repeat ? (
              <>
                <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
                  <span style={fieldLabelStyle}>{t.walkIn.repeatDays}</span>
                  <div style={chipRowStyle}>
                    {WEEK_ORDER.map((d) => (
                      <label key={d} style={chipStyle(repeatDays.includes(d))}>
                        <input
                          type="checkbox"
                          checked={repeatDays.includes(d)}
                          onChange={(e) =>
                            setRepeatDays((xs) => (e.target.checked ? [...xs, d] : xs.filter((x) => x !== d)))
                          }
                          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                          disabled={submitting}
                        />
                        {t.days.short[d]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
                  <span style={fieldLabelStyle}>{t.walkIn.repeatCourts}</span>
                  <div style={chipRowStyle}>
                    {venueCourts.map((c) => (
                      <label key={c.id} style={chipStyle(repeatCourts.includes(c.id))}>
                        <input
                          type="checkbox"
                          checked={repeatCourts.includes(c.id)}
                          onChange={(e) =>
                            setRepeatCourts((xs) =>
                              e.target.checked ? [...xs, c.id] : xs.filter((x) => x !== c.id),
                            )
                          }
                          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                          disabled={submitting}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label style={{ ...fieldStyle, marginTop: 12, maxWidth: 220 }}>
                  <span style={fieldLabelStyle}>{t.walkIn.repeatUntil}</span>
                  <input
                    type="date"
                    value={until}
                    min={date}
                    onChange={(e) => setUntil(e.target.value)}
                    style={inputStyle}
                    disabled={submitting}
                  />
                </label>
                <p style={noteTextStyle}>{t.walkIn.repeatHint}</p>
              </>
            ) : null}

            {!repeat ? (
            <>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <label style={{ ...fieldStyle, flex: 1 }}>
                <span style={fieldLabelStyle}>{t.walkIn.price}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={priceStr}
                  onChange={(e) => {
                    setPriceDirty(true);
                    setPriceStr(e.target.value);
                  }}
                  style={inputStyle}
                  disabled={submitting}
                />
              </label>
              <label style={{ ...fieldStyle, flex: 1 }}>
                <span style={fieldLabelStyle}>{t.walkIn.bibs}</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={bibs}
                  onChange={(e) => setBibs(clampQty(e.target.value))}
                  style={inputStyle}
                  disabled={submitting}
                />
              </label>
              <label style={{ ...fieldStyle, flex: 1 }}>
                <span style={fieldLabelStyle}>{t.walkIn.balls}</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={balls}
                  onChange={(e) => setBalls(clampQty(e.target.value))}
                  style={inputStyle}
                  disabled={submitting}
                />
              </label>
            </div>
            {priceStr && !priceValid && <p style={errorTextStyle}>{t.walkIn.priceRange}</p>}

            <p style={previewStyle}>
              {t.walkIn.totalBefore}
              <strong>{eur(totalCents)}</strong>
              {t.walkIn.totalAfter}
              {priceValid && priceCents !== computedBaseCents ? (
                <span style={{ color: tokens.ink3 }}>{t.walkIn.listPrice(eur(computedBaseCents))}</span>
              ) : null}
            </p>
            </>
            ) : null}

            {error && (
              <div role="alert" style={errorBannerStyle}>
                {error}
              </div>
            )}

            <div style={buttonRowStyle}>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                style={secondaryButtonStyle}
              >
                {t.common.close}
              </button>
              {repeat ? (
                <button
                  type="button"
                  onClick={submitRepeat}
                  disabled={!canSubmitRepeat}
                  style={{
                    ...primaryButtonStyle,
                    opacity: canSubmitRepeat ? 1 : 0.5,
                    cursor: canSubmitRepeat ? 'pointer' : 'not-allowed',
                  }}
                >
                  {submitting ? t.walkIn.booking : t.walkIn.repeatBook}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  style={{
                    ...primaryButtonStyle,
                    opacity: canSubmit ? 1 : 0.5,
                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                  }}
                >
                  {submitting ? t.walkIn.booking : t.walkIn.book(eur(totalCents))}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function WalkInCancelButton({
  bookingId,
  bookingCode,
  label,
}: {
  bookingId: string;
  bookingCode: string;
  label?: string;
}) {
  const router = useRouter();
  const t = useCopy();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: fnErr } = await supabase.functions.invoke('create-walk-in-booking', {
        body: { action: 'cancel', booking_id: bookingId },
      });
      if (fnErr) {
        setError(await readEdgeError(fnErr));
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.walkIn.cancelFailed);
    } finally {
      setSubmitting(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} style={triggerButtonStyle}>
        {label ?? t.walkIn.cancel}
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* A completed walk-in can be removed too, so the prompt says what
          it does to the books, not just to the slot. */}
      <span style={{ fontSize: 13, color: tokens.ink2 }}>
        {t.walkIn.removeBefore}
        <span style={monoStyle}>{bookingCode}</span>
        {t.walkIn.removeAfter}
      </span>
      <button
        type="button"
        onClick={cancel}
        disabled={submitting}
        style={{ ...triggerButtonStyle, color: tokens.alertDeep, borderColor: tokens.alertDeep }}
      >
        {submitting ? t.common.removing : t.walkIn.yesRemove}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={submitting}
        style={triggerButtonStyle}
      >
        {t.common.keep}
      </button>
      {error ? <span style={errorTextStyle}>{error}</span> : null}
    </span>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

// hourCycle, not hour12:false — hour12:false can render midnight as '24',
// which would default a just-after-midnight walk-in to 23:00, not 01:00.
function nextFullHourInVenueTz(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VENUE_TZ,
    hourCycle: 'h23',
    hour: '2-digit',
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '18');
  return `${String(Math.min(hour + 1, 23)).padStart(2, '0')}:00`;
}

// The date and time inputs can be mid-edit (empty, or half-typed in a
// browser without a picker); venueWallClockToIso throws on those, and a
// render must not.
function slotHasEnded(date: string, time: string, minutes: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return false;
  try {
    return Date.parse(venueWallClockToIso(date, time)) + minutes * 60_000 <= Date.now();
  } catch {
    return false;
  }
}

function clampQty(v: string): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 50);
}

// ── styles (shared shapes with refund-booking-modal) ─────────────────

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(26,24,20,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 16,
};

const cardStyle: CSSProperties = {
  // The modal renders inside the row's actions cell, which is right-aligned
  // on the phone card layout — without this every line inherits it.
  textAlign: 'left',
  width: '100%',
  maxWidth: 520,
  maxHeight: '90vh',
  overflowY: 'auto',
  background: tokens.surface,
  border: `1px solid ${tokens.line}`,
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 10px 30px rgba(26,24,20,0.18)',
};

// minWidth 0: a flex item otherwise refuses to shrink below its input's
// intrinsic width, which is how the Length select got pushed off the card.
const fieldStyle: CSSProperties = { display: 'block', minWidth: 0 };

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: tokens.ink3,
  marginBottom: 4,
};

const inputStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${tokens.lineBold}`,
  background: tokens.surface,
  color: tokens.ink,
  fontSize: 14,
  fontFamily: 'inherit',
  width: '100%',
};

const monoStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontWeight: 500,
};

const primaryButtonStyle: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: `1px solid ${tokens.primaryDeep}`,
  background: tokens.primary,
  color: '#fff',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const secondaryButtonStyle: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: `1px solid ${tokens.lineBold}`,
  background: 'transparent',
  color: tokens.ink2,
  fontSize: 14,
  cursor: 'pointer',
};

const triggerButtonStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: `1px solid ${tokens.lineBold}`,
  background: 'transparent',
  color: tokens.ink2,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const previewStyle: CSSProperties = {
  marginTop: 14,
  fontSize: 14,
  color: tokens.ink2,
};

const errorBannerStyle: CSSProperties = {
  marginTop: 12,
  padding: '10px 12px',
  borderRadius: 8,
  background: tokens.alertSoft,
  color: tokens.alertDeep,
  fontSize: 14,
};

const errorTextStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 13,
  color: tokens.alertDeep,
};

// Information, not an error — sunDeep is the "worth a second look" ink.
const noteTextStyle: CSSProperties = {
  marginTop: 6,
  marginBottom: 0,
  fontSize: 13,
  color: tokens.sunDeep,
};

const chipRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };

function chipStyle(on: boolean): CSSProperties {
  return {
    position: 'relative',
    padding: '6px 12px',
    borderRadius: 999,
    border: `1px solid ${on ? tokens.primaryDeep : tokens.lineBold}`,
    background: on ? tokens.primarySoft : 'transparent',
    color: on ? tokens.primaryDeep : tokens.ink2,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  };
}

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 16,
};
