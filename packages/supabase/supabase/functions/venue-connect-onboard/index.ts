// venue-connect-onboard/index.ts
// POST /venue-connect-onboard — create (or reuse) a Stripe Express connected
// account for a venue and return a hosted onboarding link. The owner completes
// KYC on Stripe's page; the `account.updated` webhook
// (_shared/webhook-handlers/account-updated.ts) flips venues.stripe_account_status.
//
// Contract: docs/api-contract.md §6.4. ADR-0004 (Stripe Connect Express).
//
// Auth: admin OR owner of the venue (via venue_owners) — widened 2026-08-31
// (41m): the owner dashboard exists (ADR-0019) and its Payment setup
// checklist step is the natural place for the owner to start their own KYC,
// instead of the founder minting and forwarding every link.
//
// Payout schedule: the account is pinned to WEEKLY payouts (anchor Monday,
// so the weekend's takings pay out soonest). This is what makes the site's
// "Weekly payouts via Stripe Connect" claim true (41l) — set at account
// creation, and re-asserted on every link mint so accounts created before
// this change converge the next time anyone touches them.
//
// Idempotency: not via header. Creating the Stripe account is guarded by the
// stored venues.stripe_account_id (a second call reuses it), by a Stripe
// idempotency key per venue, and by writing the id only while the column is
// still empty — so two first calls at once end on one Express account.
// Account links are cheap + ephemeral, so a duplicate call simply mints a
// fresh link.
//
// Return/refresh URLs: only the admin site's own origin (ADMIN_SITE_URL).
// The admin app sends its window origin; anything else is refused.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { adminReturnUrl, adminSiteOrigin } from '../_shared/admin-site.ts';
import { getUserFromRequest } from '../_shared/auth.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/errors.ts';
import { VenueConnectOnboardInput } from '../_shared/schemas/venue-connect-onboard.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { createStripeClient } from '../_shared/stripe.ts';

interface VenueRow {
  id: string;
  name: string;
  contact_email: string | null;
  stripe_account_id: string | null;
  stripe_account_status: string;
}

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
  }

  // 1. Auth — a signed-in user; admin-or-owner is decided once the body
  // names the venue (step 3a), same shape as create-walk-in-booking.
  const user = await getUserFromRequest(req);
  if (!user) return errorResponse('UNAUTHORIZED', 'Missing or invalid token', 401);

  const supa = createServiceClient();

  // 2. Parse + validate body.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }
  const parsed = VenueConnectOnboardInput.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, {
      issues: parsed.error.issues,
    });
  }
  const input = parsed.data;

  // 2b. Where Stripe sends the owner back: the admin site, nowhere else.
  //     Without a URL, the admin's home page (Today), which both owners and
  //     admins may open.
  const origin = adminSiteOrigin();
  const returnUrl = adminReturnUrl(input.return_url, origin);
  const refreshUrl = adminReturnUrl(input.refresh_url, origin);
  if (!returnUrl || !refreshUrl) {
    return errorResponse(
      'VALIDATION_FAILED',
      'return_url and refresh_url must be on the Ludi admin site',
      400,
    );
  }

  // 3. Load the venue.
  const { data: venueRaw, error: venueErr } = await supa
    .from('venues')
    .select('id, name, contact_email, stripe_account_id, stripe_account_status')
    .eq('id', input.venue_id)
    .maybeSingle();
  if (venueErr) {
    console.error('venue lookup failed', venueErr);
    return errorResponse('DB_ERROR', 'Failed to load venue', 500);
  }
  if (!venueRaw) return errorResponse('VENUE_NOT_FOUND', 'Venue not found', 404);
  const venue = venueRaw as VenueRow;

  // 3a. Authorise: admin, or an owner of THIS venue (41m). The service
  // client bypasses RLS, so the gate is spelled out here.
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
      'Stripe onboarding is for the venue owner or Ludi staff',
      403,
    );
  }

  const stripe = createStripeClient();

  try {
    // 4. Create the Express account once; reuse the stored id thereafter.
    // Weekly/Monday payouts are part of the account's definition (see
    // header): weekly is the public promise, Monday pays the weekend's
    // takings out soonest.
    const payoutSettings = {
      payouts: {
        schedule: { interval: 'weekly', weekly_anchor: 'monday' },
      },
    } as const;
    let accountId = venue.stripe_account_id;
    if (!accountId) {
      // One key per venue: a second first-call within Stripe's 24h key
      // window gets the same account back instead of a second one.
      const account = await stripe.accounts.create(
        {
          type: 'express',
          country: 'CY',
          email: venue.contact_email ?? undefined,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_profile: { name: venue.name },
          settings: payoutSettings,
          metadata: { venue_id: venue.id },
        },
        { idempotencyKey: `connect-account:${venue.id}` },
      );
      accountId = account.id;

      // Write it only into an empty column. If another call got there
      // first, theirs is the venue's account: use the stored one.
      const { data: saved, error: upErr } = await supa
        .from('venues')
        .update({ stripe_account_id: accountId })
        .eq('id', venue.id)
        .is('stripe_account_id', null)
        .select('stripe_account_id')
        .maybeSingle();
      if (upErr) {
        // Stripe account exists but we failed to persist its id — log loud:
        // the account.updated webhook can't match it until reconciled.
        console.error('failed to persist stripe_account_id — manual reconciliation', {
          venue_id: venue.id,
          stripe_account_id: accountId,
          code: upErr.code,
        });
        return errorResponse('DB_ERROR', 'Failed to save Stripe account id', 500);
      }
      if (!saved) {
        const { data: current, error: reErr } = await supa
          .from('venues')
          .select('stripe_account_id')
          .eq('id', venue.id)
          .maybeSingle();
        if (reErr || !current?.stripe_account_id) {
          console.error('stripe_account_id race: re-read failed', {
            venue_id: venue.id,
            stripe_account_id: accountId,
          });
          return errorResponse('DB_ERROR', 'Failed to save Stripe account id', 500);
        }
        if (current.stripe_account_id !== accountId) {
          console.warn('concurrent onboarding: keeping the stored account', {
            venue_id: venue.id,
            stored: current.stripe_account_id,
            unused: accountId,
          });
        }
        accountId = current.stripe_account_id;
      }
    } else {
      // Re-assert the schedule on accounts created before the weekly
      // default existed. Idempotent, and cheap next to the link mint.
      await stripe.accounts.update(accountId, { settings: payoutSettings });
    }

    // 5. Mint a fresh hosted onboarding link.
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return jsonResponse(
      {
        stripe_account_id: accountId,
        account_link_url: link.url,
        expires_at: new Date(link.expires_at * 1000).toISOString(),
        stripe_account_status: venue.stripe_account_status,
      },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('stripe connect onboarding failed', { venue_id: venue.id, err });
    // Stripe's own wording ("You cannot create a login link for an account
    // that has not completed onboarding") means nothing to an owner; staff
    // still get it in `details` for debugging.
    return errorResponse(
      'STRIPE_ERROR',
      "Stripe couldn't start payment setup just now. Try again in a minute.",
      502,
      callerIsAdmin ? { stripe_message: message } : undefined,
    );
  }
}));
