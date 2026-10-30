'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { useCopy, useLocale } from '@/components/locale-provider';
import { Card } from '@/components/ui/primitives';
import { intlTag } from '@/lib/copy';
import { markFillSent, setContactOffers } from '@/lib/fill-actions';

// The list behind Fill the hour (ADR-0045). Each row is one regular and one
// link: wa.me with the message already written, opened in the owner's own
// WhatsApp — on his phone the app, on a laptop WhatsApp Web. Ludi sends
// nothing; tapping records that he asked, so the page can say who was.

export type FillCandidate = {
  contact_id: string;
  display_name: string;
  phone_e164: string;
  at_this_hour: number;
  same_court: number;
  here_total: number;
  last_played: string | null;
  sent_at: string | null;
};

type Context = { court: string; when: string; price: string; venue: string };

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function fillMessage(template: string, ctx: Context, name: string): string {
  return template
    .replaceAll('{name}', firstName(name))
    .replaceAll('{court}', ctx.court)
    .replaceAll('{when}', ctx.when)
    .replaceAll('{price}', ctx.price)
    .replaceAll('{venue}', ctx.venue);
}

export function waLink(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(text)}`;
}

export function FillList({
  offerId,
  filled,
  candidates,
  opted,
  context,
}: {
  offerId: string;
  filled: boolean;
  candidates: FillCandidate[];
  opted: { id: string; display_name: string }[];
  context: Context;
}) {
  const f = useCopy().fill;
  const locale = useLocale();
  const router = useRouter();
  // Everything but the name is the same for every message, so the box shows
  // it written out; only {name} changes per person.
  const [template, setTemplate] = useState(() =>
    f.template
      .replaceAll('{court}', context.court)
      .replaceAll('{when}', context.when)
      .replaceAll('{price}', context.price)
      .replaceAll('{venue}', context.venue),
  );
  const [sentNow, setSentNow] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const day = useMemo(
    () => new Intl.DateTimeFormat(intlTag(locale), { day: 'numeric', month: 'short' }),
    [locale],
  );

  const onSend = (c: FillCandidate) => {
    setSentNow((s) => new Set(s).add(c.contact_id));
    startTransition(async () => {
      await markFillSent(offerId, c.contact_id);
      router.refresh();
    });
  };
  const onOpt = (contactId: string, optOut: boolean) => {
    startTransition(async () => {
      await setContactOffers(contactId, optOut, offerId);
      router.refresh();
    });
  };

  return (
    <>
      <Card>
        <label className="field">
          <span className="field-label">{f.messageLabel}</span>
          <textarea
            className="input fill-message"
            rows={5}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <span className="field-hint">{f.messageHint}</span>
        </label>
      </Card>

      <Card>
        <h2 className="fill-title">{f.listTitle}</h2>
        {candidates.length === 0 ? (
          <p className="fill-muted">{f.listEmpty}</p>
        ) : (
          <ul className="fill-list">
            {candidates.map((c) => {
              const sent = Boolean(c.sent_at) || sentNow.has(c.contact_id);
              const facts = [
                c.at_this_hour > 0 ? f.sameEvening(c.at_this_hour) : null,
                c.here_total > 0 ? f.plays(c.here_total) : f.neverPlayed,
                c.last_played ? f.lastPlayed(day.format(new Date(`${c.last_played}T12:00:00Z`))) : null,
              ].filter(Boolean);
              return (
                <li key={c.contact_id} className={sent ? 'fill-row fill-row-sent' : 'fill-row'}>
                  <div className="fill-who">
                    <strong>{c.display_name || c.phone_e164}</strong>
                    <span className="fill-muted">{facts.join(' · ')}</span>
                  </div>
                  <div className="fill-actions">
                    {filled ? null : (
                      <a
                        href={waLink(c.phone_e164, fillMessage(template, context, c.display_name))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={sent ? 'btn btn-secondary' : 'btn btn-primary'}
                        onClick={() => onSend(c)}
                      >
                        {sent ? f.sendAgain : f.send}
                      </a>
                    )}
                    {sent ? <span className="badge badge-good">{f.sent}</span> : null}
                    <button type="button" className="fill-quiet" onClick={() => onOpt(c.contact_id, true)}>
                      {f.optOut}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {opted.length > 0 ? (
        <Card>
          <h2 className="fill-title">{f.optedOutTitle}</h2>
          <p className="fill-muted">{f.optedOutHint}</p>
          <ul className="fill-list">
            {opted.map((o) => (
              <li key={o.id} className="fill-row">
                <div className="fill-who">
                  <strong>{o.display_name}</strong>
                </div>
                <div className="fill-actions">
                  <button type="button" className="fill-quiet" onClick={() => onOpt(o.id, false)}>
                    {f.allowAgain}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
