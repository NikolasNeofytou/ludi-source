// Settings — everything administrative, moved off the profile tab.
//
// The profile rework (Direction C, 2026-09-02) took the researched rule
// that a profile tab is for identity and a gear is for administration:
// Strava hides it behind ⋯, adidas Running and Ladder behind a gear,
// Slopes behind a sheet. Ludi's profile tab used to carry Sign out and
// Delete account as full-width buttons at thumb height, one scroll from
// the top — the two most destructive actions in the app, styled exactly
// like everything else.
//
// The old hub also had TWO rows ("Edit profile" and "Public player card")
// that pushed to the same edit-profile route. There is one row here, and
// visibility rides on it as a value, because it is one destination.

import { Button, Icon, Press, Reveal, TOKENS } from '@ludi/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { fetchMyFollows, type FollowedTeam } from '@/lib/cfa';
import { getConsent, setAnalyticsChoice } from '@/lib/consent';
import { openHelpMail } from '@/lib/help';
import { getPushPermission } from '@/lib/push';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, signOut } = useSession();
  const userId = session?.user?.id;

  const [isPublic, setIsPublic] = useState<boolean | null>(null);

  // The analytics choice from the consent screen, changeable here any time
  // (the privacy policy promises in-app withdrawal; consent v2). Turning it
  // off stops PostHog sending immediately.
  const [analytics, setAnalytics] = useState<boolean | null>(null);
  useEffect(() => {
    getConsent().then((record) => setAnalytics(record?.analytics ?? false));
  }, []);
  // A switch whose write fails flips back AND says so — it used to snap back
  // without a word (plans/motion-v3.md, Fail). Cleared by the next flip.
  const [analyticsFailed, setAnalyticsFailed] = useState(false);
  const onToggleAnalytics = async (next: boolean) => {
    setAnalyticsFailed(false);
    setAnalytics(next);
    const saved = await setAnalyticsChoice(next);
    if (!saved) {
      setAnalytics(!next);
      setAnalyticsFailed(true);
    }
  };

  // The two notice switches (plans/reach.md R2), read with the profile on
  // focus and written to the player's own row; and the phone's own answer,
  // so someone who said no in the system dialog sees why nothing arrives.
  const [notify, setNotify] = useState<{ games: boolean; asks: boolean } | null>(null);
  // The CFA teams the parent follows (plans/cfa-in-the-app.md K3); a row
  // opens the same sheet the venue's Saturday does.
  const [follows, setFollows] = useState<FollowedTeam[] | null>(null);
  const [osGranted, setOsGranted] = useState<boolean | null>(null);
  const [notifyFailed, setNotifyFailed] = useState(false);
  // The lobby screen's first name (ADR-0054's follow-up, plans/strava-build.md
  // R4a): on by default, as the ADR decided; the player's own row. A failed
  // save puts the switch back and says so, like the switches above.
  const [showName, setShowName] = useState<boolean | null>(null);
  const [showNameFailed, setShowNameFailed] = useState(false);
  const onToggleShowName = async (next: boolean) => {
    if (!userId || showName === null) return;
    setShowNameFailed(false);
    setShowName(next);
    const { error } = await supabase.from('users').update({ show_name_on_screens: next }).eq('id', userId);
    if (error) {
      setShowName(!next);
      setShowNameFailed(true);
    }
  };
  const onToggleNotify = async (key: 'games' | 'asks', next: boolean) => {
    if (!userId || !notify) return;
    const prev = notify;
    setNotifyFailed(false);
    setNotify({ ...notify, [key]: next });
    const { error } = await supabase
      .from('users')
      .update(key === 'games' ? { notify_games: next } : { notify_asks: next })
      .eq('id', userId);
    if (error) {
      setNotify(prev);
      setNotifyFailed(true);
    }
  };

  // Two awaits (the push token, then the session) with nothing on screen
  // used to make Sign out look dead; it holds a spinner now. The gate swaps
  // the screen when the session goes, so only a failure releases it.
  const [signingOut, setSigningOut] = useState(false);
  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      setSigningOut(false);
    }
  };

  // Re-read on focus: edit-profile saves behind this screen's back, so the
  // visibility value would otherwise go stale the moment it is changed.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      supabase
        .from('users')
        .select('public_profile, notify_games, notify_asks, show_name_on_screens')
        .eq('id', userId)
        .single()
        .then(({ data, error }) => {
          setIsPublic(error || !data ? null : Boolean(data.public_profile));
          setNotify(
            error || !data
              ? null
              : { games: data.notify_games !== false, asks: data.notify_asks !== false },
          );
          setShowName(error || !data ? null : data.show_name_on_screens !== false);
        });
      getPushPermission().then((status) => setOsGranted(status === 'granted'));
      fetchMyFollows()
        .then(setFollows)
        .catch(() => setFollows(null));
    }, [userId]),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <BackButton onPress={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 24, flexGrow: 1 }}>
        <Text
          style={{
            fontFamily: TOKENS.displaySemi,
            fontSize: 30,
            color: TOKENS.ink,
            letterSpacing: -0.9,
          }}
        >
          {t('profileHubSettings')}
        </Text>

        <View
          style={{
            backgroundColor: TOKENS.surface,
            borderRadius: 16,
            borderCurve: 'continuous',
            overflow: 'hidden',
          }}
        >
          <Press
            onPress={() => router.push('/account/edit-profile')}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 14,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={{
                  fontFamily: TOKENS.ui,
                  fontSize: 15,
                  fontWeight: '600',
                  color: TOKENS.ink,
                }}
              >
                {t('profileHubEditRow')}
              </Text>
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>
                {t('profileHubEditRowHint')}
              </Text>
            </View>
            {isPublic != null ? (
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink2 }}>
                {isPublic ? t('profilePublicOn') : t('profilePublicOff')}
              </Text>
            ) : null}
            {Icon.chevR(TOKENS.ink3, 14)}
          </Press>
        </View>

        <View
          style={{
            backgroundColor: TOKENS.surface,
            borderRadius: 16,
            borderCurve: 'continuous',
            paddingHorizontal: 16,
            paddingVertical: 14,
            gap: 4,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text
              style={{
                flex: 1,
                fontFamily: TOKENS.ui,
                fontSize: 15,
                fontWeight: '600',
                color: TOKENS.ink,
              }}
            >
              {t('analyticsChoiceLabel')}
            </Text>
            <Switch
              value={analytics ?? false}
              disabled={analytics === null}
              onValueChange={onToggleAnalytics}
              trackColor={{ true: TOKENS.primary }}
              accessibilityLabel={t('analyticsChoiceLabel')}
            />
          </View>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3, lineHeight: 17 }}>
            {t('settingsAnalyticsHint')}
          </Text>
          {analyticsFailed ? <SaveFailed label={t('profileErrorSaveFailed')} /> : null}
        </View>

        <View
          style={{
            backgroundColor: TOKENS.surface,
            borderRadius: 16,
            borderCurve: 'continuous',
            paddingHorizontal: 16,
            paddingVertical: 14,
            gap: 14,
          }}
        >
          <Text
            style={{
              fontFamily: TOKENS.monoMedium,
              fontSize: 10.5,
              color: TOKENS.ink3,
              textTransform: 'uppercase',
              letterSpacing: 0.84,
            }}
          >
            {t('settingsNotifyTitle')}
          </Text>
          <NotifyRow
            label={t('settingsNotifyGames')}
            hint={t('settingsNotifyGamesHint')}
            value={notify?.games ?? true}
            disabled={notify === null}
            onChange={(v) => onToggleNotify('games', v)}
          />
          <NotifyRow
            label={t('settingsNotifyAsks')}
            hint={t('settingsNotifyAsksHint')}
            value={notify?.asks ?? true}
            disabled={notify === null}
            onChange={(v) => onToggleNotify('asks', v)}
          />
          {notifyFailed ? <SaveFailed label={t('profileErrorSaveFailed')} /> : null}
          {osGranted === false ? (
            <Press feel="control" onPress={() => Linking.openSettings().catch(() => {})} hitSlop={6}>
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.primaryDeep, lineHeight: 17 }}>
                {t('settingsNotifyOsOff')}
              </Text>
            </Press>
          ) : null}
        </View>

        <View
          style={{
            backgroundColor: TOKENS.surface,
            borderRadius: 16,
            borderCurve: 'continuous',
            paddingHorizontal: 16,
            paddingVertical: 14,
            gap: 14,
          }}
        >
          <Text
            style={{
              fontFamily: TOKENS.monoMedium,
              fontSize: 10.5,
              color: TOKENS.ink3,
              textTransform: 'uppercase',
              letterSpacing: 0.84,
            }}
          >
            {t('settingsScreensTitle')}
          </Text>
          <NotifyRow
            label={t('settingsScreensName')}
            hint={t('settingsScreensNameHint')}
            value={showName ?? true}
            disabled={showName === null}
            onChange={onToggleShowName}
          />
          {showNameFailed ? <SaveFailed label={t('profileErrorSaveFailed')} /> : null}
        </View>

        {follows !== null ? (
          <View
            style={{
              backgroundColor: TOKENS.surface,
              borderRadius: 16,
              borderCurve: 'continuous',
              paddingHorizontal: 16,
              paddingVertical: 14,
              gap: 12,
            }}
          >
            <Text
              style={{
                fontFamily: TOKENS.monoMedium,
                fontSize: 10.5,
                color: TOKENS.ink3,
                textTransform: 'uppercase',
                letterSpacing: 0.84,
              }}
            >
              {t('followedTeams')}
            </Text>
            {follows.length === 0 ? (
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.ink3, lineHeight: 18 }}>
                {t('followedTeamsNone')}
              </Text>
            ) : (
              follows.map((f) => (
                <Press
                  key={f.team_id}
                  onPress={() =>
                    router.push({
                      pathname: '/team/[id]',
                      params: { id: f.team_id, name: f.name, category: f.category ?? '', venue: f.venue_name },
                    })
                  }
                  style={{ gap: 2 }}
                >
                  <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, fontWeight: '600', color: TOKENS.ink }}>
                    {f.name}
                  </Text>
                  <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>
                    {[f.category, f.group_label, f.venue_name, f.plays ? t('cfaPlays') : null].filter(Boolean).join(' · ')}
                  </Text>
                </Press>
              ))
            )}
          </View>
        ) : null}

        <View
          style={{
            backgroundColor: TOKENS.surface,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          <Press
            onPress={() => openHelpMail(t('helpMailSubject'), userId)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 14,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={{
                  fontFamily: TOKENS.ui,
                  fontSize: 15,
                  fontWeight: '600',
                  color: TOKENS.ink,
                }}
              >
                {t('settingsHelp')}
              </Text>
              <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3 }}>
                {t('settingsHelpHint')}
              </Text>
            </View>
            {Icon.chevR(TOKENS.ink3, 14)}
          </Press>
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ gap: 12 }}>
          <Button variant="secondary" onPress={onSignOut} loading={signingOut}>
            {t('signOut')}
          </Button>
          <Button
            variant="secondary"
            color={TOKENS.terracotta}
            onPress={() => router.push('/account/delete')}
          >
            {t('deleteAccountCta')}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// A switch that could not be saved says so under it, in the error colour.
function SaveFailed({ label }: { label: string }) {
  return (
    <Reveal>
      <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.alertDeep, lineHeight: 17 }}>{label}</Text>
    </Reveal>
  );
}

// One switch with its one-line reason — the shape the analytics switch
// above already has, so the card reads as one list.
function NotifyRow({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text
          style={{
            flex: 1,
            fontFamily: TOKENS.ui,
            fontSize: 15,
            fontWeight: '600',
            color: TOKENS.ink,
          }}
        >
          {label}
        </Text>
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          trackColor={{ true: TOKENS.primary }}
          accessibilityLabel={label}
        />
      </View>
      <Text style={{ fontFamily: TOKENS.ui, fontSize: 12, color: TOKENS.ink3, lineHeight: 17 }}>{hint}</Text>
    </View>
  );
}
