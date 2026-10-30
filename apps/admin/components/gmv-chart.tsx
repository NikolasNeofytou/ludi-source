// components/gmv-chart.tsx
// Daily bar chart for /gmv and /earnings. Pure SVG + HTML so we avoid
// pulling in a charting library (recharts/Plotly) for what is essentially
// N×60 bars. If the dashboard grows beyond bars + tooltips (axes + zoom +
// brush), revisit the build-vs-buy call.
//
// Phone-first split: the bars live in an SVG stretched to the card
// (preserveAspectRatio="none" — rects don't mind), but every label is HTML
// at a fixed size. The old all-SVG chart scaled its text with the viewBox,
// which put 11-unit axis labels at ~5px on a 375px screen. Per-bar values
// were SVG <title> hover tooltips, which a finger can't summon, so the
// same numbers sit in a collapsible "Daily figures" table under the chart.

import { getCopy, intlTag, type AdminCopy, type Locale } from '@/lib/copy';
import { formatEur } from '@/lib/format';
import { tokens } from '@/lib/tokens';

export type GmvDay = {
  day: string;            // ISO date (YYYY-MM-DD), Europe/Nicosia local
  gross_cents: number;
  refunded_cents: number;
  // What the kept (green) part of the bar shows. /gmv passes the view's
  // gross − refunded; /earnings passes venue_net, which is also after
  // Ludi's fee — and then passes fee_cents so the fee gets its own band.
  net_cents: number;
  fee_cents?: number;
};

type Props = {
  series: GmvDay[];
  height?: number;
  // Name for the kept band when the series carries a fee ('Your earnings',
  // 'To venues'). Without a fee the band is always 'Net'.
  keptLabel?: string;
  // The chart's own words and date/money locale (ADR-0037). /earnings
  // passes the account's; /gmv is the founder's page and takes the
  // English defaults.
  copy?: AdminCopy['earnings']['chart'];
  locale?: Locale;
};

// SVG user units: 960 wide so bar-width clamps read as roughly pixels on a
// laptop; 100 tall so a y value is a percentage.
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 100;

