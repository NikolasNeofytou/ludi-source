'use client';

// The CFA round loader (plans/cfa-grassroots-saturday.md). Read the CFA's
// .xlsx in the browser, keep the rows for this venue, propose a court for
// each, let the owner change anything, then put the Saturday in the book.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import readXlsxFile, { readSheetNames } from 'read-excel-file';

import { useCopy } from '@/components/locale-provider';
import { loadCfaRound, type LoadResult } from '@/lib/cfa-actions';
import {
  proposeKeeping,
  rowsFromSheet,
  teamKey,
  type Busy,
  type CfaFormat,
  type CfaRow,
  type LoaderCourt,
} from '@/lib/cfa';
import { parseEurosToCents } from '@/lib/format';

type Match = {
  include: boolean;
  kickoff: string;
  category: string;
  home: string;
  away: string;
  homeCategory: string;
  awayCategory: string;
  homeGroup: string;
  awayGroup: string;
  format: CfaFormat;
  pitchId: string;
};

// A match on the day is its two teams, each with its group: the same two
// academies can meet twice in a morning, in two groups.
const matchKey = (m: { category: string; home: string; homeGroup: string; away: string; awayGroup: string }) =>
  [m.category, m.home, m.homeGroup, m.away, m.awayGroup].map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim()).join('|');

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-ZΑ-Ω0-9]/g, '');

