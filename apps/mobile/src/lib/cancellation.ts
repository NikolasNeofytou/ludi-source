// Cancellation client (M3 #12). Wraps the cancel-booking Edge Function and
// mirrors the server's refund-policy math so the UI can show "you'll get
// €X back" before the user confirms.
//
// Contract: docs/api-contract.md §5.5.
// Edge Function: packages/supabase/supabase/functions/cancel-booking/index.ts.
// Server-side math is the source of truth — preview is a hint, not a contract.
// If they diverge by ≥€1 on confirm, we log a warning but still trust the
// server's number for what we render.

import { randomUUID } from 'expo-crypto';

import { supabase } from './supabase';

export type CancellationPolicy = 'standard' | 'strict' | 'flex';

export type CancellationTerminalState =
  | 'cancelled'
  | 'cancelled_no_refund'
  | 'refunded';

// Mirrors _shared/cancellation-policy.ts. Boundary tests on the server
// exercise the full table; if the table changes there, change it here.
//
// | Hours to slot | standard | strict | flex |
// |---------------|----------|--------|------|
// | >= 24h        | 100%     | 100%   | 100% |
// | 6h–24h        | 50%      | 0%     | 100% |
// | <  6h         | 0%       | 0%     | 50%  |
export function refundBpsForPolicy(
  policy: CancellationPolicy,
  hoursToSlot: number,
): number {
  if (hoursToSlot >= 24) return 10_000;
  if (hoursToSlot >= 6) {
    if (policy === 'standard') return 5_000;
    if (policy === 'strict') return 0;
    return 10_000; // flex
  }
  if (policy === 'flex') return 5_000;
  return 0;
}

export interface RefundPreview {
  refundCents: number;
  refundBps: number;
  hoursToSlot: number;
  terminalState: 'refunded' | 'cancelled_no_refund';
}

export function computePreviewRefund(args: {
  totalCents: number;
  policy: CancellationPolicy;
  startsAt: Date;
  now?: Date;
}): RefundPreview {
  const now = args.now ?? new Date();
  const hoursToSlot = (args.startsAt.getTime() - now.getTime()) / (1000 * 60 * 60);
  const bps = refundBpsForPolicy(args.policy, hoursToSlot);
  // Floor in user's favour, matches server. Sub-cent rounding errors otherwise
  // compound across many cancellations into a real GMV discrepancy.
  const refundCents = Math.floor((args.totalCents * bps) / 10_000);
  return {
    refundCents,
    refundBps: bps,
    hoursToSlot,
    terminalState: refundCents > 0 ? 'refunded' : 'cancelled_no_refund',
  };
}

// `pending` bookings have no charge to refund — the Edge Function treats them
// specially (PaymentIntent cancel, no Stripe refund call). UI still surfaces
// a Cancel CTA so the slot frees immediately rather than waiting for the
// 15-min cleanup cron.
const CANCELLABLE_STATES: ReadonlySet<string> = new Set([
  'pending',
  'paid',
  'confirmed',
  // C2 W6: a split fixture mid-collection — cancelling refunds every paid
  // share 100% (nothing has reached the venue yet, ADR-0027).
  'collecting',
]);

export function isCancellable(state: string): boolean {
  return CANCELLABLE_STATES.has(state);
}

// The four states that mean "this match is not happening". Enumerated rather
// than derived as "everything that is not cancellable", because that
// complement quietly includes `completed` — a match that WAS played — and a
// screen reading it that way tells a squad their finished game was called
// off. Exactly that shipped: `completed` became reachable when
// complete_played_bookings() landed (community v2, 2026-09-01) and the
// fixture screen had no reading for it.
//
// `refunded` and `refunded_by_admin` belong here despite not being spelled
// "cancelled": money went back because the booking died. Kept in step with
// the admin's SLOT_HOLDING_STATES, whose complement this is.
const CANCELLED_STATES: ReadonlySet<string> = new Set([
  'cancelled',
  'cancelled_no_refund',
  'refunded',
  'refunded_by_admin',
]);

/**
 * Did this booking end without being played? Asks the state directly instead
 * of inferring it from cancellability — the two are not complements, and
 * every state outside both sets (`pending`, `collecting`, `paid`,
 * `confirmed`, `completed`) is a booking that is alive or was honoured.
 */
export function isCancelled(state: string): boolean {
  return CANCELLED_STATES.has(state);
}

// ── Edge Function call ──────────────────────────────────────────────────

export type CancelErrorCode =
  | 'ALREADY_CANCELLED'
  | 'ALREADY_COMPLETED'
  | 'BOOKING_NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'STRIPE_ERROR'
  | 'PAYMENT_NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'IDEMPOTENCY_MISMATCH'
  | 'UNAUTHORIZED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export class CancelBookingError extends Error {
  readonly code: CancelErrorCode;
  constructor(code: CancelErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CancelBookingError';
  }
}

export interface CancelBookingResult {
  booking: {
    id: string;
    state: CancellationTerminalState;
    cancellation_refund_cents: number;
  };
}

// Generated per attempt. Same caller pattern as create-booking — the server
// caches by (key, user, body-hash), so a retry with the same key returns the
// cached response instead of double-refunding.
export function newCancelIdempotencyKey(): string {
  // See newIdempotencyKey in ./booking.ts — no global `crypto` under Hermes.
  return randomUUID();
}

export async function cancelBooking(
  bookingId: string,
  idempotencyKey: string,
): Promise<CancelBookingResult> {
  let response;
  try {
    response = await supabase.functions.invoke<CancelBookingResult>('cancel-booking', {
      body: { booking_id: bookingId },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  } catch (err) {
    throw new CancelBookingError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Network request failed',
    );
  }

  if (response.error) {
    throw await extractError(response.error);
  }
  if (!response.data) {
    throw new CancelBookingError('UNKNOWN', 'Empty response from cancel-booking');
  }
  return response.data;
}

const KNOWN_CODES = [
  'ALREADY_CANCELLED',
  'ALREADY_COMPLETED',
  'BOOKING_NOT_FOUND',
  'NOT_AUTHORIZED',
  'STRIPE_ERROR',
  'PAYMENT_NOT_FOUND',
  'VALIDATION_FAILED',
  'IDEMPOTENCY_MISMATCH',
] as const;

function isKnownCode(code: unknown): code is (typeof KNOWN_CODES)[number] {
  return typeof code === 'string' && (KNOWN_CODES as readonly string[]).includes(code);
}

interface EdgeErrorBody {
  error?: { code?: string; message?: string };
}

async function extractError(err: unknown): Promise<CancelBookingError> {
  // FunctionsHttpError exposes the original Response on `.context`.
  const ctx = (err as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as EdgeErrorBody;
      const rawCode = body?.error?.code;
      const message = body?.error?.message ?? 'Cancellation failed';
      if (isKnownCode(rawCode)) {
        return new CancelBookingError(rawCode, message);
      }
      if (ctx.status === 401) return new CancelBookingError('UNAUTHORIZED', message);
      return new CancelBookingError('UNKNOWN', message);
    } catch {
      // Body wasn't JSON — fall through.
    }
  }
  return new CancelBookingError(
    'UNKNOWN',
    err instanceof Error ? err.message : 'Cancellation failed',
  );
}
