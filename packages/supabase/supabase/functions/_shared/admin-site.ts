// _shared/admin-site.ts
// Where a link Ludi hands out may send someone back to: the admin site,
// and nowhere else. ADMIN_SITE_URL is the same secret invite-venue-owner
// reads; the fallback is the production admin, so a missing secret still
// lands somewhere real.

export const DEFAULT_ADMIN_SITE_URL = 'https://ludi-admin.vercel.app';

/** The admin site's origin (scheme + host + port), from ADMIN_SITE_URL. */
export function adminSiteOrigin(raw: string | undefined = Deno.env.get('ADMIN_SITE_URL')): string {
  try {
    return new URL(raw && raw.trim() ? raw.trim() : DEFAULT_ADMIN_SITE_URL).origin;
  } catch {
    return new URL(DEFAULT_ADMIN_SITE_URL).origin;
  }
}

/** A return URL for a hosted flow (Stripe onboarding): the one requested if
 *  it is on the admin origin, the admin's home page if none was given, and
 *  null — refuse — for anything else. */
export function adminReturnUrl(requested: string | undefined, origin: string): string | null {
  if (requested === undefined) return `${origin}/`;
  let url: URL;
  try {
    url = new URL(requested);
  } catch {
    return null;
  }
  return url.origin === origin ? url.toString() : null;
}