export function GmvChart({
  series,
  height = 200,
  copy = getCopy('en').earnings.chart,
  keptLabel = copy.net,
  locale = 'en',
}: Props) {
  if (series.length === 0) {
    return (
      <div
        style={{
          padding: 48,
          textAlign: 'center',
          color: tokens.ink3,
          fontSize: 14,
        }}
      >
        {copy.empty}
      </div>
    );
  }

  const withFee = series.some((d) => d.fee_cents !== undefined);
  const keptName = withFee ? `${keptLabel}${copy.keptSuffix}` : copy.netHint;

  // y-axis ceiling rounded up to a friendly euro number so gridlines land on
  // round values rather than 1737, 3474, etc.
  const maxGross = Math.max(...series.map((d) => d.gross_cents));
  const yMax = niceCeil(Math.max(1, maxGross));
  const pct = (cents: number) => (cents / yMax) * VIEW_HEIGHT;

  const slot = VIEW_WIDTH / series.length;
  // Clamp bar width: very wide bars on a 7-day view look weird, very narrow
  // ones on a 90-day view become invisible.
  const barW = Math.min(28, Math.max(2, slot * 0.7));

  // 4-step horizontal grid so the eye can read magnitudes without hovering.
  const gridSteps = 4;
  const gridLines = Array.from({ length: gridSteps + 1 }, (_, i) => {
    const value = (yMax * i) / gridSteps;
    return { value, y: VIEW_HEIGHT - pct(value) };
  });

  // Tick density on the x-axis — ~10 dates on a laptop, ~4 on a phone.
  // Every narrow tick is also a wide tick, so the phone just hides the
  // `minor` ones (globals.css, .gmv-tick-minor).
  const wideStride = Math.max(1, Math.ceil(series.length / 10));
  const narrowStride = wideStride * Math.max(1, Math.ceil(10 / 4));

  const activeDays = series.filter((d) => d.gross_cents > 0).reverse();

  return (
    <div className="gmv-chart">
      <div className="gmv-plot" style={{ height }}>
        {gridLines.map((g, i) => (
          <span
            key={i}
            className="gmv-y-label"
            style={{ top: `${(g.y / VIEW_HEIGHT) * 100}%` }}
          >
            {formatEurAxis(g.value)}
          </span>
        ))}
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={withFee ? copy.ariaEarnings : copy.ariaRevenue}
          style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
        >
          {gridLines.map((g, i) => (
            <line
              key={i}
              x1={0}
              x2={VIEW_WIDTH}
              y1={g.y}
              y2={g.y}
              stroke={i === 0 ? tokens.lineBold : tokens.line}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {series.map((d, i) => {
            const x = i * slot + (slot - barW) / 2;
            // Stacked bottom-up: kept, Ludi's fee, refunded. The three add
            // up to gross by the views' definitions.
            const keptH = pct(Math.max(0, d.net_cents));
            const feeH = pct(Math.max(0, d.fee_cents ?? 0));
            const refundH = pct(Math.max(0, d.refunded_cents));
            const tip = barTooltip(d, withFee ? keptLabel : 'net');
            return (
              <g key={d.day}>
                <rect
                  x={x}
                  y={VIEW_HEIGHT - keptH}
                  width={barW}
                  height={keptH}
                  fill={tokens.pitch}
                >
                  <title>{tip}</title>
                </rect>
                {feeH > 0 && (
                  <rect
                    x={x}
                    y={VIEW_HEIGHT - keptH - feeH}
                    width={barW}
                    height={feeH}
                    fill={tokens.primarySoft}
                  >
                    <title>{tip}</title>
                  </rect>
                )}
                {refundH > 0 && (
                  <rect
                    x={x}
                    y={VIEW_HEIGHT - keptH - feeH - refundH}
                    width={barW}
                    height={refundH}
                    fill={tokens.terracotta}
                    fillOpacity={0.85}
                  >
                    <title>{tip}</title>
                  </rect>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="gmv-x" aria-hidden>
        {series.map((d, i) =>
          i % wideStride === 0 ? (
            <span
              key={d.day}
              className={i % narrowStride === 0 ? 'gmv-tick' : 'gmv-tick gmv-tick-minor'}
              style={{ left: `${((i + 0.5) * slot * 100) / VIEW_WIDTH}%` }}
            >
              {formatDayShort(d.day, locale)}
            </span>
          ) : null,
        )}
      </div>

      <div className="gmv-legend">
        <Swatch color={tokens.pitch} label={keptName} />
        {withFee ? <Swatch color={tokens.primarySoft} label={copy.thFee} /> : null}
        <Swatch color={tokens.terracotta} label={copy.thRefunded} />
      </div>

      {activeDays.length > 0 ? (
        <details className="gmv-days">
          <summary>{copy.dailyFigures}</summary>
          <div className="gmv-days-wrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.thDay}</th>
                  <th>{copy.thPaid}</th>
                  <th>{copy.thRefunded}</th>
                  {withFee ? <th>{copy.thFee}</th> : null}
                  <th>{withFee ? keptLabel : copy.net}</th>
                </tr>
              </thead>
              <tbody>
                {activeDays.map((d) => (
                  <tr key={d.day}>
                    <td>{formatDayShort(d.day, locale)}</td>
                    <td>{formatEur(d.gross_cents, locale)}</td>
                    <td>{d.refunded_cents ? formatEur(d.refunded_cents, locale) : '—'}</td>
                    {withFee ? <td>{formatEur(d.fee_cents ?? 0, locale)}</td> : null}
                    <td>{formatEur(d.net_cents, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 10,
          height: 10,
          background: color,
          borderRadius: 2,
          display: 'inline-block',
          flex: 'none',
        }}
      />
      {label}
    </span>
  );
}

// Round up to the next "nice" cents value so axis labels read cleanly.
// e.g. 137c → 200c, 4321c → 5000c, 87654c → 100000c.
function niceCeil(cents: number): number {
  if (cents <= 0) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(cents)));
  const normalized = cents / magnitude;
  const niceNorm =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNorm * magnitude;
}

// '€0', '€250', '€1.5k'. One decimal on the k form — a 200000c ceiling
// puts a gridline at 150000c, which whole-k rounding labelled '€2k'.
function formatEurAxis(cents: number): string {
  if (cents === 0) return '€0';
  if (cents >= 100_000) {
    const k = (cents / 100_000).toLocaleString('en-GB', { maximumFractionDigits: 1 });
    return `€${k}k`;
  }
  return `€${(cents / 100).toFixed(0)}`;
}

// One string, not a set of JSX children. React serialises a multi-child
// text element with separators, and the browser's SVG parser coalesces the
// same content into a single text node on hydration — which is what made
// /gmv (and only /gmv) throw "Hydration failed" on every load.
function barTooltip(d: GmvDay, keptName: string): string {
  const refunded =
    d.refunded_cents > 0 ? ` · refunded ${formatEur(d.refunded_cents)}` : '';
  const fee = d.fee_cents ? ` · Ludi fee ${formatEur(d.fee_cents)}` : '';
  return `${d.day} · paid ${formatEur(d.gross_cents)}${refunded}${fee} · ${keptName} ${formatEur(d.net_cents)}`;
}

function formatDayShort(iso: string, locale: Locale): string {
  // iso = YYYY-MM-DD. Build a Date in UTC and render day+month (“15 May”,
  // “15 Μαΐ”) so the label stays compact in either language.
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(intlTag(locale), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
