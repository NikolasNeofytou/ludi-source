// Stripe Payment Sheet wrapper (M2 #9). Presents the native iOS/Android sheet
// so the user can pay with card, Apple Pay (when the merchant ID is wired),
// or any redirect-based method enabled in the Stripe Dashboard (Revolut Pay).
//
// Two-call API per Stripe SDK: initPaymentSheet then presentPaymentSheet.
// Caller passes the `client_secret` returned by create-booking; Stripe handles
// auth/3DS/Apple Pay UI without us touching it.

import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';

// Where redirect-based methods (Revolut Pay, iDEAL, …) send the user back to.
// Must resolve to a top-level route file — route groups contribute nothing to
// the URL, which is how ludi://auth/callback ended up on "Unmatched Route".
// app/stripe-redirect.tsx catches the router side; the root layout's
// handleURLCallback hands the URL to the Stripe SDK so the sheet resumes.
export const STRIPE_RETURN_URL = 'ludi://stripe-redirect';

export type CheckoutOutcome = 'success' | 'cancelled' | 'failed';

export interface CheckoutArgs {
  clientSecret: string;
  // Returned by create-booking — used as `merchantDisplayName`. The Stripe
  // publishable key itself is read by StripeProvider at app root.
  merchantDisplayName?: string;
  // iOS only: requires merchant identifier configured in app.json + a real
  // Apple Developer account. Card-only mode works without this.
  applePay?: { merchantCountryCode: string };
}

export interface CheckoutFailure {
  outcome: 'failed';
  message: string;
  // Stripe error codes ('Canceled', 'Failed', etc.) for log/analytics.
  stripeCode?: string;
}

export interface CheckoutSuccess {
  outcome: 'success';
}
export interface CheckoutCancelled {
  outcome: 'cancelled';
}

export type CheckoutResult = CheckoutSuccess | CheckoutCancelled | CheckoutFailure;

export async function runCheckout(args: CheckoutArgs): Promise<CheckoutResult> {
  const initResult = await initPaymentSheet({
    paymentIntentClientSecret: args.clientSecret,
    merchantDisplayName: args.merchantDisplayName ?? 'Ludi',
    applePay: args.applePay,
    // Without a returnURL the sheet hides every redirect-based method, so
    // enabling one in the Stripe Dashboard (Revolut Pay) would silently do
    // nothing on builds cut before this shipped.
    returnURL: STRIPE_RETURN_URL,
    allowsDelayedPaymentMethods: false,
    style: 'automatic',
  });

  if (initResult.error) {
    return {
      outcome: 'failed',
      message: initResult.error.message,
      stripeCode: initResult.error.code,
    };
  }

  const presentResult = await presentPaymentSheet();

  if (presentResult.error) {
    // Stripe SDK signals user-cancel as code 'Canceled'. Treat it as a
    // distinct outcome so the UI doesn't show an error banner — the user
    // chose to back out.
    if (presentResult.error.code === 'Canceled') {
      return { outcome: 'cancelled' };
    }
    return {
      outcome: 'failed',
      message: presentResult.error.message,
      stripeCode: presentResult.error.code,
    };
  }

  return { outcome: 'success' };
}
