// create-walk-in-booking/index.ts
// POST /create-walk-in-booking — the venue's front desk (M6 #41j).
//
// The phone rings, someone walks in: the owner records a REAL booking,
// paid offline, and the slot is blocked against app bookings by the same
// EXCLUDE constraint. Deliberately a SEPARATE function from create-booking
// (re-plan 2026-08-28, decision 2): the Stripe path keeps a zero diff, and
// this path never touches Stripe at all — no PaymentIntent, no webhook.
// The payments row it writes is bookkeeping (payment_method='offline',
// synthetic intent id), which is exactly what makes walk-in revenue appear
// in v_venue_earnings_daily. Ludi takes no fee on a walk-in paid at the desk (decision
// 2026-09-12, docs/plans/venue-offer.md); the schema enforces it
// (bookings_venue_collected_no_fee, payments_offline_no_fee).
//
// Also handles action='cancel' for walk-ins only: a mis-tap must not be a
// permanent slot block, and since no platform money moved, undoing one is
// a state change plus an audit row — not a refund.
//
// Control flow at a glance:
//   CORS preflight
//   → extract + validate JWT             (401 UNAUTHORIZED)
//   → parse + Zod-validate body          (400 VALIDATION_FAILED)
//   → resolve target pitch (input or via booking)
//   → caller is admin OR owner/manager of the pitch's venue
//                                        (403 NOT_AUTHORIZED)
//   create:
//     → Idempotency-Key REQUIRED         (400 / 409 IDEMPOTENCY_MISMATCH)
//     → pitch + venue active             (409 PITCH_NOT_BOOKABLE)
//     → compute price (override-aware)
//     → booking code (RPC) → INSERT booking (409 SLOT_UNAVAILABLE on 23P01)
//     → INSERT addons → INSERT offline payments row → audit → 200
//   cancel:
//     → booking is origin='walk_in', state 'confirmed' or 'completed'
//                                        (409 INVALID_BOOKING_STATE)
//     → state→cancelled, payment→cancelled → audit → 200

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { getUserFromRequest } from '../_shared/auth.ts';
import {
  corsHeaders,
  errorResponse,
  jsonResponse,
  pgErrorSummary,
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
import { WalkInInput } from '../_shared/schemas/walk-in.ts';
import { normaliseWalkInPhone } from '../_shared/walk-in-phone.ts';
import { createServiceClient } from '../_shared/supabase.ts';

const CANCELLABLE_WALK_IN_STATES = ['confirmed', 'completed'];

const PG_EXCLUSION_VIOLATION = '23P01';
const PG_CHECK_VIOLATION = '23514';
// Ludi takes no fee on bookings it did not bring (20260912000001).
const WALK_IN_TAKE_RATE_BPS = 0;

interface PitchRow {
  id: string;
  is_active: boolean;
  price_per_hour_cents: number;
  venues: {
    id: string;
    is_active: boolean;
    cancellation_policy: 'standard' | 'strict' | 'flex';
    cities: { code: string };
  };
}

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
  const parsed = WalkInInput.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, {
      issues: parsed.error.issues,
    });
  }
  const input = parsed.data;

  const supa = createServiceClient();

  // 3. Resolve the pitch this request acts on. For cancel it comes off the
  //    booking, which we load (and hold) before authorising against it.
  let pitchId: string;
  let cancelTarget:
    | { id: string; code: string; state: string; origin: string }
    | null = null;

  if (input.action === 'create') {
    pitchId = input.pitch_id;
  } else {
    const { data: bookingData, error: bookingErr } = await supa
      .from('bookings')
      .select('id, code, state, origin, pitch_id')
      .eq('id', input.booking_id)
      .maybeSingle();
    if (bookingErr) {
      console.error('booking lookup failed', pgErrorSummary(bookingErr));
      return errorResponse('DB_ERROR', 'Failed to load booking', 500);
    }
    if (!bookingData) {
      return errorResponse('BOOKING_NOT_FOUND', 'No such booking', 404);
    }
    cancelTarget = bookingData;
    pitchId = bookingData.pitch_id as string;
  }

  // 4. Authorise: platform admin, or owner/manager of the pitch's venue.
  //    Service role bypasses RLS, so the gate must be explicit here — this
  //    is the same check is_venue_owner_of_pitch() makes, spelled out
  //    because auth.uid() is meaningless under the service key.
  const { data: pitchData, error: pitchErr } = await supa
    .from('pitches')
    .select(
      `
        id,
        is_active,
        price_per_hour_cents,
        venues!inner (
          id,
          is_active,
          cancellation_policy,
          cities!inner ( code )
        )
      `,
    )
    .eq('id', pitchId)
    .maybeSingle();
  if (pitchErr) {
    console.error('pitch lookup failed', pgErrorSummary(pitchErr));
    return errorResponse('DB_ERROR', 'Failed to load pitch', 500);
  }
  if (!pitchData) {
    return errorResponse('PITCH_NOT_FOUND', 'Pitch not found', 404);
  }
  const pitch = pitchData as unknown as PitchRow;
  const venue = pitch.venues;

  const { data: callerRow, error: callerErr } = await supa
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (callerErr) {
    console.error('caller role lookup failed', pgErrorSummary(callerErr));
    return errorResponse('DB_ERROR', 'Failed to verify role', 500);
  }
  let authorised = callerRow?.role === 'admin';
  if (!authorised) {
    const { data: ownerRow, error: ownerErr } = await supa
      .from('venue_owners')
      .select('user_id')
      .eq('venue_id', venue.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (ownerErr) {
      console.error('venue owner lookup failed', pgErrorSummary(ownerErr));
      return errorResponse('DB_ERROR', 'Failed to verify venue access', 500);
    }
    authorised = Boolean(ownerRow);
  }
  if (!authorised) {
    return errorResponse(
      'NOT_AUTHORIZED',
      'Walk-in bookings are for the venue owner or Ludi staff',
      403,
    );
  }

  // ── cancel ─────────────────────────────────────────────────────────
  if (input.action === 'cancel') {
    const target = cancelTarget!;
    if (target.origin !== 'walk_in') {
      // App bookings carry real Stripe money; they cancel through
      // cancel-booking / admin-refund-booking, never through here.
      return errorResponse(
        'INVALID_BOOKING_STATE',
        'Only walk-in bookings can be cancelled here',
        409,
      );
    }
    // `completed` too: complete_played_bookings() flips a walk-in to
    // completed within the hour after it ends, and a walk-in is the
    // owner's own record of counter money — a €450 typed for €45, or a
    // booking logged on the wrong day, must stay correctable after the
    // slot has passed. Nothing else hangs off a walk-in (it seats no one,
    // 20260913000003), so un-counting it is the whole correction.
    if (!CANCELLABLE_WALK_IN_STATES.includes(target.state)) {
      return errorResponse(
        'INVALID_BOOKING_STATE',
        `Walk-in is in state '${target.state}'; it can no longer be cancelled`,
        409,
      );
    }

    // State-guarded UPDATE: two concurrent cancels race here, and the
    // .in('state', …) filter lets exactly one of them win.
    const { data: updated, error: updateErr } = await supa
      .from('bookings')
      .update({ state: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', target.id)
      .in('state', CANCELLABLE_WALK_IN_STATES)
      .select('id, state')
      .maybeSingle();
    if (updateErr) {
      console.error('walk-in cancel failed', pgErrorSummary(updateErr));
      return errorResponse('DB_ERROR', 'Cancel failed', 500);
    }
    if (!updated) {
      return errorResponse(
        'INVALID_BOOKING_STATE',
        'Walk-in was already cancelled',
        409,
      );
    }

    // The offline payments row was bookkeeping; mark it cancelled so the
    // earnings view stops counting it (its status filter excludes
    // cancelled). No money moves anywhere.
    const { error: payErr } = await supa
      .from('payments')
      .update({ status: 'cancelled' })
      .eq('booking_id', target.id)
      .eq('payment_method', 'offline');
    if (payErr) {
      // Booking is cancelled but the payment row still counts in earnings —
      // loud log so it gets fixed by hand; not worth un-cancelling over.
      console.error('offline payment cancel failed', pgErrorSummary(payErr));
    }

    const { error: auditErr } = await supa.from('admin_actions').insert({
      admin_user_id: user.id,
      action_type: 'walk_in_cancelled',
      target_type: 'booking',
      target_id: target.id,
      reason: input.reason || `cancelled walk-in ${target.code}`,
      payload: { booking_code: target.code },
    });
    if (auditErr) console.error('walk-in cancel audit failed', pgErrorSummary(auditErr));

    return jsonResponse({ booking: { id: target.id, state: 'cancelled' } }, 200);
  }

  // ── create ─────────────────────────────────────────────────────────

  // 5. Idempotency — REQUIRED here (unlike create-booking, where the app
  //    owns retries): a double-tap at the front desk must not double-book.
  let idempotencyKey: string | null;
  try {
    idempotencyKey = readIdempotencyKey(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid Idempotency-Key';
    return errorResponse('VALIDATION_FAILED', message, 400);
  }
  if (!idempotencyKey) {
    return errorResponse(
      'VALIDATION_FAILED',
      'Idempotency-Key header is required for walk-in bookings',
      400,
    );
  }
  const requestHash = await sha256Hex(canonicalJson(input));
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

  // 6. Bookability — deliberately WEAKER than create-booking's gate: no
  //    is_verified, no Stripe checks. A venue still onboarding Stripe
  //    (Piacere today) takes cash walk-ins from day one; only genuinely
  //    switched-off pitches/venues refuse.
  if (!pitch.is_active || !venue.is_active) {
    return errorResponse('PITCH_NOT_BOOKABLE', 'Pitch is not active', 409);
  }

  // 7. Price. The override, when present, is what the desk actually
  //    charged for the slot (addons still on top). No commission either
  //    way: Ludi didn't bring this booking, so the take rate is 0 here
  //    whatever the venue's. computeBookingPrice validates shape.
  let price;
  try {
    price = computeBookingPrice({
      startsAt: new Date(input.starts_at),
      endsAt: new Date(input.ends_at),
      pricePerHourCents: pitch.price_per_hour_cents,
      addons: input.addons,
      takeRateBps: WALK_IN_TAKE_RATE_BPS,
    });
    if (input.price_override_cents !== undefined) {
      const baseCents = input.price_override_cents;
      price = { ...price, baseCents, totalCents: baseCents + price.addonsCents };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Price computation failed';
    return errorResponse('VALIDATION_FAILED', message, 400);
  }

  // 8. Booking code via the same atomic sequence as app bookings — a
  //    walk-in code is indistinguishable from any other, on purpose.
  const cityPrefix = venue.cities.code.slice(0, 3).toUpperCase();
  const bookingYear = new Date(input.starts_at).getUTCFullYear();
  const { data: codeData, error: codeErr } = await supa.rpc('generate_booking_code', {
    p_city_prefix: cityPrefix,
    p_year: bookingYear,
  });
  if (codeErr || typeof codeData !== 'string') {
    console.error('booking code generation failed', pgErrorSummary(codeErr));
    return errorResponse('DB_ERROR', 'Failed to generate booking code', 500);
  }

  // 9. INSERT the booking — state 'confirmed' from birth (the money is in
  //    the till), so the EXCLUDE constraint blocks the slot immediately.
  // Digits, and a country code on a bare Cypriot number — see the helper.
  const normalisedPhone = normaliseWalkInPhone(input.customer_phone);
  const { data: bookingRow, error: bookingErr } = await supa
    .from('bookings')
    .insert({
      code: codeData,
      user_id: user.id,
      pitch_id: input.pitch_id,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      state: 'confirmed',
      origin: 'walk_in',
      walk_in_name: input.customer_name,
      walk_in_phone: normalisedPhone,
      contact_id: input.contact_id ?? null,
      base_price_cents: price.baseCents,
      addons_price_cents: price.addonsCents,
      total_cents: price.totalCents,
      platform_fee_cents: price.platformFeeCents,
      cancellation_policy: venue.cancellation_policy,
    })
    .select('id, code, state, total_cents')
    .single();
  if (bookingErr) {
    if (bookingErr.code === PG_EXCLUSION_VIOLATION) {
      return errorResponse(
        'SLOT_UNAVAILABLE',
        'Another booking already holds this slot. Pick a different time.',
        409,
      );
    }
    // tg_bookings_contact (20260918000002): the picked contact is not one
    // of this booking's venue. Unreachable from the form, which only offers
    // the venue's own — so this is a tampered or stale request, and says so
    // without naming whose contact it was.
    if (bookingErr.code === PG_CHECK_VIOLATION && input.contact_id) {
      return errorResponse(
        'VALIDATION_FAILED',
        'That contact is not one of this venue’s. Pick them again from the list.',
        400,
      );
    }
    console.error('walk-in booking insert failed', pgErrorSummary(bookingErr));
    return errorResponse('DB_ERROR', 'Booking insert failed', 500);
  }

  // 10. Addons, with the same compensating delete as create-booking.
  if (input.addons.length > 0) {
    const addonRows = input.addons.map((a) => ({
      booking_id: bookingRow.id,
      addon_code: a.code,
      quantity: a.quantity,
      unit_price_cents: ADDON_PRICES[a.code],
    }));
    const { error: addonErr } = await supa.from('booking_addons').insert(addonRows);
    if (addonErr) {
      console.error('addon insert failed, rolling back walk-in', pgErrorSummary(addonErr));
      await supa.from('bookings').delete().eq('id', bookingRow.id);
      return errorResponse('DB_ERROR', 'Addon insert failed', 500);
    }
  }

  // 11. The offline payments row — the whole reason walk-ins count in
  //     v_venue_earnings_daily. Synthetic intent id keyed to the booking
  //     UUID (can never collide with a Stripe 'pi_…'); no fee, as on the
  //     booking row.
  const { error: payErr } = await supa.from('payments').insert({
    booking_id: bookingRow.id,
    stripe_payment_intent_id: `offline_${bookingRow.id}`,
    amount_cents: price.totalCents,
    application_fee_cents: price.platformFeeCents,
    status: 'succeeded',
    payment_method: 'offline',
  });
  if (payErr) {
    // Without the payment row the booking would silently not count in
    // earnings — the exact under-reporting the walk-in decision exists to
    // prevent. Roll the whole thing back and let the desk retry.
    console.error('offline payment insert failed, rolling back walk-in', pgErrorSummary(payErr));
    await supa.from('booking_addons').delete().eq('booking_id', bookingRow.id);
    await supa.from('bookings').delete().eq('id', bookingRow.id);
    return errorResponse('DB_ERROR', 'Payment row insert failed', 500);
  }

  // 12. Audit — service-role insert, vocabulary from 20260829000001.
  const { error: auditErr } = await supa.from('admin_actions').insert({
    admin_user_id: user.id,
    action_type: 'walk_in_created',
    target_type: 'booking',
    target_id: bookingRow.id,
    reason: `walk-in ${bookingRow.code} for ${input.customer_name}`,
    payload: {
      booking_code: bookingRow.code,
      pitch_id: input.pitch_id,
      total_cents: price.totalCents,
      price_overridden: input.price_override_cents !== undefined,
    },
  });
  if (auditErr) console.error('walk-in audit insert failed', pgErrorSummary(auditErr));

  const responseBody = {
    booking: {
      id: bookingRow.id,
      code: bookingRow.code,
      state: bookingRow.state,
      total_cents: bookingRow.total_cents,
    },
  };
  await storeIdempotentResponse(supa, idempotencyKey, user.id, requestHash, 200, responseBody);
  return jsonResponse(responseBody, 200);
}));
