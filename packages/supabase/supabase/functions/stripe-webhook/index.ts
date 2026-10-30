// stripe-webhook/index.ts
// POST /stripe-webhook — receives Stripe events, verifies the signature,
// dedups on event.id, dispatches to per-type handlers.
//
// See docs/api-contract.md §5.3 for the contract.
//
// Dispatch flow:
//   → read raw body (required for signature verification)
//   → verify Stripe-Signature header                   (401 on mismatch)
//   → dedup: INSERT stripe_events, on conflict = duplicate → 200 immediately
//   → dispatch to HANDLERS[event.type]
//       └── unknown type → 200 with `handled: false` (we logged in dedup row)
//   → on handler success: UPDATE stripe_events with final status + notes
//   → on handler error: DELETE stripe_events so Stripe's retry re-runs us
//
// A 5xx response prompts Stripe to retry the delivery (exponential backoff
// up to 3 days). A 2xx response stops retries. Our handlers are idempotent,
// so duplicate deliveries that slip past the dedup layer are still safe.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createStripeClient, verifyWebhookEvent } from '../_shared/stripe.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { HANDLERS } from '../_shared/webhook-handlers/index.ts';

serve(withSentry(async (req) => {
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
  }

  // Raw body — must be read BEFORE any JSON parsing, or the signature
  // check will fail against a re-serialized payload.
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return errorResponse('UNAUTHORIZED', 'Missing Stripe-Signature header', 401);
  }

  const stripe = createStripeClient();
  let event;
  try {
    event = await verifyWebhookEvent(rawBody, sig, stripe);
  } catch (err) {
    console.error('stripe signature verification failed', err);
    return errorResponse('UNAUTHORIZED', 'Signature verification failed', 401);
  }

  const supa = createServiceClient();

  // Dedup: INSERT into stripe_events. 23505 (unique_violation) = already
  // seen this event.id, return 200 fast so Stripe stops retrying.
  const { error: dedupErr } = await supa.from('stripe_events').insert({
    event_id: event.id,
    event_type: event.type,
    response_code: 200,
  });
  if (dedupErr) {
    if (dedupErr.code === '23505') {
      return jsonResponse({ received: true, duplicate: true }, 200);
    }
    console.error('stripe_events insert failed', dedupErr);
    return errorResponse('DB_ERROR', 'Dedup log insert failed', 500);
  }

  const handler = HANDLERS[event.type];
  if (!handler) {
    // Unknown event type: we logged it in stripe_events but don't have a
    // handler. Return 200 so Stripe doesn't retry; if we later care about
    // this type, we add a handler and the next delivery is handled.
    await supa
      .from('stripe_events')
      .update({ notes: 'unhandled-type' })
      .eq('event_id', event.id);
    return jsonResponse({ received: true, handled: false, type: event.type }, 200);
  }

  try {
    const result = await handler({ supa, stripe, event });
    await supa
      .from('stripe_events')
      .update({ response_code: result.status, notes: result.notes ?? null })
      .eq('event_id', event.id);
    return jsonResponse(
      { received: true, handled: true, notes: result.notes ?? null },
      result.status,
    );
  } catch (err) {
    // Delete the dedup row so Stripe's next retry re-runs the handler
    // against a clean slate (rather than our cached "processed" marker).
    await supa.from('stripe_events').delete().eq('event_id', event.id);
    const message = err instanceof Error ? err.message : String(err);
    console.error('webhook handler threw', { type: event.type, id: event.id, err });
    return errorResponse('INTERNAL_ERROR', `Handler failed: ${message}`, 500);
  }
}));
