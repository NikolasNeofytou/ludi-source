// _shared/schemas/cancellation.ts
// Zod schemas for the cancel-booking contract per docs/api-contract.md §5.5.

import { z } from 'zod';

export const CancelBookingInput = z.object({
  booking_id: z.string().uuid(),
});

export type CancelBookingInputT = z.infer<typeof CancelBookingInput>;

export const CancelBookingOutput = z.object({
  booking: z.object({
    id: z.string().uuid(),
    state: z.enum(['cancelled', 'cancelled_no_refund', 'refunded']),
    cancellation_refund_cents: z.number().int().nonnegative(),
  }),
});

export type CancelBookingOutputT = z.infer<typeof CancelBookingOutput>;
