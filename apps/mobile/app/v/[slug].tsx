// The venue's link (plans/reach.md R1, plans/release-1-0.md E1):
// `ludi.football/v/<slug>` opens here once the AASA file claims /v/*, and
// `ludi://v/<slug>` already does. It resolves the slug to the venue and
// replaces itself with the venue screen, so Back goes wherever the user
// came from. Signed out, the auth gate keeps this route across sign-in and
// brings the user back here.

import { Button, NestWait, TOKENS } from '@ludi/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function VenueLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { isAuthed } = useSession();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    // Signed out, the auth gate is about to send the user to sign in and
    // bring them back here; nothing to resolve yet.
    if (!slug || !isAuthed) return;
    let cancelled = false;
    supabase
      .rpc('venue_page', { p_slug: slug })
      .then(({ data, error }) => {
        if (cancelled) return;
        const rows = (Array.isArray(data) ? data : data ? [data] : []) as { venue_id?: string }[];
        const id = rows[0]?.venue_id;
        if (error || !id) setMissing(true);
        else router.replace({ pathname: '/venue/[id]', params: { id } });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, isAuthed, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKENS.bg }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
        {missing ? (
          <>
            <Text style={{ fontFamily: TOKENS.ui, fontSize: 15, color: TOKENS.ink2, textAlign: 'center' }}>
              {t('discoverError')}
            </Text>
            <Button variant="secondary" size="sm" onPress={() => router.replace('/(tabs)')}>
              {t('bookingsFindPitch')}
            </Button>
          </>
        ) : (
          // Resolving a slug is usually instant: nothing shows unless it is
          // slow, and then the Nest (motion-v3 slice 6).
          <NestWait />
        )}
      </View>
    </SafeAreaView>
  );
}
