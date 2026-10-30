-- 43_fill_the_hour.sql — an empty hour offered to the regulars (20261013000003, ADR-0045)
-- Under test:
--   the gate: owner only (not a manager), and only once Ludi switched it on
--     (set_fill_offers_enabled is admin only)
--   fill_hour_open: one offer per slot, re-opening updates the price; a taken
--     slot is refused
--   fill_hour_candidates: who played this weekday at this hour first, then who
--     plays most; never opted out, never without a number, never booked across
--     the hour
--   fill_hour_mark_sent / fill_hour_state: asked, then filled by someone asked
--   RLS: offers readable by the owner only
--
-- Fixtures: a2 owns venue_a (b1) with c1 and c2; a3 is its manager; a1 admin;
-- a5 a stranger. The offer is c1, seven days out at 20:00 Nicosia, so every
-- past booking below on today's weekday is "the same evening".
BEGIN;
SELECT plan(18);

CREATE TEMP TABLE t_ctx AS
SELECT
  ((current_date + 7) + time '20:00') AT TIME ZONE 'Europe/Nicosia' AS s,
  ((current_date + 7) + time '21:00') AT TIME ZONE 'Europe/Nicosia' AS e;
GRANT SELECT ON t_ctx TO anon, authenticated;

-- Past walk-ins make the contacts (the trigger finds or creates by phone).
RESET ROLE;
INSERT INTO public.bookings (
  code, user_id, pitch_id, starts_at, ends_at, state, origin, walk_in_name, walk_in_phone,
  base_price_cents, total_cents, platform_fee_cents, cancellation_policy
)
SELECT v.code, '00000000-0000-4000-8000-0000000000a2', v.pitch::uuid,
  ((current_date + v.days) + v.at) AT TIME ZONE 'Europe/Nicosia',
  ((current_date + v.days) + v.at) AT TIME ZONE 'Europe/Nicosia' + interval '1 hour',
  'confirmed', 'walk_in', v.who, v.phone, 6000, 6000, 0, 'standard'
FROM (VALUES
  -- Andreas: three of the same evening
  ('RLS-2032-F001', '00000000-0000-4000-8000-0000000000c1', -7, time '20:00', 'Andreas', '99 111111'),
  ('RLS-2032-F002', '00000000-0000-4000-8000-0000000000c1', -14, time '20:00', 'Andreas', '99 111111'),
  ('RLS-2032-F003', '00000000-0000-4000-8000-0000000000c2', -21, time '19:30', 'Andreas', '99 111111'),
  -- Marios: one of the same evening, three other mornings
  ('RLS-2032-F004', '00000000-0000-4000-8000-0000000000c2', -7, time '21:00', 'Marios', '99 222222'),
  ('RLS-2032-F005', '00000000-0000-4000-8000-0000000000c2', -3, time '10:00', 'Marios', '99 222222'),
  ('RLS-2032-F006', '00000000-0000-4000-8000-0000000000c2', -4, time '10:00', 'Marios', '99 222222'),
  ('RLS-2032-F007', '00000000-0000-4000-8000-0000000000c2', -5, time '10:00', 'Marios', '99 222222'),
  -- Opted: plays the same evening but said no to offers
  ('RLS-2032-F008', '00000000-0000-4000-8000-0000000000c1', -28, time '20:00', 'Opted', '99 333333'),
  -- Busy: already booked across the offered hour, on the other court
  ('RLS-2032-F009', '00000000-0000-4000-8000-0000000000c1', -35, time '20:00', 'Busy', '99 444444'),
  ('RLS-2032-F010', '00000000-0000-4000-8000-0000000000c2', 7, time '20:00', 'Busy', '99 444444'),
  -- NoPhone: a name and nothing to message
  ('RLS-2032-F011', '00000000-0000-4000-8000-0000000000c1', -42, time '20:00', 'NoPhone', NULL)
) AS v (code, pitch, days, at, who, phone);

CREATE TEMP TABLE t_c AS
SELECT display_name AS who, id FROM public.venue_contacts
WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'
  AND display_name IN ('Andreas', 'Marios', 'Opted', 'Busy', 'NoPhone');
GRANT SELECT ON t_c TO anon, authenticated;

UPDATE public.venue_contacts SET offers_opt_out_at = now() WHERE id = (SELECT id FROM t_c WHERE who = 'Opted');

