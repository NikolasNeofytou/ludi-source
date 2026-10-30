// _shared/cancellation-policy.ts
// Pure refund-amount math for the cancel-booking Edge Function.
//
// The policy table comes from docs/api-contract.md §5.5. Snapshot lives on
// the booking row (`bookings.cancellation_policy`) so mid-booking changes
// to the venue's policy don't surprise the user — see data-model.md.
//
// | Hours to slot | standard | strict | flex |
// |---------------|----------|--------|------|
// | > 24h         | 100%     | 100%   | 100% |
// | 6–24h         | 50%      | 0%     | 100% |
// | <  6h         | 0%       | 0%     | 50%  |
// | kicked off    | —        | —      | —    |
//
// From kickoff on there is nothing to cancel: the game is being played, or
// has been and the hourly cron hasn't yet swept it to `completed`. The
// Edge Function refuses (ALREADY_STARTED, see `cancelBlockedByKickoff`)
// and the math returns 0 for the same instant, so the two can't disagree.
//
// Boundaries: 24 and 6 are inclusive on the lower side ("at exactly 24h
// to slot, you're in the >24h tier"). Stripe rounds amounts to whole
// cents — Math.floor in the user's favour for partial percentages so
// `total - refund >= venue_payout_keep` stays exact.

export type CancellationPolicy = 'standard' | 'strict' | 'flex';

/** State the booking lands in once the cancellation completes. */
export type CancellationTerminalState = 'cancelled' | 'cancelled_no_refund' | 'refunded';

export interface RefundInputs {
  totalCents: number;
  policy: CancellationPolicy;
  /** Hours between now and `bookings.starts_at`. Zero or negative = kicked off. */
  hoursToSlot: number;
}

export interface RefundOutcome {
  refundCents: number;
  /**
   * Where the booking should land. `cancelled` is reserved for `pending`
   * bookings that never reached `paid` — those have no payment to refund
   * and the Edge Function picks the state directly. The math in this file
   * only ever returns `refunded` or `cancelled_no_refund`.
   */
  terminalState: 'refunded' | 'cancelled_no_refund';
}

/** Returns refund percentage in basis points (10_000 = 100%). */
export function refundBpsForPolicy(policy: CancellationPolicy, hoursToSlot: number): number {
  if (hoursToSlot <= 0) return 0; // kicked off
  if (hoursToSlot >= 24) return 10_000;
  if (hoursToSlot >= 6) {
    if (policy === 'standard') return 5_000;
    if (policy === 'strict') return 0;
    return 10_000; // flex
  }
  // 0 < h < 6
  if (policy === 'flex') return 5_000;
  return 0;
}

export function computeRefund(input: RefundInputs): RefundOutcome {
  if (!Number.isFinite(input.totalCents) || input.totalCents <= 0) {
    throw new Error('totalCents must be a positive integer');
  }
  if (!Number.isFinite(input.hoursToSlot)) {
    throw new Error('hoursToSlot must be a finite number');
  }
  const bps = refundBpsForPolicy(input.policy, input.hoursToSlot);
  // Floor in user's favour: prefer rounding the venue's payout up, the
  // user's refund down. Sub-cent rounding errors otherwise compound across
  // many cancellations into a real GMV discrepancy.
  const refundCents = Math.floor((input.totalCents * bps) / 10_000);
  return {
    refundCents,
    terminalState: refundCents > 0 ? 'refunded' : 'cancelled_no_refund',
  };
}

/** Hours-between in floating-point. Edge Function reads `now` from the DB
 *  in production (Date.now() in the runtime is also fine — the policy
 *  table has 6h and 24h boundaries; sub-second drift can't change the
 *  outcome). Exposed as a helper so tests can pin both sides. */
export function hoursBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60);
}

/** Whether kickoff closes the cancellation. Every booking that holds a
 *  player's money — paid, confirmed, a split still collecting — stops being
 *  cancellable at `starts_at`. Only an unpaid `pending` booking may still be
 *  cancelled after it: that releases an open PaymentIntent and refunds
 *  nothing, which is the safe direction. */
export function cancelBlockedByKickoff(state: string, startsAt: Date, now: Date): boolean {
  if (state === 'pending') return false;
  return now.getTime() >= startsAt.getTime();
}
