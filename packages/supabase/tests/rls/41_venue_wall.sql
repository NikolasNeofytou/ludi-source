-- 41_venue_wall.sql — open seats on the venue's screen (20261013000001, ADR-0043)
-- Under test:
--   public_venue_schedule: an opened, live, future, short fixture carries its
--     open-seat counts and invite token; a closed one, a full one, an unpaid
--     'pending' one and one already played carry none of it; nothing on the
--     wall names a player
--
-- Fixtures: a2 owns venue_a (b1) with c1 and c2; a4 and a5 are players.
-- Dates: three days out (inside the screen's window) and yesterday.
BEGIN;
SELECT plan(10);

CREATE TEMP TABLE t_ctx AS
SELECT (current_date + 3)::date AS d, (current_date - 1)::date AS y;
GRANT SELECT ON t_ctx TO anon, authenticated;

RESET ROLE;
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  gk_slots, outfield_slots, is_open,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
)
SELECT v.id::uuid, v.code, '00000000-0000-4000-8000-0000000000a4', v.pitch::uuid,
  (v.day + v.at) AT TIME ZONE 'Europe/Nicosia', (v.day + v.at + interval '1 hour') AT TIME ZONE 'Europe/Nicosia',
  v.state, v.gk, v.outf, v.open, 4000, 0, 4000, 400, 'standard'
FROM t_ctx, LATERAL (VALUES
  -- w1: opened, confirmed, short → on the wall
  ('00000000-0000-4000-8000-00000000e101', 'RLS-2030-4101', '00000000-0000-4000-8000-0000000000c1', d, time '20:00', 'confirmed', 1, 4, TRUE),
  -- w2: not opened → booked only
  ('00000000-0000-4000-8000-00000000e102', 'RLS-2030-4102', '00000000-0000-4000-8000-0000000000c1', d, time '21:00', 'confirmed', 1, 4, FALSE),
  -- w3: opened but full (1 + 1, both seats taken below)
  ('00000000-0000-4000-8000-00000000e103', 'RLS-2030-4103', '00000000-0000-4000-8000-0000000000c2', d, time '20:00', 'confirmed', 1, 1, TRUE),
  -- w4: opened but an unpaid checkout
  ('00000000-0000-4000-8000-00000000e104', 'RLS-2030-4104', '00000000-0000-4000-8000-0000000000c2', d, time '21:00', 'pending', 1, 4, TRUE),
  -- w5: opened, short, but played yesterday
  ('00000000-0000-4000-8000-00000000e105', 'RLS-2030-4105', '00000000-0000-4000-8000-0000000000c1', y, time '20:00', 'confirmed', 1, 4, TRUE)
) AS v (id, code, pitch, day, at, state, gk, outf, open);

CREATE TEMP TABLE t_w1 AS
SELECT invite_token AS tok FROM public.bookings WHERE id = '00000000-0000-4000-8000-00000000e101';
GRANT SELECT ON t_w1 TO anon, authenticated;

-- w3's keeper seat (the organiser sat himself outfield on insert)
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status)
VALUES ('00000000-0000-4000-8000-00000000e103', '00000000-0000-4000-8000-0000000000a5', 'gk', 'in');

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
CREATE TEMP TABLE t_tok AS SELECT public.venue_display_token('00000000-0000-4000-8000-0000000000b1') AS tok;
GRANT SELECT ON t_tok TO anon, authenticated;

SELECT public.set_test_anon();
CREATE TEMP TABLE t_day AS
SELECT i AS item FROM t_ctx, jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_tok), d) -> 'items') AS i;
CREATE TEMP TABLE t_yday AS
SELECT i AS item FROM t_ctx, jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_tok), y) -> 'items') AS i;

-- 1–3. the opened, short fixture: counts and the invite
SELECT is(
  (SELECT item ->> 'join' FROM t_day, t_ctx
    WHERE (item ->> 'starts_at')::timestamptz = (d + time '20:00') AT TIME ZONE 'Europe/Nicosia'
      AND item ->> 'pitch_id' = '00000000-0000-4000-8000-0000000000c1'),
  (SELECT tok FROM t_w1),
  'wall: an opened, short fixture carries its invite'
);
SELECT is(
  (SELECT (item ->> 'open_gk')::int FROM t_day WHERE item ->> 'join' IS NOT NULL),
  1,
  'wall: the keeper seat counts as open'
);
SELECT is(
  (SELECT (item ->> 'open_outfield')::int FROM t_day WHERE item ->> 'join' IS NOT NULL),
  3,
  'wall: the organiser''s own seat is not counted open'
);

-- 4. exactly one item on the day is on the wall (w2 closed, w3 full, w4 pending)
SELECT is(
  (SELECT count(*) FROM t_day WHERE item ->> 'join' IS NOT NULL),
  1::bigint,
  'wall: closed, full and unpaid fixtures carry no invite'
);

-- 5. the others are still on the screen, as booked
SELECT is(
  (SELECT count(*) FROM t_day WHERE item ->> 'kind' = 'booked'),
  4::bigint,
  'wall: every booking still shows as booked'
);

-- 6. the closed fixture carries no counts either
SELECT is(
  (SELECT count(*) FROM t_day WHERE item ->> 'join' IS NULL AND (item ? 'open_gk') AND item -> 'open_gk' <> 'null'::jsonb),
  0::bigint,
  'wall: no counts on a fixture the board would not list'
);

-- 7. yesterday's short, opened fixture is no longer advertised
SELECT is(
  (SELECT count(*) FROM t_yday WHERE item ->> 'join' IS NOT NULL),
  0::bigint,
  'wall: a fixture already played is not advertised'
);

-- 8. no player is named anywhere on the wall
SELECT is(
  (SELECT count(*) FROM t_day WHERE item::text LIKE '%00000000-0000-4000-8000-0000000000a4%'
                              OR item::text LIKE '%00000000-0000-4000-8000-0000000000a5%'),
  0::bigint,
  'wall: no user id on the screen'
);

-- 9. closing the fixture takes it off the wall
RESET ROLE;
UPDATE public.bookings SET is_open = FALSE WHERE id = '00000000-0000-4000-8000-00000000e101';
SELECT public.set_test_anon();
SELECT is(
  (SELECT count(*) FROM t_ctx, jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_tok), d) -> 'items') AS i
   WHERE i ->> 'join' IS NOT NULL),
  0::bigint,
  'wall: closing the fixture takes it off the screen'
);

-- 10. a split fixture shows the price of a seat
RESET ROLE;
UPDATE public.bookings SET is_open = TRUE, is_split = TRUE, share_amount_cents = 800,
  collect_deadline = starts_at - interval '24 hours'
WHERE id = '00000000-0000-4000-8000-00000000e101';
SELECT public.set_test_anon();
SELECT is(
  (SELECT (i ->> 'share_cents')::int FROM t_ctx, jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_tok), d) -> 'items') AS i
   WHERE i ->> 'join' IS NOT NULL),
  800,
  'wall: a split fixture shows what a seat costs'
);

SELECT * FROM finish();
ROLLBACK;
