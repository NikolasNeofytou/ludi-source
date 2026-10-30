// The sign-in this phone started, and the only one a link may finish.
//
// A sign-in link is a credential: a magic link's token_hash signs in whoever
// opens it. Without a gate, a link or QR carrying someone else's token signs
// THIS phone into THEIR account — quietly, and bookings paid for afterwards
// land in that account (security audit 2026-10-19, A4). So a link is only
// accepted while this phone is waiting for one:
//
//   - sending a magic link or opening Google writes a pending record here,
//     with a random nonce and a 15-minute expiry;
//   - the magic link's own URL carries that nonce in its path
//     (https://ludi.football/auth/callback/<nonce>), so a link minted for
//     another phone, or an older request on this one, does not match;
//   - the record is consumed by the first session to land, whatever method
//     produced it, and a link that arrives with no record is refused.
//
// SecureStore, like the session itself: the nonce is what makes a link
// this phone's own, so it does not belong in AsyncStorage.

import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY = 'ludi.pendingSignIn';
const TTL_MS = 15 * 60_000;

export type SignInMethod = 'magic_link' | 'google';

export interface PendingSignIn {
  nonce: string;
  method: SignInMethod;
  expiresAt: number;
}

/** Starts a sign-in on this phone; returns the nonce its link must carry. */
export async function beginSignIn(method: SignInMethod): Promise<string> {
  const pending: PendingSignIn = {
    nonce: randomUUID().replace(/-/g, ''),
    method,
    expiresAt: Date.now() + TTL_MS,
  };
  await SecureStore.setItemAsync(KEY, JSON.stringify(pending));
  return pending.nonce;
}

/** The live pending sign-in, or null when there is none or it has expired. */
export async function pendingSignIn(): Promise<PendingSignIn | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as Partial<PendingSignIn>;
    if (
      typeof pending.nonce !== 'string' ||
      (pending.method !== 'magic_link' && pending.method !== 'google') ||
      typeof pending.expiresAt !== 'number' ||
      pending.expiresAt < Date.now()
    ) {
      return null;
    }
    return pending as PendingSignIn;
  } catch {
    return null;
  }
}

/** Ends whatever sign-in was pending. Called once a session lands. */
export async function endSignIn(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
}
