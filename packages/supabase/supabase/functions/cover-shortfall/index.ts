// cover-shortfall/index.ts
// POST /cover-shortfall — the organiser pays whatever the invite didn't
// collect, in one payment (C2 W4; split-payment.md decision 3: at T-24h
// the organiser covers or the fixture dies at T-22h).
//
// Deliberately allowed ANY time while collecting, not just inside the
// grace window: an organiser who wants the fixture locked in early is
// buying certainty with their own money, which is exactly the product.
// Unclaimed slots on a covered fixture fill through the free door after
// confirmation (join_fixture) — the organiser chose to eat those shares.
//
// The overshoot race (a claimed share settles after the cover was priced)
// is handled at the webhook: a share succeeding on an already-confirmed
// fixture refunds itself. claim-share also refuses new claims while a
// cover PI is live (COVER_IN_FLIGHT), which keeps the race rare.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { getUserFromRequest } from '../_shared/auth.ts';
import {
  corsHeaders,
  errorResponse,
  jsonResponse,
  preflightResponse,
} from '../_shared/errors.ts';
import {
  canonicalJson,
  IdempotencyMismatch,
  lookupIdempotentResponse,
  readIdempotencyKey,
  sha256Hex,
  storeIdempotentResponse,
} from '../_shared/idempotency.ts';
import { CoverShortfallInput } from '../_shared/schemas/cover-shortfall.ts';
import { createStripeClient, stripePublishableKey } from '../_shared/stripe.ts';
import { createServiceClient } from '../_shared/supabase.ts';

