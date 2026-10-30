// claim-share/index.ts
// POST /claim-share — take a slot on a split fixture by paying its share.
//
// The paid twin of join_fixture() (which refuses split fixtures —
// ADR-0022's boundary: joining that moves money happens in an Edge
// Function, not a definer RPC). See docs/plans/split-payment.md, ADR-0027.
//
// Control flow at a glance:
//   CORS preflight
//   → extract + validate JWT             (401 UNAUTHORIZED)
//   → parse + Zod-validate body          (400 VALIDATION_FAILED)
//   → idempotency read/lookup            (409 IDEMPOTENCY_MISMATCH)
//   → load booking by invite token       (404 INVALID_INVITE)
//   → gate: split, collecting, in time   (409 NOT_SPLIT / CLAIM_NOT_OPEN /
//                                         FIXTURE_STARTED / COLLECTION_CLOSED)
//   → existing live share? return it     (409 ALREADY_PAID if settled)
//   → seat participant                   (409 FIXTURE_FULL from the trigger)
//   → Stripe PI (plain platform charge)  (compensating un-seat on error)
//   → INSERT payments (kind='share')     (cancel PI + un-seat on error)
//   → store idempotent response
//   → 200 { booking_id, share_amount_cents, payment{...} }
//
// The slot is held from the seat to the PI's death — same 15-minute grace
// idea as pending bookings. The sweep that un-seats participants whose
// share PI died rides the W4 expire-collecting function (one scheduled
// sweeper for all of split payment's clocks).

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
import { ClaimShareInput } from '../_shared/schemas/claim-share.ts';
import { createStripeClient, stripePublishableKey } from '../_shared/stripe.ts';
import { createServiceClient } from '../_shared/supabase.ts';

