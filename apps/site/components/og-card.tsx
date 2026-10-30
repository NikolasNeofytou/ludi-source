import { tokens } from '@/lib/tokens';

/**
 * The link preview for one game or one venue (plans/instagram.md IG-3), as
 * WhatsApp and Instagram DMs draw it: 1200×630, rendered by satori, which
 * supports flexbox only (every container with more than one child needs an
 * explicit `display: flex`).
 *
 * Only what doesn't change goes in: when, where, the format, the venue.
 * Never a seat count or a price (ADR-0055). Previews are cached for days,
 * and the page underneath is where the live count is.
 */
export const OG_SIZE = { width: 1200, height: 630 };

export function OgCard({
  kicker,
  title,
  lines,
  chip,
  url,
}: {
  kicker: string;
  /** One or two big lines (a game: its day, then its time). */
  title: string[];
  lines: string[];
  chip?: string;
  url: string;
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: tokens.primaryDeep,
        padding: '64px 80px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ fontSize: 44, fontWeight: 700, color: '#FFFFFF', letterSpacing: -1 }}>
          Ludi
        </div>
        <div
          style={{
            width: 2,
            height: 34,
            background: tokens.primarySoft,
            opacity: 0.4,
            margin: '0 22px',
          }}
        />
        <div style={{ fontSize: 30, color: tokens.primarySoft, letterSpacing: 1 }}>{kicker}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {title.map((line) => (
          <div
            key={line}
            style={{
              fontSize: line.length > 30 ? 60 : 72,
              fontWeight: 700,
              color: '#FFFFFF',
              lineHeight: 1.1,
              letterSpacing: -2,
              maxWidth: 1040,
            }}
          >
            {line}
          </div>
        ))}
        {lines.map((line) => (
          <div
            key={line}
            style={{ marginTop: 18, fontSize: 38, color: tokens.primarySoft, lineHeight: 1.25 }}
          >
            {line}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 999,
              background: tokens.sun,
              marginRight: 18,
            }}
          />
          <div style={{ fontSize: 30, color: '#FFFFFF' }}>{url}</div>
        </div>
        {chip ? (
          <div
            style={{
              display: 'flex',
              fontSize: 32,
              fontWeight: 700,
              color: tokens.ink,
              background: tokens.sun,
              borderRadius: 999,
              padding: '10px 28px',
            }}
          >
            {chip}
          </div>
        ) : null}
      </div>
    </div>
  );
}
