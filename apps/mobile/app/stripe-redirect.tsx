// Landing route for STRIPE_RETURN_URL (ludi://stripe-redirect).
// The Stripe SDK does the real work — the root layout hands the URL to
// handleURLCallback, which resumes the Payment Sheet after a redirect-based
// payment (Revolut Pay etc.). But expo-router ALSO navigates on every
// incoming URL, and with no matching route that navigation lands on
// "Unmatched Route" over the checkout. This screen exists to absorb that
// navigation and step straight back to whatever was underneath.

import { TOKENS } from '@ludi/ui';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

export default function StripeRedirectScreen() {
  useEffect(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // Cold start via the redirect URL: the Payment Sheet no longer exists,
      // so there is nothing to resume — land on the tabs and let the booking
      // resolve via the webhook + My Bookings, same as an app kill mid-poll.
      router.replace('/(tabs)');
    }
  }, []);

  return <View style={{ flex: 1, backgroundColor: TOKENS.bg }} />;
}
