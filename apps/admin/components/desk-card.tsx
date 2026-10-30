'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { useCopy, useLocale } from '@/components/locale-provider';
import { Card } from '@/components/ui/primitives';
import { WalkInLauncher, type WalkInPitch } from '@/components/walk-in-modal';
import type { DeskCourt } from '@/lib/booking-request';
import { intlTag } from '@/lib/copy';
import { replyOnWhatsApp, setRequestStatus } from '@/lib/desk-actions';

// One booking request on the desk (ADR-0046): the message as the customer
// wrote it, what it reads as, whether that court is free, and the three
// answers — book it (the ordinary walk-in form, opened on the proposal),
// can't do it, not a booking. Once handled, the card offers the reply:
// from the venue's connected number when the message came that way, from
// the owner's own WhatsApp when it was pasted with a number.

export type DeskItem = {
  id: string;
  source: 'paste' | 'whatsapp';
  sender_name: string | null;
  sender_phone: string | null;
  sender_phone_e164: string | null;
  body: string;
  received_at: string;
  status: 'new' | 'booked' | 'declined' | 'dismissed';
  booking: { code: string; starts_at: string; pitch: { name: string } | null } | null;
  proposal: {
    date: string | null;
    time: string | null;
    minutes: number;
    explicitMinutes: boolean;
    requestedCourtId: string | null;
    requestedTaken: boolean;
    courtId: string | null;
    confidence: 'high' | 'partial' | 'none';
    alternatives: string[];
    when: string | null;
  };
};

const firstName = (name: string | null) => (name ?? '').trim().split(/\s+/)[0] ?? '';

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), template);
}

