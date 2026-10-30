-- Community v3 demo fixtures. Every row is coded V3-DEMO-* so the whole
-- set is removable with one DELETE (see the teardown at the bottom).
--
-- 2026-09-11 (community-v4.md unit 1): upcoming dates moved past the
-- original 2026-09-03..08 window, and one JOINED-and-short fixture added
-- (V3-DEMO-J1: organised by the mate, `me` seated outfield, still short)
-- so *Yours* renders both roles and the cap ("N more") has something to
-- cap: me hosting S3, L1, B3 + joined J1 = four short fixtures of mine.
BEGIN;

\set me     '''f4ced998-06da-4f2f-bea4-50558f352ca8'''
\set mate   '''00000000-0000-4000-8000-0000000000d1'''
\set other  '''14eab068-311c-4715-8885-38ea839056ac'''
\set indoor '''00000000-0000-4000-8000-000000000102'''
\set turf   '''00000000-0000-4000-8000-000000000101'''
\set alion  '''00000000-0000-4000-8000-000000030101'''
\set fields '''00000000-0000-4000-8000-000000030401'''

INSERT INTO public.bookings (
  code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents,
  cancellation_policy, open_level
) VALUES
  -- The thread: two played Tuesdays at 20:00, same pitch.
  ('V3-DEMO-S1', :me, :indoor,
   (date '2026-08-11' + time '20:00') AT TIME ZONE 'Europe/Nicosia',
   (date '2026-08-11' + time '21:00') AT TIME ZONE 'Europe/Nicosia',
   'completed', 4000, 0, 4000, 400, 'standard', NULL),
  ('V3-DEMO-S2', :me, :indoor,
   (date '2026-08-18' + time '20:00') AT TIME ZONE 'Europe/Nicosia',
   (date '2026-08-18' + time '21:00') AT TIME ZONE 'Europe/Nicosia',
   'completed', 4000, 0, 4000, 400, 'standard', NULL),
  -- ...and the next one in that slot: the thread's "Next", and a lane row.
  ('V3-DEMO-S3', :me, :indoor,
   (date '2026-09-15' + time '20:00') AT TIME ZONE 'Europe/Nicosia',
   (date '2026-09-15' + time '21:00') AT TIME ZONE 'Europe/Nicosia',
   'paid', 4000, 0, 4000, 400, 'standard', NULL),
  -- Lane row on an UNLISTED fixture - the lane serves it either way.
  ('V3-DEMO-L1', :me, :turf,
   (date '2026-09-18' + time '20:00') AT TIME ZONE 'Europe/Nicosia',
   (date '2026-09-18' + time '21:00') AT TIME ZONE 'Europe/Nicosia',
   'paid', 6000, 0, 6000, 600, 'standard', NULL),
  -- A stranger-ish board row: organised by the mate, with the other
  -- player seated too, so the familiarity signal reads 2.
  ('V3-DEMO-B1', :mate, :alion,
   (date '2026-09-12' + time '19:00') AT TIME ZONE 'Europe/Nicosia',
   (date '2026-09-12' + time '20:00') AT TIME ZONE 'Europe/Nicosia',
   'paid', 4500, 0, 4500, 450, 'standard', 'competitive'),
  -- One of mine, listed: a board row where the signal is correctly absent
  -- (you never count yourself), and a third lane row.
  ('V3-DEMO-B3', :me, :fields,
   (date '2026-09-17' + time '19:00') AT TIME ZONE 'Europe/Nicosia',
   (date '2026-09-17' + time '20:00') AT TIME ZONE 'Europe/Nicosia',
   'paid', 4000, 0, 4000, 400, 'standard', 'casual'),
  -- v4: a fixture I JOINED that is still short. Listed, so without the
  -- v4 partition it would sit on the board as a row I could "join"; with
  -- it, it is a *Yours* row wearing the Joined chip instead.
  ('V3-DEMO-J1', :mate, :fields,
   (date '2026-09-16' + time '21:00') AT TIME ZONE 'Europe/Nicosia',
   (date '2026-09-16' + time '22:00') AT TIME ZONE 'Europe/Nicosia',
   'paid', 4000, 0, 4000, 400, 'standard', 'casual'),
  -- v4 unit 2: three more stranger board rows so the time chips have
  -- something to cut — tonight (Fri 11), Sunday (13), and next Thursday
  -- (17), which must produce NO chip: it falls in no window.
  ('V3-DEMO-B4', :other, :turf,
   (date '2026-09-11' + time '23:00') AT TIME ZONE 'Europe/Nicosia',
   (date '2026-09-12' + time '00:00') AT TIME ZONE 'Europe/Nicosia',
   'paid', 6000, 0, 6000, 600, 'standard', NULL),
  ('V3-DEMO-B5', :mate, :alion,
   (date '2026-09-13' + time '18:00') AT TIME ZONE 'Europe/Nicosia',
   (date '2026-09-13' + time '19:00') AT TIME ZONE 'Europe/Nicosia',
   'paid', 4500, 0, 4500, 450, 'standard', 'casual'),
  ('V3-DEMO-B6', :other, :indoor,
   (date '2026-09-17' + time '21:00') AT TIME ZONE 'Europe/Nicosia',
   (date '2026-09-17' + time '22:00') AT TIME ZONE 'Europe/Nicosia',
   'paid', 4000, 0, 4000, 400, 'standard', NULL);

-- Rosters. The organiser is auto-seated by tg_bookings_seat_organiser;
-- these are the teammates that give the history its shape.
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status)
SELECT b.id, :mate, 'outfield', 'in' FROM public.bookings b
 WHERE b.code IN ('V3-DEMO-S1', 'V3-DEMO-S2');

INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status)
SELECT b.id, :other, 'outfield', 'in' FROM public.bookings b
 WHERE b.code IN ('V3-DEMO-S1', 'V3-DEMO-B1');

-- v4: me, seated on the mate's fixture.
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status)
SELECT b.id, :me, 'outfield', 'in' FROM public.bookings b
 WHERE b.code = 'V3-DEMO-J1';

UPDATE public.bookings SET is_open = TRUE
 WHERE code IN ('V3-DEMO-B1', 'V3-DEMO-B3', 'V3-DEMO-J1',
                'V3-DEMO-B4', 'V3-DEMO-B5', 'V3-DEMO-B6');

COMMIT;
