// Booking client (M2 #9). Wraps the create-booking Edge Function and the
// post-payment polling loop that watches `bookings.state` flip to `confirmed`.
//
// Contract: docs/api-contract.md §5.1.
// Edge Function: packages/supabase/supabase/functions/create-booking/index.ts.
// Server-side errors are normalized into a discriminated union so the UI
// can switch on `error.code` instead of string-matching messages.

import { randomUUID } from 'expo-crypto';

import { supabase } from './supabase';

// Mirrors _shared/pricing.ts ADDON_PRICES. Kept in sync manually because the
// mobile app can't import from the Edge Function package (different runtime).
export const ADDON_PRICES_CENTS: Record<AddonCode, number> = {
  bibs: 500,
  ball_rental: 300,
};

export type AddonCode = 'bibs' | 'ball_rental';

// Split payment (C2) is OFF for launch — the 2026-09-13 audit found four
// money bugs (docs/plans/launch-audit-2026-09-13.md §3). This hides the
// "Split the cost" toggle; create-booking also refuses split unless
// SPLIT_PAYMENTS_ENABLED=true on the server. Flip both to re-enable.
export const SPLIT_PAYMENTS_ENABLED = false;

export interface AddonLine {
  code: AddonCode;
  quantity: number;
}

export interface CreateBookingArgs {
  pitch_id: string;
  starts_at: string; // ISO 8601 with offset
  ends_at: string;
  addons: AddonLine[];
  notes?: string;
  /** C2 W6: split fixture — the PI charges the organiser's share only,
   * and the booking collects the rest through the invite. */
  split?: boolean;
  /** Community v2: the fixture this flow was "book again"-ed from. The
   * server verifies the caller stood on that roster; the link is chain
   * substrate (community-v2.md), never a discount or a right. */
  rebooked_from?: string;
}

export interface CreateBookingResult {
  booking: {
    id: string;
    code: string;
    state: 'pending';
    total_cents: number;
    is_split: boolean;
    share_amount_cents: number | null;
  };
  payment: {
    payment_intent_id: string;
    client_secret: string;
    publishable_key: string;
  };
}

// Discriminated union over the error codes the Edge Function returns
// (see create-booking/index.ts) plus client-side network failures.
export type BookingError =
  | { code: 'SLOT_UNAVAILABLE'; message: string }
  | { code: 'SPLIT_TOO_LATE'; message: string }
  | { code: 'PITCH_NOT_BOOKABLE'; message: string }
  | { code: 'VALIDATION_FAILED'; message: string }
  | { code: 'STRIPE_ERROR'; message: string }
  | { code: 'IDEMPOTENCY_MISMATCH'; message: string }
  | { code: 'RATE_LIMITED'; message: string }
  | { code: 'UNAUTHORIZED'; message: string }
  | { code: 'NETWORK_ERROR'; message: string }
  | { code: 'UNKNOWN'; message: string };

export class CreateBookingError extends Error {
  readonly code: BookingError['code'];
  constructor(err: BookingError) {
    super(err.message);
    this.code = err.code;
    this.name = 'CreateBookingError';
  }
}

interface EdgeErrorBody {
  error?: { code?: string; message?: string };
}

// Generates a fresh idempotency key. Per the plan: regenerate per attempt
// (NOT per render — caller must hold this in a ref or local var inside the
// submit handler). Reusing a key across attempts is fine if the request body
// hasn't changed; the server caches by (key, user, body-hash).
export function newIdempotencyKey(): string {
  // Hermes exposes no global `crypto` — reading it throws ReferenceError at the
  // top of the checkout effect, before create-booking is ever called. Use
  // expo-crypto's randomUUID (already a dependency, native-backed CSPRNG).
  return randomUUID();
}

