// _shared/schemas/booking.ts
// Zod schemas for the create-booking contract.
// Matches docs/api-contract.md §5.1.

import { z } from 'zod';
import { ADDON_PRICES } from '../pricing.ts';

const addonCodeSchema = z.enum(
  Object.keys(ADDON_PRICES) as [keyof typeof ADDON_PRICES, ...Array<keyof typeof ADDON_PRICES>],
);

export const CreateBookingInput = z
  .object({
    pitch_id: z.string().uuid(),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    addons: z
      .array(
        z.object({
          code: addonCodeSchema,
          quantity: z.number().int().positive().max(50),
        }),
      )
      .max(10)
      .default([]),
    notes: z.string().max(500).optional(),
    // C2 W3: a split fixture — the organiser pays their own share now and
    // the invite collects the rest (docs/plans/split-payment.md).
    split: z.boolean().default(false),
    // Community v2: the fixture this booking is "book again"-ed from. The
    // handler verifies the caller stood on that roster and silently drops
    // the link otherwise — it is chain substrate, never a right.
    rebooked_from: z.string().uuid().optional(),
  })
  .superRefine((val, ctx) => {
    const start = Date.parse(val.starts_at);
    const end = Date.parse(val.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return; // .datetime() catches this
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
    // Collapse duplicate addon codes into a single line to prevent ambiguity.
    const seen = new Set<string>();
    for (const a of val.addons) {
      if (seen.has(a.code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `addon code ${a.code} appears more than once; combine into one line`,
          path: ['addons'],
        });
        return;
      }
      seen.add(a.code);
    }
  });

export type CreateBookingInputT = z.infer<typeof CreateBookingInput>;

export const CreateBookingOutput = z.object({
  booking: z.object({
    id: z.string().uuid(),
    code: z.string(),
    state: z.literal('pending'),
    total_cents: z.number().int().positive(),
    is_split: z.boolean(),
    /** Ordinary per-head share; null on a non-split booking. */
    share_amount_cents: z.number().int().positive().nullable(),
  }),
  payment: z.object({
    payment_intent_id: z.string(),
    client_secret: z.string(),
    publishable_key: z.string(),
  }),
});

export type CreateBookingOutputT = z.infer<typeof CreateBookingOutput>;
