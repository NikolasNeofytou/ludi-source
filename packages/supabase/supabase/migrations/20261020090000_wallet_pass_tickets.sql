-- 20261020090000_wallet_pass_tickets.sql
-- Add to Apple Wallet used to open
--   …/functions/v1/wallet-pass?token=<the player's Supabase access token>
-- in Safari, because the OS fetch that hands a .pkpass to Wallet cannot
-- carry an Authorization header. That put a live JWT — good for an hour, for
-- everything the player can do — into Safari's history and every log the URL
-- passed through (security audit 2026-10-19).
--
-- Now the app first asks the function for a ticket (a POST carrying the
-- player's JWT the normal way) and opens …/wallet-pass?ticket=<id>. A ticket
-- works once, for sixty seconds, and only ever returns the card of the
-- player who asked for it: the GET deletes the row it redeems.
--
-- The id is gen_random_uuid() (122 random bits), not uuid7(): it is the
-- bearer secret, and uuid7 spends 48 of its bits on the time.
--
-- Only the function, as service_role, touches this table: RLS on with no
-- policies, and nothing granted to anon or authenticated — PUBLIC included
-- (audit A1: a REVOKE that skips PUBLIC leaves the default grant in place).

CREATE TABLE public.wallet_pass_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '60 seconds',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wallet_pass_tickets_user_idx ON public.wallet_pass_tickets (user_id);

COMMENT ON TABLE public.wallet_pass_tickets IS
'Single-use, 60-second tickets for the wallet-pass GET, minted by its POST. '
'Service role only (security audit 2026-10-19).';

ALTER TABLE public.wallet_pass_tickets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wallet_pass_tickets FROM public, anon, authenticated;
