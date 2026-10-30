// The fixture screen. Was the booking detail screen; became this in the
// booking-as-shared-fixture version (docs/plans/shared-fixture.md, W4).
//
// One booking is one fixture — a separate roster screen would split the
// truth, so this route carries both. Reads `v_fixture` + `v_fixture_roster`
// (never the base tables: a participant who is not the organiser gets zero
// rows from `bookings`). Design was drawn as a spike first and every state
// here was looked at on a device before it was wired.
//
// Joining happens on the invite screen (W5); this screen carries leaving and
// rejoining (W6) — a plain RLS-gated UPDATE, not an RPC, per ADR-0022's own
// "when it stops moving money" boundary. Leaving never deletes the row: the
// keeper trial needs "dropped out Tuesday" to differ from "said yes and
// never showed", so a departed participant stays in the roster array at
// status='out' rather than vanishing from it.
// The cancel flow below is unchanged shipped behaviour (M3 #11) — same
// per-user-action idempotency key held across retries, same preview math.

import {
  Avatar,
  Button,
  Card,
  Chip,
  EASE,
  ELEV,
  MOTION,
  Press,
  PriceSummary,
  RADII,
  ROW_LAYOUT,
  Reveal,
  SPACE,
  SPRING,
  Skeleton,
  TOKENS,
  Tally,
  haptic,
  useReduceMotion,
} from '@ludi/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, ReduceMotion, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { capture } from '@/lib/analytics';
import { askForPush } from '@/lib/push';
import { askParents, venueHostsCfa } from '@/lib/cfa';
import {
  cancelBooking,
  CancelBookingError,
  computePreviewRefund,
  isCancellable,
  isCancelled,
  newCancelIdempotencyKey,
  type CancelErrorCode,
} from '@/lib/cancellation';
import { newIdempotencyKey } from '@/lib/booking';
import { runCheckout } from '@/lib/stripe-checkout';
import {
  askReplacement,
  claimShare,
  ClaimShareError,
  coverShortfall,
  fetchFixture,
  formatFixtureDate,
  formatFixtureTimeRange,
  inviteLink,
  keepMySeat,
  leaveFixture,
  leaveShare,
  rejoinFixture,
  setFixtureLevel,
  setFixtureOpen,
  slotsFor,
  type OpenLevel,
  type Fixture,
  type FixtureWithRoster,
  type RosterEntry,
  type SlotKind,
} from '@/lib/fixture';
import {
  clearFixtureSheets,
  openLeaveSheet,
  openSeatSheet,
} from '@/lib/fixture-sheets';
import { fixtureType as type } from '@/lib/fixture-type';
import { openDirections } from '@/lib/directions';
import { colorFor, initialFor, rosterName } from '@/lib/roster-display';
import { BackButton } from '@/components/BackButton';
import { RecordingCard } from '@/components/RecordingCard';
import {
  fetchKeeperFeedbackDue,
  fetchKeeperRequestFor,
  giveKeeperFeedback,
  postKeeperRequest,
  withdrawKeeperRequest,
  type KeeperFeedbackDue,
  type KeeperRequestState,
  type KeeperShape,
} from '@/lib/keeper';

type LoadState =
  | { status: 'loading' }
  | { status: 'success'; data: FixtureWithRoster }
  | { status: 'error' };

export default function FixtureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const locale: 'en' | 'gr' = i18n.language === 'gr' ? 'gr' : 'en';

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [cancelling, setCancelling] = useState(false);
  // Pull-to-refresh is not a nicety here. This is the only screen in the app
  // whose contents change because SOMEONE ELSE acted - a teammate joins, a
  // keeper drops out, a share gets paid - and there is no push yet. Without
  // it the organiser stares at a stale 5/10 and re-launches the app to find
  // out. The other three list screens have had it since they shipped.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const cancelKeyRef = useRef<string | null>(null);
  // C2 W7 — fixture_confirmed is captured where the CLIENT observes the
  // collecting → confirmed flip, once per mount. Observation-based on
  // purpose: the actual flip happens in the webhook, and server-side
  // capture would be user-linked tracking outside the ADR-0011 consent
  // gate. (fixture_expired has no client observer and needs no event —
  // expiries are derivable from the rows: cancelled + is_split + past
  // deadline. Recorded in split-payment.md.)
  const prevSplitStateRef = useRef<string | null>(null);

  // Every read after the first is quiet: the rendered fixture stays on
  // screen while it re-reads, because throwing the roster back to a spinner
  // under the user's own thumb is what makes a refresh feel like a
  // navigation — and a seat cannot be seen to fill on a roster that has
  // just unmounted (plans/motion-v3.md, slice 0). Only the first read, and
  // a Retry from the error state, say 'first'. Wrap it when wiring a press:
  // `onPress={load}` would hand the press event in as `mode` (JOURNAL).
  const load = useCallback((mode: 'first' | 'quiet' = 'quiet') => {
    if (!id) return;
    if (mode === 'first') setState({ status: 'loading' });
    return fetchFixture(id)
      .then((data) => {
        if (data?.fixture.is_split) {
          if (
            prevSplitStateRef.current === 'collecting' &&
            data.fixture.state === 'confirmed'
          ) {
            capture('fixture_confirmed', { booking_id: data.fixture.booking_id });
          }
          prevSplitStateRef.current = data.fixture.state;
        }
        setState(data ? { status: 'success', data } : { status: 'error' });
        setRefreshFailed(false);
      })
      .catch(() => {
        // A quiet read that fails keeps the fixture it already has and says
        // so in one line; only a screen with nothing on it shows the error.
        setState((prev) => (prev.status === 'success' ? prev : { status: 'error' }));
        setRefreshFailed(true);
      });
  }, [id]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.resolve(load('quiet')).finally(() => setRefreshing(false));
  }, [load]);

  useEffect(() => {
    load('first');
  }, [load]);

  const onCancelPress = useCallback(() => {
    if (state.status !== 'success' || cancelling) return;
    const { fixture } = state.data;
    if (!isCancellable(fixture.state)) return;

    const isPending = fixture.state === 'pending';
    const preview = isPending
      ? null
      : computePreviewRefund({
          totalCents: fixture.total_cents,
          policy: fixture.cancellation_policy,
          startsAt: new Date(fixture.starts_at),
        });

    let body: string;
    if (isPending) {
      body = t('cancelConfirmBodyPending');
    } else if (fixture.state === 'collecting') {
      // Pre-confirm split death: everyone who has paid gets it all back —
      // the venue never had a confirmed booking (C2 W5's fan-out).
      body = t('cancelConfirmBodyCollecting');
    } else if (preview && preview.refundCents > 0) {
      body = t('cancelConfirmBodyWithRefund', {
        refund: formatEur(preview.refundCents),
        percent: preview.refundBps / 100,
        total: formatEur(fixture.total_cents),
      });
    } else {
      const policyLabel = (
        t('cancelPolicy', { returnObjects: true }) as Record<string, string>
      )[fixture.cancellation_policy] ?? fixture.cancellation_policy;
      body = t('cancelConfirmBodyNoRefund', { policy: policyLabel });
    }

    cancelKeyRef.current ??= newCancelIdempotencyKey();

    Alert.alert(t('cancelConfirmTitle'), body, [
      {
        text: t('cancelConfirmDismiss'),
        style: 'cancel',
        onPress: () => {
          cancelKeyRef.current = null;
        },
      },
      { text: t('cancelConfirmConfirm'), style: 'destructive', onPress: confirmCancel },
    ]);

    async function confirmCancel() {
      setCancelling(true);
      const key = cancelKeyRef.current!;
      try {
        await cancelBooking(fixture.booking_id, key);
        capture('booking_cancelled', {
          refund_cents: preview?.refundCents ?? 0,
          hours_to_slot: Math.max(
            0,
            Math.round((new Date(fixture.starts_at).getTime() - Date.now()) / 3_600_000),
          ),
        });
        cancelKeyRef.current = null;
        load();
      } catch (err) {
        const code: CancelErrorCode =
          err instanceof CancelBookingError ? err.code : 'UNKNOWN';
        if (code === 'ALREADY_CANCELLED' || code === 'ALREADY_COMPLETED') {
          cancelKeyRef.current = null;
          load();
          return;
        }
        Alert.alert(t('cancelErrorTitle'), errorMessage(t, code), [
          { text: t('cancelDismiss'), style: 'cancel' },
        ]);
      } finally {
        setCancelling(false);
      }
    }
  }, [state, cancelling, t, load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
      <BackBar onBack={() => router.back()} />
      {state.status === 'loading' && <FixtureSkeleton label={t('bookingsLoading')} />}
      {state.status === 'error' && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Text style={{ fontFamily: TOKENS.ui, color: TOKENS.ink2 }}>{t('bookingsError')}</Text>
          <Button variant="secondary" size="sm" onPress={() => load('first')}>
            {t('bookingsRefresh')}
          </Button>
        </View>
      )}
      {state.status === 'success' && (
        <FixtureBody
          data={state.data}
          locale={locale}
          cancelling={cancelling}
          onCancelPress={onCancelPress}
          // "Book again" carries the fixture's thread: the id rides to the
          // pitch screen, through checkout, into bookings.rebooked_from —
          // the chain that makes the recurring squad measurable
          // (community-v2.md).
          onRebook={() =>
            router.push({
              pathname: '/pitch/[id]',
              params: {
                id: state.data.fixture.pitch_id,
                rebookFrom: state.data.fixture.booking_id,
              },
            })
          }
          reload={load}
          refreshFailed={refreshFailed}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}
    </SafeAreaView>
  );
}

