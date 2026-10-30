// i18next bootstrap. Feeds from @ludi/ui COPY and resolves the user's locale
// via expo-localization. Persists override selection in AsyncStorage.

// Hermes ships without Intl.PluralRules, so i18next falls back to a compat
// resolver and warns on every launch — a LogBox toast that sits over the tab
// bar and swallows taps for the whole dev session. Must be imported BEFORE
// i18next so the polyfill is installed by the time the resolver is built.
import 'intl-pluralrules';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { COPY } from '@ludi/ui';
import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const LOCALE_STORAGE_KEY = 'ludi.locale';

const resources = {
  en: { translation: COPY.en },
  gr: { translation: COPY.gr },
} as const;

export async function bootstrapI18n() {
  const stored = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
  const deviceLocale = Localization.getLocales()[0]?.languageCode ?? 'en';
  const fallback = deviceLocale === 'el' || deviceLocale === 'gr' ? 'gr' : 'en';
  const lng = stored ?? fallback;

  await i18n
    .use(initReactI18next)
    .init({
      resources,
      lng,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      compatibilityJSON: 'v4',
    });
}

export async function setLocale(locale: 'en' | 'gr') {
  await AsyncStorage.setItem(LOCALE_STORAGE_KEY, locale);
  await i18n.changeLanguage(locale);
}

export default i18n;
