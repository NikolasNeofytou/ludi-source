// _shared/schemas/invite-owner.ts
// Zod schema for the invite-venue-owner contract (ADR-0024).
// Matches docs/api-contract.md §7.4.

import { z } from 'zod';

export const VENUE_OWNER_ROLES = ['owner', 'manager'] as const;

export const InviteOwnerInput = z.object({
  venue_id: z.string().uuid(),
  // Lowercased here rather than in the handler: the address is used both as
  // the lookup key against auth.users and as the invite destination, and
  // "Ioannis@..." matching nothing while "ioannis@..." matches would be a
  // confusing way to discover case sensitivity.
  email: z.string().trim().toLowerCase().email().max(254),
  owner_role: z.enum(VENUE_OWNER_ROLES).default('owner'),
  // Optional, and worth asking for: the signup trigger reads these from
  // user metadata, so supplying them means the owner shows up by name in
  // the access card instead of as "No name yet".
  first_name: z.string().trim().max(60).optional(),
  last_name: z.string().trim().max(60).optional(),
  // The dashboard's language for the new account (ADR-0037). The signup
  // trigger copies it from the invite metadata into users.preferred_locale
  // — the column's vocabulary ('gr', not 'el'). Greek by default: every
  // owner so far reads Greek, and the switch in the dashboard flips it.
  preferred_locale: z.enum(['en', 'gr']).default('gr'),
  // Emailing an invite to a human who already signed in by phone mints a
  // SECOND auth account — admin_lookup_user_by_email matches on email
  // alone, so nothing else can tell "new manager" from "Ioannis, again".
  // When the venue already has a phone-only owner the function refuses
  // with POSSIBLE_DUPLICATE unless the caller re-sends with this set,
  // asserting the invitee really is a different person.
  confirm_new_person: z.boolean().default(false),
});

export type InviteOwnerInputT = z.infer<typeof InviteOwnerInput>;
