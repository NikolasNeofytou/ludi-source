// _shared/schemas/venue-express-login.ts
// Zod schemas for venue-express-login per docs/api-contract.md §6.5.

import { z } from 'zod';

export const VenueExpressLoginInput = z.object({
  venue_id: z.string().uuid(),
});

export type VenueExpressLoginInputT = z.infer<typeof VenueExpressLoginInput>;

export const VenueExpressLoginOutput = z.object({
  login_url: z.string().url(),
});

export type VenueExpressLoginOutputT = z.infer<typeof VenueExpressLoginOutput>;