-- 1. not switched on yet
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$SELECT public.fill_hour_open('00000000-0000-4000-8000-0000000000c1', (SELECT s FROM t_ctx), (SELECT e FROM t_ctx))$$,
  'P0001', 'FILL_NOT_ENABLED',
  'fill_hour_open: off until Ludi switches it on'
);
-- 2. the owner cannot switch it on himself
SELECT throws_ok(
  $$SELECT public.set_fill_offers_enabled('00000000-0000-4000-8000-0000000000b1', TRUE)$$,
  '42501', NULL,
  'set_fill_offers_enabled: admin only'
);
-- 3. the admin can
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT lives_ok(
  $$SELECT public.set_fill_offers_enabled('00000000-0000-4000-8000-0000000000b1', TRUE)$$,
  'set_fill_offers_enabled: the admin switches it on'
);
-- 4. a manager runs the day but does not see the list
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT throws_ok(
  $$SELECT public.fill_hour_open('00000000-0000-4000-8000-0000000000c1', (SELECT s FROM t_ctx), (SELECT e FROM t_ctx))$$,
  '42501', NULL,
  'fill_hour_open: owner only, not a manager'
);

-- 5–6. the owner opens the offer; re-opening the slot keeps the offer, takes the price
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
CREATE TEMP TABLE t_o AS
SELECT public.fill_hour_open('00000000-0000-4000-8000-0000000000c1', (SELECT s FROM t_ctx), (SELECT e FROM t_ctx)) AS id;
GRANT SELECT ON t_o TO anon, authenticated;
SELECT isnt((SELECT id FROM t_o), NULL, 'fill_hour_open: an offer for the empty hour');
SELECT is(
  public.fill_hour_open('00000000-0000-4000-8000-0000000000c1', (SELECT s FROM t_ctx), (SELECT e FROM t_ctx), 5000),
  (SELECT id FROM t_o),
  'fill_hour_open: the same slot is the same offer'
);

-- 7. a slot already taken is not offered
SELECT throws_ok(
  $$SELECT public.fill_hour_open('00000000-0000-4000-8000-0000000000c2', (SELECT s FROM t_ctx), (SELECT e FROM t_ctx))$$,
  'P0001', 'FILL_SLOT_TAKEN',
  'fill_hour_open: a booked hour is refused'
);

CREATE TEMP TABLE t_cand AS
SELECT row_number() OVER () AS n, * FROM public.fill_hour_candidates((SELECT id FROM t_o));
GRANT SELECT ON t_cand TO anon, authenticated;

-- 8–9. same evening first, then the most regular
SELECT is((SELECT display_name FROM t_cand WHERE n = 1), 'Andreas', 'candidates: three of the same evening comes first');
SELECT is((SELECT at_this_hour FROM t_cand WHERE n = 1), 3, 'candidates: counted across courts, within the hour');
SELECT is((SELECT display_name FROM t_cand WHERE n = 2), 'Marios', 'candidates: then one of the same evening');
-- 11–13. never the ones who said no, are busy, or cannot be messaged
SELECT is((SELECT count(*) FROM t_cand WHERE display_name = 'Opted'), 0::bigint, 'candidates: an opt-out is never suggested');
SELECT is((SELECT count(*) FROM t_cand WHERE display_name = 'Busy'), 0::bigint, 'candidates: someone already booked across the hour is not');
SELECT is((SELECT count(*) FROM t_cand WHERE display_name = 'NoPhone'), 0::bigint, 'candidates: a contact with no number is not');

-- 14–15. asked, then filled by the man who was asked
SELECT public.fill_hour_mark_sent((SELECT id FROM t_o), (SELECT id FROM t_c WHERE who = 'Andreas'));
SELECT is(
  (SELECT asked FROM public.fill_hour_state((SELECT id FROM t_o))),
  1,
  'fill_hour_state: one regular asked'
);
RESET ROLE;
INSERT INTO public.bookings (
  code, user_id, pitch_id, starts_at, ends_at, state, origin, walk_in_name, walk_in_phone,
  base_price_cents, total_cents, platform_fee_cents, cancellation_policy
)
SELECT 'RLS-2032-F012', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c1',
  s, e, 'confirmed', 'walk_in', 'Andreas', '+357 99 111111', 5000, 5000, 0, 'standard'
FROM t_ctx;
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT filled AND filled_by_asked FROM public.fill_hour_state((SELECT id FROM t_o))),
  TRUE,
  'fill_hour_state: filled, by someone the owner asked'
);

-- 16–18. the offers are the owner's
SELECT is((SELECT count(*) FROM public.fill_offers), 1::bigint, 'RLS: the owner reads his offer');
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT is((SELECT count(*) FROM public.fill_offers), 0::bigint, 'RLS: a manager reads no offers');
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is((SELECT count(*) FROM public.fill_offer_sends), 0::bigint, 'RLS: a stranger reads no sends');

SELECT * FROM finish();
ROLLBACK;
