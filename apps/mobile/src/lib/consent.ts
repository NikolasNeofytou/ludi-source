// GDPR consent (M4 #22).
// Two-tier storage:
//   1. AsyncStorage (this device) is the binding record — the modal
//      checks this on launch and blocks the app until acceptance.
//   2. Supabase auth.users.raw_user_meta_data.{gdpr_consent_at,
//      gdpr_consent_version, gdpr_analytics, gdpr_analytics_at} is the
//      server-side audit copy, synced best-effort on each signin and on
//      every analytics change, so the record survives device loss /
//      reinstall.
//
// Two different things live in the record, on purpose:
//   - `accepted_at`: the privacy notice was shown and the user continued.
//     Accounts, bookings and payments run on contract, crash reports on
//     legitimate interest (ADR-0010) — none of it is consent-based.
//   - `analytics`: the one genuinely consent-based choice (PostHog,
//     ADR-0011). Off unless the user switches it on; changeable any time in
//     Settings (setAnalyticsChoice). The privacy policy promises exactly this.
//
// Versioning: when we update the privacy policy materially, bump
// CONSENT_VERSION. Old consents become stale → modal reappears → user
// re-accepts. v2 (2026-09-13): v1 bundled analytics into a single "Accept
// and continue" with no way to refuse or withdraw — not valid consent — so
// every v1 user is asked once more, this time with a real choice.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { setAnalyticsConsent } from './analytics';
import { supabase } from './supabase';

const CONSENT_KEY = 'ludi.gdpr_consent';
export const CONSENT_VERSION = 'v2';

export interface ConsentRecord {
  version: string;
  accepted_at: string;
  /** Product analytics opt-in. False unless the user turned it on. */
  analytics: boolean;
  analytics_changed_at: string;
}

export async function getConsent(): Promise<ConsentRecord | null> {
  const raw = await AsyncStorage.getItem(CONSENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ConsentRecord;
    // Treat out-of-version consents as not-given so we re-prompt on
    // policy updates. Existing audit records on the server are
    // unaffected (Supabase only stores the latest meta).
    if (parsed.version !== CONSENT_VERSION) return null;
    if (!parsed.accepted_at || typeof parsed.analytics !== 'boolean') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function recordConsent({ analytics }: { analytics: boolean }): Promise<ConsentRecord> {
  const now = new Date().toISOString();
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    accepted_at: now,
    analytics,
    analytics_changed_at: now,
  };
  await AsyncStorage.setItem(CONSENT_KEY, JSON.stringify(record));
  return record;
}

/**
 * Change the analytics choice after the fact (Settings). Applies it to
 * PostHog immediately — opting out stops all sending — and syncs the audit
 * copy. Returns null if there is no current consent record to change.
 */
export async function setAnalyticsChoice(analytics: boolean): Promise<ConsentRecord | null> {
  const current = await getConsent();
  if (!current) return null;
  const record: ConsentRecord = {
    ...current,
    analytics,
    analytics_changed_at: new Date().toISOString(),
  };
  await AsyncStorage.setItem(CONSENT_KEY, JSON.stringify(record));
  setAnalyticsConsent(analytics);
  void syncConsentToSupabase();
  return record;
}

// Best-effort sync to auth.users.raw_user_meta_data. Never throws —
// signin must not block on this. Subsequent signins re-attempt.
export async function syncConsentToSupabase(): Promise<void> {
  const record = await getConsent();
  if (!record) return;
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await supabase.auth.updateUser({
      data: {
        gdpr_consent_at: record.accepted_at,
        gdpr_consent_version: record.version,
        gdpr_analytics: record.analytics,
        gdpr_analytics_at: record.analytics_changed_at,
      },
    });
  } catch {
    // Network blip or session invalidated. Retry on next signin.
  }
}
