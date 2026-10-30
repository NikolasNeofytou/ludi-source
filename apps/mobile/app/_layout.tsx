// Root layout. Loads fonts, boots i18n, mounts the SessionProvider,
// wraps StripeProvider for Payment Sheet access, and routes between (auth)
// and (tabs) based on session state. The ConsentGate sits outside the
// SessionProvider so GDPR consent precedes any data flow at all.
import {
  EASE,
  GREEK_DISPLAY,
  MARK_GROUND,
  MOTION,
  NestWait,
  RADII,
  TOKENS,
  setHapticsHandler,
  useReduceMotion,
} from '@ludi/ui';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { StripeProvider, useStripe } from '@stripe/stripe-react-native';
import { useURL } from 'expo-linking';
import {
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_500Medium_Italic,
} from '@expo-google-fonts/fraunces';
import {
  Literata_400Regular,
  Literata_500Medium,
  Literata_500Medium_Italic,
  Literata_600SemiBold,
} from '@expo-google-fonts/literata';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { Stack, usePathname, useRouter, useSegments, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, withTiming } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import * as Sentry from '@sentry/react-native';

import { ConsentScreen } from '@/components/ConsentScreen';
import { LudiLaunch } from '@/components/LudiLaunch';
import { UpdateGate } from '@/components/UpdateGate';
import { setAnalyticsConsent, capture } from '@/lib/analytics';
import { startAuthCallbackCapture } from '@/lib/auth-callback';
import { getConsent } from '@/lib/consent';
import { LIQUID_GLASS } from '@/lib/glass';
import { bootstrapI18n } from '@/lib/i18n';
import { takePendingInvite } from '@/lib/invite';
import { isResumableRoute, setPendingRoute, takePendingRoute } from '@/lib/pending-route';
import { routeForNotice, syncPushToken } from '@/lib/push';
import { initSentry } from '@/lib/sentry';
import { SessionProvider, useSession } from '@/lib/session';

// Initialise crash reporting as early as possible — before any render, and
// independently of the consent gate (legitimate interest; see ADR-0010).
// No-op when EXPO_PUBLIC_SENTRY_DSN is unset.
initSentry();

// Before any navigation: a magic-link callback delivered while the app is
// running must be caught before the /callback screen mounts.
startAuthCallbackCapture();

// Stripe publishable key is public by design — safe to ship in the bundle.
// The matching secret key lives only in the Edge Function env. create-booking
// also returns it for future env-mismatch detection (not wired yet).
const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
// Apple Pay merchant identifier — placeholder until the real Apple Developer
// merchant ID is registered. Card-only Payment Sheet works without this.
const APPLE_PAY_MERCHANT_ID = 'merchant.com.ludi.app';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Give @ludi/ui primitives (Button press, SegmentedControl selection) and the
// screens real haptics. The package itself is Expo-free; this is the ONE wiring
// point — nothing else in the app imports expo-haptics. Android takes the
// modern HapticFeedbackConstants path (no VIBRATE permission, actuator-tuned)
// rather than the legacy vibrator the iOS-named calls fall back to:
// a press is a virtual key, a selection is a segment tick, the success is
// the system confirm, the error the system reject (ADR-0035's 2026-10-20
// amendment — three sites only; see packages/ui/src/haptics.ts).
const ANDROID_HAPTIC = {
  press: Haptics.AndroidHaptics.Virtual_Key,
  selection: Haptics.AndroidHaptics.Segment_Tick,
  success: Haptics.AndroidHaptics.Confirm,
  error: Haptics.AndroidHaptics.Reject,
} as const;
setHapticsHandler((kind) => {
  if (Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(ANDROID_HAPTIC[kind]).catch(() => {});
    return;
  }
  if (kind === 'press') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } else if (kind === 'selection') {
    Haptics.selectionAsync().catch(() => {});
  } else if (kind === 'success') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  } else {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  }
});

