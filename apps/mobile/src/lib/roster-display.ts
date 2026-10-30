// Roster display helpers. Extracted from the fixture screen when the seat
// sheet became its own route and needed the same avatar colour and name
// fallback — two copies would drift the moment one of them gained a case.

import type { RosterEntry } from '@/lib/fixture';

const AVATAR_COLORS = [
  '#4E6E7A',
  '#7A5E4E',
  '#4E7A5E',
  '#6E4E7A',
  '#7A6E4E',
  '#4E5E7A',
  '#7A4E5E',
  '#2F6B57',
];

export function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i += 1) h = (h * 31 + userId.charCodeAt(i)) % 100_000;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

// `first_name` is NOT NULL on `users` and defaults to the empty string, so a
// player who has never opened their profile comes back as '' rather than
// null — `?? ` sails straight past it and the seat renders nameless. Found
// on the simulator against seed rows in exactly that state.
export function rosterName(p: RosterEntry): string {
  return p.first_name?.trim() || p.handle?.trim() || '—';
}
