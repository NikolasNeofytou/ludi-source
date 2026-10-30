// Home mini-map — a picture that answers "where?", under the filter pills
// (ADR-0029) and on the Record (plans/maps.md). Pins are venues, open games
// and keeper requests; gestures stay off so the ScrollView owns the
// scroll, and the only interaction is tapping a pin.
//
// iOS renders Apple Maps (mutedStandard keeps it close to the Chalk & Aegean
// palette, no API key needed). Android renders Google Maps via the restricted
// key that app.config.js injects from GOOGLE_MAPS_ANDROID_API_KEY (EAS env /
// local .env; Cloud project ludi-507117). Tiles also need billing linked on
// that project; builds cut before the key landed show a blank card.

import { RADII, ELEV, TOKENS } from '@ludi/ui';
import { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

export const MAP_AVAILABLE = true;

export type MapPinKind = 'venue' | 'game' | 'keeper';

export interface MapPin {
  /** Unique within the card; the marker's identifier. */
  id: string;
  kind: MapPinKind;
  lat: number;
  lng: number;
  /** The callout's title: the venue's name. */
  title: string;
  /** A short label drawn on the pin: a kickoff and the spots, a game count. */
  label?: string;
}

const MAP_HEIGHT = 180;
// Never zoom in past neighbourhood level — a lone venue should still show
// enough streets to orient by.
const MIN_DELTA = 0.02;
const PADDING = 1.5;

export function HomeMapCard({
  pins,
  a11yLabel,
  onPinPress,
}: {
  pins: MapPin[];
  a11yLabel: string;
  onPinPress: (pin: MapPin) => void;
}) {
  const region = useMemo(() => {
    if (pins.length === 0) return null;
    const lats = pins.map((p) => p.lat);
    const lngs = pins.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * PADDING, MIN_DELTA),
      longitudeDelta: Math.max((maxLng - minLng) * PADDING, MIN_DELTA),
    };
  }, [pins]);

  if (!MAP_AVAILABLE || !region) return null;

  const press = (id: string | undefined) => {
    const pin = id ? pins.find((p) => p.id === id) : undefined;
    if (pin) onPinPress(pin);
  };

  return (
    <View
      accessibilityLabel={a11yLabel}
      style={[
        {
          borderRadius: RADII.lg,
          borderCurve: 'continuous',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: TOKENS.line,
          backgroundColor: TOKENS.surface,
          overflow: 'hidden',
        },
        ELEV.e2,
      ]}
    >
      <MapView
        style={{ height: MAP_HEIGHT }}
        region={region}
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsPointsOfInterests={false}
        showsCompass={false}
        // Marker-level onPress doesn't fire on iOS under Fabric — the
        // map-level event with the marker's identifier is the path that does.
        onMarkerPress={(e) => press(e.nativeEvent.id)}
        // A near-miss tap makes MapKit select the nearest pin and show its
        // callout without a marker press — let tapping that callout navigate.
        onCalloutPress={(e) => press(e.nativeEvent.id)}
      >
        {pins.map((p) => (
          <Marker
            // Keyed by the label too: a changed label remounts the marker,
            // which closes a callout that would otherwise keep the old text.
            key={`${p.id}:${p.label ?? ''}`}
            identifier={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            title={p.title}
            description={p.label}
            tracksViewChanges={false}
          >
            {p.kind === 'venue' ? <VenuePin label={p.label} /> : <ActivityPin kind={p.kind} label={p.label ?? ''} />}
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

// Brand pin: terracotta dot on a white ring — matches the EmptyState pin icon
// colour and stays legible on the muted tiles at any density. On the Record
// the label is the number of games played there.
function VenuePin({ label }: { label?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <View
        style={[
          {
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: TOKENS.surface,
            alignItems: 'center',
            justifyContent: 'center',
          },
          ELEV.e1,
        ]}
      >
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: TOKENS.terracotta }} />
      </View>
      {label ? <PinLabel text={label} color={TOKENS.ink} /> : null}
    </View>
  );
}

// A game or a keeper request: a pill with the kickoff and what is open.
// Aegean for a game, sun for a keeper wanted — the board's own colours.
function ActivityPin({ kind, label }: { kind: MapPinKind; label: string }) {
  const fill = kind === 'keeper' ? TOKENS.sun : TOKENS.primary;
  const ink = kind === 'keeper' ? TOKENS.ink : TOKENS.surface;
  return (
    <View
      style={[
        {
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 11,
          backgroundColor: fill,
        },
        ELEV.e1,
      ]}
    >
      <Text style={{ fontFamily: TOKENS.monoMedium, fontSize: 10.5, color: ink, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

function PinLabel({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7, backgroundColor: TOKENS.surface }}>
      <Text style={{ fontFamily: TOKENS.monoMedium, fontSize: 10, color }}>{text}</Text>
    </View>
  );
}