export function CfaLoader({
  venueId,
  venueName,
  day,
  courts,
  busy,
  alreadyLoaded,
  existing,
  teamKeys,
  defaultPriceCents,
}: {
  venueId: string;
  venueName: string;
  day: string;
  courts: LoaderCourt[];
  busy: Busy[];
  alreadyLoaded: number;
  existing: { category: string; home: string; homeGroup: string; away: string; awayGroup: string; pitchId: string }[];
  teamKeys: string[];
  defaultPriceCents: number;
}) {
  const t = useCopy();
  const c = t.cfa;
  const router = useRouter();

  const [date, setDate] = useState(day);
  const [round, setRound] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [priceStr, setPriceStr] = useState((defaultPriceCents / 100).toFixed(2));
  const [fileRows, setFileRows] = useState<CfaRow[]>([]);
  const [fileVenue, setFileVenue] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [awayRows, setAwayRows] = useState<CfaRow[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<LoadResult | null>(null);

  const venues = useMemo(() => [...new Set(fileRows.map((r) => r.venue).filter(Boolean))].sort(), [fileRows]);
  // A match already on a court keeps it (a re-load is a diff, not a redo).
  const onCourt = useMemo(() => new Map(existing.map((e) => [matchKey(e), e.pitchId])), [existing]);
  const ours = useMemo(() => new Set(teamKeys), [teamKeys]);

  function pick(rows: CfaRow[], venue: string) {
    const kept = rows.filter((r) => !venue || r.venue === venue);
    // The rest of the file: the away matches of the teams that play here.
    setAwayRows(
      venue
        ? rows.filter(
            (r) =>
              r.venue !== venue &&
              r.category &&
              (ours.has(teamKey(r.home, r.homeCategory, r.homeGroup)) ||
                ours.has(teamKey(r.away, r.awayCategory, r.awayGroup))),
          )
        : [],
    );
    const base = kept.map<Match>((r) => ({
      include: true,
      kickoff: r.kickoff,
      category: r.category,
      home: r.home,
      away: r.away,
      homeCategory: r.homeCategory,
      awayCategory: r.awayCategory,
      homeGroup: r.homeGroup,
      awayGroup: r.awayGroup,
      format: r.format,
      pitchId: onCourt.get(matchKey({ ...r, homeGroup: r.homeGroup, awayGroup: r.awayGroup })) ?? '',
    }));
    const proposed = proposeKeeping(base, courts, busy, minutes);
    setMatches(base.map((m, i) => ({ ...m, pitchId: proposed[i] ?? '' })));
    const withDate = kept.find((r) => r.date);
    if (withDate?.date) setDate(withDate.date);
    const withRound = kept.find((r) => r.round);
    if (withRound?.round) setRound(`${c.roundWord} ${withRound.round}`);
    setResult(null);
  }

  async function onFile(file: File) {
    setReadError(null);
    try {
      const names = await readSheetNames(file);
      let rows: CfaRow[] = [];
      for (const name of names) {
        rows = rowsFromSheet(await readXlsxFile(file, { sheet: name }));
        if (rows.length) break;
      }
      if (!rows.length) {
        setReadError(c.noRowsInFile);
        return;
      }
      setFileRows(rows);
      const all = [...new Set(rows.map((r) => r.venue).filter(Boolean))];
      const mine = norm(venueName.split(' ')[0] ?? venueName);
      const guess = all.find((v) => norm(v).includes(mine)) ?? '';
      setFileVenue(guess);
      pick(rows, guess);
    } catch (err) {
      console.error(err);
      setReadError(c.unreadable);
    }
  }

  function update(i: number, patch: Partial<Match>) {
    setMatches((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  }

  function reproposeAll() {
    const fresh = matches.map((m) => ({ ...m, pitchId: onCourt.get(matchKey(m)) ?? '' }));
    const proposed = proposeKeeping(fresh, courts, busy, minutes);
    setMatches(fresh.map((m, i) => ({ ...m, pitchId: proposed[i] ?? '' })));
  }

  const priceCents = parseEurosToCents(priceStr);
  const ready = matches.filter((m) => m.include && m.pitchId && m.kickoff && m.home && m.away && m.category);
  const canSave = !saving && ready.length > 0 && priceCents !== null && priceCents >= 1;

  async function save() {
    if (!canSave || priceCents === null) return;
    setSaving(true);
    const sent = matches.filter((m) => m.include && m.pitchId);
    const res = await loadCfaRound({
      venueId,
      date,
      round,
      matches: [
        ...sent.map((m) => ({
          pitch_id: m.pitchId,
          kickoff: m.kickoff,
          minutes,
          category: m.category,
          home: m.home,
          away: m.away,
          home_category: m.homeCategory || m.category,
          away_category: m.awayCategory || m.category,
          home_group: m.homeGroup,
          away_group: m.awayGroup,
          price_cents: priceCents,
        })),
        ...awayRows.map((r) => ({
          elsewhere: r.venue,
          kickoff: r.kickoff,
          category: r.category,
          home: r.home,
          away: r.away,
          home_category: r.homeCategory,
          away_category: r.awayCategory,
          home_group: r.homeGroup,
          away_group: r.awayGroup,
        })),
      ],
    });
    setSaving(false);
    if (res.ok) {
      // Skipped indexes point into what was sent; say which rows (an away
      // row the database skips is not one of the owner's rows).
      res.skipped = res.skipped
        .filter((s) => s.index < sent.length)
        .map((s) => ({ ...s, index: matches.indexOf(sent[s.index]!) }));
      router.refresh();
    }
    setResult(res);
  }

  const courtName = new Map(courts.map((x) => [x.id, x.name]));
  const skippedAt = new Map(result && result.ok ? result.skipped.map((s) => [s.index, s.reason]) : []);

  return (
    <div className="stack">
      <div className="card" style={{ padding: 16 }}>
        <p className="field-hint" style={{ marginTop: 0 }}>
          {c.intro}
        </p>
        <div className="cfa-grid">
          <label className="field">
            <span className="field-label">{c.file}</span>
            <input
              className="input"
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>
          {venues.length ? (
            <label className="field">
              <span className="field-label">{c.venueInFile}</span>
              <select
                className="input"
                value={fileVenue}
                onChange={(e) => {
                  setFileVenue(e.target.value);
                  pick(fileRows, e.target.value);
                }}
              >
                <option value="">{c.allVenues}</option>
                {venues.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span className="field-label">{c.date}</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{c.round}</span>
            <input
              className="input"
              value={round}
              maxLength={40}
              placeholder={c.roundPlaceholder}
              onChange={(e) => setRound(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">{c.minutes}</span>
            <select className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[50, 60, 70, 75, 90].map((m) => (
                <option key={m} value={m}>
                  {t.common.minutes(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{c.price}</span>
            <input className="input" inputMode="decimal" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} />
          </label>
        </div>
        {readError ? <p className="field-error">{readError}</p> : null}
        {alreadyLoaded > 0 ? <p className="field-hint">{c.alreadyLoaded(alreadyLoaded)}</p> : null}
        {awayRows.length > 0 ? <p className="field-hint">{c.awayHint(awayRows.length)}</p> : null}
      </div>

      {matches.length ? (
        <div className="card calendar-card" style={{ padding: 0 }}>
          <div className="calendar-scroll">
            <table className="cfa-table">
              <thead>
                <tr>
                  <th />
                  <th>{c.colTime}</th>
                  <th>{c.colCategory}</th>
                  <th>{c.colHome}</th>
                  <th>{c.colAway}</th>
                  <th>{c.colFormat}</th>
                  <th>{c.colCourt}</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m, i) => {
                  const reason = skippedAt.get(i);
                  return (
                    <tr key={i} className={m.include ? (reason ? 'cfa-skipped' : '') : 'cfa-off'}>
                      <td>
                        <input
                          type="checkbox"
                          checked={m.include}
                          aria-label={c.include}
                          onChange={(e) => update(i, { include: e.target.checked })}
                        />
                      </td>
                      <td>
                        <input className="input" type="time" value={m.kickoff} onChange={(e) => update(i, { kickoff: e.target.value })} />
                      </td>
                      <td>
                        <input className="input" value={m.category} maxLength={40} onChange={(e) => update(i, { category: e.target.value })} />
                      </td>
                      <td>
                        <input className="input" value={m.home} maxLength={120} onChange={(e) => update(i, { home: e.target.value })} />
                      </td>
                      <td>
                        <input className="input" value={m.away} maxLength={120} onChange={(e) => update(i, { away: e.target.value })} />
                      </td>
                      <td className="mono">{m.format ? `${m.format}×${m.format}` : c.notFutsal}</td>
                      <td>
                        <select className="input" value={m.pitchId} onChange={(e) => update(i, { pitchId: e.target.value })}>
                          <option value="">{c.noCourt}</option>
                          {courts.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                        {reason ? <span className="field-error">{c.skipReason(reason)}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="sheet-row">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            setMatches((ms) => [
              ...ms,
              {
                include: true,
                kickoff: '09:00',
                category: '',
                home: '',
                away: '',
                homeCategory: '',
                awayCategory: '',
                homeGroup: '',
                awayGroup: '',
                format: 5,
                pitchId: '',
              },
            ])
          }
        >
          {c.addMatch}
        </button>
        {matches.length ? (
          <button type="button" className="btn btn-secondary" onClick={reproposeAll}>
            {c.propose}
          </button>
        ) : null}
        <button type="button" className="btn btn-primary" onClick={save} disabled={!canSave}>
          {saving ? t.common.saving : c.put(ready.length)}
        </button>
      </div>

      {result ? (
        result.ok ? (
          <div className="card" style={{ padding: 16 }}>
            <p style={{ margin: 0 }}>{c.done(result)}</p>
            {result.skipped.length ? <p className="field-error">{c.skippedCount(result.skipped.length)}</p> : null}
            <div className="sheet-row">
              <Link className="btn btn-primary" href={`/calendar/cfa/programme?venue=${venueId}&day=${date}`}>
                {c.programme}
              </Link>
              <Link className="btn btn-secondary" href={`/calendar?venue=${venueId}&view=day&day=${date}`}>
                {t.calendar.title}
              </Link>
            </div>
          </div>
        ) : (
          <p className="field-error">{result.message}</p>
        )
      ) : null}
      <p className="field-hint">
        {c.courtsHint(courts.filter((x) => x.units.length > 1).map((x) => courtName.get(x.id) ?? '').join(', ') || '—')}
      </p>
    </div>
  );
}
