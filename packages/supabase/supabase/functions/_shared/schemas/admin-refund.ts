// _shared/schemas/admin-refund.ts
// Zod schemas for the admin-refund-booking contract per docs/api-contract.md §7.3.

import { z } from 'zod';

export const AdminRefundInput = z.object({
  booking_id: z.string().uuid(),
  // null = full remaining refund. Positive = partial. The function clamps
  // against (total_cents - already_refunded) at runtime.
  amount_cents: z.number().int().positive().nullable(),
  reason: z.string().min(10).max(500),
});

export type AdminRefundInputT = z.infer<typeof AdminRefundInput>;

export const AdminRefundOutput = z.object({
  booking: z.object({
    id: z.string().uuid(),
    state: z.literal('refunded_by_admin'),
    refund_cents: z.number().int().positive(),
  }),
  admin_action_id: z.string().uuid(),
});

export type AdminRefundOutputT = z.infer<typeof AdminRefundOutput>;
