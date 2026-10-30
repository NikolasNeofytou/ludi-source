'use client';

// A booking on the Calendar, tappable (plans/calendar-manage.md). The cell
// keeps looking like the book; a tap opens the one place to manage it: what
// it is, a comment only the venue sees, and what can be done — remove a
// one-off walk-in, skip one week of a standing booking or stop it repeating.
// App bookings get the comment and a way to Bookings; their money lives there.
// A CFA match gets the match's own actions instead of "remove": moving,
// postponing or cancelling it tells the parents who follow its teams
// (plans/cfa-in-the-app.md K5), which removing the booking would not.

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { useCopy } from '@/components/locale-provider';
import { WalkInCancelButton } from '@/components/walk-in-modal';
import { moveCfaMatch, setCfaMatchStatus, type MatchChange } from '@/lib/cfa-actions';
import { saveBookingNote } from '@/lib/note-actions';
import { endSeries } from '@/lib/series-actions';

export type CalendarBookingInfo = {
  id: string;
  code: string;
  name: string;
  court: string;
  when: string;
  dayKey: string;
  walkIn: boolean;
  seriesId: string | null;
  stateLabel: string | null;
  note: string | null;
  cfa?: {
    matchId: string;
    status: string;
    kickoff: string;
    pitchId: string;
    courts: { id: string; name: string }[];
  } | null;
};

export function CalendarBooking({
  booking,
  className,
  children,
}: {
  booking: CalendarBookingInfo;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`booking-open ${className ?? ''}`}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open && <BookingSheet booking={booking} onClose={() => setOpen(false)} />}
    </>
  );
}

function BookingSheet({ booking, onClose }: { booking: CalendarBookingInfo; onClose: () => void }) {
  const t = useCopy();
  const c = t.calendar;
  const router = useRouter();

  const [note, setNote] = useState(booking.note ?? '');
  const [saved, setSaved] = useState(booking.note ?? '');
  const [saving, setSaving] = useState(false);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);
  const [stopping, setStopping] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [stopMsg, setStopMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  async function save(next: string) {
    setSaving(true);
    setNoteMsg(null);
    const res = await saveBookingNote(booking.id, next);
    setSaving(false);
    if (!res.ok) {
      setNoteMsg(res.message);
      return;
    }
    setNote(res.note ?? '');
    setSaved(res.note ?? '');
    setNoteMsg(res.note ? c.commentSaved : c.commentRemoved);
    router.refresh();
  }

  async function stopRepeating() {
    if (!booking.seriesId) return;
    setStopping('busy');
    const fd = new FormData();
    fd.set('series_id', booking.seriesId);
    fd.set('ends_on', booking.dayKey);
    const res = await endSeries({ status: 'idle' }, fd);
    setStopping('idle');
    setStopMsg({ ok: res.status === 'success', text: 'message' in res ? res.message : '' });
    if (res.status === 'success') router.refresh();
  }

  const dirty = note.trim() !== saved.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-sheet-title"
      className="sheet-overlay"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <h2 id="booking-sheet-title" className="sheet-title">
          {booking.name}
        </h2>
        <p className="sheet-meta">
          {booking.court} · {booking.when} · <span className="mono">{booking.code}</span>
        </p>
        <p className="sheet-tags">
          {booking.cfa ? (
            <span className="badge badge-info">{c.cfaMatch}</span>
          ) : booking.seriesId ? (
            <span className="badge badge-info">{c.repeatsWeekly}</span>
          ) : booking.walkIn ? (
            <span className="badge badge-info">{t.common.walkIn}</span>
          ) : (
            <span className="badge">{c.appBooking}</span>
          )}
          {booking.stateLabel ? <span className="badge badge-warn">{booking.stateLabel}</span> : null}
          {booking.cfa?.status === 'postponed' ? <span className="badge badge-warn">{c.cfaPostponed}</span> : null}
        </p>

        <label className="field">
          <span className="field-label">{c.comment}</span>
          <textarea
            className="input sheet-note"
            value={note}
            maxLength={280}
            rows={3}
            placeholder={c.commentPlaceholder}
            onChange={(e) => setNote(e.target.value)}
            disabled={saving}
          />
          <span className="field-hint">{c.commentPrivate}</span>
        </label>
        <div className="sheet-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => save(note)}
            disabled={saving || !dirty || !note.trim()}
          >
            {saving ? t.common.saving : c.saveComment}
          </button>
          {saved ? (
            <button type="button" className="btn btn-secondary" onClick={() => save('')} disabled={saving}>
              {c.removeComment}
            </button>
          ) : null}
          {noteMsg ? <span className="field-hint">{noteMsg}</span> : null}
        </div>

        {booking.cfa ? (
          <CfaActions cfa={booking.cfa} />
        ) : booking.walkIn ? (
          <div className="sheet-section">
            {booking.seriesId ? (
              <>
                <div className="sheet-row">
                  <WalkInCancelButton bookingId={booking.id} bookingCode={booking.code} label={c.skipWeek} />
                </div>
                <p className="field-hint">{c.skipWeekHint}</p>
                <div className="sheet-row">
                  {stopping === 'confirm' ? (
                    <>
                      <span className="field-hint">{c.stopConfirm(booking.when)}</span>
                      <button type="button" className="btn btn-danger" onClick={stopRepeating}>
                        {c.stopYes}
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => setStopping('idle')}>
                        {t.common.keep}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setStopping('confirm')}
                      disabled={stopping === 'busy'}
                    >
                      {stopping === 'busy' ? t.common.saving : c.stopRepeating}
                    </button>
                  )}
                  <Link href="/standing" className="sheet-link">
                    {c.allStanding}
                  </Link>
                </div>
                {stopMsg ? (
                  <p className={stopMsg.ok ? 'field-hint' : 'field-error'}>{stopMsg.text}</p>
                ) : null}
              </>
            ) : (
              <div className="sheet-row">
                <WalkInCancelButton bookingId={booking.id} bookingCode={booking.code} />
              </div>
            )}
          </div>
        ) : null}

        <div className="sheet-row sheet-foot">
          <Link href={`/bookings?from=${booking.dayKey}&to=${booking.dayKey}`} className="sheet-link">
            {c.openInBookings}
          </Link>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
}