function FixtureBody({
  data,
  locale,
  cancelling,
  onCancelPress,
  onRebook,
  reload,
  refreshFailed,
  refreshing,
  onRefresh,
}: {
  data: FixtureWithRoster;
  locale: 'en' | 'gr';
  cancelling: boolean;
  onCancelPress: () => void;
  onRebook: () => void;
  /** Quiet: the fixture stays on screen while it re-reads. */
  reload: () => void;
  refreshFailed: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { fixture, roster } = data;
  const [expanded, setExpanded] = useState(false);
  // Seats, tags and messages animate only once the fixture is on screen: the
  // first render lands still, every change after it moves (Arrivals).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [leaving, setLeaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Both sheets are `formSheet` routes now (ADR-0035, gesture-motion G3), so
  // the OS owns their drag. What the screen still owns is what goes IN them:
  // it publishes the seat or the leave context, then navigates.
  useEffect(() => clearFixtureSheets, []);

  const gk = slotsFor(roster, 'gk', fixture.gk_slots);
  const out = slotsFor(roster, 'outfield', fixture.outfield_slots);
  const total = fixture.gk_slots + fixture.outfield_slots;
  // Only 'in' rows occupy the squad — the roster array now carries departed
  // participants too, so their own row must not inflate this count.
  const filled = roster.filter((r) => r.status === 'in').length;
  const missingGk = gk.filter((s) => !s).length;

  const ownRow = roster.find((r) => r.is_you);
  const hasLeft = ownRow?.status === 'out';
  const hoursToSlot = (new Date(fixture.starts_at).getTime() - Date.now()) / 3_600_000;

  // Asks whether the fixture was CANCELLED, not whether it can still be
  // cancelled. Those stopped being complements the moment `completed` became
  // a state a booking actually reaches (complete_played_bookings, community
  // v2): a played match is not cancellable, so the old `!isCancellable(...)`
  // reading put the red "nobody is told automatically yet" banner on top of
  // every finished game and suppressed `played` — taking the rebook CTA, the
  // PLAYED eyebrow and the squad's played copy down with it.
  const cancelled = fixture.cancelled_at !== null || isCancelled(fixture.state);
  // The hourly cron flips played fixtures to 'completed' (community v2,
  // closes ledger #45) — but past-ness stays time-derived here so the
  // screen is right in the minutes between final whistle and cron tick.
  const played = !cancelled && new Date(fixture.ends_at).getTime() < Date.now();
  const frozen = cancelled || played;
  const isOrganiser = fixture.viewer_is_organiser;
  const isEmpty = filled <= 1;
  const complete = filled === total && !frozen;
  const showInvite = isOrganiser && !frozen && filled < total;

  // A keeper from the pool plays free (ADR-0047): he is in the squad but
  // not among the people the pitch is split between.
  const freeKeepers = roster.filter((r) => r.status === 'in' && r.keeper_free).length;
  const viewerFreeKeeper = ownRow?.status === 'in' && ownRow.keeper_free;
  const payersNow = Math.max(filled - freeKeepers, 1);
  const perHeadFull = Math.round(fixture.total_cents / Math.max(total - freeKeepers, 1));
  const perHeadNow = Math.round(fixture.total_cents / payersNow);

  // ── Split money (C2 W6) ─────────────────────────────────────────────
  const isSplit = fixture.is_split && fixture.share_amount_cents != null;
  const shareCents = fixture.share_amount_cents ?? 0;
  const collecting = isSplit && fixture.state === 'collecting';
  const deadlineMs = fixture.collect_deadline ? Date.parse(fixture.collect_deadline) : null;
  const pastDeadline = collecting && deadlineMs !== null && Date.now() >= deadlineMs;

  // ── Find my replacement (ADR-0044) ──────────────────────────────────
  // A live, bought fixture: the seat waits for whoever takes it. While a
  // split fixture is still collecting there is no replacement — leaving
  // gives the share back and the seat reopens to the ordinary claim.
  const ownPaid = isSplit && ownRow?.share_paid === true;
  const replacing = ownRow?.status === 'in' && ownRow.replacing_since !== null;
  const canReplace =
    !isOrganiser && !frozen && hoursToSlot > 0 &&
    (fixture.state === 'paid' || fixture.state === 'confirmed');
  const replacementMode: 'free' | 'paid' | null = canReplace ? (ownPaid ? 'paid' : 'free') : null;
  const leaveMode: 'plain' | 'refund' | 'no_refund' =
    collecting && ownPaid ? 'refund' : isSplit && !collecting && ownPaid ? 'no_refund' : 'plain';
  const shareLabel = `€${(shareCents / 100).toFixed(2)}`;
  const paidCount = roster.filter((r) => r.status === 'in' && r.share_paid).length;
  // A keeper from the pool plays free (ADR-0047): never asked for a share.
  const viewerUnpaid = collecting && ownRow?.status === 'in' && !ownRow.share_paid && !ownRow.keeper_free;
  const deadlineLine = deadlineMs
    ? `${formatFixtureDate(fixture.collect_deadline!, locale)} · ${formatFixtureTimeRange(
        fixture.collect_deadline!,
        fixture.collect_deadline!,
        locale,
      ).split('–')[0]}`
    : '';

  const organiserName = roster.find((r) => r.is_organiser)?.first_name ?? '';
  const cityName = locale === 'gr' ? fixture.city_name_gr : fixture.city_name_en;
  const whereLine = [fixture.venue_name, fixture.pitch_name, cityName].filter(Boolean).join(' · ');
  const whenLine = formatFixtureDate(fixture.starts_at, locale);
  const timeLine = formatFixtureTimeRange(fixture.starts_at, fixture.ends_at, locale);

  // The people who were in and gave the slot up. `leaveFixture` keeps their
  // row at status='out' precisely so this is knowable - the keeper trial
  // needs "dropped out Tuesday" to differ from "never answered" - and until
  // now nothing rendered it, so the fact was collected and thrown away. Not
  // shown once the fixture is frozen: after the whistle, who withdrew four
  // days earlier is history nobody is acting on.
  // A seat handed over (ADR-0044) went to someone; it did not open, so the
  // player who handed it over is not a drop-out.
  const dropped = useMemo(
    () => roster.filter((r) => r.status === 'out' && !r.was_replaced),
    [roster],
  );

  const outFilled = out.filter(Boolean) as RosterEntry[];
  const outEmpty = out.length - outFilled.length;
  const shownEmpty = frozen ? 0 : expanded ? outEmpty : Math.min(outEmpty, 2);
  const hiddenEmpty = frozen ? 0 : outEmpty - shownEmpty;
  const gkShown = frozen ? (gk.filter(Boolean) as RosterEntry[]) : gk;

  const share = (message: string) => {
    Share.share({ message }).catch(() => {});
  };
  const onInvite = () =>
    share(
      t('fixtureShareInvite', {
        when: `${whenLine} · ${timeLine}`,
        venue: whereLine,
        short: total - filled,
        link: inviteLink(fixture),
      }),
    );
  const onSendDetails = () =>
    share(
      t('fixtureShareDetails', {
        when: `${whenLine} · ${timeLine}`,
        venue: whereLine,
        keepers: (gk.filter(Boolean) as RosterEntry[]).map((k) => k.first_name).join(' & '),
        each: `€${(perHeadFull / 100).toFixed(2)}`,
        organiser: organiserName,
      }),
    );
  const onAskKeepers = () =>
    share(
      t('fixtureShareInvite', {
        when: `${whenLine} · ${timeLine}`,
        venue: whereLine,
        short: missingGk,
        link: inviteLink(fixture),
      }),
    );

  // The point of the drop-out flow: what it produces. A slot that quietly
  // empties is worse than one nobody ever filled, because the organiser
  // believes it is covered — so leaving hands the leaver straight to the
  // replacement ask, mirroring the organiser's own onAskKeepers/onInvite.
  const onReplace = () => {
    if (!ownRow) return;
    share(
      ownRow.slot_kind === 'gk'
        ? t('leaveShareReplacementKeeper', {
            when: `${whenLine} · ${timeLine}`,
            venue: whereLine,
            link: inviteLink(fixture),
          })
        : t('leaveShareReplacement', {
            when: `${whenLine} · ${timeLine}`,
            venue: whereLine,
            link: inviteLink(fixture),
          }),
    );
  };

  // One entry point for every seat on the grid, so a tap means the same
  // thing wherever it lands: filled opens the person, empty opens the gap.
  const onSeat = (player: RosterEntry | null, slot: SlotKind) => {
    const seat = player
      ? ({ kind: 'player', player } as const)
      : ({ kind: 'empty', slot } as const);
    openSeatSheet({
      seat,
      showPaid: collecting,
      canInvite: !frozen && filled < total,
      // An empty keeper's shirt asks the keeper pool; everything else asks
      // the squad. Bound here, where the seat is known.
      onInvite: seat.kind === 'empty' && seat.slot === 'gk' ? onAskKeepers : onInvite,
    });
    router.push(`/booking/${id}/seat`);
  };

  // Leave and rejoin used to swallow a failure: the link un-dimmed and
  // nothing else happened. Now it says so under the link it came from.
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const onLeave = async () => {
    if (!ownRow) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      if (collecting) {
        // The database refuses a bare leave on a paid seat here: the share
        // has to come back with it (leave-share).
        await leaveShare(fixture.booking_id);
      } else {
        await leaveFixture(ownRow.participant_id);
      }
      capture('fixture_left', {
        slot_kind: ownRow.slot_kind,
        hours_to_slot: Math.max(0, Math.round(hoursToSlot)),
      });
      onReplace();
      reload();
    } catch {
      setLeaveError(t('fixtureReplacementError'));
    } finally {
      setLeaving(false);
    }
  };

  // ── The goalkeeper pool (ADR-0047) ──────────────────────────────────
  // A keeper place is an empty keeper slot or a keeper handing his seat over.
  const keeperPlaces =
    missingGk + roster.filter((r) => r.status === 'in' && r.slot_kind === 'gk' && r.replacing_since).length;
  const [pool, setPool] = useState<KeeperRequestState | null>(null);
  const [keeperDue, setKeeperDue] = useState<KeeperFeedbackDue | null>(null);
  const [keeperError, setKeeperError] = useState<string | null>(null);
  const [keeperBusy, setKeeperBusy] = useState<KeeperShape | 'withdraw' | null>(null);
  useEffect(() => {
    let off = false;
    if (isOrganiser && !frozen) {
      fetchKeeperRequestFor(fixture.booking_id).then((r) => !off && setPool(r)).catch(() => {});
    }
    if (played) {
      fetchKeeperFeedbackDue(fixture.booking_id).then((r) => !off && setKeeperDue(r)).catch(() => {});
    }
    return () => {
      off = true;
    };
  }, [fixture, isOrganiser, frozen, played]);
  const onPostKeeper = async (shape: KeeperShape) => {
    setKeeperError(null);
    setKeeperBusy(shape);
    try {
      const posted = await postKeeperRequest(fixture.booking_id, shape);
      capture('keeper_posted', { shape, audience: posted.audience });
      setPool(await fetchKeeperRequestFor(fixture.booking_id));
    } catch {
      setKeeperError(t('fixtureKeeperError'));
    } finally {
      setKeeperBusy(null);
    }
  };
  const onWithdrawKeeper = async () => {
    if (!pool) return;
    setKeeperError(null);
    setKeeperBusy('withdraw');
    try {
      await withdrawKeeperRequest(pool.request_id);
      setPool(null);
    } catch {
      setKeeperError(t('fixtureKeeperError'));
    } finally {
      setKeeperBusy(null);
    }
  };

  const [replacementError, setReplacementError] = useState<string | null>(null);

  const onFindReplacement = async () => {
    if (!ownRow) return;
    setLeaving(true);
    setReplacementError(null);
    try {
      await askReplacement(fixture.booking_id);
      // The fourth push moment (plans/reach.md R2): whoever takes the
      // seat, this player wants to hear it.
      void askForPush('replacement_asked');
      capture('replacement_asked', {
        slot_kind: ownRow.slot_kind,
        paid: ownPaid,
        hours_to_slot: Math.max(0, Math.round(hoursToSlot)),
      });
      onReplace();
      reload();
    } catch {
      setReplacementError(t('fixtureReplacementError'));
    } finally {
      setLeaving(false);
    }
  };

  const onKeepSeat = async () => {
    setLeaving(true);
    setReplacementError(null);
    try {
      await keepMySeat(fixture.booking_id);
      reload();
    } catch {
      setReplacementError(t('fixtureReplacementError'));
    } finally {
      setLeaving(false);
    }
  };

  const onRejoin = async () => {
    if (!ownRow) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await rejoinFixture(fixture.invite_token, ownRow.slot_kind);
      reload();
    } catch {
      setLeaveError(t('fixtureReplacementError'));
    } finally {
      setLeaving(false);
    }
  };

  // ── Split money actions (C2 W6). Both return the SAME PaymentIntent on
  //    a re-tap, so an abandoned Payment Sheet resumes rather than
  //    double-charging. ──────────────────────────────────────────────────
  const onPayShare = async () => {
    if (!ownRow) return;
    setPaying(true);
    setPayError(null);
    try {
      const claim = await claimShare(fixture.invite_token, ownRow.slot_kind, newIdempotencyKey());
      const checkout = await runCheckout({ clientSecret: claim.client_secret });
      if (checkout.outcome === 'failed') setPayError(checkout.message);
      if (checkout.outcome === 'success') {
        capture('share_paid', { booking_id: fixture.booking_id, amount_cents: claim.amount_cents });
        reload();
      }
    } catch (err) {
      if (err instanceof ClaimShareError && err.code === 'ALREADY_PAID') {
        reload();
        return;
      }
      setPayError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setPaying(false);
    }
  };

  const onCover = async () => {
    setPaying(true);
    setPayError(null);
    try {
      const cover = await coverShortfall(fixture.booking_id, newIdempotencyKey());
      const checkout = await runCheckout({ clientSecret: cover.client_secret });
      if (checkout.outcome === 'failed') setPayError(checkout.message);
      if (checkout.outcome === 'success') {
        capture('fixture_covered', { booking_id: fixture.booking_id, amount_cents: cover.amount_cents });
        reload();
      }
    } catch (err) {
      if (err instanceof ClaimShareError && err.code === 'NOTHING_TO_COVER') {
        reload();
        return;
      }
      setPayError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setPaying(false);
    }
  };

  return (
    <Arrivals.Provider value={mounted}>
    <ScrollView
      contentContainerStyle={{ padding: SPACE.s5, paddingBottom: 48, gap: SPACE.s5 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TOKENS.ink3} />
      }
    >
      {refreshFailed && (
        <Arrive>
          <Text style={[type.body, { color: TOKENS.alertDeep }]}>{t('fixtureRefreshError')}</Text>
        </Arrive>
      )}
      {cancelled && (
        <Arrive>
        <Card
          color={TOKENS.terraSoft}
          padded={16}
          elevation="e0"
          style={{ borderColor: 'transparent' }}
        >
          <Text style={[type.label, { color: TOKENS.alertDeep }]}>{t('fixtureCancelledTitle')}</Text>
          <Text style={[type.body, { color: TOKENS.alertDeep, marginTop: 6 }]}>
            {t('fixtureCancelledBody')}
          </Text>
        </Card>
        </Arrive>
      )}

      {/* C2 W6 — the collecting strip: where the money stands, when it is
          due, and the one action the viewer can take about it. Past the
          deadline it turns urgent: the organiser covers or it dies at
          T-22h; a teammate can only watch (the screen is the channel). */}
      {collecting && (
        <Card
          color={pastDeadline ? TOKENS.sunSoft : TOKENS.primarySoft}
          padded={16}
          elevation="e0"
          style={{ borderColor: 'transparent', gap: 10 }}
        >
          <Text style={[type.label, { color: pastDeadline ? TOKENS.sunDeep : TOKENS.primaryDeep }]}>
            {pastDeadline
              ? t('fixtureCollectingLateTitle')
              : t('fixtureCollectingTitle', { paid: paidCount, filled })}
          </Text>
          <Text
            style={[type.body, { color: pastDeadline ? TOKENS.sunDeep : TOKENS.primaryDeep, fontSize: 13 }]}
          >
            {pastDeadline
              ? isOrganiser
                ? t('fixtureCollectingLateOrganiser')
                : t('fixtureCollectingLateTeammate', { name: organiserName })
              : t('fixtureCollectingBody', { when: deadlineLine })}
          </Text>
          {payError && (
            <Text style={[type.body, { color: TOKENS.alertDeep, fontSize: 13 }]}>{payError}</Text>
          )}
          {/* Past the deadline claim-share refuses (COLLECTION_CLOSED), so
              the button would only ever fail — the late copy above already
              says only the organiser's cover can save it now. */}
          {viewerUnpaid && !pastDeadline && (
            <Button size="lg" full loading={paying} onPress={onPayShare}>
              {t('fixturePayShare', { amount: `€${(shareCents / 100).toFixed(2)}` })}
            </Button>
          )}
          {isOrganiser && !viewerUnpaid && (
            <Button
              size={pastDeadline ? 'lg' : 'sm'}
              full={pastDeadline}
              variant={pastDeadline ? 'primary' : 'secondary'}
              color={pastDeadline ? TOKENS.sun : undefined}
              loading={paying}
              onPress={onCover}
            >
              {t('fixtureCoverCta')}
            </Button>
          )}
        </Card>
      )}

      {/* Leaving does not remove the fixture from the teammate's list — they
          were in it, and may want back in. The banner carries the only two
          things that matter after leaving: the slot is open, and nobody was
          told (no push exists yet). */}
      {/* Your own seat, waiting for whoever takes it (ADR-0044). You still
          hold it: the card says so, and offers the two things left to do. */}
      {replacing && !frozen && (
        <Card color={TOKENS.sunSoft} padded={16} elevation="e0" style={{ borderColor: 'transparent', gap: 10 }}>
          <Text style={[type.label, { color: TOKENS.sunDeep }]}>{t('fixtureReplacingTitle')}</Text>
          <Text style={[type.body, { color: TOKENS.sunDeep }]}>
            {ownPaid ? t('fixtureReplacingBodyPaid', { amount: shareLabel }) : t('fixtureReplacingBody')}
          </Text>
          {replacementError && (
            <Text style={[type.body, { color: TOKENS.alertDeep }]}>{replacementError}</Text>
          )}
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <Button size="sm" color={TOKENS.primary} onPress={onReplace}>
              {t('fixtureReplacingShare')}
            </Button>
            <Button size="sm" variant="secondary" disabled={leaving} onPress={onKeepSeat}>
              {t('fixtureReplacingKeep')}
            </Button>
          </View>
        </Card>
      )}

      {hasLeft && !frozen && (
        <Card color={TOKENS.sunSoft} padded={16} elevation="e0" style={{ borderColor: 'transparent', gap: 10 }}>
          <Text style={[type.label, { color: TOKENS.sunDeep }]}>{t('fixtureOutBannerTitle')}</Text>
          <Text style={[type.body, { color: TOKENS.sunDeep }]}>{t('fixtureOutBannerBody')}</Text>
          <View style={{ alignSelf: 'flex-start' }}>
            <Button size="sm" color={TOKENS.primary} onPress={onReplace}>
              {ownRow?.slot_kind === 'gk' ? t('fixtureOutBannerAskKeeper') : t('fixtureOutBannerAsk')}
            </Button>
          </View>
        </Card>
      )}

      <View style={{ gap: 6 }}>
        <Text style={type.eyebrow}>
          {(played
            ? t('fixtureEyebrowPlayed')
            : isOrganiser
              ? t('fixtureEyebrowOrganiser')
              // The banner already says "you're out" — the eyebrow repeating
              // it reads as noise, so it just falls back to a neutral label.
              : hasLeft
                ? t('bookingDetailTitle')
                : t('fixtureEyebrowIn')) + ` · ${fixture.code}`}
        </Text>
        <Text style={type.h1}>{whenLine}</Text>
        <Text style={[type.body, { fontSize: 16, color: TOKENS.ink }]}>
          {timeLine} · {fixture.pitch_type}
          {cancelled ? '' : ` · ${relativeWhen(t, fixture, played)}`}
        </Text>
        <Text style={type.body}>{whereLine}</Text>
        {/* The way to the gate (plans/maps.md M1): the venue's pin, not a
            search of its address. */}
        {!cancelled && !played && fixture.lat != null && fixture.lng != null ? (
          <Press
            feel="control"
            accessibilityRole="link"
            onPress={() => openDirections({ lat: fixture.lat!, lng: fixture.lng!, name: fixture.venue_name })}
            hitSlop={8}
            style={{ alignSelf: 'flex-start' }}
          >
            <Text style={[type.body, { color: TOKENS.primaryDeep, fontWeight: '600' }]}>{t('directions')} →</Text>
          </Press>
        ) : null}
      </View>

      {/* The roster's prominence scales with how full it is: on the night you
          book, nobody is here yet and the only useful act is the invite. */}
      {showInvite && isEmpty && (
        <View style={{ gap: 8 }}>
          <Button size="lg" full onPress={onInvite}>
            {t('fixtureInviteCta')}
          </Button>
          <Text style={[type.body, { textAlign: 'center', fontSize: 13 }]}>
            {t('fixtureInviteHint')}
          </Text>
        </View>
      )}

      <View style={{ gap: SPACE.s3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text style={type.section}>{t('fixtureSquad').toUpperCase()}</Text>
          <Tally
            align="right"
            style={type.count}
            value={
              cancelled
                ? t('fixtureSquadWereIn', { filled })
                : played
                  ? t('fixtureSquadPlayed', { filled })
                  : t('fixtureSquadOf', { filled, total })
            }
          />
        </View>

        {gkShown.length > 0 && (
          <>
            <GroupLabel
              label={t('fixtureKeepers')}
              filled={gk.filter(Boolean).length}
              of={played ? null : fixture.gk_slots}
            />
            <KeeperGroup
              slots={gkShown}
              missing={frozen ? 0 : keeperPlaces}
              cancelled={cancelled}
              showPaid={collecting}
              onAsk={onAskKeepers}
              onSeat={frozen ? undefined : onSeat}
              pool={isOrganiser && !frozen ? { state: pool, error: keeperError, busy: keeperBusy, onPost: onPostKeeper, onWithdraw: onWithdrawKeeper } : null}
            />
          </>
        )}

        <GroupLabel
          label={t('fixtureOutfield')}
          filled={outFilled.length}
          of={played ? null : fixture.outfield_slots}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.s3 }}>
          {outFilled.map((p) => (
            <SeatCell key={p.participant_id} style={{ width: '47.6%' }}>
              <Slot
                player={p}
                kind="outfield"
                dimmed={cancelled}
                showPaid={collecting}
                onSeat={frozen ? undefined : onSeat}
              />
            </SeatCell>
          ))}
          {Array.from({ length: shownEmpty }).map((_, i) => (
            <SeatCell key={`e${i}`} style={{ width: '47.6%' }}>
              <Slot
                player={null}
                kind="outfield"
                dimmed={cancelled}
                onSeat={frozen ? undefined : onSeat}
              />
            </SeatCell>
          ))}
          {hiddenEmpty > 0 && (
            <SeatCell key="more" style={{ width: '47.6%' }}>
              <Press
                onPress={() => setExpanded(true)}
                accessibilityLabel={t('fixtureSlotMoreOpen', { count: hiddenEmpty })}
                style={[
                  styles.slot,
                  {
                    justifyContent: 'center',
                    borderWidth: 1.5,
                    borderStyle: 'dashed',
                    borderColor: TOKENS.lineBold,
                    opacity: 0.55,
                  },
                ]}
              >
                <Text style={{ fontFamily: TOKENS.ui, fontSize: 14, color: TOKENS.ink3 }}>
                  {t('fixtureSlotMoreOpen', { count: hiddenEmpty })}
                </Text>
              </Press>
            </SeatCell>
          )}
        </View>

        {/* The withdrawals, under the squad rather than inside it: they hold
            no slot, so putting them in the grid would misread the count.
            Struck through and still tappable - "who dropped, and when" is
            exactly what the organiser looking at the gap above needs. */}
        {dropped.length > 0 && !frozen && (
          <Arrive style={{ gap: 8, marginTop: 4 }}>
            <Text style={[type.label, { color: TOKENS.ink3 }]}>
              {t('fixtureDroppedTitle', { count: dropped.length })}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.s3 }}>
              {dropped.map((p) => (
                <SeatCell key={p.participant_id} style={{ width: '47.6%' }}>
                  <Slot player={p} kind={p.slot_kind} struck onSeat={onSeat} />
                </SeatCell>
              ))}
            </View>
            <Text style={[type.body, { fontSize: 13 }]}>{t('fixtureDroppedBody')}</Text>
          </Arrive>
        )}
      </View>

      {showInvite && !isEmpty && (
        <Button size="md" variant="secondary" full onPress={onInvite}>
          {t('fixtureInviteMore', { count: total - filled })}
        </Button>
      )}

      {/* A teammate holding the same link had no way to use it. Bringing a
          mate is the most ordinary thing a player does about a short squad,
          and gating it to the organiser meant the fixture stayed short while
          nine people each knew someone. Secondary weight: it is the
          organiser's fixture, and this is a hand, not a takeover. */}
      {!isOrganiser && !frozen && !hasLeft && filled < total && (
        <Button size="md" variant="secondary" full onPress={onInvite}>
          {t('fixtureInviteTeammate')}
        </Button>
      )}

      {/* The keeper block's amber, resolved. Quiet on purpose: confirmed.tsx
          owns the app's only celebratory moment. */}
      {complete && (
        <Card
          color={TOKENS.pitchSoft}
          padded={16}
          elevation="e0"
          style={{ borderColor: 'transparent', gap: 10 }}
        >
          <Text style={[type.label, { color: TOKENS.pitchDeep }]}>{t('fixtureCompleteTitle')}</Text>
          <Text style={[type.body, { color: TOKENS.pitchDeep, fontSize: 13, lineHeight: 18 }]}>
            {t('fixtureCompleteBody')}
          </Text>
          <View style={{ alignSelf: 'flex-start' }}>
            <Button variant="secondary" size="sm" color={TOKENS.primaryDeep} onPress={onSendDetails}>
              {t('fixtureSendDetails')}
            </Button>
          </View>
        </Card>
      )}

      {/* The organiser's question is not "what did I pay" but "what do I ask
          each of them for". Display-only until split payment (unit 3, #38). */}
      <Card padded={18} radius="lg" style={{ gap: 14 }}>
        {cancelled && fixture.cancellation_refund_cents !== null ? (
          <View style={{ gap: 10 }}>
            <Text style={[type.label, { color: TOKENS.ink3 }]}>{t('fixtureRefund')}</Text>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}
            >
              <Text style={type.money}>
                €{(fixture.cancellation_refund_cents / 100).toFixed(2)}
              </Text>
              <Text style={[type.body, { fontSize: 13 }]}>
                {t('fixtureRefundOf', {
                  total: `€${(fixture.total_cents / 100).toFixed(0)}`,
                  policy: fixture.cancellation_policy,
                })}
              </Text>
            </View>
          </View>
        ) : cancelled ? null : hasLeft ? (
          <Text style={[type.body, { fontSize: 14 }]}>{t('fixtureOwedNothing')}</Text>
        ) : viewerFreeKeeper ? (
          <View style={{ gap: 4 }}>
            <Text style={[type.label, { color: TOKENS.ink3 }]}>{t('fixtureYourShare')}</Text>
            <Text style={type.bigMoney}>{t('fixtureKeeperFreeShare')}</Text>
            <Text style={[type.body, { fontSize: 13, color: TOKENS.ink3, marginTop: 2 }]}>
              {t('fixtureKeeperFreeHint')}
            </Text>
          </View>
        ) : isSplit ? (
          <View style={{ gap: 4 }}>
            <Text style={[type.label, { color: TOKENS.ink3 }]}>
              {ownRow && !isOrganiser ? t('fixtureYourShare') : t('fixtureShareEach')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={type.bigMoney}>€{(shareCents / 100).toFixed(2)}</Text>
              <Tally
                style={[type.body, { fontSize: 13 }]}
                value={
                  collecting
                    ? t('fixtureSharesPaid', { paid: paidCount, filled: filled - freeKeepers })
                    : t('fixtureSharesSettled')
                }
              />
            </View>
            <Text style={[type.body, { fontSize: 13, color: TOKENS.ink3, marginTop: 2 }]}>
              {t('fixtureSplitHint')}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 4 }}>
            <Text style={[type.label, { color: TOKENS.ink3 }]}>
              {played
                ? isOrganiser
                  ? t('fixtureOwedToYou')
                  : t('fixtureYouOwe', { name: organiserName })
                : !isOrganiser
                  ? t('fixtureYourShare')
                  : isEmpty
                    ? t('fixtureSplitsTo')
                    : t('fixtureAskEachFor')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Tally
                style={type.bigMoney}
                value={`€${((isEmpty && !played ? perHeadFull : perHeadNow) / 100).toFixed(2)}`}
              />
              <Tally
                style={[type.body, { fontSize: 13 }]}
                value={
                  played
                    ? t('fixtureSquadPlayed', { filled })
                    : isEmpty
                      ? t('fixtureEachOnceFull', { total })
                      : t('fixtureAtNIn', { filled: payersNow })
                }
              />
            </View>
            {freeKeepers > 0 && (
              <Text style={[type.body, { fontSize: 13, color: TOKENS.ink3 }]}>{t('fixtureKeeperFreeNote')}</Text>
            )}
            {!isEmpty && !played && filled < total && (
              <Text style={[type.body, { fontSize: 13, color: TOKENS.ink3 }]}>
                {t('fixtureIfAllCome', {
                  amount: `€${(perHeadFull / 100).toFixed(2)}`,
                  total,
                })}
              </Text>
            )}
            <Text style={[type.body, { fontSize: 13, color: TOKENS.ink3, marginTop: 2 }]}>
              {isOrganiser
                ? t('fixtureSettleHint')
                : t('fixtureSettleHintTeammate', { name: organiserName })}
            </Text>
          </View>
        )}

        <View style={{ height: 1, backgroundColor: TOKENS.line }} />
        <PriceSummary
          lines={[
            { id: 'pitch', label: t('fixturePitchLine'), amountCents: fixture.total_cents - addonsTotal(fixture) },
            ...fixture.addons.map((a) => ({
              id: a.addon_code,
              label: `${a.addon_code === 'bibs' ? t('addonBibs') : t('addonBallRental')} ×${a.quantity}`,
              amountCents: a.unit_price_cents * a.quantity,
            })),
          ]}
          totalLabel={
            isSplit
              ? t('fixtureSplitTotal')
              : isOrganiser
                ? t('fixturePaidByYou')
                : t('fixturePaidByThem', { name: organiserName })
          }
          totalCents={fixture.total_cents}
        />
      </Card>

      {/* The community listing (ADR-0028). Only while short — a full fixture
          is delisted by the board's own predicate, and showing a switch that
          does nothing would be a lie. Same reason the states are pinned to
          the board's own listable set: a pending (unpaid) booking cannot
          list, so it does not get a switch claiming otherwise. Split
          fixtures list too: a stranger claiming a paid slot is the C2 door
          working as designed. */}
      {isOrganiser && !frozen && filled < total &&
        ['collecting', 'paid', 'confirmed'].includes(fixture.state) && (
        <CommunityToggle fixture={fixture} />
      )}

      {/* Court cameras (ADR-0042): nothing at a court without one. */}
      {!cancelled && !hasLeft && (
        <RecordingCard
          bookingId={fixture.booking_id}
          startsAt={fixture.starts_at}
          played={played}
          isOrganiser={isOrganiser}
          locale={locale}
        />
      )}

      {played && keeperDue && <KeeperFeedbackCard due={keeperDue} onDone={() => setKeeperDue(null)} />}

      {played && (
        <View style={{ gap: 8 }}>
          <Button size="lg" full onPress={onRebook}>
            {t('fixtureRebook')}
          </Button>
          <Text style={[type.body, { textAlign: 'center', fontSize: 13 }]}>
            {t('fixtureRebookHint')}
          </Text>
        </View>
      )}

      {/* A destructive action does not get equal weight with the invite. */}
      {isOrganiser && !frozen && (
        <Press
          feel="control"
          onPress={() => {
            haptic('press');
            onCancelPress();
          }}
          disabled={cancelling}
          style={{ alignSelf: 'center', padding: 12 }}
        >
          <Text
            style={{
              fontFamily: TOKENS.ui,
              fontSize: 15,
              fontWeight: '600',
              color: TOKENS.alertDeep,
              opacity: cancelling ? 0.5 : 1,
            }}
          >
            {cancelling ? t('bookingCancelling') : t('bookingCancelCta')}
          </Text>
        </Press>
      )}

      {/* The teammate's counterpart to cancel: same weight, same place.
          Leaving is as ordinary an act as joining — burying it just means
          people leave by not turning up, which is the outcome to avoid. */}
      {!isOrganiser && !frozen && !hasLeft && (
        <Press
          feel="control"
          onPress={() => {
            openLeaveSheet({
              isKeeper: ownRow?.slot_kind === 'gk',
              late: hoursToSlot <= 2,
              organiserName,
              onLeave,
              onAskAndStay: onReplace,
              replacement: replacing ? null : replacementMode,
              shareAmount: shareLabel,
              leaveMode,
              onFindReplacement,
            });
            router.push(`/booking/${id}/leave`);
          }}
          disabled={leaving}
          style={{ alignSelf: 'center', padding: 12 }}
        >
          <Text
            style={{
              fontFamily: TOKENS.ui,
              fontSize: 15,
              fontWeight: '600',
              color: TOKENS.alertDeep,
              opacity: leaving ? 0.5 : 1,
            }}
          >
            {t('fixtureLeaveCta')}
          </Text>
        </Press>
      )}
      {!isOrganiser && !frozen && hasLeft && (
        <Press
          feel="control"
          onPress={() => {
            haptic('press');
            void onRejoin();
          }}
          disabled={leaving}
          style={{ alignSelf: 'center', padding: 12 }}
        >
          <Text
            style={{
              fontFamily: TOKENS.ui,
              fontSize: 15,
              fontWeight: '600',
              color: TOKENS.primaryDeep,
              opacity: leaving ? 0.5 : 1,
            }}
          >
            {t('fixtureRejoinCta')}
          </Text>
        </Press>
      )}
      {leaveError && (
        <Arrive>
          <Text style={[type.body, { color: TOKENS.alertDeep, textAlign: 'center' }]}>
            {leaveError}
          </Text>
        </Arrive>
      )}
    </ScrollView>
    </Arrivals.Provider>
  );
}

