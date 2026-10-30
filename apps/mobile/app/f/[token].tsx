// The fixture invite preview (booking-as-shared-fixture, W5).
//
// Reached from `https://ludi.football/f/<token>` (universal link, C1) or
// `ludi://f/<token>` (the web fallback's "Open in Ludi" button) — the invite
// link, never the booking code
// (ADR-0021). Deliberately renders signed-out: a stranger deciding whether
// to install Ludi has to see what they are being invited to first. This
// route is carved out of the global AuthGate redirect in app/_layout.tsx
// for exactly that reason.
//
// The sequence a real invite goes through: cold app → deep link → sign-in →
// back here. `takePendingInvite()`/`setPendingInvite()` (src/lib/invite.ts)
// carry the token through that round trip; app/_layout.tsx's AuthGate
// consumes it once a session exists and resumes here instead of dropping the
// newcomer on the tabs.
//
// Joining lands on "You're in" (booking/[id]/joined, the second celebration)
// and from there on the fixture screen, which reads `v_fixture` /
// `v_fixture_roster` as any other participant would — this screen never
// renders the roster itself, per DATA_MODEL's minimisation posture.

import {
  Avatar,
  Button,
  Card,
  MOTION,
  ROW_LAYOUT,
  Reveal,
  RiseIn,
  SPACE,
  Skeleton,
  TOKENS,
  haptic,
} from '@ludi/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { newIdempotencyKey } from '@/lib/booking';
import {
  claimShare,
  ClaimShareError,
  fetchFixture,
  fetchFixturePreview,
  formatFixtureDate,
  formatFixtureTimeRange,
  joinFixture,
  JoinFixtureError,
  ReplacementError,
  takeSeat,
  type FixturePreview,
  type SlotKind,
} from '@/lib/fixture';
import { inviteRecorded } from '@/lib/recording';
import { capture } from '@/lib/analytics';
import { setPendingInvite, takePendingInvite } from '@/lib/invite';
import { useSession } from '@/lib/session';
import { runCheckout } from '@/lib/stripe-checkout';

type LoadState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'ready'; preview: FixturePreview };

