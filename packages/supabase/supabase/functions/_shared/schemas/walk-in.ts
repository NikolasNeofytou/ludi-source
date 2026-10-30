// _shared/schemas/walk-in.ts
// Zod schemas for the create-walk-in-booking contract (M6 #41j).
// Matches docs/api-contract.md §5.6.

import { z } from 'zod';
import { ADDON_PRICES } from '../pricing.ts';

const addonCodeSchema = z.enum(
  Object.keys(ADDON_PRICES) as [keyof typeof ADDON_PRICES, ...Array<keyof typeof ADDON_PRICES>],
);

// Same slot-shape rules as the player path (30 min – 8 h, end after start,
// deduped addon lines): a walk-in is a real booking, and a rule that only
// binds app bookings is a rule the walk-in path will eventually violate.
const CreateWalkIn = z.object({
  action: z.literal('create'),
  pitch_id: z.string().uuid(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  customer_name: z.string().trim().min(1).max(120),
  // Free-form: the owner types what they'd write on paper. Normalisation
  // to digits happens server-side before storage.
  customer_phone: z.string().trim().max(30).optional(),
  // Slice C of plans/owner-contacts.md: the venue contact the counter
  // picked from the typeahead. Optional — typing a new name still works,
  // and the bookings trigger makes the contact from the phone. Carried
  // explicitly because a contact without a usable phone can only be
  // linked by its id. The trigger rejects one from another venue (23514).
  contact_id: z.string().uuid().optional(),
  addons: z
    .array(
      z.object({
        code: addonCodeSchema,
        quantity: z.number().int().positive().max(50),
      }),
    )
    .max(10)
    .default([]),
  // The cash price actually agreed at the desk, replacing the computed
  // base price (addons still priced on top). Bounded so a typo cannot
  // record a €0.01 or €100,000 booking; commission is computed on what
  // was actually charged.
  price_override_cents: z.number().int().min(100).max(500_000).optional(),
});

// Cancel exists so a mis-tap is not a permanent slot block: walk-in money
// never moved through the platform, so undoing one is bookkeeping, not a
// refund. Only origin='walk_in' bookings qualify (enforced server-side).
const CancelWalkIn = z.object({
  action: z.literal('cancel'),
  booking_id: z.string().uuid(),
  reason: z.string().trim().max(200).optional(),
});

// The slot-shape refinements live on the union (discriminatedUnion members
// must be plain ZodObjects, not ZodEffects) and only fire for 'create'.
export const WalkInInput = z
  .discriminatedUnion('action', [CreateWalkIn, CancelWalkIn])
  .superRefine((val, ctx) => {
    if (val.action !== 'create') return;
    const start = Date.parse(val.starts_at);
    const end = Date.parse(val.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ends_at must be after starts_at',
        path: ['ends_at'],
      });
    }
    const durationMinutes = (end - start) / 60_000;
    if (durationMinutes < 30) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'booking must be at least 30 minutes',
        path: ['ends_at'],
      });
    }
    if (durationMinutes > 8 * 60) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'booking must be at most 8 hours',
        path: ['ends_at'],
      });
    }
    const seen = new Set<string>();
    for (const a of val.addons) {
      if (seen.has(a.code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `addon code ${a.code} appears more than once; combine into one line`,
          path: ['addons'],
        });
      }
      seen.add(a.code);
    }
  });

export type WalkInInputT = z.infer<typeof WalkInInput>;