/* ───────────────────────────── roster parts ───────────────────────────── */

// The organiser's listing switch (ADR-0028). Optimistic — the flip is a
// single-column UPDATE that only ever races with the organiser themselves —
// with a revert-on-error rather than a spinner over a switch.
function CommunityToggle({ fixture }: { fixture: Fixture }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(fixture.is_open);
  const [level, setLevel] = useState<OpenLevel | null>(fixture.open_level);
  // A reload elsewhere (pull-to-refresh, join events) re-renders with fresh
  // fixture data; follow it so the switch never argues with the server.
  useEffect(() => {
    setOpen(fixture.is_open);
    setLevel(fixture.open_level);
  }, [fixture.is_open, fixture.open_level]);

  // The parents' game (plans/cfa-in-the-app.md K6): at a venue that hosts
  // the CFA's children on Saturdays, an open game can ask the parents who
  // follow a team there and said "I play too". Once per game, server-side;
  // the answer never says how many (ADR-0051).
  const [hostsCfa, setHostsCfa] = useState(false);
  const [asked, setAsked] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  useEffect(() => {
    let cancelled = false;
    venueHostsCfa(fixture.venue_id)
      .then((yes) => {
        if (!cancelled) setHostsCfa(yes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fixture.venue_id]);
  const onAskParents = async () => {
    setAsked('busy');
    try {
      await askParents(fixture.booking_id);
      capture('parents_asked', { booking_id: fixture.booking_id });
      setAsked('done');
    } catch {
      setAsked('error');
    }
  };

  const onToggle = async (next: boolean) => {
    setOpen(next);
    try {
      await setFixtureOpen(fixture.booking_id, next);
      capture('fixture_opened', { booking_id: fixture.booking_id, is_open: next });
    } catch {
      setOpen(!next);
    }
  };

  // Tapping the active chip clears the tag — "unsaid" is a valid answer,
  // not a state the organiser gets locked out of.
  const onLevel = async (next: OpenLevel) => {
    const value = level === next ? null : next;
    const prev = level;
    setLevel(value);
    try {
      await setFixtureLevel(fixture.booking_id, value);
      capture('fixture_level_set', {
        booking_id: fixture.booking_id,
        level: value ?? 'unset',
      });
    } catch {
      setLevel(prev);
    }
  };

  return (
    <Card padded={16} elevation="e1" style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <Text style={[type.label, { color: TOKENS.ink }]}>
            {t('fixtureOpenToggleTitle')}
          </Text>
          {open && (
            <Text
              style={{
                fontFamily: TOKENS.monoMedium,
                fontSize: 10,
                color: TOKENS.pitchDeep,
                letterSpacing: 0.6,
              }}
            >
              {t('fixtureOpenToggleOnTag').toUpperCase()}
            </Text>
          )}
        </View>
        <Switch
          value={open}
          onValueChange={onToggle}
          trackColor={{ true: TOKENS.primary, false: TOKENS.line }}
          accessibilityLabel={t('fixtureOpenToggleTitle')}
        />
      </View>
      <Text style={[type.body, { fontSize: 13 }]}>{t('fixtureOpenToggleBody')}</Text>

      {open && (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink2 }}>
            {t('fixtureOpenLevelHint')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip size="sm" active={level === 'casual'} onPress={() => onLevel('casual')}>
              {t('levelCasual')}
            </Chip>
            <Chip size="sm" active={level === 'competitive'} onPress={() => onLevel('competitive')}>
              {t('levelCompetitive')}
            </Chip>
          </View>
        </View>
      )}

      {open && hostsCfa && (
        <View style={{ gap: 6, marginTop: 8 }}>
          {asked === 'done' ? (
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.pitchDeep }}>{t('askParentsDone')}</Text>
          ) : (
            <>
              <Button size="sm" variant="secondary" onPress={onAskParents} disabled={asked === 'busy'}>
                {t('askParents')}
              </Button>
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>
                {asked === 'error' ? t('askParentsError') : t('askParentsHint')}
              </Text>
            </>
          )}
        </View>
      )}
    </Card>
  );
}