// Hard ceiling on the branded launch overlay. The overlay covers the whole app
// while it plays, so a launch sequence that failed to hand off — a thrown
// animation, a timer that never fires, a device where reduce-motion resolution
// hangs — would leave the app visually bricked with no way out. This guarantees
// the app is revealed regardless of what the sequence does.
const LAUNCH_MAX_MS = 4000;

// The one sheet shape — the fixture's seat and leave sheets and a CFA team.
// On iOS 26+ the system draws the sheet: Liquid Glass while it rests at its
// detent, corners concentric with the phone's own. Pinning a radius or an
// opaque fill there would overrule both. Below iOS 26 and on Android the
// brand's 28pt surface stays. See docs/plans/ios-current.md (tier 0).
const SHEET = {
  presentation: 'formSheet',
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
  ...(LIQUID_GLASS
    ? { contentStyle: { backgroundColor: 'transparent' } }
    : { sheetCornerRadius: RADII.xl, contentStyle: { backgroundColor: TOKENS.surface } }),
} as const;

// Consent gate — blocks the app behind a first-launch GDPR modal.
// Sits OUTSIDE SessionProvider + StripeProvider so no data-flow
// machinery initialises before the user has consented. Reads
// AsyncStorage once on mount; once accepted, future launches
// (until policy version bumps) pass through immediately.
function ConsentGate({ children }: { children: React.ReactNode }) {
  type State = { kind: 'checking' } | { kind: 'needed' } | { kind: 'given' };
  const [state, setState] = useState<State>({ kind: 'checking' });

  const [analyticsOptIn, setAnalyticsOptIn] = useState(false);

  const refresh = useCallback(async () => {
    const record = await getConsent();
    setAnalyticsOptIn(record?.analytics ?? false);
    setState({ kind: record ? 'given' : 'needed' });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const { i18n } = useTranslation();

  // Drive PostHog from the consent record's analytics choice (ADR-0011,
  // consent v2): passing the notice is NOT an analytics opt-in. Nothing
  // initialises or sends unless the user switched analytics on; app_opened
  // fires once, and only then. Later changes go through setAnalyticsChoice.
  useEffect(() => {
    if (state.kind === 'given' && analyticsOptIn) {
      setAnalyticsConsent(true);
      capture('app_opened', { locale: i18n.language?.startsWith('gr') ? 'gr' : 'en' });
    } else if (state.kind !== 'checking') {
      setAnalyticsConsent(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, analyticsOptIn]);

  if (state.kind === 'checking') {
    return (
      // The consent record is a local read: nothing shows unless it is slow
      // (motion-v3 slice 6 — no full-screen spinner).
      <View style={{ flex: 1, backgroundColor: TOKENS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <NestWait />
      </View>
    );
  }
  if (state.kind === 'needed') {
    return <ConsentScreen onAccepted={refresh} />;
  }
  return <>{children}</>;
}

// Hands every incoming deep link to the Stripe SDK so a redirect-based
// payment (Revolut Pay etc.) resumes the Payment Sheet when the user comes
// back from the external app. iOS needs the explicit call; on Android the
// SDK handles the return itself and this no-ops. Non-Stripe URLs (the auth
// callback, invite links) are ignored by the SDK — it returns false and the
// router handles them as before. Must render inside StripeProvider.
function StripeRedirectHandler() {
  const { handleURLCallback } = useStripe();
  const url = useURL();

  useEffect(() => {
    if (url) {
      handleURLCallback(url).catch(() => {
        // A URL the SDK chokes on is the router's problem, not a crash.
      });
    }
  }, [url, handleURLCallback]);

  return null;
}

// Auth gate — redirects between (auth) and (tabs) based on session state.
// Lives inside SessionProvider so it has access to useSession.
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthed, loading } = useSession();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    // `f/[token]` is the fixture invite preview (docs/plans/shared-fixture.md
    // ARCHITECTURE §"the invite has to survive sign-in") and it is meant to
    // render SIGNED OUT: a stranger deciding whether to install Ludi has to
    // see what they are being invited to before this gate would otherwise
    // bounce them straight to /signin. Excluded exactly like `(auth)` is —
    // the screen itself handles both the signed-out preview and, once
    // signed in, resuming to the fixture.
    const inInviteRoute = segments[0] === 'f';
    if (!isAuthed && !inAuthGroup && !inInviteRoute) {
      // A venue link opened signed out (the CFA follow QR on the venue's
      // TV, plans/release-1-0.md E1) is kept, so sign-in lands on the venue
      // and not on Discover.
      if (isResumableRoute(pathname)) void setPendingRoute(pathname);
      router.replace('/(auth)/signin');
      return;
    }
    if (isAuthed && inAuthGroup) {
      // This is the one place every sign-in method funnels through — phone
      // OTP, magic link, Apple, Google — none of the (auth) screens navigate
      // on success themselves, they just wait for the session to change and
      // let this effect react. So it is also the one place to resume a
      // deep-link invite that survived the round trip through sign-in: if a
      // token was stashed before the redirect to /signin, consume it and
      // land back on the fixture instead of the tabs the newcomer never
      // asked for.
      takePendingInvite().then(async (token) => {
        if (token) {
          router.replace(`/f/${token}`);
          return;
        }
        const route = await takePendingRoute();
        router.replace((route ?? '/(tabs)') as Href);
      });
    }
  }, [isAuthed, loading, segments, pathname, router]);

  return <>{children}</>;
}

// The push substrate's two launch-time jobs (plans/reach.md R2): keep a
// granted token registered — never an ask, those live at four moments —
// and route a tapped notice to the fixture or the board. Lives inside
// SessionProvider and AuthGate so a route lands on a signed-in app; a
// tap that arrives signed out is dropped, not queued.
function PushRegistrar() {
  const { session } = useSession();
  const router = useRouter();
  const userId = session?.user.id;

  useEffect(() => {
    if (userId) void syncPushToken();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const open = (data: unknown) => {
      const route = routeForNotice(data);
      if (__DEV__) console.log('[push] tapped', route ?? 'no route for', JSON.stringify(data));
      if (!route) return;
      capture('push_opened', {
        kind: route.endsWith('community') ? 'community' : route.endsWith('bookings') ? 'bookings' : 'booking',
      });
      router.push(route as Href);
    };
    // A tap that launched the app cold, then every tap while it runs.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) open(response.notification.request.content.data);
      })
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener((response) =>
      open(response.notification.request.content.data),
    );
    return () => sub.remove();
  }, [userId, router]);

  return null;
}

