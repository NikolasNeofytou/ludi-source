-- 38_who_took_it.sql — slice E: who put a walk-in on the book, and who
-- took it off (20260918000001).
--
-- No new table: a walk-in's bookings.user_id has been the ACTING staff
-- member since 20260829000001, and cancels write a walk_in_cancelled
-- admin_actions row with the actor. The roster view now surfaces both.
-- These assertions pin the two things that make it safe to surface:
--   * the taker never leaks into the customer's name, nor an app
--     booking's player into "taken by";
--   * a staff member's EMAIL is the owner's to see, never a manager's.
--
-- Fixtures (_bootstrap): a1 admin, a2 "Owner User" owns venue_a (b1,
-- pitch c1), a3 "Manager User" manages it, a4 "Other User" has app
-- booking f1, a5 is a stranger.
BEGIN;
SELECT plan(10);

-- As superuser, before any set_test_user.
UPDATE auth.users SET email = 'manager.fixture@venue-a.cy'
 WHERE id = '00000000-0000-4000-8000-0000000000a3'::uuid;

INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, origin,
  walk_in_name, walk_in_phone,
  base_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES
  -- W1: the manager took it, for Andreas
  ('00000000-0000-4000-8000-0000000000e1'::uuid, 'RLS-2026-E001',
   '00000000-0000-4000-8000-0000000000a3'::uuid,
   '00000000-0000-4000-8000-0000000000c1'::uuid,
   '2031-03-04 18:00+00', '2031-03-04 19:00+00', 'confirmed', 'walk_in',
   'Andreas', '35799000001', 6000, 6000, 0, 'standard'),
  -- W2: Ludi took it — the founder at the counter during a handover
  ('00000000-0000-4000-8000-0000000000e2'::uuid, 'RLS-2026-E002',
   '00000000-0000-4000-8000-0000000000a1'::uuid,
   '00000000-0000-4000-8000-0000000000c1'::uuid,
   '2031-03-04 19:00+00', '2031-03-04 20:00+00', 'confirmed', 'walk_in',
   'Petros', '35799000002', 6000, 6000, 0, 'standard'),
  -- W3: the manager took it and the owner cancelled it
  ('00000000-0000-4000-8000-0000000000e3'::uuid, 'RLS-2026-E003',
   '00000000-0000-4000-8000-0000000000a3'::uuid,
   '00000000-0000-4000-8000-0000000000c1'::uuid,
   '2031-03-04 20:00+00', '2031-03-04 21:00+00', 'cancelled', 'walk_in',
   'Marios', '35799000003', 6000, 6000, 0, 'standard');

INSERT INTO public.admin_actions (
  admin_user_id, action_type, target_type, target_id, reason
) VALUES (
  '00000000-0000-4000-8000-0000000000a2'::uuid, 'walk_in_cancelled',
  'booking', '00000000-0000-4000-8000-0000000000e3'::uuid,
  'cancelled walk-in RLS-2026-E003'
);

-- ── As the owner ────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);

-- 1. he sees who took it, by name
SELECT is(
  (SELECT r.taken_by_name FROM public.v_venue_booking_roster AS r
   WHERE r.booking_id = '00000000-0000-4000-8000-0000000000e1'::uuid),
  'Manager User',
  'owner: sees the name of the staff member who took a walk-in'
);

-- 2. and their email — the fallback for a nameless account, and his to
--    see: he already reads it through venue_people()
SELECT is(
  (SELECT r.taken_by_email FROM public.v_venue_booking_roster AS r
   WHERE r.booking_id = '00000000-0000-4000-8000-0000000000e1'::uuid),
  'manager.fixture@venue-a.cy',
  'owner: sees the staff member''s email'
);

-- 3. a walk-in Ludi took says so
SELECT ok(
  (SELECT r.taken_by_ludi FROM public.v_venue_booking_roster AS r
   WHERE r.booking_id = '00000000-0000-4000-8000-0000000000e2'::uuid),
  'owner: a walk-in the platform took is flagged as Ludi''s'
);

-- 4. he sees who cancelled it
SELECT is(
  (SELECT r.cancelled_by_name FROM public.v_venue_booking_roster AS r
   WHERE r.booking_id = '00000000-0000-4000-8000-0000000000e3'::uuid),
  'Owner User',
  'owner: sees who cancelled a walk-in'
);

-- 5. an APP booking has no taker. Its user_id is the player, and naming
--    the player as "who took it" would be wrong and a new exposure.
SELECT is(
  (SELECT r.taken_by_user_id FROM public.v_venue_booking_roster AS r
   WHERE r.booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  NULL,
  'owner: an app booking has no "taken by"'
);

-- 6. and the taker never leaks into the customer's name — the confusion
--    20260829000001 warned about, now that the taker has a column of
--    their own
SELECT is(
  (SELECT r.first_name FROM public.v_venue_booking_roster AS r
   WHERE r.booking_id = '00000000-0000-4000-8000-0000000000e1'::uuid),
  'Andreas',
  'owner: the customer column still holds the customer, not the taker'
);

-- ── As the manager ──────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);

-- 7. he sees the name — who took a booking here is the day (ADR-0041),
--    and "ask Maria, she booked it" is a shift-handover sentence
SELECT is(
  (SELECT r.taken_by_name FROM public.v_venue_booking_roster AS r
   WHERE r.booking_id = '00000000-0000-4000-8000-0000000000e1'::uuid),
  'Manager User',
  'manager: sees who took a walk-in, by name'
);

-- 8. but never a colleague's email, even his own row's — the column is
--    filled per caller, and a manager is not the caller it is filled for
SELECT is(
  (SELECT r.taken_by_email FROM public.v_venue_booking_roster AS r
   WHERE r.booking_id = '00000000-0000-4000-8000-0000000000e1'::uuid),
  NULL,
  'manager: never sees a staff member''s email'
);

-- 9. nor the canceller's
SELECT is(
  (SELECT r.cancelled_by_email FROM public.v_venue_booking_roster AS r
   WHERE r.booking_id = '00000000-0000-4000-8000-0000000000e3'::uuid),
  NULL,
  'manager: never sees the canceller''s email'
);

-- ── As a stranger ───────────────────────────────────────────────────
-- 10. who took a booking at a venue is that venue's business
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_venue_booking_roster AS r
   WHERE r.booking_id IN (
     '00000000-0000-4000-8000-0000000000e1'::uuid,
     '00000000-0000-4000-8000-0000000000e2'::uuid,
     '00000000-0000-4000-8000-0000000000e3'::uuid)),
  0,
  'stranger: sees none of it'
);

SELECT * FROM finish();
ROLLBACK;
