// _shared/stripe.ts
// Stripe client factory for Edge Functions. Single place to pin the API
// version so we upgrade deliberately, not by accident.

import Stripe from 'stripe';

// Pin the API version explicitly. Updating this is a conscious act:
// bump the version string, read the changelog, update callers.
// https://stripe.com/docs/api/versioning
const STRIPE_API_VERSION = '2024-06-20' as const;

export function createStripeClient(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) {
    throw new Error('Missing STRIPE_SECRET_KEY. See functions/.env.example.');
  }
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    // Deno-compatible fetch-based HTTP client. Stripe SDK detects runtime
    // but setting it explicitly avoids surprises.
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export function stripePublishableKey(): string {
  const key = Deno.env.get('STRIPE_PUBLISHABLE_KEY');
  if (!key) {
    throw new Error('Missing STRIPE_PUBLISHABLE_KEY. See functions/.env.example.');
  }
  return key;
}

/** The signing secret from the Stripe dashboard (or from `stripe listen` for
 *  local dev). Different per environment — never share across prod/staging. */
export function stripeWebhookSecret(): string {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) {
    throw new Error('Missing STRIPE_WEBHOOK_SECRET. See functions/.env.example.');
  }
  return secret;
}

/**
 * Verify a Stripe webhook delivery and return the parsed event.
 *
 * MUST be called with the raw request body (as a string) — not re-serialized
 * JSON. Stripe computes the signature over the exact bytes it sent; any
 * JSON round-trip (parse + stringify) reorders keys or strips whitespace
 * and the signature will fail.
 *
 * Two Stripe endpoints deliver to this URL, each with its own signing
 * secret: the platform-account destination (STRIPE_WEBHOOK_SECRET) and the
 * connected-accounts destination for payout.* / account.updated
 * (STRIPE_CONNECT_WEBHOOK_SECRET) — Stripe fixes an endpoint's
 * events-from scope at creation, so connected-account events need their
 * own destination (api-contract.md §5.3). Verification tries the platform
 * secret first and falls back to the connect secret; the connect secret is
 * optional so environments without the second destination keep working.
 *
 * Uses constructEventAsync because Deno's crypto is subtle-based (async).
 * The sync constructEvent call in the Node SDK is not available here.
 */
export async function verifyWebhookEvent(
  rawBody: string,
  signatureHeader: string,
  stripe: Stripe,
): Promise<Stripe.Event> {
  try {
    return await stripe.webhooks.constructEventAsync(
      rawBody,
      signatureHeader,
      stripeWebhookSecret(),
    );
  } catch (err) {
    const connectSecret = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET');
    if (!connectSecret) throw err;
    return await stripe.webhooks.constructEventAsync(
      rawBody,
      signatureHeader,
      connectSecret,
    );
  }
}
