import Link from 'next/link';

import { CopyLink } from '@/components/copy-link';
import { AppShell, EmptyState, PageHead } from '@/components/ui';
import { requireVenueAccess } from '@/lib/auth';
import { rotateScreenLink } from '@/lib/cfa-actions';
import { getCopy } from '@/lib/copy';
import { qrSvg, screenUrl } from '@/lib/screen-link';
import { createClient } from '@/lib/supabase/server';

// The venue's public screen (plans/cfa-grassroots-saturday.md): one secret
// link that shows the day on the lobby TV and on anyone's phone. Made on
// first visit; a new link retires the old one.

export default async function ScreenPage({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const viewer = await requireVenueAccess();
  const params = await searchParams;
  const t = getCopy(viewer.locale);
  const venue = viewer.venues.find((v) => v.id === params.venue) ?? viewer.venues[0] ?? null;
  if (!venue) {
    return (
      <AppShell viewer={viewer}>
        <PageHead title={t.screen.title} />
        <EmptyState>{t.calendar.noVenue}</EmptyState>
      </AppShell>
    );
  }

  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc('venue_display_token', { p_venue_id: venue.id });
  if (error) throw new Error(`screen: token failed: ${error.message}`);

  const url = await screenUrl(token as string);
  const qr = await qrSvg(url);

  return (
    <AppShell viewer={viewer}>
      <PageHead title={t.screen.title} meta={venue.name} />
      <div className="card stack" style={{ padding: 20, maxWidth: 720 }}>
        <p style={{ margin: 0 }}>{t.screen.intro}</p>
        <div className="screen-qr-row">
          <div className="screen-qr" role="img" aria-label={t.screen.qrAlt} dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="stack" style={{ minWidth: 0 }}>
            <p className="field-hint" style={{ margin: 0 }}>
              {t.screen.qrHint}
            </p>
            <code className="screen-url">{url}</code>
          </div>
        </div>
        <div className="sheet-row">
          <Link href={url} target="_blank" className="btn btn-primary">
            {t.screen.open}
          </Link>
          <CopyLink value={url} label={t.screen.copy} copied={t.screen.copied} />
        </div>
        <ul className="screen-tips">
          <li>{t.screen.tipTv}</li>
          <li>{t.screen.tipPhone}</li>
          <li>{t.screen.tipPrivacy}</li>
        </ul>
        <form action={rotateScreenLink} className="sheet-row">
          <input type="hidden" name="venue_id" value={venue.id} />
          <button type="submit" className="btn btn-secondary">
            {t.screen.rotate}
          </button>
          <span className="field-hint">{t.screen.rotateHint}</span>
        </form>
      </div>
    </AppShell>
  );
}
