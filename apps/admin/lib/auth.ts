import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';

import { isLocale, type Locale } from '@/lib/copy';
import { createClient } from '@/lib/supabase/server';

// `role` is what the caller is at this venue: 'admin' for a platform
// admin (every venue), otherwise their `venue_owners.role`. A manager runs
// the venue day to day — hours, courts, walk-ins — but the venue's money
// (Stripe onboarding, the payout dashboard) is the owner's alone.
export type VenueRole = 'admin' | 'owner' | 'manager';
export type VenueRef = { id: string; name: string; role: VenueRole };

// Who is looking, and at what.
//
// `isAdmin` is the platform role from `users.role`. `venues` is the scope:
// every venue for an admin, the caller's `venue_owners` rows for an owner.
// An admin who also owns a venue is treated as an admin — the wider scope
// wins, and there is no product reason to make them switch hats.
export type Viewer = {
  user: User;
  isAdmin: boolean;
  venues: VenueRef[];
  // The account's language (ADR-0037): `users.preferred_locale`, read in
  // the same query as the role. Every page renders in it; every server
  // action answers in it.
  locale: Locale;
};

// Server-side guard for an admin-only route. Redirects:
//   - unauthenticated → /login
//   - authenticated non-admin (including a venue owner) → /locked
//
// Returns the same Viewer shape as requireVenueAccess so admin-only pages
// can render the shell without a second round trip. Self-promotion is
// blocked at the DB level by tg_users_block_role_change (see
// packages/supabase/.../20260421000005_rls_policies.sql), so trusting
// users.role as the authoritative admin signal is safe.
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireVenueAccess();
  if (!viewer.isAdmin) redirect('/locked');
  return viewer;
}

// Server-side guard for a route both audiences use (M6 #41d, ADR-0019).
// Redirects:
//   - unauthenticated → /login
//   - signed in but neither admin nor a venue owner → /locked
//
// Per ADR-0019 this guard is navigation and affordance, NOT the security
// boundary — RLS is. Write every page so a bug here leaks nothing the
// caller could not already read with the anon key.
//
// That is a weaker guarantee than it sounds for two tables, and the
// difference matters: `pitches` and `venues` both allow PUBLIC reads of
// their bookable/active rows, so RLS alone would show a venue owner every
// other venue's pitches. Pages listing those MUST filter by
// `viewer.venues` explicitly — see `scopeToViewer()`. `bookings` needs no
// such filter: its policy is self-or-owner-or-admin with no public branch.
export async function requireVenueAccess(): Promise<Viewer> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('role, preferred_locale')
    .eq('id', user.id)
    .maybeSingle<{ role: string; preferred_locale: string }>();
  if (profileError) {
    throw new Error(
      `requireVenueAccess: role lookup failed: ${profileError.message}`,
    );
  }

  const locale: Locale = isLocale(profile?.preferred_locale) ? profile.preferred_locale : 'en';

  if (profile?.role === 'admin') {
    const { data, error } = await supabase
      .from('venues')
      .select('id, name')
      .order('name', { ascending: true });
    if (error) {
      throw new Error(`requireVenueAccess: venue list failed: ${error.message}`);
    }
    const venues = ((data ?? []) as { id: string; name: string }[]).map(
      (v) => ({ ...v, role: 'admin' as const }),
    );
    return { user, isAdmin: true, venues, locale };
  }

  // Not an admin — the scope is whatever venue_owners grants. The policy
  // on that table is `user_id = auth.uid() OR is_admin()`, so this returns
  // the caller's own memberships and nothing else.
  const { data, error } = await supabase
    .from('venue_owners')
    .select('role, venue:venues ( id, name )')
    .eq('user_id', user.id);
  if (error) {
    throw new Error(`requireVenueAccess: ownership lookup failed: ${error.message}`);
  }

  type Membership = {
    role: 'owner' | 'manager';
    venue: { id: string; name: string } | null;
  };
  const venues = ((data ?? []) as unknown as Membership[])
    .filter((row) => Boolean(row.venue))
    .map((row) => ({ ...row.venue!, role: row.role }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (venues.length === 0) redirect('/locked');

  // A grant a venue's owner made starts pending (migration
  // 20261020000101): the venue sees only the address it typed, not this
  // person's own details, until they open the venue here. This is that
  // moment. A no-op once accepted; a failure only keeps the details
  // hidden for one more page load.
  const { error: acceptError } = await supabase.rpc('accept_venue_access');
  if (acceptError) {
    console.warn(`requireVenueAccess: accept_venue_access failed: ${acceptError.message}`);
  }

  return { user, isAdmin: false, venues, locale };
}

// Whether the caller may act on a venue's money — start Stripe
// onboarding, open the payout dashboard. Owners and admins; not managers.
// The Edge Functions behind those buttons enforce the same rule.
export function canManageMoney(viewer: Viewer, venueId: string): boolean {
  if (viewer.isAdmin) return true;
  return viewer.venues.some((v) => v.id === venueId && v.role === 'owner');
}

// Whether the caller is the OWNER of at least one venue — the question the
// nav asks, since ADR-0041 gives a manager a narrower one. A manager runs
// the day; he does not see what the day earned, set a price, or decide who
// else holds a key. Per-venue questions use canManageMoney / the venue's
// own role; this is the "should this nav entry exist at all" version.
export function ownsAnyVenue(viewer: Viewer): boolean {
  return viewer.venues.some((v) => v.role === 'owner');
}

// Venue ids an owner may see, or `null` for an admin (meaning "no filter").
// Pass the result to a PostgREST `.in('venue_id', …)` — see the note on
// requireVenueAccess about why `pitches` and `venues` need this and
// `bookings` does not.
export function scopeToViewer(viewer: Viewer): string[] | null {
  return viewer.isAdmin ? null : viewer.venues.map((v) => v.id);
}
