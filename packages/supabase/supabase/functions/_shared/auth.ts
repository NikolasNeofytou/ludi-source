// _shared/auth.ts
// Extract and verify the caller's identity from the Authorization header.
//
// Supabase issues a JWT on sign-in; the mobile app forwards it via the SDK
// on every `functions.invoke()` call. We verify that token by asking the
// auth server who it belongs to — relying on `auth.getUser(jwt)` is safer
// than decoding locally because it checks signature + expiry + revocation.

import { createAnonClient } from './supabase.ts';

export interface AuthUser {
  id: string;
  email: string | null;
}

export async function getUserFromRequest(req: Request): Promise<AuthUser | null> {
  const header = req.headers.get('Authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const supa = createAnonClient();
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) return null;

  return { id: data.user.id, email: data.user.email ?? null };
}
