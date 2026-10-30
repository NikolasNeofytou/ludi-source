-- 20260831000002_venue_payouts.sql
-- 41l (venue-owner-admin.md, audit 2026-08-31): the substrate for payout
-- visibility. Maria's question 3 is "how much did I make, AND WHEN DO I
-- GET IT?" — 41h answered the first half; this table lets the dashboard
-- answer the second.
--
-- Rows are written exclusively by the stripe-webhook (payout.paid /
-- payout.failed on the venue's CONNECTED account — event.account resolves
-- to venues.stripe_account_id). One row per Stripe payout, upserted, so a
-- payout that fails after paying (bank bounce) overwrites to failed
-- rather than duplicating. This is deliberately a mirror, not a ledger:
-- Stripe stays the source of truth; the Express login link (see
-- venue-express-login) is where an owner disputes a number.
CREATE TABLE public.venue_payouts (
  stripe_payout_id  text PRIMARY KEY,
  venue_id          uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  amount_cents      int NOT NULL CHECK (amount_cents > 0),
  currency          text NOT NULL DEFAULT 'eur',
  status            text NOT NULL CHECK (status IN ('paid', 'failed')),
  arrival_date      date,
  failure_code      text,
  failure_message   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.venue_payouts IS
  'Mirror of Stripe payouts on venue connected accounts (41l). Written '
  'only by the stripe-webhook payout.paid/payout.failed handlers; Stripe '
  'is the source of truth. Read by the owner dashboard Earnings page.';

CREATE INDEX venue_payouts_venue_idx
  ON public.venue_payouts (venue_id, arrival_date DESC);

CREATE TRIGGER tg_venue_payouts_updated_at
  BEFORE UPDATE ON public.venue_payouts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- RLS: owners and admins read; nobody but the service role writes (no
-- INSERT/UPDATE/DELETE policies for authenticated — the webhook's service
-- client bypasses RLS, exactly like payments).
ALTER TABLE public.venue_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_payouts_select_owner_or_admin
  ON public.venue_payouts FOR SELECT
  USING (public.is_venue_owner_of_venue(venue_id) OR public.is_admin());
