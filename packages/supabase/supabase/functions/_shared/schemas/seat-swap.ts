// _shared/schemas/seat-swap.ts
// Zod schemas for find-my-replacement (ADR-0044): take-seat (a seat whose
// player asked for a replacement, paid on a split fixture) and leave-share
// (giving a paid seat up while the squad is still paying, with the refund).

import { z } from 'zod';

export const TakeSeatInput = z.object({
  invite_token: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, 'invite_token is not a token'),
  // Omitted = whichever seat has waited longest.
  slot_kind: z.enum(['gk', 'outfield']).optional(),
});

export type TakeSeatInputT = z.infer<typeof TakeSeatInput>;

export const LeaveShareInput = z.object({
  booking_id: z.string().uuid(),
});

export type LeaveShareInputT = z.infer<typeof LeaveShareInput>;