function GroupLabel({ label, filled, of }: { label: string; filled: number; of: number | null }) {
  const style = [type.label, { color: TOKENS.ink3 }];
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
      <Text style={style}>{label.toUpperCase()}</Text>
      <Tally style={style} value={of === null ? String(filled) : `${filled}/${of}`} />
    </View>
  );
}

// The gap and the remedy are one element. Drawn apart, the screen said "short
// a keeper" twice and the second time was nowhere near the slot.
type KeeperPool = {
  state: KeeperRequestState | null;
  error: string | null;
  /** Which pool action is in flight, so its button holds a spinner. */
  busy: KeeperShape | 'withdraw' | null;
  onPost: (shape: KeeperShape) => void;
  onWithdraw: () => void;
};

function KeeperGroup({
  slots,
  missing,
  cancelled,
  showPaid,
  onAsk,
  onSeat,
  pool,
}: {
  slots: Array<RosterEntry | null>;
  missing: number;
  cancelled: boolean;
  showPaid?: boolean;
  onAsk: () => void;
  onSeat?: (player: RosterEntry | null, kind: SlotKind) => void;
  /** The organiser's line to the keeper pool (ADR-0047); null for everyone else. */
  pool?: KeeperPool | null;
}) {
  const { t } = useTranslation();
  const row = (
    <View style={{ flexDirection: 'row', gap: SPACE.s3 }}>
      {slots.map((p, i) => (
        <SeatCell key={p?.participant_id ?? `gk${i}`} style={{ flex: 1 }}>
          <Slot
            player={p}
            kind="gk"
            dimmed={cancelled}
            onWarmGround={missing > 0}
            showPaid={showPaid}
            onSeat={onSeat}
          />
        </SeatCell>
      ))}
    </View>
  );
  if (missing === 0) return row;
  return (
    <Card
      color={TOKENS.sunSoft}
      padded={12}
      elevation="e0"
      style={{ borderColor: 'transparent', gap: 12 }}
    >
      {row}
      <View style={{ gap: 10, paddingHorizontal: 2 }}>
        <Text style={[type.body, { color: TOKENS.sunDeep, fontSize: 13, lineHeight: 18 }]}>
          {missing > 1 ? t('fixtureKeeperNoneBody') : t('fixtureKeeperShortBody')}
        </Text>
        {pool ? (
          pool.state?.status === 'open' ? (
            <>
              <Text style={[type.body, { color: TOKENS.sunDeep, fontSize: 13, lineHeight: 18, fontWeight: '600' }]}>
                {(pool.state.audience > 1
                  ? t('fixtureKeeperPosted', { count: pool.state.audience })
                  : pool.state.audience === 1
                    ? t('fixtureKeeperPostedOne')
                    : t('fixtureKeeperPostedNone')) +
                  (pool.state.shape === 'rotation' ? t('fixtureKeeperPostedRotation') : '')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Button variant="secondary" size="sm" color={TOKENS.primaryDeep} onPress={onAsk}>
                  {t('fixtureKeeperAskWhatsapp')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  color={TOKENS.ink2}
                  loading={pool.busy === 'withdraw'}
                  onPress={pool.onWithdraw}
                >
                  {t('fixtureKeeperWithdraw')}
                </Button>
              </View>
            </>
          ) : (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Button
                  size="sm"
                  color={TOKENS.primary}
                  loading={pool.busy === 'full'}
                  disabled={pool.busy !== null && pool.busy !== 'full'}
                  onPress={() => pool.onPost('full')}
                >
                  {t('fixtureKeeperPost')}
                </Button>
                <Button variant="secondary" size="sm" color={TOKENS.primaryDeep} onPress={onAsk}>
                  {t('fixtureKeeperAskWhatsapp')}
                </Button>
              </View>
              <Press
                feel="control"
                onPress={() => pool.onPost('rotation')}
                disabled={pool.busy !== null}
                hitSlop={6}
                style={{ alignSelf: 'flex-start', opacity: pool.busy === 'rotation' ? 0.5 : 1 }}
              >
                <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.sunDeep, textDecorationLine: 'underline' }}>
                  {t('fixtureKeeperPostRotation')}
                </Text>
              </Press>
            </View>
          )
        ) : (
          <View style={{ alignSelf: 'flex-start' }}>
            <Button variant="secondary" size="sm" color={TOKENS.primaryDeep} onPress={onAsk}>
              {t('fixtureKeeperAsk')}
            </Button>
          </View>
        )}
        {pool?.error ? (
          <Arrive>
            <Text style={[type.body, { color: TOKENS.alertDeep, fontSize: 13 }]}>{pool.error}</Text>
          </Arrive>
        ) : null}
      </View>
    </Card>
  );
}

