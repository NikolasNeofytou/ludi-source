// create-booking/index.ts
// POST /create-booking — creates a pending booking row and a Stripe
// PaymentIntent with the platform fee routed via Stripe Connect.
//
// See docs/api-contract.md §5.1 for the contract and discriminated errors.
// See docs/data-model.md for the bookings/payments schema.
//
// Control flow at a glance:
//   CORS preflight
//   → extract + validate JWT          (401 UNAUTHORIZED)
//   → parse + Zod-validate body       (400 VALIDATION_FAILED)
//   → read Idempotency-Key            (409 IDEMPOTENCY_MISMATCH)
//   → look up cached response ────────── return early if hit
//   → load pitch + venue + city       (404/409 PITCH_NOT_BOOKABLE)
//   → slot is on the pitch's grid     (409 SLOT_UNAVAILABLE)
//   → caller's unpaid holds < 2       (429 RATE_LIMITED)
//   → compute price                   (server trusts no client numbers)
//   → generate booking code (RPC)
//   → INSERT booking                  (409 SLOT_UNAVAILABLE on 23P01)
//   → INSERT booking_addons           (compensating DELETE booking on error)
//   → Stripe PI create                (compensating DELETE on error)
//   → INSERT payments                 (best-effort Stripe cancel on error)
//   → store idempotent response
//   → 200 OK

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
import { ADDON_PRICES, computeBookingPrice } from '../_shared/pricing.ts';
import {
  collectDeadline,
  organiserShareCents,
  shareAmountCents,
  splitCreatable,
} from '../_shared/share-math.ts';
import { CreateBookingInput } from '../_shared/schemas/booking.ts';
import {
  BOOKING_HORIZON_DAYS,
  beyondHorizon,
  matchOfferedSlot,
  MAX_PENDING_PER_USER,
  type OfferedSlot,
  venueDateOf,
} from '../_shared/booking-window.ts';
import { createStripeClient, stripePublishableKey } from '../_shared/stripe.ts';
import { createCallerClient, createServiceClient } from '../_shared/supabase.ts';