export function DeskCard({
  item,
  courts,
  pitches,
  venueName,
  connected,
}: {
  item: DeskItem;
  courts: DeskCourt[];
  pitches: WalkInPitch[];
  venueName: string;
  connected: boolean;
}) {
  const d = useCopy().desk;
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [replyState, setReplyState] = useState<'idle' | 'sent' | 'copied' | 'window' | 'failed'>('idle');
  const p = item.proposal;
  const courtName = (id: string | null) => courts.find((c) => c.id === id)?.name ?? '';

  const received = new Intl.DateTimeFormat(intlTag(locale), {
    timeZone: 'Europe/Nicosia',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(item.received_at));

  const act = (status: DeskItem['status'], code: string | null = null) =>
    startTransition(async () => {
      await setRequestStatus(item.id, status, code);
      router.refresh();
    });

  // The reply, written for what happened.
  const bookedWhen = item.booking
    ? new Intl.DateTimeFormat(intlTag(locale), {
        timeZone: 'Europe/Nicosia',
        weekday: 'long',
        day: 'numeric',
        month: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(item.booking.starts_at))
    : '';
  const initialReply =
    item.status === 'booked' && item.booking
      ? fill(d.confirmTemplate, {
          name: firstName(item.sender_name),
          court: item.booking.pitch?.name ?? '',
          when: bookedWhen,
          code: item.booking.code,
          venue: venueName,
        })
      : item.status === 'declined'
        ? fill(d.declineTemplate, {
            name: firstName(item.sender_name),
            when: p.when ?? '',
            alt: p.alternatives.length ? d.altPhrase(p.alternatives.join(', ')) : '',
            venue: venueName,
          })
        : '';
  const [reply, setReply] = useState(initialReply.replace(/\s+—/, ' —').replace(/ {2,}/g, ' '));

  const sendFromVenue = () =>
    startTransition(async () => {
      const res = await replyOnWhatsApp(item.id, reply);
      setReplyState(res.ok ? 'sent' : res.code === 'WINDOW_CLOSED' ? 'window' : 'failed');
    });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reply);
      setReplyState('copied');
    } catch {
      setReplyState('failed');
    }
  };
  const waHref = item.sender_phone_e164
    ? `https://wa.me/${item.sender_phone_e164.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(reply)}`
    : null;

  const proposalLine = () => {
    if (p.confidence === 'none' || !p.date || !p.time) return <span className="fill-muted">{d.noProposal}</span>;
    const parts = [
      p.when,
      p.explicitMinutes ? d.minutes(p.minutes) : null,
      p.courtId ? courtName(p.courtId) : null,
    ].filter(Boolean);
    return (
      <>
        <strong>{parts.join(' · ')}</strong>{' '}
        {p.courtId ? (
          <span className="badge badge-good">
            {p.requestedTaken ? d.otherCourt(courtName(p.courtId)) : d.free}
          </span>
        ) : (
          <span className="badge badge-warn">{d.noneFree}</span>
        )}
        {p.requestedTaken && p.requestedCourtId ? (
          <span className="fill-muted"> {courtName(p.requestedCourtId)} {d.taken}</span>
        ) : null}
        {p.alternatives.length ? (
          <div className="fill-muted">{d.alternatives(p.alternatives.join(', '))}</div>
        ) : null}
      </>
    );
  };

  return (
    <Card>
      <div className={item.status === 'new' ? 'desk-card' : 'desk-card desk-card-handled'}>
        <div className="desk-head">
          <strong>{item.sender_name || item.sender_phone || '—'}</strong>
          {item.sender_name && item.sender_phone ? <span className="fill-muted">{item.sender_phone}</span> : null}
          <span className="badge badge-neutral">{item.source === 'whatsapp' ? d.viaWhatsapp : d.viaPaste}</span>
          <span className="fill-muted desk-when">{received}</span>
        </div>
        <p className="desk-body">{item.body}</p>

        {item.status === 'new' ? (
          <>
            <div className="desk-proposal">
              <span className="field-label">{d.readsAs}</span> {proposalLine()}
              {p.confidence === 'partial' ? <div className="fill-muted">{d.partial}</div> : null}
            </div>
            <div className="fill-actions">
              <WalkInLauncher
                pitches={pitches}
                label={d.book}
                prefill={{
                  pitchId: p.courtId ?? p.requestedCourtId ?? undefined,
                  date: p.date ?? undefined,
                  time: p.time ?? undefined,
                  duration: p.minutes,
                  name: item.sender_name ?? '',
                  phone: item.sender_phone ?? '',
                }}
                onBooked={(code) => act('booked', code)}
              />
              <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => act('declined')}>
                {d.decline}
              </button>
              <button type="button" className="fill-quiet" disabled={pending} onClick={() => act('dismissed')}>
                {d.dismiss}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="desk-proposal">
              <span
                className={
                  item.status === 'booked' ? 'badge badge-good' : item.status === 'declined' ? 'badge badge-warn' : 'badge badge-neutral'
                }
              >
                {item.status === 'booked' && item.booking
                  ? d.statusBooked(item.booking.code)
                  : item.status === 'declined'
                    ? d.statusDeclined
                    : d.statusDismissed}
              </span>{' '}
              <button type="button" className="fill-quiet" disabled={pending} onClick={() => act('new')}>
                {d.undo}
              </button>
            </div>
            {item.status !== 'dismissed' ? (
              <div className="desk-reply">
                <label className="field">
                  <span className="field-label">{d.replyTitle}</span>
                  <textarea className="input fill-message" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
                </label>
                <div className="fill-actions">
                  {item.source === 'whatsapp' && connected ? (
                    <button type="button" className="btn btn-primary" disabled={pending || replyState === 'sent'} onClick={sendFromVenue}>
                      {d.replySend}
                    </button>
                  ) : null}
                  {waHref && !(item.source === 'whatsapp' && connected) ? (
                    <a className="btn btn-primary" href={waHref} target="_blank" rel="noopener noreferrer">
                      {d.replyWa}
                    </a>
                  ) : null}
                  <button type="button" className="btn btn-secondary" onClick={copy}>
                    {replyState === 'copied' ? d.replyCopied : d.replyCopy}
                  </button>
                  {replyState === 'sent' ? <span className="badge badge-good">{d.replySent}</span> : null}
                </div>
                {replyState === 'window' ? <p className="fill-muted">{d.replyWindow}</p> : null}
                {replyState === 'failed' ? <p className="fill-muted">{d.replyFailed}</p> : null}
                {!waHref && item.source === 'paste' ? <p className="fill-muted">{d.replyNoPhone}</p> : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