// After the final whistle, the two-sided record (ADR-0047): the organiser
// says whether the pool keeper turned up and whether he would have him back;
// the keeper says whether he would play for that team again. Yes or no.
function KeeperFeedbackCard({ due, onDone }: { due: KeeperFeedbackDue; onDone: () => void }) {
  const { t } = useTranslation();
  const [showed, setShowed] = useState<boolean | null>(null);
  const [again, setAgain] = useState<boolean | null>(null);
  const [state, setState] = useState<'asking' | 'saving' | 'done' | 'error'>('asking');
  const organiser = due.role === 'organiser';

  useEffect(() => {
    if (state !== 'asking' || again === null || (organiser && showed === null)) return;
    setState('saving');
    giveKeeperFeedback(due.request_id, organiser ? showed : null, again)
      .then(() => {
        capture('keeper_feedback', { role: due.role, again });
        setState('done');
        setTimeout(onDone, 1800);
      })
      .catch(() => setState('error'));
  }, [showed, again, state, organiser, due, onDone]);

  const pair = (value: boolean | null, set: (v: boolean) => void) => (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Chip active={value === true} onPress={() => set(true)}>
        {t('keeperFeedbackYes')}
      </Chip>
      <Chip active={value === false} onPress={() => set(false)}>
        {t('keeperFeedbackNo')}
      </Chip>
    </View>
  );

  return (
    <Card color={TOKENS.pitchSoft} padded={16} elevation="e0" style={{ borderColor: 'transparent', gap: 12 }}>
      {state === 'done' ? (
        <Text style={[type.body, { color: TOKENS.pitchDeep, fontWeight: '600' }]}>{t('keeperFeedbackThanks')}</Text>
      ) : (
        <>
          {organiser ? (
            <>
              <Text style={[type.body, { color: TOKENS.ink, fontWeight: '600' }]}>
                {t('keeperFeedbackOrganiserTitle', { name: due.other_name ?? '' })}
              </Text>
              {pair(showed, setShowed)}
              <Text style={[type.body, { color: TOKENS.ink, fontWeight: '600' }]}>{t('keeperFeedbackBack')}</Text>
              {pair(again, setAgain)}
            </>
          ) : (
            <>
              <Text style={[type.body, { color: TOKENS.ink, fontWeight: '600' }]}>{t('keeperFeedbackKeeperTitle')}</Text>
              {pair(again, setAgain)}
            </>
          )}
          <Text style={[type.body, { fontSize: 12, color: TOKENS.ink3 }]}>{t('keeperFeedbackHint')}</Text>
          {state === 'error' ? (
            <Text style={[type.body, { color: TOKENS.alertDeep, fontSize: 13 }]}>{t('fixtureKeeperError')}</Text>
          ) : null}
        </>
      )}
    </Card>
  );
}

