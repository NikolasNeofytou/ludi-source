'use client';

import Link from 'next/link';
import { useState } from 'react';

import { FieldError, SubmitButton, useKeptAction } from '@/components/ui/form';
import { enrolCourts } from '@/lib/enrol-actions';
import { formatEur } from '@/lib/format';
import { PITCH_SURFACES, PITCH_TYPES } from '@/lib/schemas';

// Step 2: the courts as a table. Rows live in client state only until the
// save — which is the step (ADR-0031): a refused save keeps every row on
// screen (useKeptAction), and a successful one redirects.
//
// A row can stand for several courts ("Court" × 7 → Court 1 … Court 7),
// and a row can be MADE OF courts named elsewhere on the page — a 7-a-side
// joined from two 5-a-sides (ADR-0032). The names are what the owner says
// at the counter; the action resolves them to rows after it has inserted
// the plain courts.

type Row = {
  key: number;
  name: string;
  type: string;
  surface: string;
  price: string;
  count: number;
  madeOf: string[];
};

export type SavedCourt = {
  id: string;
  name: string;
  type: string;
  surface: string;
  price_per_hour_cents: number;
  made_of?: string[];
};

let nextKey = 1;
const blank = (from?: Partial<Row>): Row => ({
  key: nextKey++,
  name: from?.name ?? '',
  type: from?.type ?? '5-a-side',
  surface: from?.surface ?? 'turf',
  price: from?.price ?? '',
  count: from?.count ?? 1,
  madeOf: from?.madeOf ?? [],
});

// "Court" × 3 → Court 1, Court 2, Court 3 — mirrors expandRow on the server
// so the names offered under "Made of" are the names that will exist.
function expandName(name: string, count: number): string[] {
  if (count === 1) return [name];
  const m = /^(.*?)(\d+)\s*$/.exec(name);
  const base = m ? m[1]!.trimEnd() : name.trim();
  const start = m ? Number(m[2]) : 1;
  return Array.from({ length: count }, (_, k) => `${base} ${start + k}`);
}