const DEAD_PAYMENT_STATUSES = ['cancelled', 'failed', 'refunded'];

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
  }

  const user = await getUserFromRequest(req);
  if (!user) return errorResponse('UNAUTHORIZED', 'Missing or invalid token', 401);

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }
  const parsed = CoverShortfallInput.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, {
      issues: parsed.error.issues,
    });
  }
  const input = parsed.data;

  let idempotencyKey: string | null;
  try {
    idempotencyKey = readIdempotencyKey(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid Idempotency-Key';
    return errorResponse('VALIDATION_FAILED', message, 400);
  }
  const requestHash = await sha256Hex(canonicalJson(input));

  const supa = createServiceClient();

  if (idempotencyKey) {
    try {
      const cached = await lookupIdempotentResponse(supa, idempotencyKey, user.id, requestHash);
      if (cached) {
        return new Response(JSON.stringify(cached.body), {
          status: cached.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    } catch (err) {
      if (err instanceof IdempotencyMismatch) {
        return errorResponse('IDEMPOTENCY_MISMATCH', err.message, 409);
      }
      console.error('idempotency lookup error', err);
      return errorResponse('INTERNAL_ERROR', 'Idempotency lookup failed', 500);
    }
  }

  const { data: booking, error: bookingErr } = await supa
    .from('bookings')
    .select('id, code, user_id, state, is_split, total_cents, starts_at')
    .eq('id', input.booking_id)
    .maybeSingle();
  if (bookingErr) {
    console.error('booking lookup failed', bookingErr);
    return errorResponse('DB_ERROR', 'Failed to load fixture', 500);
  }
  if (!booking) return errorResponse('BOOKING_NOT_FOUND', 'No such fixture', 404);
  if (booking.user_id !== user.id) {
    return errorResponse('NOT_AUTHORIZED', 'Only the organiser can cover the shortfall', 403);
  }
  if (!booking.is_split || booking.state !== 'collecting') {
    return errorResponse('CLAIM_NOT_OPEN', `Fixture is not collecting (${booking.state})`, 409);
  }
  if (Date.parse(booking.starts_at) <= Date.now()) {
    return errorResponse('FIXTURE_STARTED', 'This match has already kicked off', 409);
  }

  // The organiser's own participant row anchors cover payments too.
  const { data: organiserRow, error: orgErr } = await supa
    .from('booking_participants')
    .select('id')
    .eq('booking_id', booking.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (orgErr || !organiserRow) {
    console.error('organiser participant lookup failed', orgErr);
    return errorResponse('DB_ERROR', 'Organiser roster row missing', 500);
  }

  const stripe = createStripeClient();

  // A live cover already in flight? Same re-tap idiom as claim-share:
  // hand back the same PI rather than minting a second gap-sized charge.
  const { data: liveCover, error: liveErr } = await supa
    .from('payments')
    .select('id, status, stripe_payment_intent_id')
    .eq('booking_id', booking.id)
    .eq('kind', 'cover')
    .not('status', 'in', `(${DEAD_PAYMENT_STATUSES.join(',')})`)
    .maybeSingle();
  if (liveErr) {
    console.error('live cover lookup failed', liveErr);
    return errorResponse('DB_ERROR', 'Failed to load cover state', 500);
  }
  if (liveCover) {
    const pi = await stripe.paymentIntents.retrieve(liveCover.stripe_payment_intent_id);
    const responseBody = {
      booking_id: booking.id,
      cover_amount_cents: pi.amount,
      payment: {
        payment_intent_id: pi.id,
        client_secret: pi.client_secret,
        publishable_key: stripePublishableKey(),
      },
    };
    if (idempotencyKey) {
      await storeIdempotentResponse(supa, idempotencyKey, user.id, requestHash, 200, responseBody);
    }
    return jsonResponse(responseBody, 200);
  }

  // Price the gap from succeeded money only — the same set settle counts.
  const { data: sumRows, error: sumErr } = await supa
    .from('payments')
    .select('amount_cents')
    .eq('booking_id', booking.id)
    .in('kind', ['share', 'cover'])
    .eq('status', 'succeeded');
  if (sumErr) {
    console.error('sum load failed', sumErr);
    return errorResponse('DB_ERROR', 'Failed to price the shortfall', 500);
  }
  const collected = (sumRows ?? []).reduce((a, r) => a + r.amount_cents, 0);
  const shortfall = booking.total_cents - collected;
  if (shortfall <= 0) {
    return errorResponse('NOTHING_TO_COVER', 'The fixture is fully collected', 409);
  }

  const { count: priorCovers, error: countErr } = await supa
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('booking_id', booking.id)
    .eq('kind', 'cover');
  if (countErr) {
    console.error('cover count failed', countErr);
    return errorResponse('DB_ERROR', 'Failed to prepare payment', 500);
  }

  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: shortfall,
        currency: 'eur',
        automatic_payment_methods: { enabled: true },
        metadata: {
          booking_id: booking.id,
          booking_code: booking.code,
          user_id: user.id,
          participant_id: organiserRow.id,
          kind: 'cover',
        },
      },
      { idempotencyKey: `cover:${booking.id}:${priorCovers ?? 0}` },
    );
  } catch (err) {
    const stripeCode = (err as { code?: string })?.code;
    console.error('cover PI creation failed', err);
    return errorResponse(
      'STRIPE_ERROR',
      "Payment couldn't be started just now. Try again in a minute.",
      502,
      stripeCode ? { stripe_code: stripeCode } : undefined,
    );
  }

  const { error: payErr } = await supa.from('payments').insert({
    booking_id: booking.id,
    stripe_payment_intent_id: paymentIntent.id,
    amount_cents: shortfall,
    application_fee_cents: 0,
    status: 'requires_payment_method',
    kind: 'cover',
    participant_id: organiserRow.id,
  });
  if (payErr) {
    console.error('cover payment insert failed; cancelling PI', payErr);
    try {
      await stripe.paymentIntents.cancel(paymentIntent.id);
    } catch (cancelErr) {
      console.error('PI cancel also failed', cancelErr);
    }
    return errorResponse('DB_ERROR', 'Payment row insert failed', 500);
  }

  const responseBody = {
    booking_id: booking.id,
    cover_amount_cents: shortfall,
    payment: {
      payment_intent_id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      publishable_key: stripePublishableKey(),
    },
  };
  if (idempotencyKey) {
    await storeIdempotentResponse(supa, idempotencyKey, user.id, requestHash, 200, responseBody);
  }
  return jsonResponse(responseBody, 200);
}));
