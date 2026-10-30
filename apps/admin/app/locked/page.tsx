import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SignOutButton } from '@/components/sign-out-button';
import { getCopy, isLocale } from '@/lib/copy';
import { createClient } from '@/lib/supabase/server';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';

// /locked is where the guards send a signed-in account that may not see the
// page it asked for. Anonymous visitors go to /login instead — there is
// nothing to "lock" for someone who isn't signed in.
//
// Since #41d it has TWO readers, and telling them apart matters:
//
//   1. An account with no access at all — a player who signed in with the
//      wrong number, or an owner whose `venue_owners` row hasn't been
//      created yet (that table is admin-write only per ADR-0019: a venue
//      joins Ludi because the founder signed it).
//   2. A venue owner who DOES have a dashboard and simply asked for an
//      admin-only page like /venues or /gmv.
//
// Reader 2 getting "this account isn't set up yet" would be alarming and
// wrong — they have access, just not to that page. So this page repeats the
// ownership lookup rather than guessing.
export default async function LockedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // `||`, not `??`. GoTrue returns `phone: ''` for an account created by
  // email invite -- an empty string, not null -- so `??` passes it straight
  // through and this page renders "You're signed in as , but...". It stayed
  // hidden while every admin signed in by phone; the first email-invited
  // owner to land here saw the blank (2026-08-30).
  const identifier = user.phone || user.email || user.id;

  // The account's language, read directly: this page renders outside
  // AppShell and the guards, and a signed-in reader has an account to ask.
  const [{ data }, { data: profile }] = await Promise.all([
    supabase.from('venue_owners').select('venue_id').eq('user_id', user.id).limit(1),
    supabase
      .from('users')
      .select('preferred_locale')
      .eq('id', user.id)
      .maybeSingle<{ preferred_locale: string }>(),
  ]);
  const hasDashboard = (data ?? []).length > 0;
  const t = getCopy(isLocale(profile?.preferred_locale) ? profile.preferred_locale : 'en').locked;

  if (hasDashboard) {
    return (
      <main className="centre">
        <h1 style={{ fontSize: 30 }}>{t.teamTitle}</h1>
        <p style={{ margin: 0, color: 'var(--ludi-ink2)', maxWidth: 460 }}>{t.teamBody}</p>
        <Link href="/bookings" className="btn btn-primary">
          {t.backToBookings}
        </Link>
      </main>
    );
  }

  return (
    <main className="centre">
      <h1 style={{ fontSize: 30 }}>{t.noAccessTitle}</h1>
      <p style={{ margin: 0, color: 'var(--ludi-ink2)', maxWidth: 460 }}>
        {t.signedInAs}
        <strong>{identifier}</strong>
        {t.noAccessBody}
        <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
        {t.addYou}
      </p>
      <SignOutButton />
    </main>
  );
}
