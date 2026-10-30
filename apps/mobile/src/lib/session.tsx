// Session provider — Supabase auth state as React context.
// Mounts once at the root, listens to onAuthStateChange so any UI can react
// to sign-in / sign-out / token refresh without re-fetching the session.

import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { capture, identifyUser, resetAnalytics } from './analytics';
import { endSignIn } from './pending-sign-in';
import { unregisterPushToken } from './push';
import { syncConsentToSupabase } from './consent';
import { setSentryUser } from './sentry';
import { supabase } from './supabase';

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // Stays true until the persisted-session rehydration completes. The auth
  // gate uses this to avoid flashing the signin screen on cold reopen.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setSentryUser(data.session?.user.id ?? null);
      if (data.session?.user.id) identifyUser(data.session.user.id);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      // Tag the opaque user id on Sentry (id only — never PII; see ADR-0010).
      setSentryUser(sess?.user.id ?? null);
      // PostHog identity — UUID only, consent-gated (ADR-0011 / analytics.ts).
      if (sess?.user.id) identifyUser(sess.user.id);
      else resetAnalytics();
      // auth_completed: a genuine sign-in (SIGNED_IN) — not cold-start
      // rehydration (INITIAL_SESSION) or token refresh. Covers all 4 methods.
      if (event === 'SIGNED_IN' && sess?.user) {
        // Whatever finished it, the sign-in this phone was waiting for is
        // over: a link that arrives later finds nothing to complete.
        void endSignIn();
        const provider = sess.user.app_metadata?.provider;
        const method =
          provider === 'apple'
            ? 'apple'
            : provider === 'google'
              ? 'google'
              : provider === 'email'
                ? 'magic_link'
                : 'phone';
        const created = new Date(sess.user.created_at).getTime();
        const last = sess.user.last_sign_in_at ? new Date(sess.user.last_sign_in_at).getTime() : created;
        capture('auth_completed', { method, is_new_user: Math.abs(created - last) < 10_000 });
      }
      // Best-effort: after every signin / token-refresh, push the local
      // GDPR consent record into auth.users.raw_user_meta_data so the
      // server has an audit copy. Never throws (see consent.ts).
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        void syncConsentToSupabase();
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    // The device's push token goes first, while the session can still
    // vouch for it (plans/reach.md R2): a signed-out phone is nobody's.
    await unregisterPushToken();
    await supabase.auth.signOut();
  }, []);

  return (
    <SessionContext.Provider value={{ session, loading, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used inside <SessionProvider>');
  }
  return { ...ctx, isAuthed: !!ctx.session };
}
