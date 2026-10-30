// venue-express-login/index.ts
// POST /venue-express-login — mint a one-time Stripe Express Dashboard
// login link for a venue's connected account (41l).
//
// Why this exists: an Express account has no Stripe dashboard of its own —
// the platform mints login links or the owner sees nothing. Balance, next
// payout date, bank details, payout history: all live behind this link.
// The owner Earnings page is the caller.
//
// Contract: docs/api-contract.md §6.5.
//
// Auth: admin OR owner of the venue (via venue_owners) — same gate as
// venue-connect-onboard post-41m.
//
// Idempotency: none needed. Login links are single-use and expire; every
// call mints a fresh one.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { getUserFromRequest } from '../_shared/auth.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/errors.ts';
import { VenueExpressLoginInput } from '../_shared/schemas/venue-express-login.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { createStripeClient } from '../_shared/stripe.ts';

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
  }

  const user = await getUserFromRequest(req);
  if (!user) return errorResponse('UNAUTHORIZED', 'Missing or invalid token', 401);

  const supa = createServiceClient();

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }
  const parsed = VenueExpressLoginInput.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, {
      issues: parsed.error.issues,
    });
  }

  const { data: venue, error: venueErr } = await supa
    .from('venues')
    .select('id, stripe_account_id')
    .eq('id', parsed.data.venue_id)
    .maybeSingle();
  if (venueErr) {
    console.error('venue lookup failed', venueErr);
    return errorResponse('DB_ERROR', 'Failed to load venue', 500);
  }
  if (!venue) return errorResponse('VENUE_NOT_FOUND', 'Venue not found', 404);

  // Admin, or an owner of THIS venue. The service client bypasses RLS, so
  // the gate is spelled out here (same shape as venue-connect-onboard).
  const { data: callerRow, error: callerErr } = await supa
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (callerErr) {
    console.error('caller role lookup failed', callerErr);
    return errorResponse('DB_ERROR', 'Failed to verify role', 500);
  }
  // The venue's OWNER, not a manager: venue_owners.role = 'manager' runs
  // the venue day to day, but bank details and payouts are the owner's
  // (docs/data-model.md, "manager = limited scope"). The admin app hides
  // this button from managers; this is the gate that means it.
  const callerIsAdmin = callerRow?.role === 'admin';
  let authorised = callerIsAdmin;
  if (!authorised) {
    const { data: ownerRow, error: ownerErr } = await supa
      .from('venue_owners')
      .select('role')
      .eq('venue_id', venue.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (ownerErr) {
      console.error('venue owner lookup failed', ownerErr);
      return errorResponse('DB_ERROR', 'Failed to verify venue access', 500);
    }
    if (ownerRow?.role === 'manager') {
      return errorResponse(
        'NOT_AUTHORIZED',
        "Payments are managed by the venue's owner",
        403,
      );
    }
    authorised = ownerRow?.role === 'owner';
  }
  if (!authorised) {
    return errorResponse(
      'NOT_AUTHORIZED',
      'The Stripe dashboard is for the venue owner or Ludi staff',
      403,
    );
  }

  if (!venue.stripe_account_id) {
    // No Connect account yet — payments setup hasn't started. The UI
    // should be showing the onboarding CTA instead of this button.
    return errorResponse(
      'NO_STRIPE_ACCOUNT',
      'This venue has not started Stripe onboarding yet',
      409,
    );
  }

  const stripe = createStripeClient();
  try {
    const link = await stripe.accounts.createLoginLink(venue.stripe_account_id);
    return jsonResponse({ login_url: link.url }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('express login link failed', { venue_id: venue.id, err });
    // Stripe's own wording ("You cannot create a login link for an account
    // that has not completed onboarding") means nothing to an owner; staff
    // still get it in `details` for debugging.
    return errorResponse(
      'STRIPE_ERROR',
      "Stripe couldn't open the dashboard. If payment setup isn't finished, finish it from Today first; otherwise try again in a minute.",
      502,
      callerIsAdmin ? { stripe_message: message } : undefined,
    );
  }
}));
