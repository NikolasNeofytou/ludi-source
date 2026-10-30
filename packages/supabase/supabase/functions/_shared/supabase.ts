// _shared/supabase.ts
// Factories for the two Supabase client configurations Edge Functions use.
//
//   - Service client: uses SERVICE_ROLE_KEY, bypasses RLS. For DB writes that
//     the security model says must happen only from server code (bookings,
//     payments, idempotency_keys).
//
//   - Anon client with a user's JWT: used ONLY to verify the token by calling
//     auth.getUser(). We don't use it for DB reads because all reads in
//     create-booking need to see rows beyond what a player's RLS allows
//     (e.g. venue.stripe_account_id is not in the public-read projection).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(
      `Missing env var ${name}. Set it in .env.local (see functions/.env.example).`,
    );
  }
  return value;
}

export function createServiceClient(): SupabaseClient {
  const url = required('SUPABASE_URL');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient(): SupabaseClient {
  const url = required('SUPABASE_URL');
  const key = required('SUPABASE_ANON_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// A client that acts AS THE CALLER — their JWT, their RLS, their
// auth.uid().
//
// Needed for the `admin_*` SECURITY DEFINER lookups, and the reason is a
// trap worth stating: inside a SECURITY DEFINER function `current_user` is
// the function's OWNER, so any gate written in terms of current_user (such
// as is_privileged_writer()) evaluates as postgres and passes for
// everybody. Proven on the local stack 2026-08-29 — a plain player read as
// privileged inside a definer body. Those functions therefore gate on
// `is_admin()`, which reads auth.uid() from the JWT, and auth.uid() is
// empty when the service key is used. So: call them with this.
//
// Use the service client for writes that must bypass RLS; use this for
// anything whose authorisation is expressed as "who is asking".
export function createCallerClient(accessToken: string): SupabaseClient {
  const url = required('SUPABASE_URL');
  const key = required('SUPABASE_ANON_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
