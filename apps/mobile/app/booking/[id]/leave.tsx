// Giving up a seat, as a native `formSheet` route (motion-v2 slice 7 /
// gesture-motion G3). Dismissing IS staying in — the sheet's own *Stay in*
// and the OS's drag and scrim all come to the same thing, so there is no
// `onStay` callback: leaving is the only act that has to be asked for.
//
// Find my replacement (ADR-0044): on a live, bought fixture the first answer
// is to keep the seat until someone takes it — the squad is never a man
// short without knowing, and on a paid split seat the share comes back when
// the taker pays. Leaving outright stays one tap below it, worded by what it
// does to the money.

import { Button, Press, TOKENS, haptic } from '@ludi/ui';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { afterDismiss, useFixtureSheets } from '@/lib/fixture-sheets';
import { fixtureType as type } from '@/lib/fixture-type';

export default function LeaveSheet() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { leave } = useFixtureSheets();

  useEffect(() => {
    if (!leave && router.canGoBack()) router.back();
  }, [leave, router]);

  if (!leave) return null;

  const {
    isKeeper,
    late,
    organiserName,
    onLeave,
    onAskAndStay,
    replacement = null,
    shareAmount = '',
    leaveMode = 'plain',
    onFindReplacement,
  } = leave;
  const urgent = isKeeper || late;
  // `late` only fires inside a 2-hour window, so the label doesn't need to
  // be numerically precise — a fixed phrase avoids i18next pluralization,
  // which the Copy interface's exact-property typing doesn't accommodate
  // for a single edge case.
  const hoursLabel = t('leaveSheetHoursLabel');
  const replaceNote = replacement === 'paid'
    ? t('leaveSheetFindReplacementPaidNote', { amount: shareAmount })
    : t('leaveSheetFindReplacementNote');
  // The ordinary leave's body ("it opens for someone else straight away")
  // is the opposite of keeping the seat, so with a replacement on offer the
  // ordinary case speaks about the replacement instead. The keeper and late
  // cases keep their warnings; the note goes under the button there.
  const ordinaryWithReplacement = Boolean(replacement) && !urgent;
  const title = isKeeper && late
    ? t('leaveSheetKeeperLateTitle', { hours: hoursLabel })
    : isKeeper
      ? t('leaveSheetKeeperTitle')
      : late
        ? t('leaveSheetLateTitle', { hours: hoursLabel })
        : ordinaryWithReplacement
          ? t('leaveSheetReplaceTitle')
          : t('leaveSheetOrdinaryTitle');
  const body = isKeeper && late
    ? t('leaveSheetKeeperLateBody')
    : isKeeper
      ? t('leaveSheetKeeperBody')
      : late
        ? t('leaveSheetLateBody')
        : ordinaryWithReplacement
          ? replaceNote
          : t('leaveSheetOrdinaryBody', { organiser: organiserName });

  // What the plain leave does to the money, said on the button.
  const leaveLabel = leaveMode === 'refund'
    ? t('leaveSheetLeaveRefund', { amount: shareAmount })
    : leaveMode === 'no_refund'
      ? t('leaveSheetLeaveNoRefund')
      : urgent || replacement
        ? t('leaveSheetGiveUpAnyway')
        : t('leaveSheetGiveUp');

  // Leaving navigates and mutates on the screen behind, so it runs after the
  // sheet is gone; staying is just a dismissal.
  const leaveAndDismiss = () => {
    router.back();
    afterDismiss(onLeave);
  };

  // Quiet links give under the finger (Press). Leaving is a Do — it changes
  // the game — so it also plays `press`, like the Button it sits under;
  // "Stay in" only closes the sheet and stays silent.
  const quietLink = (label: string, onPress: () => void, color: string, size = 15, does = false) => (
    <Press
      feel="control"
      onPress={() => {
        if (does) haptic('press');
        onPress();
      }}
      style={{ alignSelf: 'center', padding: 10 }}
    >
      <Text style={{ fontFamily: TOKENS.ui, fontSize: size, fontWeight: '600', color }}>{label}</Text>
    </Press>
  );

  return (
    <View style={{ padding: 22, paddingBottom: Math.max(insets.bottom, 16) + 8, gap: 14 }}>
      <Text
        style={[type.h1, { fontSize: 21, lineHeight: 27 }, urgent ? { color: TOKENS.alertDeep } : null]}
      >
        {title}
      </Text>
      <Text style={[type.body, { fontSize: 15, lineHeight: 21 }]}>{body}</Text>
      {replacement && onFindReplacement ? (
        <>
          <Button
            full
            onPress={() => {
              router.back();
              afterDismiss(onFindReplacement);
            }}
          >
            {t('leaveSheetFindReplacement')}
          </Button>
          {!ordinaryWithReplacement && (
            <Text style={[type.body, { fontSize: 13, lineHeight: 18, color: TOKENS.ink2, textAlign: 'center' }]}>
              {replaceNote}
            </Text>
          )}
          {quietLink(leaveLabel, leaveAndDismiss, TOKENS.alertDeep, 15, true)}
          {quietLink(t('leaveSheetStayIn'), () => router.back(), TOKENS.ink3, 14)}
        </>
      ) : urgent ? (
        <>
          <Button
            full
            onPress={() => {
              router.back();
              afterDismiss(onAskAndStay);
            }}
          >
            {isKeeper ? t('leaveSheetAskPool') : t('leaveSheetAskReplacement')}
          </Button>
          {quietLink(leaveLabel, leaveAndDismiss, TOKENS.alertDeep, 15, true)}
          {quietLink(t('leaveSheetStayIn'), () => router.back(), TOKENS.ink3, 14)}
        </>
      ) : (
        <>
          <Button full variant="secondary" color={TOKENS.alertDeep} onPress={leaveAndDismiss}>
            {leaveLabel}
          </Button>
          {quietLink(t('leaveSheetStayIn'), () => router.back(), TOKENS.ink2)}
        </>
      )}
    </View>
  );
}