const LIVE_SHARE_STATUSES_EXCLUDED = ['cancelled', 'failed', 'refunded'];

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
  const parsed = ClaimShareInput.safeParse(rawBody);
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

  // Load the fixture by its capability. Service role: the caller is not on
  // the roster yet, so RLS would (correctly) show them nothing.
  const { data: booking, error: bookingErr } = await supa
    .from('bookings')
    .select('id, code, state, is_split, share_amount_cents, collect_deadline, starts_at')
    .eq('invite_token', input.invite_token)
    .maybeSingle();
  if (bookingErr) {
    console.error('booking lookup failed', bookingErr);
    return errorResponse('DB_ERROR', 'Failed to load fixture', 500);
  }
  if (!booking) return errorResponse('INVALID_INVITE', 'This invite is not valid', 404);

  if (!booking.is_split || booking.share_amount_cents == null) {
    return errorResponse('NOT_SPLIT', 'This fixture is free to join — use the invite link', 409);
  }
  // Anchor unpaid (pending) and post-confirm both refuse: claim-share only
  // makes sense while the fixture is collecting. Confirmed split fixtures
  // take replacements through the free door (join_fixture).
  if (booking.state !== 'collecting') {
    return errorResponse('CLAIM_NOT_OPEN', `Fixture is not collecting (${booking.state})`, 409);
  }
  const now = Date.now();
  if (Date.parse(booking.starts_at) <= now) {
    return errorResponse('FIXTURE_STARTED', 'This match has already kicked off', 409);
  }
  if (booking.collect_deadline && Date.parse(booking.collect_deadline) <= now) {
    return errorResponse('COLLECTION_CLOSED', 'The payment window for this match has closed', 409);
  }

  // A live cover means the organiser is closing the fixture with their own
  // money — new claims would overshoot the total. The webhook's late-share
  // refund catches the race this guard can't (a share PI already in the
  // wild when the cover lands); this keeps that race rare.
  const { data: coverInFlight, error: coverErr } = await supa
    .from('payments')
    .select('id')
    .eq('booking_id', booking.id)
    .eq('kind', 'cover')
    .not('status', 'in', `(${LIVE_SHARE_STATUSES_EXCLUDED.join(',')})`)
    .maybeSingle();
  if (coverErr) {
    console.error('cover lookup failed', coverErr);
    return errorResponse('DB_ERROR', 'Failed to load fixture', 500);
  }
  if (coverInFlight) {
    return errorResponse(
      'COVER_IN_FLIGHT',
      'The organiser is covering the rest — this fixture is closing',
      409,
    );
  }

  // Existing row? A re-tap of the pay button must return the SAME
  // PaymentIntent, not mint a second one.
  const { data: existing, error: existErr } = await supa
    .from('booking_participants')
    .select('id, status')
    .eq('booking_id', booking.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (existErr) {
    console.error('participant lookup failed', existErr);
    return errorResponse('DB_ERROR', 'Failed to load roster', 500);
  }

  const stripe = createStripeClient();

  if (existing) {
    const { data: liveShare, error: liveErr } = await supa
      .from('payments')
      .select('id, status, stripe_payment_intent_id')
      .eq('participant_id', existing.id)
      .eq('kind', 'share')
      .not('status', 'in', `(${LIVE_SHARE_STATUSES_EXCLUDED.join(',')})`)
      .maybeSingle();
    if (liveErr) {
      console.error('live share lookup failed', liveErr);
      return errorResponse('DB_ERROR', 'Failed to load share', 500);
    }
    if (liveShare?.status === 'succeeded') {
      return errorResponse('ALREADY_PAID', 'Your share for this match is already paid', 409);
    }
    if (liveShare) {
      // Same claim, retried: hand back the live PI's client_secret.
      const pi = await stripe.paymentIntents.retrieve(liveShare.stripe_payment_intent_id);
      const responseBody = {
        booking_id: booking.id,
        share_amount_cents: booking.share_amount_cents,
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
  }

  // Seat them (or re-seat a leaver). The capacity trigger re-counts under
  // the booking row lock, so two claims racing for the last slot resolve
  // to exactly one seat — the loser gets FIXTURE_FULL.
  let participantId: string;
  const wasSeated = existing?.status === 'in';
  try {
    if (existing) {
      const { error: seatErr } = await supa
        .from('booking_participants')
        .update({ status: 'in', slot_kind: input.slot_kind, left_at: null })
        .eq('id', existing.id);
      if (seatErr) throw seatErr;
      participantId = existing.id;
    } else {
      const { data: seatRow, error: seatErr } = await supa
        .from('booking_participants')
        .insert({ booking_id: booking.id, user_id: user.id, slot_kind: input.slot_kind })
        .select('id')
        .single();
      if (seatErr) throw seatErr;
      participantId = seatRow.id;
    }
  } catch (err) {
    const pgErr = err as { code?: string; message?: string };
    if (pgErr.code === 'P0001' && pgErr.message?.includes('FIXTURE_FULL')) {
      return errorResponse('FIXTURE_FULL', 'Every slot of that kind is taken', 409);
    }
    console.error('seat failed', err);
    return errorResponse('DB_ERROR', 'Failed to take the slot', 500);
  }

  const unseat = async () => {
    if (wasSeated) return; // they held the slot before us; leave them in it
    await supa
      .from('booking_participants')
      .update({ status: 'out', left_at: new Date().toISOString() })
      .eq('id', participantId);
  };

  // Attempt counter scopes the Stripe idempotency key: a leaver who paid,
  // was refunded, and rejoins needs a FRESH PI, while a blind retry of the
  // same attempt maps to the same one. (One key per user-action, per the
  // house Stripe-idempotency rule.)
  const { count: priorCount, error: countErr } = await supa
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('participant_id', participantId)
    .eq('kind', 'share');
  if (countErr) {
    console.error('share count failed', countErr);
    await unseat();
    return errorResponse('DB_ERROR', 'Failed to prepare payment', 500);
  }

  // Plain platform charge — no transfer_data, no application fee: the
  // venue's money moves once, when the fixture confirms (ADR-0027).
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: booking.share_amount_cents,
        currency: 'eur',
        automatic_payment_methods: { enabled: true },
        metadata: {
          booking_id: booking.id,
          booking_code: booking.code,
          user_id: user.id,
          participant_id: participantId,
          kind: 'share',
        },
      },
      { idempotencyKey: `share:${participantId}:${priorCount ?? 0}` },
    );
  } catch (err) {
    const stripeCode = (err as { code?: string })?.code;
    console.error('share PI creation failed; un-seating', err);
    await unseat();
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
    amount_cents: booking.share_amount_cents,
    application_fee_cents: 0,
    status: 'requires_payment_method',
    kind: 'share',
    participant_id: participantId,
  });
  if (payErr) {
    console.error('share payment insert failed; cancelling PI and un-seating', payErr);
    try {
      await stripe.paymentIntents.cancel(paymentIntent.id);
    } catch (cancelErr) {
      console.error('PI cancel also failed', cancelErr);
    }
    await unseat();
    return errorResponse('DB_ERROR', 'Payment row insert failed', 500);
  }

  const responseBody = {
    booking_id: booking.id,
    share_amount_cents: booking.share_amount_cents,
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