// Postgres error codes we handle explicitly.
const PG_EXCLUSION_VIOLATION = '23P01';

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
  }

  // 1. Auth.
  const user = await getUserFromRequest(req);
  if (!user) return errorResponse('UNAUTHORIZED', 'Missing or invalid token', 401);

  // 2. Parse + validate body.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }

  const parsed = CreateBookingInput.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse(
      'VALIDATION_FAILED',
      'Input failed validation',
      400,
      { issues: parsed.error.issues },
    );
  }
  const input = parsed.data;

  // A slot that has already started can't be bought. The slot grid only
  // reflects the moment it loaded — select 19:00 at 18:50, pay at 19:05 —
  // and a kickoff inside the no-refund window would also be unrefundable.
  // Reported as SLOT_UNAVAILABLE so the app shows "that slot just went".
  if (Date.parse(input.starts_at) <= Date.now()) {
    return errorResponse('SLOT_UNAVAILABLE', 'This slot has already started. Pick a later time.', 409);
  }
  if (beyondHorizon(new Date(input.starts_at), new Date())) {
    return errorResponse(
      'SLOT_UNAVAILABLE',
      `Bookings open ${BOOKING_HORIZON_DAYS} days ahead. Pick an earlier date.`,
      409,
    );
  }

  // Split payment is OFF for launch (docs/plans/launch-audit-2026-09-13.md
  // §3 — four money bugs). New app builds hide the toggle; this stops the
  // builds already in testers' hands. Re-enable with the secret
  // SPLIT_PAYMENTS_ENABLED=true. Fixtures already collecting are untouched.
  if (input.split && Deno.env.get('SPLIT_PAYMENTS_ENABLED') !== 'true') {
    return errorResponse(
      'VALIDATION_FAILED',
      "Splitting the cost isn't available yet — switch it off and book the whole pitch.",
      400,
    );
  }

  // 3. Idempotency — read key, compute hash of canonicalized body.
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
      const cached = await lookupIdempotentResponse(
        supa,
        idempotencyKey,
        user.id,
        requestHash,
      );
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

  // 4. Load pitch + venue + city. Service role bypasses RLS, so we see the
  //    fields the mobile app's read policy doesn't expose (stripe_account_id).
  interface PitchRow {
    id: string;
    type: string;
    is_active: boolean;
    is_verified: boolean;
    price_per_hour_cents: number;
    venues: {
      id: string;
      is_active: boolean;
      stripe_account_id: string | null;
      stripe_account_status: string;
      take_rate_bps: number;
      cancellation_policy: 'standard' | 'strict' | 'flex';
      cities: { code: string };
    };
  }

  const { data: pitchData, error: pitchErr } = await supa
    .from('pitches')
    .select(
      `
        id,
        type,
        is_active,
        is_verified,
        price_per_hour_cents,
        venues!inner (
          id,
          is_active,
          stripe_account_id,
          stripe_account_status,
          take_rate_bps,
          cancellation_policy,
          cities!inner ( code )
        )
      `,
    )
    .eq('id', input.pitch_id)
    .maybeSingle();

  if (pitchErr) {
    console.error('pitch lookup failed', pitchErr);
    return errorResponse('DB_ERROR', 'Failed to load pitch', 500);
  }
  if (!pitchData) {
    return errorResponse('PITCH_NOT_BOOKABLE', 'Pitch not found', 404);
  }
  const pitch = pitchData as unknown as PitchRow;
  const venue = pitch.venues;

  const bookable =
    pitch.is_active &&
    pitch.is_verified &&
    venue.is_active &&
    venue.stripe_account_status === 'active' &&
    venue.stripe_account_id !== null;

  if (!bookable || !venue.stripe_account_id) {
    return errorResponse('PITCH_NOT_BOOKABLE', 'Pitch is not currently bookable', 409);
  }

  // 4b. The requested range must be exactly one slot the pitch offers that
  //     day — the grid the app draws, from the same function. It carries
  //     the weekly hours, date overrides, closed days and composite
  //     blockers, so a hand-built request can't buy 03:00 or a closed day.
  //     Called as the player (the app calls it the same way); the EXCLUDE
  //     constraint below stays the race-proof overlap check.
  const accessToken = (req.headers.get('Authorization') ?? '').slice(7).trim();
  const slotDate = venueDateOf(new Date(input.starts_at));
  const { data: slotRows, error: slotsGridErr } = await createCallerClient(accessToken).rpc(
    'get_available_slots',
    { p_pitch_id: input.pitch_id, p_start_date: slotDate, p_end_date: slotDate },
  );
  if (slotsGridErr) {
    console.error('get_available_slots failed', { code: slotsGridErr.code });
    return errorResponse('DB_ERROR', 'Failed to check the pitch schedule', 500);
  }
  const slotMatch = matchOfferedSlot(
    (slotRows ?? []) as OfferedSlot[],
    new Date(input.starts_at),
    new Date(input.ends_at),
  );
  if (slotMatch === 'not_offered') {
    return errorResponse(
      'SLOT_UNAVAILABLE',
      "That time isn't one of this pitch's slots. Pick a time from the list.",
      409,
    );
  }
  if (slotMatch === 'taken') {
    return errorResponse(
      'SLOT_UNAVAILABLE',
      'Another booking already holds this slot. Pick a different time.',
      409,
    );
  }

  // 4c. Unpaid holds per player. Each pending booking keeps a court off
  //     the grid until it is paid or swept; a player needs one checkout
  //     and one retry, not a block of courts.
  const { count: pendingCount, error: pendingErr } = await supa
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('state', 'pending');
  if (pendingErr) {
    console.error('pending count failed', { code: pendingErr.code });
    return errorResponse('DB_ERROR', 'Failed to check your open bookings', 500);
  }
  if ((pendingCount ?? 0) >= MAX_PENDING_PER_USER) {
    return errorResponse(
      'RATE_LIMITED',
      'You have bookings waiting for payment. Finish or cancel one of them first.',
      429,
    );
  }

  // 5. Compute the price. Server-side only — we trust no client number.
  let price;
  try {
    price = computeBookingPrice({
      startsAt: new Date(input.starts_at),
      endsAt: new Date(input.ends_at),
      pricePerHourCents: pitch.price_per_hour_cents,
      addons: input.addons,
      takeRateBps: venue.take_rate_bps,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Price computation failed';
    return errorResponse('VALIDATION_FAILED', message, 400);
  }

  // 5b. Split fixtures: the share arithmetic, priced before anything is
  //     written. The organiser's anchor share is what the PI below charges;
  //     the rest arrives through claim-share (ADR-0027). The first cut
  //     refuses splits inside the T-24h+grace window rather than running a
  //     compressed clock (cut list #4, docs/plans/split-payment.md).
  let shareCents: number | null = null;
  let organiserCents = 0;
  if (input.split) {
    if (!splitCreatable(new Date(input.starts_at), new Date())) {
      return errorResponse(
        'SPLIT_TOO_LATE',
        'Too close to kickoff to collect shares — book it whole instead',
        400,
      );
    }
    const { data: slotsData, error: slotsErr } = await supa.rpc('squad_slots_for', {
      p_pitch_type: pitch.type,
    });
    const slotsRow = (Array.isArray(slotsData) ? slotsData[0] : slotsData) as
      | { gk_slots: number; outfield_slots: number }
      | null;
    if (slotsErr || !slotsRow?.gk_slots || !slotsRow?.outfield_slots) {
      console.error('squad_slots_for failed', slotsErr, slotsData);
      return errorResponse('DB_ERROR', 'Failed to derive squad size', 500);
    }
    const slots = slotsRow.gk_slots + slotsRow.outfield_slots;
    shareCents = shareAmountCents(price.totalCents, slots);
    organiserCents = organiserShareCents(price.totalCents, slots);
  }

  // 6. Generate booking code via the atomic DB sequence.
  const cityPrefix = venue.cities.code.slice(0, 3).toUpperCase();
  const bookingYear = new Date(input.starts_at).getUTCFullYear();
  const { data: codeData, error: codeErr } = await supa.rpc('generate_booking_code', {
    p_city_prefix: cityPrefix,
    p_year: bookingYear,
  });
  if (codeErr || typeof codeData !== 'string') {
    console.error('booking code generation failed', codeErr);
    return errorResponse('DB_ERROR', 'Failed to generate booking code', 500);
  }
  const bookingCode = codeData;

  // 6b. Rebook chain (community-v2.md): honour the link only if the caller
  //     actually stood on the source fixture's roster — organiser included,
  //     the seat-organiser trigger puts them there. A failed check drops
  //     the link and books anyway: the chain is measurement substrate, and
  //     a tampered param should not cost anyone a slot.
  let rebookedFrom: string | null = null;
  if (input.rebooked_from) {
    const { data: sourceRow } = await supa
      .from('booking_participants')
      .select('id')
      .eq('booking_id', input.rebooked_from)
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (sourceRow) {
      rebookedFrom = input.rebooked_from;
    } else {
      console.warn('rebooked_from dropped: caller not on source roster', {
        user_id: user.id,
        rebooked_from: input.rebooked_from,
      });
    }
  }

  // 7. INSERT the booking. The EXCLUDE constraint rejects overlaps with any
  //    booking already in (pending, paid, confirmed, completed) state.
  const { data: bookingRow, error: bookingErr } = await supa
    .from('bookings')
    .insert({
      code: bookingCode,
      user_id: user.id,
      pitch_id: input.pitch_id,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      state: 'pending',
      base_price_cents: price.baseCents,
      addons_price_cents: price.addonsCents,
      total_cents: price.totalCents,
      platform_fee_cents: price.platformFeeCents,
      cancellation_policy: venue.cancellation_policy,
      notes: input.notes ?? null,
      is_split: input.split,
      share_amount_cents: shareCents,
      collect_deadline: input.split
        ? collectDeadline(new Date(input.starts_at)).toISOString()
        : null,
      rebooked_from: rebookedFrom,
    })
    .select('id, code, state, total_cents, is_split, share_amount_cents')
    .single();

  if (bookingErr) {
    if (bookingErr.code === PG_EXCLUSION_VIOLATION) {
      return errorResponse(
        'SLOT_UNAVAILABLE',
        'Another booking already holds this slot. Pick a different time.',
        409,
      );
    }
    console.error('booking insert failed', bookingErr);
    return errorResponse('DB_ERROR', 'Booking insert failed', 500);
  }

  // 8. INSERT booking_addons (snapshotting the unit price at booking time).
  if (input.addons.length > 0) {
    const addonRows = input.addons.map((a) => ({
      booking_id: bookingRow.id,
      addon_code: a.code,
      quantity: a.quantity,
      unit_price_cents: ADDON_PRICES[a.code],
    }));
    const { error: addonErr } = await supa.from('booking_addons').insert(addonRows);
    if (addonErr) {
      console.error('addon insert failed, rolling back booking', addonErr);
      await supa.from('bookings').delete().eq('id', bookingRow.id);
      return errorResponse('DB_ERROR', 'Addon insert failed', 500);
    }
  }

  // 8b. Split: the trigger has already seated the organiser; their
  //     participant row is what the anchor share attaches to.
  let organiserParticipantId: string | null = null;
  if (input.split) {
    const { data: partRow, error: partErr } = await supa
      .from('booking_participants')
      .select('id')
      .eq('booking_id', bookingRow.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (partErr || !partRow) {
      console.error('organiser participant lookup failed', partErr);
      await supa.from('booking_addons').delete().eq('booking_id', bookingRow.id);
      await supa.from('bookings').delete().eq('id', bookingRow.id);
      return errorResponse('DB_ERROR', 'Organiser roster row missing', 500);
    }
    organiserParticipantId = partRow.id;
  }

  // 9. Create the Stripe PaymentIntent. Idempotency key is scoped to the
  //    booking UUID, so retries of the outer endpoint that reach a fresh
  //    booking also produce a fresh PI, while retries that find the same
  //    booking (via idempotency cache above) never reach this code path.
  //
  //    Split fixtures charge the organiser's ANCHOR SHARE as a plain
  //    platform charge — no transfer_data, no application fee (ADR-0027:
  //    separate charges, one Transfer when the fixture confirms). The
  //    single-payer path keeps its destination charge (ADR-0026).
  // The client is built inside the try so a missing/bad STRIPE_SECRET_KEY
  // rolls the booking back too, instead of leaving a pending row holding
  // the slot until the 15-minute sweep.
  let stripe: ReturnType<typeof createStripeClient>;
  let paymentIntent;
  try {
    stripe = createStripeClient();
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: input.split ? organiserCents : price.totalCents,
        currency: 'eur',
        ...(input.split
          ? {}
          : {
            application_fee_amount: price.platformFeeCents,
            transfer_data: { destination: venue.stripe_account_id },
          }),
        automatic_payment_methods: { enabled: true },
        metadata: {
          booking_id: bookingRow.id,
          booking_code: bookingRow.code,
          user_id: user.id,
          pitch_id: input.pitch_id,
          kind: input.split ? 'share' : 'booking',
          ...(organiserParticipantId ? { participant_id: organiserParticipantId } : {}),
        },
      },
      {
        idempotencyKey: input.split
          ? `share:${organiserParticipantId}:0`
          : `booking:${bookingRow.id}`,
      },
    );
  } catch (err) {
    const stripeCode = (err as { code?: string; message?: string })?.code;
    console.error('stripe PI creation failed, rolling back booking', err);
    await supa.from('booking_addons').delete().eq('booking_id', bookingRow.id);
    await supa.from('bookings').delete().eq('id', bookingRow.id);
    return errorResponse(
      'STRIPE_ERROR',
      "Payment couldn't be started just now. Try again in a minute.",
      502,
      stripeCode ? { stripe_code: stripeCode } : undefined,
    );
  }

  // 10. INSERT payments row tracking this PI.
  const { error: payErr } = await supa.from('payments').insert({
    booking_id: bookingRow.id,
    stripe_payment_intent_id: paymentIntent.id,
    amount_cents: input.split ? organiserCents : price.totalCents,
    application_fee_cents: input.split ? 0 : price.platformFeeCents,
    status: 'requires_payment_method',
    kind: input.split ? 'share' : 'booking',
    participant_id: organiserParticipantId,
  });
  if (payErr) {
    // The PI is live but we couldn't record it. Cancel the PI, keep the
    // booking in pending and let the cleanup cron expire it — safer than
    // returning success with no DB trail of the payment.
    console.error('payments insert failed; cancelling PI and booking', payErr);
    try {
      await stripe.paymentIntents.cancel(paymentIntent.id);
    } catch (cancelErr) {
      console.error('PI cancel also failed', cancelErr);
    }
    await supa.from('booking_addons').delete().eq('booking_id', bookingRow.id);
    await supa.from('bookings').delete().eq('id', bookingRow.id);
    return errorResponse('DB_ERROR', 'Payment row insert failed', 500);
  }

  // 11. Build the response. Returning publishable_key here saves the mobile
  //     app one round trip to its own config endpoint (there isn't one yet).
  const responseBody = {
    booking: {
      id: bookingRow.id,
      code: bookingRow.code,
      state: bookingRow.state,
      total_cents: bookingRow.total_cents,
      is_split: bookingRow.is_split,
      share_amount_cents: bookingRow.share_amount_cents,
    },
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