function CfaActions({ cfa }: { cfa: NonNullable<CalendarBookingInfo['cfa']> }) {
  const t = useCopy();
  const c = t.calendar;
  const router = useRouter();
  const [pitchId, setPitchId] = useState(cfa.pitchId);
  const [kickoff, setKickoff] = useState(cfa.kickoff);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(change: Promise<MatchChange>) {
    setBusy(true);
    setMsg(null);
    const res = await change;
    setBusy(false);
    setConfirm(false);
    if (res.ok) {
      setMsg({ ok: true, text: c.cfaTold });
      router.refresh();
      return;
    }
    setMsg({ ok: false, text: res.reason === 'taken' ? c.cfaTaken : res.reason === 'notYours' ? t.cfa.notYours : c.cfaFailed });
  }

  const moved = pitchId !== cfa.pitchId || kickoff !== cfa.kickoff;

  return (
    <div className="sheet-section">
      <span className="field-label">{c.cfaMove}</span>
      <div className="sheet-row">
        <select
          className="input"
          aria-label={c.cfaCourt}
          value={pitchId}
          onChange={(e) => setPitchId(e.target.value)}
          disabled={busy}
        >
          {cfa.courts.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="time"
          aria-label={c.cfaTime}
          value={kickoff}
          onChange={(e) => setKickoff(e.target.value)}
          disabled={busy}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !moved}
          onClick={() => run(moveCfaMatch(cfa.matchId, pitchId, kickoff))}
        >
          {busy ? t.common.saving : c.cfaMoveSave}
        </button>
      </div>
      <div className="sheet-row">
        {cfa.status === 'postponed' ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => run(setCfaMatchStatus(cfa.matchId, 'scheduled'))}
          >
            {c.cfaPutBack}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => run(setCfaMatchStatus(cfa.matchId, 'postponed'))}
          >
            {c.cfaPostpone}
          </button>
        )}
        {confirm ? (
          <>
            <span className="field-hint">{c.cfaCancelConfirm}</span>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => run(setCfaMatchStatus(cfa.matchId, 'cancelled'))}
            >
              {c.cfaCancel}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirm(false)}>
              {t.common.keep}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirm(true)}>
            {c.cfaCancel}
          </button>
        )}
      </div>
      {msg ? <p className={msg.ok ? 'field-hint' : 'field-error'}>{msg.text}</p> : null}
    </div>
  );
}