// A seat. Until launch prep this was a label; every one of them is now the
// tap target its shape has always implied - a filled seat opens the person,
// an empty one opens the gap and the act that closes it. `Seat` supplies the
// press behaviour so both readings keep identical geometry: wrapping only
// the filled case in a Pressable shifted the grid by a pixel.
function Seat({
  onPress,
  accessibilityLabel,
  children,
  style,
}: {
  onPress?: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
  style: object[];
}) {
  if (!onPress) return <View style={style}>{children}</View>;
  // A seat opens its sheet: a Press (it gives under the finger), not the
  // opacity snap it was.
  return (
    <Press onPress={onPress} accessibilityLabel={accessibilityLabel} style={style}>
      {children}
    </Press>
  );
}

function Slot({
  player,
  kind,
  dimmed,
  onWarmGround,
  showPaid,
  struck,
  onSeat,
}: {
  player: RosterEntry | null;
  kind: SlotKind;
  dimmed?: boolean;
  onWarmGround?: boolean;
  /** C2 W6: on a collecting split fixture, every seat says where its money
   * stands — the roster is the ledger everyone can read. */
  showPaid?: boolean;
  /** A departed player, shown outside the grid. Reads as spent, not absent. */
  struck?: boolean;
  onSeat?: (player: RosterEntry | null, kind: SlotKind) => void;
}) {
  const { t } = useTranslation();
  const gkEmpty = !player && kind === 'gk';
  // `sun` on `sunSoft` is barely a border.
  const gkDash = onWarmGround ? TOKENS.sunDeep : TOKENS.sun;
  const press = onSeat ? () => onSeat(player, kind) : undefined;

  if (!player) {
    return (
      <Seat
        onPress={press}
        accessibilityLabel={gkEmpty ? t('fixtureSlotKeeper') : t('fixtureSlotOpen')}
        style={[
          styles.slot,
          {
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: gkEmpty ? gkDash : TOKENS.lineBold,
            opacity: dimmed ? 0.4 : gkEmpty ? 1 : 0.55,
          },
        ]}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: gkEmpty ? gkDash : TOKENS.lineBold,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{ fontFamily: TOKENS.ui, fontSize: 15, color: gkEmpty ? TOKENS.sunDeep : TOKENS.ink3 }}
          >
            +
          </Text>
        </View>
        <Text
          numberOfLines={1}
          style={{ fontFamily: TOKENS.ui, fontSize: 14, color: gkEmpty ? TOKENS.sunDeep : TOKENS.ink3 }}
        >
          {gkEmpty ? t('fixtureSlotKeeper') : t('fixtureSlotOpen')}
        </Text>
      </Seat>
    );
  }

  // The label says "You"; the avatar still says who you are. Deriving the
  // initial from the label gives every viewer a "Y" on their own tile.
  const realName = rosterName(player);
  const name = player.is_you ? t('fixtureYou') : realName;
  return (
    <Seat
      onPress={press}
      accessibilityLabel={name}
      style={[
        styles.slot,
        struck ? {} : ELEV.e1,
        {
          backgroundColor: struck ? 'transparent' : TOKENS.surface,
          borderWidth: struck ? 1 : 0,
          borderColor: TOKENS.line,
          opacity: dimmed ? 0.4 : struck ? 0.6 : 1,
        },
      ]}
    >
      <Avatar initial={initialFor(realName)} color={colorFor(player.user_id)} size={28} />
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: TOKENS.ui,
            fontSize: 14,
            fontWeight: '600',
            color: struck ? TOKENS.ink3 : TOKENS.ink,
            textDecorationLine: struck ? 'line-through' : 'none',
          }}
        >
          {name}
        </Text>
        {player.is_organiser && (
          <Text style={{ fontFamily: TOKENS.mono, fontSize: 9.5, color: TOKENS.ink3, letterSpacing: 0.6 }}>
            {t('fixtureOrganiserTag')}
          </Text>
        )}
        {player.status === 'in' && player.replacing_since && !struck && (
          <Text style={{ fontFamily: TOKENS.mono, fontSize: 9.5, color: TOKENS.sunDeep, letterSpacing: 0.6 }}>
            {t('fixtureReplacingTag')}
          </Text>
        )}
        {player.keeper_free && player.status === 'in' && !struck ? (
          <Text style={{ fontFamily: TOKENS.mono, fontSize: 9.5, color: TOKENS.pitchDeep, letterSpacing: 0.6 }}>
            {t('fixtureKeeperFreeTag')}
          </Text>
        ) : null}
        {showPaid && !player.is_organiser && !player.keeper_free && (
          <PaidTag paid={!!player.share_paid} label={player.share_paid ? t('fixturePaidTag') : t('fixtureUnpaidTag')} />
        )}
      </View>
      {/* The seat's own affordance. A chevron on every tile would shout; the
          faint one appears only where a tap goes somewhere. */}
      {press && (
        <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink3, opacity: 0.6 }}>
          ›
        </Text>
      )}
    </Seat>
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
      <BackButton onPress={onBack} />
    </View>
  );
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

