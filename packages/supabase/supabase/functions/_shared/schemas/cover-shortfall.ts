// _shared/schemas/cover-shortfall.ts
// Zod schemas for cover-shortfall (C2 W4): the organiser closes the gap on
// their own collecting fixture with one payment.

import { z } from 'zod';

export const CoverShortfallInput = z.object({
  booking_id: z.string().uuid(),
});

export type CoverShortfallInputT = z.infer<typeof CoverShortfallInput>;

export const CoverShortfallOutput = z.object({
  booking_id: z.string().uuid(),
  cover_amount_cents: z.number().int().positive(),
  payment: z.object({
    payment_intent_id: z.string(),
    client_secret: z.string(),
    publishable_key: z.string(),
  }),
});

export type CoverShortfallOutputT = z.infer<typeof CoverShortfallOutput>;
