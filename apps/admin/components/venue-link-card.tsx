import { CopyLink } from '@/components/copy-link';
import { Card } from '@/components/ui/primitives';
import { getCopy } from '@/lib/copy';
import type { Locale } from '@/lib/copy/types';
import { qrSvg, venueUrl } from '@/lib/screen-link';

// The venue's own link (plans/reach.md R1): the address the owner puts in
// the Instagram bio and the QR he prints for the counter. Server-rendered:
// the QR is an inline SVG, crisp on paper, no image request.

export async function VenueLinkCard({
  slug,
  venueName,
  locale,
}: {
  slug: string;
  venueName: string;
  locale: Locale;
}) {
  const t = getCopy(locale).link;
  const url = venueUrl(slug);
  const svg = await qrSvg(url);
  const shown = url.replace(/^https?:\/\//, '');

  return (
    <Card>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="stack" style={{ flex: '1 1 240px', gap: 8 }}>
          <p className="form-section" style={{ marginTop: 0 }}>
            {t.title}
          </p>
          <p className="fill-muted" style={{ margin: 0 }}>
            {t.body(venueName)}
          </p>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, wordBreak: 'break-all' }}>
            {shown}
          </a>
          <div className="filters-actions">
            <CopyLink value={url} label={t.copy} copied={t.copied} />
          </div>
          <p className="field-hint" style={{ margin: 0 }}>
            {t.hint}
          </p>
        </div>
        <div
          role="img"
          aria-label={t.qrAlt(venueName)}
          style={{ width: 132, height: 132, flex: '0 0 auto', background: '#fff', borderRadius: 8, padding: 4 }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </Card>
  );
}
