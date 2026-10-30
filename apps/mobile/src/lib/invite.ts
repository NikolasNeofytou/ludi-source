// Pending-invite storage (W5, docs/plans/shared-fixture.md ARCHITECTURE
// §"The invite has to survive sign-in").
//
// The link lands in a group chat. Roughly none of the people who tap it have
// Ludi installed, and the ones who do may be signed out — so the sequence is
// cold app → deep link → sign-in → back to the fixture, and the token has to
// survive a round trip through OTP or Apple Sign-In, including the OS
// killing the app behind the SMS app mid-flow.
//
// AsyncStorage, not SecureStore: the token grants a slot in one five-a-side
// match, it is revocable by rotation (ADR-0021), and it is already sitting
// in the plaintext of a WhatsApp thread on the same device. It does not
// warrant Keychain-backed storage the way the Supabase session does.

import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_INVITE_KEY = 'ludi.pendingInviteToken';

export async function setPendingInvite(token: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_INVITE_KEY, token);
}

export async function takePendingInvite(): Promise<string | null> {
  const token = await AsyncStorage.getItem(PENDING_INVITE_KEY);
  if (token) await AsyncStorage.removeItem(PENDING_INVITE_KEY);
  return token;
}