function addonsTotal(f: Fixture): number {
  return f.addons.reduce((sum, a) => sum + a.unit_price_cents * a.quantity, 0);
}

function relativeWhen(
  t: (k: string, o?: Record<string, unknown>) => string,
  f: Fixture,
  played: boolean,
): string {
  const days = Math.round((new Date(f.starts_at).getTime() - Date.now()) / 86_400_000);
  // A fixture that has just been played is the common case now that the
  // completion cron runs, so the day-one reading is worth having: "1 days
  // ago" was unreachable while `played` never rendered for a completed
  // booking, and became the first thing on screen once it did.
  if (played) {
    const ago = Math.max(1, Math.abs(days));
    return ago === 1 ? t('fixtureAgoOne') : t('fixtureAgo', { count: ago });
  }
  if (days <= 0) return t('fixtureTonight');
  if (days === 1) return t('fixtureTomorrow');
  return t('fixtureIn', { count: days });
}

function formatEur(cents: number): string {
  const euros = cents / 100;
  return euros.toFixed(cents % 100 === 0 ? 0 : 2);
}

function errorMessage(t: (k: string) => string, code: CancelErrorCode): string {
  switch (code) {
    case 'STRIPE_ERROR':
    case 'PAYMENT_NOT_FOUND':
      return t('cancelErrorStripe');
    case 'NETWORK_ERROR':
      return t('cancelErrorNetwork');
    case 'UNAUTHORIZED':
      return t('cancelErrorUnauthorized');
    default:
      return t('cancelErrorGeneric');
  }
}

