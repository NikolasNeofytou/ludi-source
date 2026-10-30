// _shared/share-math.ts
// The split-fixture arithmetic (C2, docs/plans/split-payment.md; ADR-0027).
// Pure functions so the Deno tests can walk the money without a database.
//
// The invariant everything else leans on:
//   shareAmountCents * (slots - 1) + organiserShareCents === totalCents
// The organiser absorbs the rounding remainder UPWARD — they pay their own
// share plus at most slots−1 cents. (The first draft had them absorbing
// downward via ceil(), which reads nicer and is broken: for totals small
// relative to the squad, ceil × (slots−1) overshoots the total and the
// organiser's remainder goes negative. The property test caught it; floor
// never breaks for any total ≥ slots.) settle_split_booking() re-asserts
// the sum server-side before any Transfer; this module is where the
// numbers come from in the first place.

/** Ordinary per-head share: floor(total / slots), frozen onto the booking. */
export function shareAmountCents(totalCents: number, slots: number): number {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error('totalCents must be a positive integer');
  }
  if (!Number.isInteger(slots) || slots < 2) {
    throw new Error('slots must be an integer >= 2');
  }
  const share = Math.floor(totalCents / slots);
  if (share < 1) {
    throw new Error(`total ${totalCents} too small to split ${slots} ways`);
  }
  return share;
}

/** The organiser's anchor payment: their share plus the rounding remainder. */
export function organiserShareCents(totalCents: number, slots: number): number {
  const share = shareAmountCents(totalCents, slots);
  const organiser = totalCents - share * (slots - 1);
  if (organiser < share || organiser >= share + slots) {
    // floor() bounds the remainder to [0, slots); the throw is the sum
    // invariant refusing to be quietly wrong if the formula ever changes.
    throw new Error(`organiser share out of range: ${organiser} (share ${share})`);
  }
  return organiser;
}

/**
 * One payer's slice of a policy refund: floor(amount × bps / 10000).
 * Floors, so the fanned-out total never exceeds the policy refund on the
 * booking total — each payer may keep up to one cent that a ceiling would
 * have refunded, and Ludi never refunds more than the policy owes
 * (C2 W5, cancel-booking's confirmed-split branch).
 */
export function proRataCents(amountCents: number, refundBps: number): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('amountCents must be a non-negative integer');
  }
  if (!Number.isInteger(refundBps) || refundBps < 0 || refundBps > 10_000) {
    throw new Error('refundBps must be an integer in [0, 10000]');
  }
  return Math.floor((amountCents * refundBps) / 10_000);
}

/** All shares are due 24h before kickoff (founder decision, 2026-08-29). */
export const COLLECT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The organiser's cover-or-die grace after the deadline (T-24h → T-22h). */
export const COVER_GRACE_MS = 2 * 60 * 60 * 1000;

export function collectDeadline(startsAt: Date): Date {
  return new Date(startsAt.getTime() - COLLECT_WINDOW_MS);
}

/**
 * A split booking needs a real collection window: deadline in the future
 * plus the cover grace, i.e. kickoff at least 26h away. Inside that, the
 * first cut simply refuses ("too close to kickoff to collect") — the
 * compressed clock is on the C2 cut list, not in this version.
 */
export function splitCreatable(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() - now.getTime() >= COLLECT_WINDOW_MS + COVER_GRACE_MS;
}