export function CourtsTable({
  venueId,
  saved,
}: {
  venueId: string;
  saved: SavedCourt[];
}) {
  const [rows, setRows] = useState<Row[]>(() => [blank({ name: saved.length ? '' : 'Court' })]);
  const { state, pending, onSubmit, fieldErrors } = useKeptAction(enrolCourts);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const duplicate = (key: number) =>
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      const src = rs[i];
      if (!src) return rs;
      const copy = blank({
        type: src.type,
        surface: src.surface,
        price: src.price,
        name: nextName(src.name),
      });
      return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)];
    });
  const remove = (key: number) =>
    setRows((rs) => (rs.length === 1 ? rs : rs.filter((r) => r.key !== key)));
  const toggleMadeOf = (key: number, name: string) =>
    setRows((rs) =>
      rs.map((r) =>
        r.key === key
          ? {
              ...r,
              madeOf: r.madeOf.includes(name)
                ? r.madeOf.filter((n) => n !== name)
                : [...r.madeOf, name],
            }
          : r,
      ),
    );

  // Every plain court a composite could be made of: the ones already saved
  // that are not themselves composites, plus every plain row on this page,
  // expanded by its count.
  const leafNames = [
    ...saved.filter((c) => !c.made_of?.length).map((c) => c.name),
    ...rows.filter((r) => r.madeOf.length === 0 && r.name.trim()).flatMap((r) => expandName(r.name.trim(), r.count)),
  ];

  const err = (i: number, field: string) => fieldErrors[`courts.${i}.${field}`];
  const totalCourts = rows.reduce((n, r) => n + (r.madeOf.length ? 1 : r.count), 0);

  return (
    <div className="stack">
      {saved.length ? (
        <div>
          <p className="form-section">Already saved</p>
          <ul className="enrol-saved">
            {saved.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                <span>
                  {c.type} · {c.surface} · {formatEur(c.price_per_hour_cents)}/h
                  {c.made_of?.length ? ` · made of ${c.made_of.join(' + ')}` : ''}
                </span>
                <Link href={`/pitches/${c.id}/edit`}>Edit</Link>
              </li>
            ))}
          </ul>
          <p className="field-hint">
            Add more below, or{' '}
            <Link href={`/venues/${venueId}/enrol/hours`}>continue to hours</Link>.
          </p>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="stack">
        <input type="hidden" name="venue_id" value={venueId} />

        {state.status === 'error' ? (
          <p role="alert" className="auth-error">
            {state.message}
            {fieldErrors.courts ? ` ${fieldErrors.courts[0]}` : ''}
          </p>
        ) : null}

        <div className="court-head" aria-hidden>
          <span>Court</span>
          <span>Type</span>
          <span>Surface</span>
          <span>€ / hour</span>
          <span>How many</span>
          <span />
        </div>

        {rows.map((r, i) => {
          const composite = r.madeOf.length > 0;
          const options = leafNames.filter((n) => !expandName(r.name.trim(), r.count).includes(n));
          return (
            <div key={r.key} className="court-row">
              <label className="field court-name">
                <span className="field-label">Court</span>
                <input
                  name={`courts[${i}][name]`}
                  className="input"
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  placeholder={composite ? '7v7 A' : 'Court'}
                  maxLength={120}
                  required
                  autoComplete="off"
                />
                <FieldError errors={err(i, 'name')} />
              </label>
              <label className="field">
                <span className="field-label">Type</span>
                <select
                  name={`courts[${i}][type]`}
                  className="input"
                  value={r.type}
                  onChange={(e) => update(r.key, { type: e.target.value })}
                >
                  {PITCH_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <FieldError errors={err(i, 'type')} />
              </label>
              <label className="field">
                <span className="field-label">Surface</span>
                <select
                  name={`courts[${i}][surface]`}
                  className="input"
                  value={r.surface}
                  onChange={(e) => update(r.key, { surface: e.target.value })}
                >
                  {PITCH_SURFACES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <FieldError errors={err(i, 'surface')} />
              </label>
              <label className="field">
                <span className="field-label">€ / hour</span>
                <input
                  name={`courts[${i}][price_per_hour_eur]`}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={r.price}
                  onChange={(e) => update(r.key, { price: e.target.value })}
                  placeholder="60"
                  title="The whole court for one hour, in euros"
                  required
                />
                <FieldError errors={err(i, 'price_per_hour_eur')} />
              </label>
              <label className="field">
                <span className="field-label">How many</span>
                <input
                  name={`courts[${i}][count]`}
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={20}
                  step={1}
                  value={composite ? 1 : r.count}
                  disabled={composite}
                  onChange={(e) =>
                    update(r.key, { count: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })
                  }
                />
                <FieldError errors={err(i, 'count')} />
              </label>
              <div className="court-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => duplicate(r.key)}
                  title="Add a court like this one"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => remove(r.key)}
                  disabled={rows.length === 1}
                  aria-label={`Remove ${r.name || `court ${i + 1}`}`}
                >
                  ×
                </button>
              </div>

              <input type="hidden" name={`courts[${i}][made_of]`} value={r.madeOf.join('|')} />
              <details className="court-made-of" open={composite}>
                <summary>
                  {composite ? `Made of ${r.madeOf.join(' + ')}` : 'Made of other courts?'}
                </summary>
                {options.length === 0 ? (
                  <span className="field-hint">Name the plain courts first, then pick them here.</span>
                ) : (
                  <div className="made-of">
                    {options.map((n) => (
                      <label key={n} className="made-of-option">
                        <input
                          type="checkbox"
                          checked={r.madeOf.includes(n)}
                          onChange={() => toggleMadeOf(r.key, n)}
                        />{' '}
                        {n}
                      </label>
                    ))}
                  </div>
                )}
                <FieldError errors={err(i, 'made_of')} />
              </details>

              {!composite && r.count > 1 && r.name.trim() ? (
                <span className="field-hint court-expansion">
                  → {expandName(r.name.trim(), r.count).join(', ')}
                </span>
              ) : null}
            </div>
          );
        })}

        <div className="filters-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setRows((rs) => [...rs, blank()])}
          >
            Add a court
          </button>
          <SubmitButton
            label={`Save ${totalCourts === 1 ? 'court' : `${totalCourts} courts`} and continue`}
            pending={pending}
          />
        </div>
        <p className="field-hint">
          <strong>€ / hour is the whole court for one hour</strong> — what a
          group pays at the counter for sixty minutes. Owners quote per
          player: × 10 for a 5-a-side (€6 a head → 60), × 14 for a 7-a-side
          (€6 → 84). Whole euros are fine.
        </p>
        <p className="field-hint">
          Courts start unverified and off Discover until the venue&rsquo;s
          payments are set up — that is expected today. A 7-a-side played on
          two 5-a-sides is its own row, <em>made of</em> those two: booking
          it takes both, booking either takes it. No 9-a-side? Enter it as
          the nearest format, or leave it off the app for now.
        </p>
      </form>
    </div>
  );
}

// "Court 2" → "Court 3"; "Main turf" → "Main turf 2". Cheap, and it saves
// retyping the part of the name that doesn't change.
function nextName(name: string): string {
  const m = /^(.*?)(\d+)\s*$/.exec(name);
  if (m) return `${m[1]}${Number(m[2]) + 1}`;
  return name ? `${name} 2` : '';
}
