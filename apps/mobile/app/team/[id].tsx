// Follow a CFA team, as a native `formSheet` route (plans/cfa-in-the-app.md
// K3, ADR-0051). Opened from a team on the venue's Saturday or from the
// teams list in settings. A follow is the parent's alone: the sheet says so
// in one line, because a parent deciding whether to follow their child's
// team is exactly the person who should hear it.
//
// Following asks for push at that moment (the fifth moment, never at
// launch); "I play too" opts the parent into the parents' game ask at the
// venue the team plays at (K6), and can change without unfollowing.

import { Button, TOKENS } from '@ludi/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { capture } from '@/lib/analytics';
import { fetchMyFollows, followTeam, unfollowTeam } from '@/lib/cfa';
import { fixtureType as type } from '@/lib/fixture-type';
import { askForPush } from '@/lib/push';

export default function TeamSheet() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id, name, category, venue } = useLocalSearchParams<{
    id: string;
    name?: string;
    category?: string;
    venue?: string;
  }>();

  const [ready, setReady] = useState(false);
  const [following, setFollowing] = useState(false);
  const [plays, setPlays] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchMyFollows()
      .then((rows) => {
        if (cancelled) return;
        const mine = rows.find((r) => r.team_id === id);
        setFollowing(Boolean(mine));
        setPlays(mine?.plays ?? false);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const onFollow = async () => {
    if (!id) return;
    setBusy(true);
    setFailed(false);
    try {
      await followTeam(id, plays);
      capture('team_followed', { plays });
      await askForPush('team_followed');
      router.back();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const onPlays = async (next: boolean) => {
    setPlays(next);
    if (!following || !id) return;
    try {
      await followTeam(id, next);
    } catch {
      setPlays(!next);
      setFailed(true);
    }
  };

  const onUnfollow = async () => {
    if (!id) return;
    setBusy(true);
    setFailed(false);
    try {
      await unfollowTeam(id);
      capture('team_unfollowed', {});
      router.back();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const eyebrow = [category, venue].filter(Boolean).join(' · ');

  return (
    <View style={{ padding: 22, paddingBottom: Math.max(insets.bottom, 16) + 8, gap: 14 }}>
      {eyebrow ? <Text style={type.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
      <Text style={[type.h1, { fontSize: 24, lineHeight: 29 }]}>{name}</Text>
      <Text style={[type.body, { fontSize: 15, lineHeight: 21 }]}>{t('cfaFollowWhy')}</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flexShrink: 1, gap: 2 }}>
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, fontWeight: '600', color: TOKENS.ink }}>
            {t('cfaPlays')}
          </Text>
          <Text style={[type.body, { fontSize: 13 }]}>{t('cfaPlaysHint')}</Text>
        </View>
        <Switch
          value={plays}
          onValueChange={onPlays}
          disabled={!ready || busy}
          trackColor={{ true: TOKENS.primary, false: TOKENS.line }}
          accessibilityLabel={t('cfaPlays')}
        />
      </View>

      <Text style={[type.body, { fontSize: 12.5, color: TOKENS.ink3 }]}>{t('cfaFollowPrivate')}</Text>

      {following ? (
        <Pressable
          onPress={onUnfollow}
          disabled={busy}
          style={({ pressed }) => ({ alignSelf: 'center', padding: 10, opacity: pressed || busy ? 0.5 : 1 })}
        >
          <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, fontWeight: '600', color: TOKENS.alertDeep }}>
            {t('cfaUnfollow')}
          </Text>
        </Pressable>
      ) : (
        <Button full onPress={onFollow} disabled={!ready || busy}>
          {t('cfaFollow')}
        </Button>
      )}
      {failed ? (
        <Text style={{ fontFamily: TOKENS.ui, fontSize: 13, color: TOKENS.alertDeep, textAlign: 'center' }}>
          {t('cfaFollowError')}
        </Text>
      ) : null}
    </View>
  );
}