/* ─────────────────────────────── styles ─────────────────────────────── */

const styles = StyleSheet.create({
  slot: {
    height: 48,
    borderRadius: RADII.md,
    borderCurve: 'continuous',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});

/* ───────────────────────────── motion parts ───────────────────────────── */
// plans/motion-v3.md, sweep 3. The fixture stays mounted across reloads now
// (slice 0), so what changed can be seen to change.

/** True once the fixture has rendered: the first frame lands still. */
const Arrivals = createContext(false);

// A seat arriving is spatial (it scales up into its place on the spatial
// spring); leaving is a fade. Neighbours glide on ROW_LAYOUT.
const seatIn = (reduceMotion: boolean) => () => {
  'worklet';
  if (reduceMotion) {
    return {
      initialValues: { opacity: 0 },
      animations: {
        opacity: withTiming(1, { duration: MOTION.quick / 2, easing: EASE, reduceMotion: ReduceMotion.Never }),
      },
    };
  }
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.92 }] },
    animations: {
      opacity: withTiming(1, { duration: MOTION.quick, easing: EASE }),
      transform: [{ scale: withSpring(1, SPRING.spatial) }],
    },
  };
};
const seatOut = (reduceMotion: boolean) => () => {
  'worklet';
  return {
    initialValues: { opacity: 1 },
    animations: {
      opacity: withTiming(0, {
        duration: reduceMotion ? MOTION.instant / 2 : MOTION.instant,
        easing: EASE,
        reduceMotion: ReduceMotion.Never,
      }),
    },
  };
};

/** One cell of a roster grid: a seat filling or emptying is seen to. */
function SeatCell({ children, style }: { children: React.ReactNode; style: object }) {
  const animate = useContext(Arrivals);
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View
      entering={animate ? seatIn(reduceMotion) : undefined}
      exiting={animate ? seatOut(reduceMotion) : undefined}
      layout={animate && !reduceMotion ? ROW_LAYOUT : undefined}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

/** A message or card that appears after the fixture is up arrives as a
 *  Reveal; on the first render it is simply there. */
function Arrive({ children, style }: { children: React.ReactNode; style?: object }) {
  const animate = useContext(Arrivals);
  if (!animate) return <View style={style}>{children}</View>;
  return <Reveal style={style}>{children}</Reveal>;
}

/** PAID / UNPAID cross-fades when a share settles, instead of swapping. */
function PaidTag({ paid, label }: { paid: boolean; label: string }) {
  const animate = useContext(Arrivals);
  return (
    <Animated.Text
      key={paid ? 'paid' : 'unpaid'}
      entering={animate ? FadeIn.duration(MOTION.quick) : undefined}
      style={{
        fontFamily: TOKENS.mono,
        fontSize: 9.5,
        color: paid ? TOKENS.pitchDeep : TOKENS.sunDeep,
        letterSpacing: 0.6,
      }}
    >
      {label}
    </Animated.Text>
  );
}

/** The fixture's first load: its shape, not a spinner (plans/motion-v3.md). */
function FixtureSkeleton({ label }: { label: string }) {
  return (
    <View accessibilityLabel={label} style={{ padding: SPACE.s5, gap: SPACE.s5 }}>
      <View style={{ gap: 8 }}>
        <Skeleton variant="row" />
        <Skeleton variant="row" />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.s3 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={{ width: '47.6%' }}>
            <Skeleton variant="tile" />
          </View>
        ))}
      </View>
      <Skeleton variant="card" />
    </View>
  );
}

