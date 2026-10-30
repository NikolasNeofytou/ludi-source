// directions.ts — the way to the gate (plans/maps.md M1).
//
// Opens the platform's maps app on the venue's point, not on a text search
// of its address: an address search can land on the wrong side of a
// Cypriot street, a pin cannot. Apple Maps on iOS, the geo: intent on
// Android (which any installed maps app answers), Google Maps on the web
// as the fallback for both.

import { Linking, Platform } from 'react-native';

export interface DirectionsTarget {
  lat: number;
  lng: number;
  name: string;
}

export function directionsUrl(target: DirectionsTarget): string {
  const ll = `${target.lat},${target.lng}`;
  const q = encodeURIComponent(target.name);
  if (Platform.OS === 'ios') return `maps://?ll=${ll}&q=${q}`;
  if (Platform.OS === 'android') return `geo:${ll}?q=${ll}(${q})`;
  return `https://www.google.com/maps/search/?api=1&query=${ll}`;
}

export async function openDirections(target: DirectionsTarget): Promise<void> {
  const url = directionsUrl(target);
  try {
    await Linking.openURL(url);
  } catch {
    await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${target.lat},${target.lng}`).catch(
      () => {},
    );
  }
}
