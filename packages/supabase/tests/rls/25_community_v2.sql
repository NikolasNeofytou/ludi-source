-- 25_community_v2.sql — the record & the rebook (migration 20260901000002)
--
-- Objects under test:
--   complete_played_bookings()  — flips played paid/confirmed, nothing else
--   my_record()                 — caller-scoped counts; authenticated only
--   bookings.rebooked_from      — FK + frozen for organisers by the guard
--
-- Bootstrap has only f1/f2 (both future) — every past-tense fixture this
-- file needs is created here, inside its own rolled-back transaction.
BEGIN;
SELECT plan(12);

-- ────────────────────────────────────────────────────────────────────
-- Setup, as superuser: a played confirmed fixture (f9, the one the flip
-- should catch — a5 seated on it so the record has a teammate), a
-- future 'paid' (f7), a past 'pending' (f8) and a cancelled (fa) to
-- prove the flip's predicate edges.
-- ────────────────────────────────────────────────────────────────────
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents,
  platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000f9',
  'RLS-2030-0009',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1',
  now() - interval '2 days',
  now() - interval '2 days' + interval '1 hour',
  'confirmed',
  4000, 0, 4000, 400, 'standard'
), (
  '00000000-0000-4000-8000-0000000000f7',
  'RLS-2030-0007',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1',
  now() + interval '3 days',
  now() + interval '3 days' + interval '1 hour',
  'paid',
  4000, 0, 4000, 400, 'standard'
), (
  '00000000-0000-4000-8000-0000000000f8',
  'RLS-2030-0008',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1',
  now() - interval '3 days',
  now() - interval '3 days' + interval '1 hour',
  'pending',
  4000, 0, 4000, 400, 'standard'
), (
  '00000000-0000-4000-8000-0000000000fa',
  'RLS-2030-0010',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1',
  now() - interval '4 days',
  now() - interval '4 days' + interval '1 hour',
  'cancelled',
  4000, 0, 4000, 400, 'standard'
);

INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status)
VALUES (
  '00000000-0000-4000-8000-0000000000f9',
  '00000000-0000-4000-8000-0000000000a5',
  'outfield', 'in'
);

-- ────────────────────────────────────────────────────────────────────
-- 1. Completion flip
-- ────────────────────────────────────────────────────────────────────

-- 1 — exactly one row qualifies (f9: confirmed, ended). f7 is future,
-- f8 is pending, fa is cancelled.
SELECT is(
  public.complete_played_bookings(),
  1,
  'complete_played_bookings: flips exactly the played active fixture'
);

-- 2
SELECT is(
  (SELECT state::text FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000f9'::uuid),
  'completed',
  'the played fixture is completed'
);

-- 3 — untouched: future paid, past pending, cancelled
SELECT is(
  (SELECT count(*)::int FROM public.bookings
    WHERE id IN ('00000000-0000-4000-8000-0000000000f7',
                 '00000000-0000-4000-8000-0000000000f8',
                 '00000000-0000-4000-8000-0000000000fa')
      AND state = 'completed'),
  0,
  'complete_played_bookings: future, pending and cancelled are untouched'
);

-- 4 — idempotent
SELECT is(
  public.complete_played_bookings(),
  0,
  'a second run flips nothing'
);

-- 5 — cron-only: clients cannot flip states
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$SELECT public.complete_played_bookings()$$,
  '42501',
  NULL,
  'complete_played_bookings: no client EXECUTE grant'
);

-- ────────────────────────────────────────────────────────────────────
-- 2. The record
-- ────────────────────────────────────────────────────────────────────

-- 6 — a4 organised f9 (auto-seated) and a5 joined it: 1 match, 1 teammate,
-- and the one pitch it was played on resolves to 1 venue (venues column
-- added by 20260902000002 for the profile's three-number record strip).
SELECT results_eq(
  $$SELECT matches_played, teammates, venues FROM public.my_record()$$,
  $$VALUES (1, 1, 1)$$,
  'my_record: organiser of the completed fixture counts it, the teammate and the venue'
);

-- 7 — the teammate sees the mirror image
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT results_eq(
  $$SELECT matches_played, teammates, venues FROM public.my_record()$$,
  $$VALUES (1, 1, 1)$$,
  'my_record: the teammate''s record counts the same match and venue'
);

-- 8 — a player with no completed matches has a zero record, not an error
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT results_eq(
  $$SELECT matches_played, teammates, venues FROM public.my_record()$$,
  $$VALUES (0, 0, 0)$$,
  'my_record: empty history reads as zeros'
);

-- 9 — signed-out has no record to ask for
SELECT public.set_test_anon();
SELECT throws_ok(
  $$SELECT * FROM public.my_record()$$,
  '42501',
  NULL,
  'my_record: anon has no EXECUTE grant'
);

-- ────────────────────────────────────────────────────────────────────
-- 3. The rebook chain
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
RESET ROLE;

-- 10 — the link inserts (service side sets it at creation)
SELECT lives_ok(
  $$UPDATE public.bookings
       SET rebooked_from = '00000000-0000-4000-8000-0000000000f9'
     WHERE id = '00000000-0000-4000-8000-0000000000f7'$$,
  'rebooked_from: privileged writers can set the chain link'
);

-- 11 — FK holds: a link must point at a real booking
SELECT throws_ok(
  $$UPDATE public.bookings
       SET rebooked_from = '00000000-0000-4000-8000-00000000dead'
     WHERE id = '00000000-0000-4000-8000-0000000000f7'$$,
  '23503',
  NULL,
  'rebooked_from: FK rejects a phantom source'
);

-- 12 — the organiser cannot rewrite their chain (column guard)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$UPDATE public.bookings SET rebooked_from = NULL
     WHERE id = '00000000-0000-4000-8000-0000000000f7'$$,
  '42501',
  'an organiser may open or close their fixture, nothing else',
  'rebooked_from: frozen for organisers by the column guard'
);

SELECT * FROM finish();
ROLLBACK;