export async function createBooking(
  args: CreateBookingArgs,
  idempotencyKey: string,
): Promise<CreateBookingResult> {
  let response;
  try {
    response = await supabase.functions.invoke<CreateBookingResult>('create-booking', {
      body: args,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  } catch (err) {
    throw new CreateBookingError({
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : 'Network request failed',
    });
  }

  if (response.error) {
    // supabase.functions.invoke returns a FunctionsHttpError whose context
    // has the actual JSON response body. Pull the structured error code out
    // of it; fall back to UNKNOWN if the server didn't follow the contract.
    const parsed = await extractEdgeError(response.error);
    throw new CreateBookingError(parsed);
  }
  if (!response.data) {
    throw new CreateBookingError({
      code: 'UNKNOWN',
      message: 'Empty response from create-booking',
    });
  }
  return response.data;
}

/**
 * Generic Edge Function error unwrap — the raw `{code, message, status}` the
 * server sent, for any caller (claim-share and cover-shortfall in
 * `fixture.ts` map it onto their own unions). FunctionsHttpError exposes the
 * original Response on `.context`.
 */
export async function extractEdgeFunctionError(
  err: unknown,
  fallbackMessage: string,
): Promise<{ code: string | null; message: string; status: number | null }> {
  const ctx = (err as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as EdgeErrorBody;
      return {
        code: body?.error?.code ?? null,
        message: body?.error?.message ?? fallbackMessage,
        status: ctx.status ?? null,
      };
    } catch {
      // Body wasn't JSON — fall through.
    }
  }
  return {
    code: null,
    message: err instanceof Error ? err.message : fallbackMessage,
    status: null,
  };
}

async function extractEdgeError(err: unknown): Promise<BookingError> {
  const raw = await extractEdgeFunctionError(err, 'Booking failed');
  if (isKnownErrorCode(raw.code)) return { code: raw.code, message: raw.message };
  // Map server status codes the contract doesn't enumerate.
  if (raw.status === 401) return { code: 'UNAUTHORIZED', message: raw.message };
  if (raw.status === 429) return { code: 'RATE_LIMITED', message: raw.message };
  return { code: 'UNKNOWN', message: raw.message };
}

const KNOWN_CODES = [
  'SLOT_UNAVAILABLE',
  'SPLIT_TOO_LATE',
  'PITCH_NOT_BOOKABLE',
  'VALIDATION_FAILED',
  'STRIPE_ERROR',
  'IDEMPOTENCY_MISMATCH',
  'RATE_LIMITED',
  'UNAUTHORIZED',
] as const;

function isKnownErrorCode(code: unknown): code is (typeof KNOWN_CODES)[number] {
  return typeof code === 'string' && (KNOWN_CODES as readonly string[]).includes(code);
}

// ── Polling for confirmation ────────────────────────────────────────────
// After the Payment Sheet returns success, the user's money is captured but
// the `bookings.state` flip from `pending`→`paid`→`confirmed` happens via
// the stripe-webhook Edge Function. Mobile polls so the UI can hand the user
// a confirmation screen the moment that lands.
//
// Open question per the plan: if 2s × 10 polling proves laggy on real Wi-Fi,
// switch to a Realtime channel subscription on `bookings:id=eq.X`.

export type PollOutcome = 'confirmed' | 'timeout';

export interface PollOpts {
  intervalMs?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  /** States that count as "done". Defaults to ['confirmed']; a split
   * checkout passes ['collecting','confirmed'] — the anchor share settling
   * moves the booking to collecting, which IS its success state (C2 W6). */
  until?: readonly string[];
}

export async function pollBookingState(
  bookingId: string,
  opts: PollOpts = {},
): Promise<PollOutcome> {
  const interval = opts.intervalMs ?? 2_000;
  const maxAttempts = opts.maxAttempts ?? 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts.signal?.aborted) return 'timeout';

    const { data, error } = await supabase
      .from('bookings')
      .select('state')
      .eq('id', bookingId)
      .maybeSingle();

    // Don't bail on transient query errors — keep polling. The 20s cap
    // bounds total wait either way.
    const until = opts.until ?? ['confirmed'];
    if (!error && data?.state && until.includes(data.state)) return 'confirmed';

    if (attempt < maxAttempts - 1) {
      await sleep(interval, opts.signal);
    }
  }
  return 'timeout';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

// ── Pricing preview (client-side) ───────────────────────────────────────
// Pure mirror of _shared/pricing.ts — used only for the live "Book €N" CTA
// label so the user sees the total update as they tap addon steppers. The
// authoritative computation still happens server-side in create-booking;
// any client/server mismatch falls back to the server's number on success.

export function computePreviewTotalCents(
  pricePerHourCents: number,
  startsAt: Date,
  endsAt: Date,
  addons: readonly AddonLine[],
): number {
  const durationMin = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
  const baseCents = Math.round((pricePerHourCents * durationMin) / 60);
  let addonsCents = 0;
  for (const a of addons) addonsCents += ADDON_PRICES_CENTS[a.code] * a.quantity;
  return baseCents + addonsCents;
}

// Format a euro amount in cents as the numeric body of a price label —
// "17" for round euros, "17.50" otherwise. The "€" prefix lives in the
// i18n template so callers don't double-render it.
export function formatEurAmount(cents: number): string {
  const euros = cents / 100;
  return euros.toFixed(cents % 100 === 0 ? 0 : 2);
}
