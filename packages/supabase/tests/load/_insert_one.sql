-- _insert_one.sql — one attempt of the double_book.sh load test.
-- Variables come from `psql -v name=value`; :'name' interpolates as a
-- safely-quoted SQL literal so we don't have to quote-juggle in bash.
INSERT INTO public.bookings (
  code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents,
  cancellation_policy
) VALUES (
  'LOAD-' || :'i',
  :'user_id'::uuid,
  :'pitch_id'::uuid,
  :'slot_start'::timestamptz,
  :'slot_end'::timestamptz,
  'pending', 4000, 0, 4000, 600, 'standard'
);
