-- Lock down internals that the public anon key could reach (launch audit
-- 2026-09-13).
--
-- 1. booking_codes_seq never had RLS enabled, and Supabase's default
--    privileges give anon + authenticated full CRUD on public tables. With
--    only the anon key, anyone could PATCH last_seq to INT_MAX (every new
--    booking then fails in generate_booking_code) or DELETE the rows (new
--    codes collide with old ones). Only the service-role Edge Functions
--    (create-booking, create-walk-in-booking) mint codes.
--
-- 2. The three pg_cron cleanup functions are SECURITY DEFINER with no
--    caller check and were executable by anon. Looping
--    cleanup_stale_pending_bookings(1) would flip every pending checkout
--    older than a minute to cancelled_no_refund while the player is still
--    on the card sheet. pg_cron runs them as postgres, which keeps EXECUTE.

ALTER TABLE public.booking_codes_seq ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_codes_seq FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.generate_booking_code(text, integer)      FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_stale_pending_bookings(integer)   FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_expired_idempotency_keys()        FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_stripe_events(integer)        FROM public, anon, authenticated;

GRANT ALL ON TABLE public.booking_codes_seq TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_booking_code(text, integer)    TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_pending_bookings(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_idempotency_keys()      TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_stripe_events(integer)      TO service_role;
