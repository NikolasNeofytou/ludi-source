import type { InAppCopy } from '@/lib/content/types';
import { SITE_URL } from '@/lib/site';
import { tokens } from '@/lib/tokens';
import type { InAppBrowser, Platform } from '@/lib/user-agent';

/**
 * One line for a visitor reading the page inside Instagram's or Facebook's
 * own browser (plans/instagram.md IG-4), where the App Store button, the
 * APK download or `ludi://` may not open. The page can't tell whether a tap
 * failed, so the line shows to everyone in there and nowhere else.
 *
 * On Android it also offers an `intent://` link that hands the same page to
 * Chrome. Not yet checked on a phone: the device matrix in the plan is the
 * test.
 */
export function InAppNote({
  copy,
  browser,
  platform,
  path,
}: {
  copy: InAppCopy;
  browser: InAppBrowser;
  platform: Platform;
  /** This page's path and query, e.g. `/el/v/campeone?s=ludi-ig-play`. */
  path: string;
}) {
  if (browser === 'other') return null;
  const app = browser === 'instagram' ? 'Instagram' : 'Facebook';
  const host = new URL(SITE_URL).host;
  const chrome = `intent://${host}${path}#Intent;scheme=https;package=com.android.chrome;end`;

  return (
    <p
      className="mono"
      role="note"
      style={{
        fontSize: 13,
        lineHeight: 1.5,
        color: tokens.ink2,
        margin: '14px 0 0',
        maxWidth: '40rem',
      }}
    >
      {copy.note(app)}
      {platform === 'android' ? (
        <>
          {' '}
          <a href={chrome} style={{ color: tokens.primary, fontWeight: 600 }}>
            {copy.openInChrome} →
          </a>
        </>
      ) : null}
    </p>
  );
}
