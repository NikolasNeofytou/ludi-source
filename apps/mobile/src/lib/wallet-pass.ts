// Add to Apple Wallet (plans/wallet-passes.md), with no JWT in a URL.
//
// iOS fetches the .pkpass itself when Safari opens it, and that fetch cannot
// carry an Authorization header, so the URL Safari opens has to authorise
// itself. It used to carry the player's access token — an hour of everything
// the player can do, sitting in Safari's history and every log on the way
// (security audit 2026-10-19). Now it carries a ticket from wallet-pass's
// POST: one use, sixty seconds, and only ever the caller's own card.

import { supabase } from './supabase';

const FUNCTION_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/wallet-pass`;

/** The URL that adds the signed-in player's card to Wallet, or null. */
export async function walletPassUrl(): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke<{ ticket?: string }>('wallet-pass', {
    method: 'POST',
  });
  const ticket = data?.ticket;
  if (error || typeof ticket !== 'string') return null;
  return `${FUNCTION_URL}?ticket=${encodeURIComponent(ticket)}`;
}
