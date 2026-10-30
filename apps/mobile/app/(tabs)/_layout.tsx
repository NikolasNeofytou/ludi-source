// Bottom tabs — the platform's own bar (docs/plans/ios-current.md, move 7;
// ADR-0035 amended 2026-10-15). Four live tabs — Discover, Community,
// Bookings, Profile. Community is the open-matches board (ADR-0028). Map
// stays out of the bar until Mapbox lands: a native tab bar only shows the
// triggers declared here, so the route needs no `href: null`.
//
// iOS 26+ draws it in Liquid Glass, floating over the content, and moves it to
// the side on iPhone Duo's outer display; earlier iOS gets the classic bar and
// Android the Material 3 one. What the brand keeps is the label: JetBrains
// Mono, uppercase, the Aegean tint on the selected tab. Unselected labels and
// icons are left to the system so they flip light/dark with the content under
// the glass. Icons are SF Symbols on iOS and Material Symbols on Android —
// the bar tints them itself; Ludi's own icons stay in the content.
import { TOKENS } from '@ludi/ui';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslation } from 'react-i18next';

// The bar takes no textTransform, so the label arrives uppercase. Greek
// capitals drop the tonos (ΚΟΙΝΟΤΗΤΑ, not ΚΟΙΝΌΤΗΤΑ); the diaeresis stays.
function capital(label: string) {
  return label.normalize('NFD').replace(/́/g, '').normalize('NFC').toUpperCase();
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const labels = t('tabLabels', { returnObjects: true }) as string[];

  return (
    <NativeTabs
      tintColor={TOKENS.primary}
      labelStyle={{ fontFamily: TOKENS.monoMedium, fontSize: 10 }}
      // Android's Material bar hides unselected labels by default; the bar
      // has always named all four.
      labelVisibilityMode="labeled"
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
        <NativeTabs.Trigger.Label>{capital(labels[0] ?? 'Discover')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="community">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
        <NativeTabs.Trigger.Label>{capital(labels[2] ?? 'Community')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="bookings">
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
        <NativeTabs.Trigger.Label>{capital(labels[3] ?? 'Bookings')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} md="person" />
        <NativeTabs.Trigger.Label>{capital(labels[4] ?? 'Profile')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
