// _shared/pricing.ts
// Pure, dependency-free booking-price math. Exported so unit tests can
// exercise every branch without spinning up a DB or Stripe.
//
// Why it lives here and not in Postgres: the numbers travel to Stripe as
// `amount` and `application_fee_amount`, so they have to be computed by
// the same process that calls Stripe. A DB trigger would have to round-trip
// the result back into the Edge Function anyway. Keeping it in one language
// (TS) makes the logic testable and inspectable.

// Addon catalog. `bibs` and `ball_rental` are legally required to be offered
// on every pitch in Cyprus — this is availability, not a product choice.
// Prices are tunable; presence is not.
export const ADDON_PRICES = {
  bibs: 500, // €5.00 per set of bibs
  ball_rental: 300, // €3.00 per ball
} as const;

export type AddonCode = keyof typeof ADDON_PRICES;

export interface AddonLine {
  code: AddonCode;
  quantity: number;
}

export interface PriceInputs {
  startsAt: Date;
  endsAt: Date;
  pricePerHourCents: number;
  addons: readonly AddonLine[];
  takeRateBps: number;
}

export interface PriceBreakdown {
  /** Duration of the booking in minutes (whole minutes). */
  durationMinutes: number;
  /** Base price: pitch rate pro-rated to exact duration, rounded to nearest cent. */
  baseCents: number;
  /** Sum of addon lines: quantity × unit price. */
  addonsCents: number;
  /** baseCents + addonsCents. */
  totalCents: number;
  /** Ludi's commission: totalCents × takeRateBps / 10000, floored. */
  platformFeeCents: number;
}

/** Pure price computation. Throws on inputs that would violate DB constraints. */
export function computeBookingPrice(input: PriceInputs): PriceBreakdown {
  const { startsAt, endsAt, pricePerHourCents, addons, takeRateBps } = input;

  const startMs = startsAt.getTime();
  const endMs = endsAt.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error('starts_at and ends_at must be valid dates');
  }
  if (endMs <= startMs) {
    throw new Error('ends_at must be after starts_at');
  }
  const durationMs = endMs - startMs;
  const durationMinutes = Math.round(durationMs / 60_000);
  if (durationMinutes < 1) {
    throw new Error('booking must be at least 1 minute long');
  }

  if (pricePerHourCents <= 0) throw new Error('pricePerHourCents must be > 0');
  if (takeRateBps < 0 || takeRateBps > 10_000) {
    throw new Error('takeRateBps out of range (0..10000)');
  }

  // Pro-rate to the exact duration. Round to nearest cent; banks and Stripe
  // both deal in integer cents, so we never let a fraction of a cent escape.
  const baseCents = Math.round((pricePerHourCents * durationMinutes) / 60);
  if (baseCents <= 0) throw new Error('computed baseCents must be > 0');

  let addonsCents = 0;
  for (const line of addons) {
    if (!(line.code in ADDON_PRICES)) {
      throw new Error(`unknown addon code: ${line.code}`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`addon quantity must be a positive integer (${line.code})`);
    }
    addonsCents += ADDON_PRICES[line.code] * line.quantity;
  }

  const totalCents = baseCents + addonsCents;
  // Floor the fee in the user's favour — the venue is the beneficiary of any
  // sub-cent rounding. Keeps `total - fee >= venue_payout` exact.
  const platformFeeCents = Math.floor((totalCents * takeRateBps) / 10_000);

  return { durationMinutes, baseCents, addonsCents, totalCents, platformFeeCents };
}
