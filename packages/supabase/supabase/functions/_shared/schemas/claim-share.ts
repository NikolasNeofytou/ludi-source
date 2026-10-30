// _shared/schemas/claim-share.ts
// Zod schemas for the claim-share contract (C2 W3): taking a slot on a
// split fixture costs its share, so joining goes through this Edge
// Function instead of the free join_fixture RPC (ADR-0022's boundary).

import { z } from 'zod';

export const ClaimShareInput = z.object({
  invite_token: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, 'invite_token is not a token'),
  slot_kind: z.enum(['gk', 'outfield']),
});

export type ClaimShareInputT = z.infer<typeof ClaimShareInput>;

export const ClaimShareOutput = z.object({
  booking_id: z.string().uuid(),
  share_amount_cents: z.number().int().positive(),
  payment: z.object({
    payment_intent_id: z.string(),
    client_secret: z.string(),
    publishable_key: z.string(),
  }),
});

export type ClaimShareOutputT = z.infer<typeof ClaimShareOutput>;
