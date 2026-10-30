'use client';

import { useEffect, useRef } from 'react';

import { useCopy } from '@/components/locale-provider';
import { createClient } from '@/lib/supabase/client';

// Where an email link lands (ADR-0024).
//
// This is a CLIENT page, and that is the whole design note. The obvious
// implementation is a server route handler, and it silently does not work:
// Supabase's default invite and magic-link templates send the browser to
// `…#access_token=…`, and a URL fragment is never transmitted to a server.
// A server route would receive a bare GET, conclude the link was invalid,
// and bounce a perfectly good invite to /login. Verified against the local
// stack 2026-08-29 by following a real invite link and reading the
// Location header.
//
// So all three shapes are handled here, in the browser, where every one of
// them is readable:
//
//   #access_token=…&refresh_token=…   implicit. What the DEFAULT templates
//                                     send, and NOT picked up automatically
//                                     — see the note at that branch.
//   ?code=…                           PKCE. Same-browser only — the
//                                     verifier cookie lives where the link
//                                     was requested.
//   ?token_hash=…&type=…              Device-independent. What the
//                                     templates send IF they are switched
//                                     to {{ .TokenHash }} later; handled
//                                     now so that switch needs no code.
//
// Handling all three means the email templates can be reconfigured — or
// left alone — without this route caring, which is the point: template
// config lives in a dashboard nobody diffs.
//
// @supabase/ssr's browser client writes the session to cookies, so the
// server components on the next navigation see it. No token is ever put
// in a query string by us.

export default function AuthCallbackPage() {
  const t = useCopy().callback;
  // React 18 StrictMode double-invokes effects in dev; a magic-link token is
  // single-use, so the second run would "fail" a link that already worked.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const supabase = createClient();
      const params = new URLSearchParams(window.location.search);

      const providerError =
        params.get('error_description') ?? params.get('error');
      if (providerError) {
        console.error('auth callback: provider error:', providerError);
        window.location.replace('/login?error=link');
        return;
      }

      const code = params.get('code');
      const tokenHash = params.get('token_hash');
      const type = params.get('type');

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error('auth callback: code exchange failed:', error.message);
          // Almost always the cross-device case: the verifier lives in the
          // browser that asked for the link. Naming that specifically stops
          // the owner requesting another link from the same wrong device.
          window.location.replace('/login?error=device');
          return;
        }
      } else if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as 'magiclink' | 'invite' | 'email' | 'recovery',
        });
        if (error) {
          console.error('auth callback: token verify failed:', error.message);
          window.location.replace('/login?error=link');
          return;
        }
      } else {
        // Implicit flow — the shape the DEFAULT templates send.
        //
        // Parsed by hand rather than left to `detectSessionInUrl`, because
        // that does not fire here: @supabase/ssr's browser client runs the
        // PKCE flow, and the PKCE branch looks for `?code=` and ignores
        // fragment tokens entirely. Verified on the local stack 2026-08-29
        // — a real invite fragment arrived intact and no session appeared.
        // setSession is explicit, does not depend on client internals, and
        // cannot regress silently the way an implicit default can.
        const frag = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const accessToken = frag.get('access_token');
        const refreshToken = frag.get('refresh_token');
        if (!accessToken || !refreshToken) {
          console.error('auth callback: no tokens in query or fragment');
          window.location.replace('/login?error=link');
          return;
        }
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          console.error('auth callback: setSession failed:', error.message);
          window.location.replace('/login?error=link');
          return;
        }
      }

      // Drop the tokens out of the address bar before going anywhere — the
      // fragment would otherwise sit in history and in any screenshot.
      window.history.replaceState(null, '', '/auth/callback');

      // A hard navigation, not router.replace(). Two reasons, and the first
      // is not theoretical — this screen was observed stuck on "Signing you
      // in" when a client-side replace raced a re-render. Second, the
      // session was just written to a cookie from the browser; a full load
      // guarantees the server components read it rather than relying on
      // refresh() ordering. This is an owner's first impression of Ludi and
      // it should not be clever.
      window.location.replace('/');
    })();
  }, []);

  return (
    <main className="entry">
      <div className="entry-form-side">
        <div className="entry-form">
          <p className="entry-step">{t.title}</p>
          <p style={{ color: 'var(--ludi-ink2)', fontSize: 14, margin: 0 }}>{t.body}</p>
        </div>
      </div>
    </main>
  );
}
