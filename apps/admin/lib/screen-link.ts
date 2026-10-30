import { headers } from 'next/headers';
import QRCode from 'qrcode';

// The venue's public screen link and its QR code (plans/cfa-grassroots-
// saturday.md). The link is absolute to whatever host served this request,
// so a local run shows a local link and prod shows prod. The QR is an inline
// SVG made on the server: no image request, crisp on a TV and on paper.

export async function screenUrl(token: string): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'ludi-admin.vercel.app';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}/tv/${token}`;
}

// An open fixture's invite on the public site, the link a WhatsApp forward
// carries (ADR-0021). SITE_ORIGIN lets a local run point at a local site.
export function joinUrl(inviteToken: string): string {
  const origin = (process.env.SITE_ORIGIN ?? 'https://ludi.football').replace(/\/$/, '');
  return `${origin}/f/${inviteToken}`;
}

// The venue's own page on the site (plans/reach.md R1).
export function venueUrl(slug: string): string {
  const origin = (process.env.SITE_ORIGIN ?? 'https://ludi.football').replace(/\/$/, '');
  return `${origin}/v/${slug}`;
}

export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#0e242b', light: '#ffffff' },
  });
}
