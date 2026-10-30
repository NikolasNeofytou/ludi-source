-- 44_whatsapp_desk.sql — the booking desk (20261013000004, ADR-0046)
-- Under test:
--   desk_add: the owner or a manager pastes a message; a stranger cannot; an
--     empty one is refused
--   venue_inbox RLS: the venue's staff read it, a stranger reads nothing
--   desk_free_courts: a booked court and a closed court are not free
--   desk_set_status: booked against a code of this venue only
--   desk_receive_whatsapp: service only; an unconnected number is ignored; a
--     connected one lands in the inbox once, however often Meta redelivers
--   desk_connect_number: admin only
--   desk_purge: thirty days
--
-- Fixtures: a2 owns venue_a (b1: c1, c2), a3 is its manager, a1 admin,
-- a5 stranger.
BEGIN;
SELECT plan(18);

CREATE TEMP TABLE t_ctx AS
SELECT
  ((current_date + 5) + time '20:00') AT TIME ZONE 'Europe/Nicosia' AS s,
  ((current_date + 5) + time '21:00') AT TIME ZONE 'Europe/Nicosia' AS e,
  (current_date + 5) AS d;
GRANT SELECT ON t_ctx TO anon, authenticated;

RESET ROLE;
INSERT INTO public.bookings (
  code, user_id, pitch_id, starts_at, ends_at, state, origin, walk_in_name, walk_in_phone,
  base_price_cents, total_cents, platform_fee_cents, cancellation_policy
)
SELECT 'RLS-2033-D001', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c1',
  s, e, 'confirmed', 'walk_in', 'Andreas', '99 111111', 6000, 6000, 0, 'standard'
FROM t_ctx;

-- 1. a stranger cannot paste into a venue's desk
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT throws_ok(
  $$SELECT public.desk_add('00000000-0000-4000-8000-0000000000b1', 'X', '99 000000', 'αύριο 8')$$,
  '42501', NULL,
  'desk_add: not a stranger'
);

-- 2. a manager can: the desk is the day
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
CREATE TEMP TABLE t_m AS
SELECT public.desk_add('00000000-0000-4000-8000-0000000000b1', 'Marios', '99 222222', 'Γεια, αύριο στις 8 για 5άρι;') AS id;
GRANT SELECT ON t_m TO anon, authenticated;
SELECT isnt((SELECT id FROM t_m), NULL, 'desk_add: a manager pastes a message');

-- 3. an empty message is refused
SELECT throws_ok(
  $$SELECT public.desk_add('00000000-0000-4000-8000-0000000000b1', 'X', NULL, '   ')$$,
  'P0001', 'DESK_EMPTY',
  'desk_add: nothing to read'
);

-- 4–6. the venue's staff read it; the phone is normalised; a stranger reads nothing
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is((SELECT count(*) FROM public.venue_inbox), 1::bigint, 'RLS: the owner reads the desk');
SELECT is((SELECT sender_phone_e164 FROM public.venue_inbox), '+35799222222', 'desk: the number is normalised');
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is((SELECT count(*) FROM public.venue_inbox), 0::bigint, 'RLS: a stranger reads nothing');

-- 7–8. free courts: c1 is booked; then c2 closes for the day
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT array_agg(pitch_id ORDER BY pitch_id) FROM public.desk_free_courts('00000000-0000-4000-8000-0000000000b1', (SELECT s FROM t_ctx), (SELECT e FROM t_ctx))),
  ARRAY['00000000-0000-4000-8000-0000000000c2'::uuid],
  'desk_free_courts: a booked court is not free'
);
RESET ROLE;
INSERT INTO public.pitch_schedule_overrides (pitch_id, override_date, is_closed, reason)
SELECT '00000000-0000-4000-8000-0000000000c2', d, TRUE, 'test' FROM t_ctx;
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT count(*) FROM public.desk_free_courts('00000000-0000-4000-8000-0000000000b1', (SELECT s FROM t_ctx), (SELECT e FROM t_ctx))),
  0::bigint,
  'desk_free_courts: a court closed that day is not free'
);

-- 9–10. booked against this venue's code; an unknown code is refused
SELECT throws_ok(
  $$SELECT public.desk_set_status((SELECT id FROM t_m), 'booked', 'NOPE-0000')$$,
  'P0001', 'DESK_BOOKING_NOT_FOUND',
  'desk_set_status: a code that is not this venue''s'
);
SELECT public.desk_set_status((SELECT id FROM t_m), 'booked', 'RLS-2033-D001');
SELECT is(
  (SELECT status || '/' || (booking_id IS NOT NULL)::text || '/' || (handled_at IS NOT NULL)::text FROM public.venue_inbox WHERE id = (SELECT id FROM t_m)),
  'booked/true/true',
  'desk_set_status: booked, linked, handled'
);

-- 11. only Ludi connects a number
SELECT throws_ok(
  $$SELECT public.desk_connect_number('00000000-0000-4000-8000-0000000000b1', '1234567890', '+357 99 000000')$$,
  '42501', NULL,
  'desk_connect_number: admin only'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT public.desk_connect_number('00000000-0000-4000-8000-0000000000b1', '1234567890', '+357 99 000000');

-- 12–15. the webhook's door
RESET ROLE;
SELECT throws_ok(
  $$SELECT public.desk_receive_whatsapp('1234567890', 'wamid.A', '35799333333', 'Kostas', 'αύριο 9', now())$$,
  'P0001', 'SERVICE_ROLE_ONLY',
  'desk_receive_whatsapp: service only'
);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SELECT is(
  public.desk_receive_whatsapp('999999999', 'wamid.X', '35799333333', 'Kostas', 'αύριο 9', now()),
  NULL,
  'desk_receive_whatsapp: a number nobody connected is ignored'
);
SELECT isnt(
  public.desk_receive_whatsapp('1234567890', 'wamid.A', '35799333333', 'Kostas', 'αύριο 9', now()),
  NULL,
  'desk_receive_whatsapp: a connected number lands in the desk'
);
SELECT is(
  public.desk_receive_whatsapp('1234567890', 'wamid.A', '35799333333', 'Kostas', 'αύριο 9', now()),
  NULL,
  'desk_receive_whatsapp: a redelivery does nothing'
);
SELECT is(
  (SELECT sender_phone_e164 || '/' || source FROM public.venue_inbox WHERE wa_message_id = 'wamid.A'),
  '+35799333333/whatsapp',
  'desk_receive_whatsapp: the sender is stored the way a person types it'
);

-- 16–17. thirty days
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', TRUE);
INSERT INTO public.venue_inbox (venue_id, source, body, received_at)
VALUES ('00000000-0000-4000-8000-0000000000b1', 'paste', 'old', now() - interval '31 days');
SELECT is(public.desk_purge(), 1, 'desk_purge: a message older than thirty days goes');
SELECT is((SELECT count(*) FROM public.venue_inbox), 2::bigint, 'desk_purge: the recent ones stay');

SELECT * FROM finish();
ROLLBACK;