export default function InvitePreviewScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { isAuthed, loading: sessionLoading } = useSession();
  const locale: 'en' | 'gr' = i18n.language === 'gr' ? 'gr' : 'en';

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [joining, setJoining] = useState<SlotKind | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  // `fixture_preview()` deliberately carries no per-viewer information (it is
  // callable signed-out), so "am I already on this roster?" is answered by
  // whether `v_fixture` — participant-gated — resolves at all. Otherwise a
  // full fixture reads as "you're excluded" to the organiser re-opening
  // their own link, which is exactly backwards.
  // `null` while the check is in flight: the join buttons wait for the
  // answer instead of showing and then swapping to "already joined".
  const [alreadyIn, setAlreadyIn] = useState<boolean | null>(null);
  // Court cameras (ADR-0042): a joiner is told before he takes a spot.
  const [recorded, setRecorded] = useState(false);
  useEffect(() => {
    if (token) inviteRecorded(token).then(setRecorded).catch(() => {});
  }, [token]);

  const load = useCallback(() => {
    if (!token) return;
    setState({ status: 'loading' });
    fetchFixturePreview(token)
      .then((preview) => setState(preview ? { status: 'ready', preview } : { status: 'not_found' }))
      .catch(() => setState({ status: 'not_found' }));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (state.status !== 'ready' || !isAuthed) {
      setAlreadyIn(false);
      return;
    }
    setAlreadyIn(null);
    let cancelled = false;
    fetchFixture(state.preview.booking_id)
      .then((data) => {
        // `fetchFixture` succeeding no longer means "on the roster right
        // now" — read access survives leaving (W6), so someone who left
        // this exact fixture gets a non-null result too. Check their own
        // row's status specifically: 'in' is already-in, 'out' or absent
        // both fall through to the ordinary join buttons, and for an 'out'
        // row that IS the rejoin path — join_fixture flips the same row
        // back rather than inserting a second one.
        const ownRow = data?.roster.find((r) => r.is_you);
        if (!cancelled) setAlreadyIn(ownRow?.status === 'in');
      })
      .catch(() => {
        if (!cancelled) setAlreadyIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state, isAuthed]);

  // Stash the token the instant it is known to be real, before the user does
  // anything else — the tap that sends them to sign-in can happen seconds
  // later, or the OS can kill the app under the SMS app in between. Only
  // when signed out: the stash exists to survive sign-in, and a token stashed
  // by someone already in was never consumed, so their NEXT sign-in, weeks
  // later, landed on that old invite (found in motion-v3 sweep 5).
  useEffect(() => {
    // (Wait for the session: on a cold start it reads signed-out until the
    // stored one loads.)
    if (state.status === 'ready' && token && !sessionLoading && !isAuthed) {
      setPendingInvite(token).catch(() => {});
    }
  }, [state.status, token, sessionLoading, isAuthed]);

  const onSignIn = useCallback(() => {
    router.push('/(auth)/signin');
  }, [router]);

  // The dead-end states (bad link, full, ended) are often reached by
  // router.replace — a cold deep link, or AuthGate resuming a stashed invite
  // after sign-in — so there is no back stack. Give them a way into the app,
  // and drop the stashed token so sign-in doesn't bring them back here.
  const onExit = useCallback(() => {
    takePendingInvite().catch(() => null);
    router.replace('/(tabs)');
  }, [router]);

  // The seat is theirs: the second celebration, then the squad. It carries
  // what this screen already knows, so "You're in" reads nothing.
  const toJoined = useCallback(
    (bookingId: string) => {
      if (state.status !== 'ready') return;
      const p = state.preview;
      const city = locale === 'gr' ? p.city_name_gr : p.city_name_en;
      router.replace({
        pathname: '/booking/[id]/joined',
        params: {
          id: bookingId,
          starts_at: p.starts_at,
          ends_at: p.ends_at,
          where: [p.venue_name, p.pitch_name, city].filter(Boolean).join(' · '),
        },
      });
    },
    [state, locale, router],
  );

  const onJoin = useCallback(
    async (slotKind: SlotKind) => {
      if (!token || state.status !== 'ready') return;
      setJoining(slotKind);
      setJoinError(null);
      try {
        // Split fixtures take money to join (C2 W6): claim-share seats the
        // caller and returns a PaymentIntent for the same Payment Sheet the
        // checkout uses. Free fixtures keep the join_fixture RPC.
        if (state.preview.is_split) {
          const claim = await claimShare(token, slotKind, newIdempotencyKey());
          const checkout = await runCheckout({ clientSecret: claim.client_secret });
          if (checkout.outcome === 'cancelled') {
            // The seat holds for ~15 minutes (the stale-claim sweep); tapping
            // join again resumes the SAME PaymentIntent.
            setJoinError(t('inviteClaimPayLater'));
            return;
          }
          if (checkout.outcome === 'failed') {
            // A payment declined — one of the error haptic's three kinds.
            haptic('error');
            setJoinError(checkout.message);
            return;
          }
          toJoined(claim.booking_id);
          return;
        }
        await joinFixture(token, slotKind);
        // The push ask (plans/reach.md R2, "fixture_joined") moved to
        // "You're in", after its beat has landed.
        toJoined(state.preview.booking_id);
      } catch (err) {
        if (err instanceof ClaimShareError) {
          if (err.code === 'ALREADY_PAID') {
            router.replace(`/booking/${state.preview.booking_id}`);
            return;
          }
          // A join refused because the game filled or ended — one of the
          // error haptic's three sites (ADR-0035, amended 2026-10-20).
          if (
            err.code === 'FIXTURE_FULL' ||
            err.code === 'COLLECTION_CLOSED' ||
            err.code === 'FIXTURE_STARTED'
          ) {
            haptic('error');
          }
          setJoinError(
            err.code === 'FIXTURE_FULL'
              ? t('inviteJoinErrorFull')
              : err.code === 'COLLECTION_CLOSED' || err.code === 'COVER_IN_FLIGHT' ||
                  err.code === 'CLAIM_NOT_OPEN'
                ? t('inviteClaimClosed')
                : err.code === 'FIXTURE_STARTED'
                  ? t('inviteJoinErrorEnded')
                  : err.code === 'INVALID_INVITE'
                    ? t('inviteJoinErrorInvalid')
                    : t('inviteJoinErrorGeneric'),
          );
          if (err.code === 'FIXTURE_FULL' || err.code === 'COLLECTION_CLOSED') load();
          return;
        }
        const code = err instanceof JoinFixtureError ? err.code : 'UNKNOWN';
        if (code === 'FIXTURE_FULL' || code === 'FIXTURE_STARTED' || code === 'FIXTURE_CANCELLED') {
          haptic('error');
        }
        setJoinError(
          code === 'FIXTURE_FULL'
            ? t('inviteJoinErrorFull')
            : code === 'FIXTURE_STARTED' || code === 'FIXTURE_CANCELLED'
              ? t('inviteJoinErrorEnded')
              : code === 'INVALID_INVITE'
                ? t('inviteJoinErrorInvalid')
                : t('inviteJoinErrorGeneric'),
        );
        // A full or ended fixture is stale data, not a retry-the-same-tap
        // situation — refresh so the screen reflects what actually happened.
        if (code === 'FIXTURE_FULL' || code === 'FIXTURE_STARTED' || code === 'FIXTURE_CANCELLED') {
          load();
        }
      } finally {
        setJoining(null);
      }
    },
    [token, state, router, t, load, toJoined],
  );

  // A seat someone is waiting to hand over (ADR-0044): taken, not joined.
  // On a split fixture the taker pays the frozen share and the leaver's
  // comes back; take-seat answers both, and a re-tap resumes the same PI.
  const onTake = useCallback(
    async (slotKind: SlotKind) => {
      if (!token || state.status !== 'ready') return;
      setJoining(slotKind);
      setJoinError(null);
      try {
        const res = await takeSeat(token, slotKind, state.preview.is_split, newIdempotencyKey());
        if (!res.taken) {
          const checkout = await runCheckout({ clientSecret: res.payment.client_secret });
          if (checkout.outcome === 'cancelled') {
            setJoinError(t('inviteClaimPayLater'));
            return;
          }
          if (checkout.outcome === 'failed') {
            haptic('error');
            setJoinError(checkout.message);
            return;
          }
        }
        capture('seat_taken', { booking_id: res.booking_id, paid: !res.taken });
        toJoined(res.booking_id);
      } catch (err) {
        const code = err instanceof ReplacementError ? err.code : 'UNKNOWN';
        if (code === 'ALREADY_IN') {
          router.replace(`/booking/${state.preview.booking_id}`);
          return;
        }
        if (code === 'NO_SEAT_TO_TAKE' || code === 'FIXTURE_STARTED' || code === 'SEAT_NOT_TAKEABLE') {
          haptic('error');
        }
        setJoinError(
          code === 'NO_SEAT_TO_TAKE'
            ? t('inviteTakeSeatGone')
            : code === 'FIXTURE_STARTED' || code === 'SEAT_NOT_TAKEABLE'
              ? t('inviteJoinErrorEnded')
              : code === 'INVALID_INVITE'
                ? t('inviteJoinErrorInvalid')
                : t('inviteJoinErrorGeneric'),
        );
        if (code === 'NO_SEAT_TO_TAKE' || code === 'FIXTURE_STARTED') load();
      } finally {
        setJoining(null);
      }
    },
    [token, state, router, t, load, toJoined],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, padding: SPACE.s5, justifyContent: 'center', gap: SPACE.s6 }}>
        {/* The invite's own shape while it loads — its line and its card —
            fading out under the real one (motion-v3 slice 6). */}
        {(state.status === 'loading' || sessionLoading) && (
          <Animated.View
            exiting={FadeOut.duration(MOTION.instant)}
            accessible
            accessibilityLabel={t('inviteLoading')}
            style={{ gap: 12 }}
          >
            <Skeleton variant="row" />
            <Skeleton variant="card" />
          </Animated.View>
        )}

        {state.status === 'not_found' && (
          <View style={{ gap: SPACE.s5 }}>
            <StatusCard title={t('inviteNotFound')} body={t('inviteNotFoundBody')} />
            <Button size="lg" full variant="secondary" onPress={onExit}>
              {t('inviteExitCta')}
            </Button>
          </View>
        )}

        {state.status === 'ready' && !sessionLoading && (
          <ReadyBody
            preview={state.preview}
            locale={locale}
            recorded={recorded}
            isAuthed={isAuthed}
            alreadyIn={alreadyIn}
            joining={joining}
            joinError={joinError}
            onSignIn={onSignIn}
            onJoin={onJoin}
            onTake={onTake}
            onGoToFixture={() => router.replace(`/booking/${state.preview.booking_id}`)}
            onExit={onExit}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function ReadyBody({
  preview,
  locale,
  recorded,
  isAuthed,
  alreadyIn,
  joining,
  joinError,
  onSignIn,
  onJoin,
  onTake,
  onGoToFixture,
  onExit,
}: {
  preview: FixturePreview;
  locale: 'en' | 'gr';
  recorded: boolean;
  isAuthed: boolean;
  alreadyIn: boolean | null;
  joining: SlotKind | null;
  joinError: string | null;
  onSignIn: () => void;
  onJoin: (slotKind: SlotKind) => void;
  onTake: (slotKind: SlotKind) => void;
  onGoToFixture: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const cityName = locale === 'gr' ? preview.city_name_gr : preview.city_name_en;
  const whereLine = [preview.venue_name, preview.pitch_name, cityName].filter(Boolean).join(' · ');

  if (alreadyIn === true) {
    return (
      <RiseIn distance={8}>
        <View style={{ gap: SPACE.s5 }}>
          <StatusCard
            title={t('inviteAlreadyJoined')}
            body={`${formatFixtureDate(preview.starts_at, locale)} · ${whereLine}`}
          />
          <Button size="lg" full onPress={onGoToFixture}>
            {t('inviteGoToFixture')}
          </Button>
        </View>
      </RiseIn>
    );
  }

  const gkTake = preview.gk_open <= 0 && (preview.gk_replacing ?? 0) > 0;
  const outTake = preview.outfield_open <= 0 && (preview.outfield_replacing ?? 0) > 0;
  const takeLabel = (keeper: boolean) =>
    preview.is_split && preview.share_amount_cents != null
      ? t('inviteTakeSeatPaid', { amount: `€${(preview.share_amount_cents / 100).toFixed(2)}` })
      : keeper
        ? t('inviteTakeSeatKeeper')
        : t('inviteTakeSeat');

  if (!preview.joinable) {
    const full = preview.gk_open <= 0 && preview.outfield_open <= 0;
    return (
      <RiseIn distance={8}>
        <View style={{ gap: SPACE.s5 }}>
          <StatusCard
            title={full ? t('inviteFull') : t('inviteEnded')}
            body={full ? t('inviteFullBody') : t('inviteEndedBody')}
          />
          <Button size="lg" full variant="secondary" onPress={onExit}>
            {t('inviteExitCta')}
          </Button>
        </View>
      </RiseIn>
    );
  }

  // Staggered arrival (mark → headline → counts → CTA) — the invite preview
  // is a new player's first sight of Ludi; it should land, not pop.
  return (
    <View style={{ gap: SPACE.s5 }}>
      <RiseIn index={0}>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Avatar initial="⚽" color={TOKENS.primary} size={44} />
      </View>
      </RiseIn>

      <RiseIn index={1}>
      <View style={{ gap: 6, alignItems: 'center' }}>
        <Text
          style={{
            fontFamily: TOKENS.monoMedium,
            fontSize: 10.5,
            color: TOKENS.primaryDeep,
            letterSpacing: 1.05,
          }}
        >
          {t('inviteHeading').toUpperCase()}
        </Text>
        <Text
          style={{
            fontFamily: TOKENS.displaySemi,
            fontSize: 28,
            color: TOKENS.ink,
            letterSpacing: -1,
            textAlign: 'center',
          }}
        >
          {formatFixtureDate(preview.starts_at, locale)}
        </Text>
        <Text style={{ fontFamily: TOKENS.ui, fontSize: 16, color: TOKENS.ink, textAlign: 'center' }}>
          {formatFixtureTimeRange(preview.starts_at, preview.ends_at, locale)} · {preview.pitch_type}
        </Text>
        <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, color: TOKENS.ink2, textAlign: 'center' }}>
          {whereLine}
        </Text>
      </View>
      </RiseIn>

      {/* Counts only, never names — a link forwarded into a second group
          chat must not publish who is playing to whoever it reaches next
          (ADR-0012 minimisation, ADR-0021). */}
      <RiseIn index={2}>
      <Card
        color={preview.gk_open > 0 ? TOKENS.sunSoft : TOKENS.pitchSoft}
        padded={16}
        elevation="e0"
        style={{ borderColor: 'transparent', gap: 4 }}
      >
        {preview.gk_open > 0 && (
          <Text
            style={{
              fontFamily: TOKENS.monoMedium,
              fontSize: 10.5,
              color: TOKENS.sunDeep,
              letterSpacing: 1.05,
            }}
          >
            {t('inviteKeeperUrgent').toUpperCase()}
          </Text>
        )}
        {/* A full fixture whose only seats are being handed over says just
            that, not "0 keeper · 0 outfield spots open" above it. */}
        {(preview.gk_open > 0 || preview.outfield_open > 0 || (!gkTake && !outTake)) && (
          <Text
            style={{
              fontFamily: TOKENS.ui,
              fontSize: 14,
              color: preview.gk_open > 0 ? TOKENS.sunDeep : TOKENS.pitchDeep,
            }}
          >
            {t('inviteSpotsOpen', { gk: Math.max(0, preview.gk_open), outfield: Math.max(0, preview.outfield_open) })}
          </Text>
        )}
        {((preview.gk_replacing ?? 0) > 0 || (preview.outfield_replacing ?? 0) > 0) && (
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, fontWeight: '600', color: TOKENS.sunDeep }}>
            {t('inviteSeatsToTake', { gk: preview.gk_replacing ?? 0, outfield: preview.outfield_replacing ?? 0 })}
          </Text>
        )}
        {preview.is_split && preview.share_amount_cents != null && (
          <Text
            style={{
              fontFamily: TOKENS.ui,
              fontWeight: '600',
              fontSize: 14,
              color: preview.gk_open > 0 ? TOKENS.sunDeep : TOKENS.pitchDeep,
            }}
          >
            {t('inviteShareLine', { amount: `€${(preview.share_amount_cents / 100).toFixed(2)}` })}
          </Text>
        )}
      </Card>
      </RiseIn>

      {/* The camera notice resolves after the rest, so it arrives as a Reveal
          and what is below glides down instead of jumping. */}
      {recorded && (
        <Reveal>
          <Card color={TOKENS.primarySoft} padded={16} elevation="e0" style={{ borderColor: 'transparent', gap: 4 }}>
            <Text style={{ fontFamily: TOKENS.ui, fontWeight: '600', fontSize: 14, color: TOKENS.primaryDeep }}>
              {t('recordNotice')}
            </Text>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink2 }}>{t('recordNoticeAsk')}</Text>
          </Card>
        </Reveal>
      )}

      {joinError && (
        <Reveal key={joinError}>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.alertDeep, textAlign: 'center' }}>
            {joinError}
          </Text>
        </Reveal>
      )}

      {/* Signed in, the actions wait for the already-in answer (null). */}
      {isAuthed && alreadyIn === null ? null : (
        <Animated.View layout={ROW_LAYOUT}>
          {!isAuthed ? (
            <RiseIn index={3}>
              <Button size="lg" full onPress={onSignIn}>
                {t('inviteSignInCta')}
              </Button>
            </RiseIn>
          ) : (
            <RiseIn index={3}>
            <View style={{ gap: 10 }}>
              {preview.gk_open > 0 && (
                <Button
                  size="lg"
                  full
                  color={TOKENS.sun}
                  loading={joining === 'gk'}
                  disabled={joining !== null && joining !== 'gk'}
                  onPress={() => onJoin('gk')}
                >
                  {t('inviteJoinAsKeeper')}
                </Button>
              )}
              {preview.outfield_open > 0 && (
                <Button
                  size="lg"
                  full
                  variant={preview.gk_open > 0 ? 'secondary' : 'primary'}
                  loading={joining === 'outfield'}
                  disabled={joining !== null && joining !== 'outfield'}
                  onPress={() => onJoin('outfield')}
                >
                  {preview.gk_open > 0 ? t('inviteJoinAsOutfield') : t('inviteJoinAsOutfieldOnly')}
                </Button>
              )}
              {gkTake && (
                <Button
                  size="lg"
                  full
                  color={TOKENS.sun}
                  loading={joining === 'gk'}
                  disabled={joining !== null && joining !== 'gk'}
                  onPress={() => onTake('gk')}
                >
                  {takeLabel(true)}
                </Button>
              )}
              {outTake && (
                <Button
                  size="lg"
                  full
                  variant={gkTake || preview.gk_open > 0 ? 'secondary' : 'primary'}
                  loading={joining === 'outfield'}
                  disabled={joining !== null && joining !== 'outfield'}
                  onPress={() => onTake('outfield')}
                >
                  {takeLabel(false)}
                </Button>
              )}
            </View>
            </RiseIn>
          )}
        </Animated.View>
      )}
    </View>
  );
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 12 }}>
      <Text
        style={{
          fontFamily: TOKENS.displaySemi,
          fontSize: 22,
          color: TOKENS.ink,
          textAlign: 'center',
          letterSpacing: -0.5,
        }}
      >
        {title}
      </Text>
      <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2, textAlign: 'center' }}>
        {body}
      </Text>
    </View>
  );
}
