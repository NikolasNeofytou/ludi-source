import Link from 'next/link';

import { LocaleProvider } from '@/components/locale-provider';
import { LocaleSwitch } from '@/components/locale-switch';
import { SignOutButton } from '@/components/sign-out-button';
import { ShellNav, type NavItem } from '@/components/ui/shell-nav';
import { getCopy, htmlLang } from '@/lib/copy';
import { ownsAnyVenue, type Viewer } from '@/lib/auth';

// The persistent frame every signed-in page renders inside (M6 #41c),
// now role-aware (M6 #41d, ADR-0019) and in the account's language
// (ADR-0037): it re-provides `viewer.locale` over the root layout's guest
// locale, so every client component below reads the account's choice.
//
// The nav is narrower for a venue owner because the admin-only pages are
// genuinely platform-wide: `/venues` carries every venue's take rate and
// Stripe account, and `/gmv` is the platform roll-up. `/earnings` (M6
// #41h) is the venue-dimensioned money view both audiences share — for
// the admin it is the per-venue breakdown /gmv never had.
//
// Hiding a nav item is NOT what keeps an owner out of those routes — the
// pages themselves still call `requireAdmin()`. Per ADR-0019 the nav is
// affordance; the guard is the gate and RLS is the boundary.
export function AppShell({
  viewer,
  children,
}: {
  viewer: Viewer;
  children: React.ReactNode;
}) {
  const t = getCopy(viewer.locale);
  // The day. Everyone with venue access gets these, manager included —
  // they ARE the job (ADR-0041).
  const ownerNav: NavItem[] = [
    { href: '/', label: t.shell.nav.today },
    { href: '/bookings', label: t.shell.nav.bookings },
    { href: '/calendar', label: t.shell.nav.calendar },
    { href: '/pitches', label: t.shell.nav.pitches },
  ];
  // The booking desk (ADR-0046) is the day too; an admin is the processor
  // of these messages and does not read them.
  if (!viewer.isAdmin) ownerNav.splice(3, 0, { href: '/requests', label: t.shell.nav.requests });
  // And the two an owner has that a manager does not. /earnings shows what
  // the venue earned and what Ludi took; /access decides who else holds a
  // key. Both redirect a manager away, and both are gated underneath — the
  // earnings view and venue_payouts are owner-only in the database now, so
  // hiding the entry is affordance, not the boundary (ADR-0019).
  //
  // An admin keeps /earnings — for them it is the per-venue breakdown /gmv
  // never had — but not /access: they have the same list, plus the grant,
  // on /venues/[id]/edit, and here it would mean "every venue".
  const owns = ownsAnyVenue(viewer);
  // Contacts is the owner's list of his regulars (plans/owner-contacts.md);
  // a manager finds them in the booking form and never sees the list, and
  // an admin does not browse venues' customers.
  if (!viewer.isAdmin && owns) {
    ownerNav.push({ href: '/contacts', label: t.shell.nav.contacts });
  }
  if (viewer.isAdmin || owns) {
    ownerNav.push({ href: '/earnings', label: t.shell.nav.earnings });
  }
  if (!viewer.isAdmin && owns) {
    ownerNav.push({ href: '/access', label: t.shell.nav.access });
  }
  const nav = viewer.isAdmin
    ? [
        ...ownerNav,
        { href: '/venues', label: t.shell.nav.venues },
        { href: '/gmv', label: t.shell.nav.revenue },
      ]
    : ownerNav;

  // `lang` on the shell, not only on <html>: the root layout can only know
  // the cookie, and the account may say otherwise. It matters for more than
  // screen readers — `text-transform: uppercase` drops Greek accents only
  // when the element's language is Greek (ΚΡΑΤΗΣΕΙΣ, not ΚΡΑΤΉΣΕΙΣ), which
  // is how every label in the stat tiles and table heads is set.
  const lang = htmlLang(viewer.locale);

  return (
    <LocaleProvider locale={viewer.locale}>
      <header className="shell-bar" lang={lang}>
        <Link href="/" className="shell-brand">
          Ludi
          <span className="shell-scope">{scopeLabel(viewer)}</span>
        </Link>
        <ShellNav items={nav} sectionsLabel={t.shell.sections} />
        <LocaleSwitch />
        <SignOutButton />
      </header>
      <main className="shell-main" lang={lang}>
        {children}
      </main>
    </LocaleProvider>
  );
}

// How the shell names the caller's scope.
function scopeLabel(viewer: Viewer): string {
  const t = getCopy(viewer.locale);
  if (viewer.isAdmin) return t.shell.allVenues;
  const only = viewer.venues.length === 1 ? viewer.venues[0] : undefined;
  if (only) return only.name;
  return t.shell.venuesCount(viewer.venues.length);
}
