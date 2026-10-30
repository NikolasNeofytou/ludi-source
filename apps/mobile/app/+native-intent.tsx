// Incoming links, before the router sees them (plans/release-1-0.md E1).
//
// Only the pages that are meant to arrive from outside the app open from a
// link: an invite (/f/<token>), a venue (/v/<slug>, /venue/<id>), the
// sign-in callback and Stripe's return. Anything else — a booking, a
// checkout, a team sheet — lands on the home screen. Those screens read
// their parameters from the URL, so a link that reached them could start a
// checkout or put a link-writer's text on a Ludi screen (security audit
// 2026-10-19). Inside the app they are reached by tapping, never by a link.
//
// The site serves Greek pages under /el/ — /el/f/<token> for an invite,
// /el/v/<slug> for a venue — and the AASA file claims /el/f/* already (and
// /el/v/* once the store build is out). The app has one route per page, not
// one per language, so the language prefix is dropped here: the app speaks
// the user's language on its own.
//
// A magic link arrives as https://ludi.football/auth/callback/<nonce>?…
// (older emails: ludi://callback?…) and is sent to the one callback route;
// the screen reads the full URL from src/lib/auth-callback.ts, which saw it
// before this function did.

const SITE = /^https?:\/\/(?:www\.)?ludi\.football(?=[/?#]|$)/i;
const SCHEME = /^ludi:\/\//i;

const CALLBACK = /^(?:auth\/)?callback(?:[/?#]|$)/;
const EXTERNAL = /^(?:f\/[^/?#]+|v\/[^/?#]+|venue\/[^/?#]+|stripe-redirect)\/?(?:[?#]|$)/;

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    // ludi://f/x, https://ludi.football/f/x and /f/x are all "f/x". A link
    // for any other scheme or host is not ours to open.
    let rest: string;
    if (SITE.test(path)) rest = path.replace(SITE, '');
    else if (SCHEME.test(path)) rest = path.replace(SCHEME, '');
    else if (path.startsWith('/')) rest = path;
    else return '/';
    rest = rest.replace(/^\/+/, '').replace(/^el\/(?=[fv]\/)/, '');

    if (CALLBACK.test(rest)) return '/callback';
    if (EXTERNAL.test(rest)) return `/${rest}`;
    return '/';
  } catch {
    return '/';
  }
}