// The launch hands off by fading out over the app it has been covering
// (`quick`), not navy → chalk in one frame (motion-v3 slice 6). An effect, so
// Reduce Motion halves it rather than skipping it.
const launchOut = (reduceMotion: boolean) => () => {
  'worklet';
  return {
    initialValues: { opacity: 1 },
    animations: {
      opacity: withTiming(0, {
        duration: reduceMotion ? MOTION.quick / 2 : MOTION.quick,
        easing: EASE,
        reduceMotion: ReduceMotion.Never,
      }),
    },
  };
};

function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);
  const [launchDone, setLaunchDone] = useState(false);
  const reduceMotion = useReduceMotion();

  // Static instances only — RN font matching cannot select weights within a
  // custom family, so each weight registers under its own family name and
  // TOKENS carries one token per weight (display / displaySemi / mono / …).
  // The keys MUST match the family names in packages/ui/src/tokens.ts.
  const [fontsLoaded] = useFonts({
    Fraunces: Fraunces_500Medium,
    'Fraunces-SemiBold': Fraunces_600SemiBold,
    'Fraunces-Italic': Fraunces_500Medium_Italic,
    Literata: Literata_400Regular,
    'Literata-SemiBold': Literata_600SemiBold,
    // Greek display text (Fraunces has no Greek) — see displayFamily().
    'Literata-Medium': Literata_500Medium,
    'Literata-MediumItalic': Literata_500Medium_Italic,
    JetBrainsMono: JetBrainsMono_400Regular,
    'JetBrainsMono-Medium': JetBrainsMono_500Medium,
    'JetBrainsMono-Bold': JetBrainsMono_700Bold,
  });

  // The silent-fallback failure mode (useFonts({}) shipped for four months
  // with every string rendering SF Pro — see JOURNAL 2026-08-10) must never
  // recur: assert in dev that every family TOKENS names is registered.
  if (__DEV__ && fontsLoaded) {
    const registered = new Set([
      'Fraunces',
      'Fraunces-SemiBold',
      'Fraunces-Italic',
      'Literata',
      'Literata-SemiBold',
      'Literata-Medium',
      'Literata-MediumItalic',
      'JetBrainsMono',
      'JetBrainsMono-Medium',
      'JetBrainsMono-Bold',
    ]);
    for (const fam of [
      TOKENS.display,
      TOKENS.displaySemi,
      TOKENS.displayItalic,
      TOKENS.poster,
      TOKENS.posterSemi,
      TOKENS.mono,
      TOKENS.monoMedium,
      TOKENS.monoBold,
      ...Object.values(GREEK_DISPLAY),
    ]) {
      if (!registered.has(fam)) {
        console.error(`[fonts] TOKENS names unregistered family "${fam}" — text will silently fall back to the system font.`);
      }
    }
  }

  useEffect(() => {
    bootstrapI18n()
      .catch((err) => {
        console.warn('i18n bootstrap failed, falling back to EN', err);
      })
      .finally(() => setI18nReady(true));
  }, []);

  useEffect(() => {
    if (i18nReady && fontsLoaded) {
      // The native splash hands straight over to LudiLaunch, which is the same
      // mark on the same ground — so the seam is invisible and the branded
      // sequence carries on from where the static image stopped.
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [i18nReady, fontsLoaded]);

  useEffect(() => {
    const timer = setTimeout(() => setLaunchDone(true), LAUNCH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!i18nReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {/* Outermost gate: a retired build (plans/ops-readiness.md O7) shows
            one Update screen and mounts nothing else. */}
        <UpdateGate>
          <ConsentGate>
            <StripeProvider
              publishableKey={STRIPE_PUBLISHABLE_KEY}
              merchantIdentifier={APPLE_PAY_MERCHANT_ID}
            >
              <StripeRedirectHandler />
              <SessionProvider>
                <AuthGate>
                  <PushRegistrar />
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      contentStyle: { backgroundColor: TOKENS.bg },
                    }}
                  >
                    {/* Signing in or out swaps one world for the other:
                        it fades rather than sliding in like a pushed screen
                        (plans/motion-v3.md, "Sign-in lands"). */}
                    <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
                    <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
                    {/* The fixture's two sheets, declared here rather than in a
                        `booking/[id]/_layout.tsx`: a layout there would also
                        wrap `checkout` and `confirmed` in a nested navigator,
                        and the payment flow is not worth re-parenting to move a
                        sheet. `fitToContents` means the sheet is as tall as its
                        content and no taller — Android caps at three detents,
                        irrelevant at one. See ADR-0035 and
                        docs/plans/gesture-motion.md (G3). */}
                    <Stack.Screen
                      name="booking/[id]/seat"
                      options={SHEET}
                    />
                    {/* Following a CFA team (plans/cfa-in-the-app.md K3), the
                        same sheet shape as the fixture's two. */}
                    <Stack.Screen
                      name="team/[id]"
                      options={SHEET}
                    />
                    <Stack.Screen
                      name="booking/[id]/leave"
                      options={SHEET}
                    />
                  </Stack>
                </AuthGate>
              </SessionProvider>
            </StripeProvider>
          </ConsentGate>
        </UpdateGate>

        {launchDone ? null : (
          <Animated.View style={styles.launch} pointerEvents="none" exiting={launchOut(reduceMotion)}>
            <LudiLaunch size={180} onFinish={() => setLaunchDone(true)} />
          </Animated.View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // `pointerEvents="none"` so that even while the overlay is up, nothing can
  // swallow a tap permanently if the dismissal misbehaves.
  launch: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MARK_GROUND,
  },
});

// Sentry.wrap installs the error boundary + touch/navigation breadcrumbs.
// Harmless when Sentry is uninitialised (no DSN).
export default Sentry.wrap(RootLayout);
