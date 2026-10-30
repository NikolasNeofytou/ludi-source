'use server';

import { cookies } from 'next/headers';

import { LOCALE_COOKIE, isLocale } from '@/lib/copy';
import { createClient } from '@/lib/supabase/server';

// The switch's action (ADR-0037). Signed in: the account's
// `preferred_locale` (own-row writable; the role trigger fires only on
// `role`). Always: the cookie, so the sign-in page and <html lang> follow
// this browser's last choice. A junk value is ignored, not defaulted — the
// switch only ever sends the two.
export async function setLocale(value: string): Promise<void> {
  if (!isLocale(value)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { error } = await supabase
      .from('users')
      .update({ preferred_locale: value })
      .eq('id', user.id);
    // Logged, not thrown: the cookie still flips the page, and a failed
    // column write is a bug to read in the log, not a reason to leave the
    // owner on the wrong language.
    if (error) console.error('setLocale: users update failed:', error.code, error.message);
  }

  (await cookies()).set(LOCALE_COOKIE, value, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });

  // No revalidatePath (audit C3). It used to end with
  // `revalidatePath('/', 'layout')`, which purges every cached route — and
  // this action needs no sign-in, so anyone could call it in a loop. Nothing
  // here is cached to purge: every page reads the cookie or the account, so
  // all of them render per request. Setting a cookie in an action already
  // re-renders the page it was called from, and the switch then calls
  // router.refresh() (components/locale-switch.tsx).
}
