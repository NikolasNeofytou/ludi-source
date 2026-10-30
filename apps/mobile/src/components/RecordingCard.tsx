// RecordingCard — court cameras on the fixture screen (ADR-0042).
//
// Before kickoff: the organiser's switch, or, for everyone else, the notice
// that the game is recorded. After the game: the match itself, for the
// players who were in on it, until it expires. Renders nothing at a court
// without a camera. Every rule is the database's (recording_state); the
// card only shows what it says.

import { Button, Card, Press, Reveal, TOKENS } from '@ludi/ui';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Switch, Text, View } from 'react-native';

import { capture } from '@/lib/analytics';
import { formatFixtureDate } from '@/lib/fixture';
import { fixtureType as type } from '@/lib/fixture-type';
import {
  deleteRecording,
  fetchRecordingState,
  recordingUrl,
  setRecording,
  type RecordingState,
} from '@/lib/recording';

export function RecordingCard({
  bookingId,
  startsAt,
  played,
  isOrganiser,
  locale,
}: {
  bookingId: string;
  startsAt: string;
  played: boolean;
  isOrganiser: boolean;
  locale: 'en' | 'gr';
}) {
  const { t } = useTranslation();
  const [rec, setRec] = useState<RecordingState | null>(null);
  const [busy, setBusy] = useState(false);
  // The switch flips the moment it's touched and reverts only if the save
  // fails (it used to snap back while saving, then flip again).
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchRecordingState(bookingId).then(setRec).catch(() => {});
  }, [bookingId]);
  useEffect(refresh, [refresh, played]);

  if (!rec || (!rec.has_camera && !rec.consented && !rec.recording_id)) return null;

  const muted = [type.body, { fontSize: 13, color: TOKENS.ink3 }];
  const title = [type.body, { color: TOKENS.ink, fontWeight: '600' as const }];

  // ── Before and during the game ──────────────────────────────────────
  if (!played) {
    if (rec.can_toggle && rec.has_camera) {
      const minor = rec.blocked_reason === 'REC_MINOR';
      const onToggle = async (on: boolean) => {
        setBusy(true);
        setError(null);
        setOptimistic(on);
        try {
          await setRecording(bookingId, on);
          capture('recording_toggled', { on });
          refresh();
        } catch {
          setOptimistic(null);
          setError(t('recordError'));
        } finally {
          setBusy(false);
        }
      };
      const shown = optimistic ?? rec.consented;
      return (
        <Card padded={16} elevation="e0" style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[title, { flex: 1 }]}>{t('recordToggle')}</Text>
            <Switch
              value={shown}
              disabled={busy || (minor && !rec.consented)}
              onValueChange={onToggle}
              trackColor={{ true: TOKENS.primary }}
            />
          </View>
          <Text style={muted}>
            {minor ? t('recordMinor') : shown ? t('recordHintOn') : t('recordHintOff')}
          </Text>
          {error ? (
            <Reveal>
              <Text style={[type.body, { color: TOKENS.alertDeep, fontSize: 13 }]}>{error}</Text>
            </Reveal>
          ) : null}
        </Card>
      );
    }
    if (!rec.consented) return null;
    const beforeKickoff = new Date(startsAt).getTime() > Date.now();
    return (
      <Card color={TOKENS.primarySoft} padded={16} elevation="e0" style={{ borderColor: 'transparent', gap: 4 }}>
        <Text style={title}>{rec.state === 'recording' ? t('matchRecording') : t('recordNotice')}</Text>
        {beforeKickoff && !isOrganiser ? <Text style={muted}>{t('recordNoticeAsk')}</Text> : null}
      </Card>
    );
  }

  // ── After the game: the match ───────────────────────────────────────
  if (!rec.consented && !rec.recording_id) return null;
  const state = rec.state;

  const onWatch = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await recordingUrl(bookingId);
      capture('recording_watched', { booking_id: bookingId });
      await WebBrowser.openBrowserAsync(url);
    } catch {
      setError(t('matchError'));
    } finally {
      setBusy(false);
    }
  };
  const onDelete = () => {
    if (!rec.recording_id) return;
    const id = rec.recording_id;
    Alert.alert(t('matchDeleteTitle'), t('matchDeleteBody'), [
      { text: t('matchCancel'), style: 'cancel' },
      {
        text: t('matchDeleteConfirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteRecording(id);
            capture('recording_deleted', { booking_id: bookingId });
            refresh();
          } catch {
            setError(t('matchError'));
          }
        },
      },
    ]);
  };

  return (
    <Card padded={16} elevation="e0" style={{ gap: 10 }}>
      <Text style={[type.label, { color: TOKENS.ink3 }]}>{t('matchTitle').toUpperCase()}</Text>
      {state === 'ready' ? (
        <>
          <Button size="lg" full onPress={onWatch} disabled={busy}>
            {t('matchWatch')}
          </Button>
          {rec.expires_at ? (
            <Text style={muted}>{t('matchExpires', { date: formatFixtureDate(rec.expires_at, locale) })}</Text>
          ) : null}
          {isOrganiser ? (
            <Press feel="control" onPress={onDelete} style={{ alignSelf: 'flex-start' }}>
              <Text style={[type.body, { fontSize: 13, color: TOKENS.alertDeep, fontWeight: '600' }]}>
                {t('matchDelete')}
              </Text>
            </Press>
          ) : null}
        </>
      ) : state === 'deleted' ? (
        <Text style={muted}>{t('matchDeleted')}</Text>
      ) : state === 'failed' || !state ? (
        <Text style={muted}>{t('matchFailed')}</Text>
      ) : (
        <Text style={muted}>{t('matchUploading')}</Text>
      )}
      {error ? <Text style={[type.body, { color: TOKENS.alertDeep, fontSize: 13 }]}>{error}</Text> : null}
    </Card>
  );
}
