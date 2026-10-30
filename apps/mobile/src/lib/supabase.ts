// Supabase client. Tokens live in expo-secure-store so they survive app restarts
// but aren't exposed to JS-accessible storage.

// Before the client: PKCE needs WebCrypto, which Hermes lacks (web-crypto.ts).
import './web-crypto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// SecureStore is iOS/Android-only; fall back to AsyncStorage on web.
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: Platform.OS === 'web' ? AsyncStorage : (ExpoSecureStoreAdapter as unknown as typeof AsyncStorage),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE: what comes back from Google (and from any {{ .ConfirmationURL }}
    // email) is a one-time code that only the verifier stored on this phone
    // can redeem, so a code caught on the `ludi` scheme by another app is
    // worthless. The implicit default put the session's tokens themselves in
    // the redirect (audit 2026-10-19, A4). Magic links are unaffected: their
    // token_hash verifies the same under either flow (checked against GoTrue
    // 2.195 locally; prod runs 2.197).
    flowType: 'pkce',
  },
});
