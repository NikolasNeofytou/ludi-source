// _shared/errors.ts
// Structured error responses shared across Edge Functions. Every error carries
// a stable machine-readable code so the mobile app can render per-case UI
// (e.g. "Slot unavailable — pick another time") without regex-matching messages.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const baseHeaders = {
  ...corsHeaders,
  'Content-Type': 'application/json; charset=utf-8',
};

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'METHOD_NOT_ALLOWED'
  | 'VALIDATION_FAILED'
  | 'IDEMPOTENCY_MISMATCH'
  | 'SLOT_UNAVAILABLE'
  | 'PITCH_NOT_BOOKABLE'
  | 'STRIPE_ERROR'
  | 'RATE_LIMITED'
  | 'DB_ERROR'
  | 'INTERNAL_ERROR'
  // cancel-booking
  | 'BOOKING_NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'ALREADY_CANCELLED'
  | 'ALREADY_COMPLETED'
  | 'ALREADY_STARTED'
  | 'PAYMENT_NOT_FOUND'
  // admin-refund-booking
  | 'INVALID_BOOKING_STATE'
  | 'REFUND_AMOUNT_EXCEEDS_REMAINING'
  // admin-toggle-pitch
  | 'PITCH_NOT_FOUND'
  | 'INVALID_PITCH_TRANSITION'
  | 'VENUE_NOT_ACTIVE_FOR_VERIFY'
  // venue-connect-onboard
  | 'VENUE_NOT_FOUND'
  // invite-venue-owner
  | 'ALREADY_GRANTED'
  | 'POSSIBLE_DUPLICATE'
  // invite-venue-owner, owner-called (plans/venue-staff.md slice C)
  | 'OWNER_ROLE_NOT_YOURS'
  | 'GRANT_CAP_REACHED'
  // create-booking split mode + claim-share (C2 W3)
  | 'SPLIT_TOO_LATE'
  | 'INVALID_INVITE'
  | 'NOT_SPLIT'
  | 'CLAIM_NOT_OPEN'
  | 'FIXTURE_STARTED'
  | 'COLLECTION_CLOSED'
  | 'ALREADY_PAID'
  | 'FIXTURE_FULL'
  // cover-shortfall (C2 W4)
  | 'NOTHING_TO_COVER'
  | 'COVER_IN_FLIGHT'
  // venue-express-login (41l)
  | 'NO_STRIPE_ACCOUNT'
  // anonymize-me: the Apple re-confirmation was a different Apple ID
  | 'APPLE_ACCOUNT_MISMATCH'
  // take-seat + leave-share (find-my-replacement, ADR-0044)
  | 'SEAT_NOT_TAKEABLE'
  | 'ALREADY_IN'
  | 'NO_SEAT_TO_TAKE'
  | 'SEAT_REQUIRES_PAYMENT'
  | 'ALREADY_PAID_HERE'
  | 'INVALID_SLOT_KIND'
  | 'NOT_ON_ROSTER'
  | 'ORGANISER_CANNOT_LEAVE'
  | 'PAYMENT_IN_FLIGHT'
  // whatsapp-reply (the booking desk, ADR-0046)
  | 'NOT_FOUND'
  | 'NOT_CONNECTED'
  | 'WINDOW_CLOSED'
  | 'WHATSAPP_ERROR'
  // court cameras (ADR-0042): the database's reasons, passed through
  | 'REC_UNKNOWN_DEVICE'
  | 'REC_NOT_VIEWER'
  | 'REC_NOT_ORGANISER'
  | 'REC_NOT_STAFF'
  | 'REC_REASON_REQUIRED'
  | 'REC_NOT_READY'
  | 'REC_NOT_FINISHED'
  | 'REC_BAD_TRANSITION'
  | 'REC_OUTSIDE_WINDOW'
  | 'REC_NOT_CONSENTED'
  | 'STORAGE_ERROR';

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  details?: unknown;
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  details?: unknown,
): Response {
  const body: ErrorBody = { error: code, message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), { status, headers: baseHeaders });
}

/** What a Postgres / PostgREST error may put in a log: its SQLSTATE and the
 *  constraint it names. Never `details`, which for a constraint violation
 *  is the offending row's values — a walk-in's name and phone number. */
export function pgErrorSummary(
  err: { code?: string; message?: string } | null | undefined,
): { code?: string; constraint?: string } {
  if (!err) return {};
  const constraint = err.message?.match(/constraint "([^"]+)"/)?.[1];
  return { code: err.code, ...(constraint ? { constraint } : {}) };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: baseHeaders });
}

export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}
