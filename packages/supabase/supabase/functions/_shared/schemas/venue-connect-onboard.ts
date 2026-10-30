// _shared/schemas/venue-connect-onboard.ts
// Zod schemas for the venue-connect-onboard contract per docs/api-contract.md §6.4.

import { z } from 'zod';

export const VenueConnectOnboardInput = z.object({
  venue_id: z.string().uuid(),
  // Where Stripe's hosted onboarding sends the user. The admin UI (#30)
  // supplies its own origin; the handler accepts only the admin site's
  // origin (ADMIN_SITE_URL) and defaults to its home page.
  return_url: z.string().url().optional(),
  refresh_url: z.string().url().optional(),
});

export type VenueConnectOnboardInputT = z.infer<typeof VenueConnectOnboardInput>;

export const VenueConnectOnboardOutput = z.object({
  stripe_account_id: z.string(),
  account_link_url: z.string().url(),
  expires_at: z.string().datetime(),
  stripe_account_status: z.enum(['pending', 'active', 'restricted', 'disabled']),
});

export type VenueConnectOnboardOutputT = z.infer<typeof VenueConnectOnboardOutput>;
