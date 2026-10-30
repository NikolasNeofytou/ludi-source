'use client';

import { useMemo, useState } from 'react';

import type { KeepersCopy } from '@/lib/content/types';
import { contactLink, WHATSAPP_NUMBER } from '@/lib/site';
import { tokens } from '@/lib/tokens';

/**
 * The keeper signup.
 *
 * There is no backend and no submit. The fields compose a plain-text message,
 * and the button is an ordinary link that opens the keeper's own WhatsApp — or
 * their mail client while `site.WHATSAPP_NUMBER` is null — with that message
 * already written. They press send themselves.
 *
 * That is deliberate, not a shortcut. docs/plans/site.md rules out a capture
 * backend on this site, and phase 1 of the trial is run by hand in a WhatsApp
 * broadcast (docs/plans/goalkeeper-trial.md §Phasing) — so the thread is
 * exactly where a keeper needs to arrive, and a row in a table nobody reads
 * yet is not. It also means the site never handles a phone number: there is no
 * field for one, because the number arrives with the message.
 *
 * With JavaScript off the controls do nothing, but the button still carries
 * the intro line, so the page never becomes a dead end.
 */
export function KeeperSignup({ copy }: { copy: KeepersCopy }) {
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [level, setLevel] = useState('');
  const [nights, setNights] = useState<string[]>([]);
  const [note, setNote] = useState('');

  // Nights read back in the order they are printed on the page, not the order
  // they happened to be tapped — "Monday, Friday" rather than "Friday, Monday".
  const orderedNights = useMemo(
    () => copy.nights.filter((night) => nights.includes(night.value)).map((night) => night.value),
    [copy.nights, nights],
  );

  const message = useMemo(() => {
    const lines: string[] = [copy.messageIntro, ''];
    const add = (label: string, value: string) => {
      if (value.trim()) lines.push(`${label}: ${value.trim()}`);
    };
    add(copy.messageLabels.name, name);
    add(copy.messageLabels.area, area);
    add(copy.messageLabels.level, level);
    add(copy.messageLabels.nights, orderedNights.join(', '));
    add(copy.messageLabels.note, note);
    // trimEnd keeps the empty state to a single line: the blank after the
    // intro is a separator, and there is nothing yet for it to separate.
    return lines.join('\n').trimEnd();
  }, [copy.messageIntro, copy.messageLabels, name, area, level, orderedNights, note]);

  function toggleNight(value: string) {
    setNights((prev) =>
      prev.includes(value) ? prev.filter((night) => night !== value) : [...prev, value],
    );
  }

  // The name is the only thing that makes the message worth sending. Everything
  // else is genuinely optional — friction on this page costs keepers, and
  // keepers are the scarce side.
  const ready = name.trim().length > 0;
  const sendLabel = WHATSAPP_NUMBER ? copy.sendLabel : copy.sendFallbackLabel;

  return (
    <section className="card" style={{ background: tokens.pitchSoft, marginTop: 56 }}>
      <h2 className="t-section" style={{ color: tokens.pitchDeep }}>
        {copy.formTitle}
      </h2>
      <p className="prose" style={{ fontSize: 15, margin: '10px 0 24px', maxWidth: '40rem' }}>
        {copy.formBody}
      </p>

      <div className="field">
        <label className="field__label" htmlFor="keeper-name">
          {copy.nameLabel}
        </label>
        <input
          id="keeper-name"
          className="field__input"
          type="text"
          autoComplete="name"
          placeholder={copy.namePlaceholder}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="keeper-area">
          {copy.areaLabel}
        </label>
        <input
          id="keeper-area"
          className="field__input"
          type="text"
          placeholder={copy.areaPlaceholder}
          value={area}
          onChange={(event) => setArea(event.target.value)}
        />
      </div>

      <fieldset className="field field--group">
        <legend className="field__label">{copy.levelLabel}</legend>
        <div className="choices">
          {copy.levels.map((option) => (
            <label className="choice" key={option.value}>
              <input
                type="radio"
                name="keeper-level"
                value={option.value}
                checked={level === option.value}
                onChange={() => setLevel(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field field--group">
        <legend className="field__label">{copy.nightsLabel}</legend>
        <p className="field__hint">{copy.nightsHint}</p>
        <div className="chips">
          {copy.nights.map((night) => (
            <label className="chip" key={night.value}>
              <input
                type="checkbox"
                checked={nights.includes(night.value)}
                onChange={() => toggleNight(night.value)}
              />
              <span>{night.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor="keeper-note">
          {copy.noteLabel}
        </label>
        <textarea
          id="keeper-note"
          className="field__input"
          rows={3}
          placeholder={copy.notePlaceholder}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {/* Showing the message back is the whole trust argument made concrete:
       * this, and only this, is what leaves the page — and the keeper is the
       * one who sends it. */}
      <div className="field">
        <span className="field__label">{copy.previewLabel}</span>
        <pre className="preview mono">{message}</pre>
      </div>

      {ready ? (
        <a className="btn btn--wide press" href={contactLink('Ludi — keeper list', message)}>
          {sendLabel} →
        </a>
      ) : (
        <span className="btn btn--wide btn--off" aria-disabled="true">
          {sendLabel} →
        </span>
      )}

      <p style={{ fontSize: 12.5, color: tokens.ink3, margin: '14px 0 0' }}>
        {ready ? copy.sendHint : copy.nameRequiredHint}
      </p>
      <p style={{ fontSize: 12.5, color: tokens.ink3, margin: '6px 0 0' }}>{copy.privacyNote}</p>
    </section>
  );
}
