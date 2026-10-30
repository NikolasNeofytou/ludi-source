-- 13_booking_participants.sql — RLS, capacity and the fixture read path
--
-- Objects under test (migration 20260824000001):
--   booking_participants_select_roster  — self / fellow participant / organiser / admin
--   booking_participants_update_self    — own row only
--   (deliberate absence of INSERT and DELETE policies)
--   tg_booking_participants_capacity            — slots cannot be overfilled
--   tg_booking_participants_block_identity_columns
--   tg_bookings_seat_organiser                  — every fixture has its organiser
--   v_fixture / v_fixture_roster                — ADR-0013 shape + caller predicate
--   fixture_preview() / join_fixture()          — ADR-0021 / ADR-0022
--
-- Bootstrap fixtures used: pitch A1 is 5-a-side, so a fixture on it is
-- 2 keepers + 8 outfield. Booking f1 belongs to `other` (a4) and starts in
-- 2030, so it is joinable.
BEGIN;
SELECT plan(38);

-- ────────────────────────────────────────────────────────────────────
-- Extra fixtures, created before any identity switch (i.e. as the test
-- superuser): a fixture that has already kicked off, and a cancelled one.
-- ────────────────────────────────────────────────────────────────────
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents,
  platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000f3',
  'RLS-2030-0003',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2',
  now() - interval '2 days',
  now() - interval '2 days' + interval '1 hour',
  'confirmed',
  4000, 0, 4000, 400, 'standard'
), (
  '00000000-0000-4000-8000-0000000000f4',
  'RLS-2030-0004',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2',
  now() + interval '9 days',
  now() + interval '9 days' + interval '1 hour',
  'cancelled',
  4000, 0, 4000, 400, 'standard'
);

-- The token is the capability, and a non-owner cannot read it off the
-- bookings table by design — so the test carries it the way the product
-- does: out of band, in a link. A temp table stands in for the link.
CREATE TEMP TABLE t_links AS
  SELECT code, invite_token FROM public.bookings
   WHERE id IN (
     '00000000-0000-4000-8000-0000000000f1',
     '00000000-0000-4000-8000-0000000000f2', -- v_book_admin, RLS-2030-0002
     '00000000-0000-4000-8000-0000000000f3',
     '00000000-0000-4000-8000-0000000000f4'
   );
GRANT SELECT ON t_links TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- The organiser is seated, and the fixture has a shape
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);

-- 1
SELECT is(
  (SELECT count(*)::int FROM public.booking_participants
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid
      AND user_id    = '00000000-0000-4000-8000-0000000000a4'::uuid
      AND slot_kind  = 'outfield'
      AND status     = 'in'),
  1,
  'tg_bookings_seat_organiser: the organiser is on their own roster'
);

-- 2
SELECT is(
  (SELECT gk_slots || '+' || outfield_slots FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  '2+8',
  'squad_slots_for: a 5-a-side fixture is 2 keepers and 8 outfield'
);

-- 3 — ADR-0021: the capability is not the enumerable code
SELECT isnt(
  (SELECT invite_token FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  (SELECT code FROM public.bookings
    WHERE id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  'bookings.invite_token is distinct from bookings.code'
);

-- ────────────────────────────────────────────────────────────────────
-- A stranger sees nothing — and the policy does not recurse
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);

-- 4 — the #36 shape. A policy that asks "is the caller a participant?"
-- queries this table; if the helper were SECURITY INVOKER it could
-- re-enter the policy and die on max_stack_depth (54001), which Postgres
-- does not catch because the reference is laundered through a function.
-- An unfiltered scan is the query that triggers it.
--
-- BUT: this assertion alone does NOT catch an INVOKER helper — verified by
-- mutation on 2026-08-24, flipping the function to INVOKER and watching
-- this test still pass. The inner query self-filters on auth.uid(), which
-- is leakproof, so the planner can push it below the policy qual and the
-- recursion never starts. That is the same mechanism that hid the is_admin
-- bug for months. Tests 26 and 27 assert the property structurally, and
-- deleting them because "test 4 covers it" would be a mistake.
SELECT lives_ok(
  $$SELECT count(*) FROM public.booking_participants$$,
  'is_participant_of_booking: unfiltered scan returns instead of recursing'
);

-- 5
SELECT is(
  (SELECT count(*)::int FROM public.booking_participants),
  0,
  'booking_participants_select_roster: a stranger sees no roster rows'
);

-- 6
SELECT is(
  (SELECT count(*)::int FROM public.v_fixture),
  0,
  'v_fixture: a stranger sees no fixtures'
);

-- 7
SELECT is(
  (SELECT count(*)::int FROM public.v_fixture_roster),
  0,
  'v_fixture_roster: a stranger sees no roster'
);

-- 8 — PII excluded by construction, not by policy (ADR-0013 posture)
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('v_fixture', 'v_fixture_roster')
      AND column_name IN ('phone', 'email', 'stripe_customer_id', 'role',
                          'platform_fee_cents', 'base_price_cents', 'notes',
                          -- 20260902000001 widened the roster with the card's
                          -- football facts. These two were held back on
                          -- purpose (quasi-identifying, 20260530000001) and
                          -- the assertion is what keeps them out.
                          'height_cm', 'age_band')),
  0,
  'v_fixture / v_fixture_roster expose no PII and no commercial columns'
);

-- 8b - the roster's football facts ARE there, or the fixture screen has
-- nothing to render. Asserted by name so a careless view rewrite that drops
-- them fails here rather than silently emptying the teammate sheet.
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'v_fixture_roster'
      AND column_name IN ('skill_level', 'positions', 'preferred_foot',
                          'played_with_you')),
  4,
  'v_fixture_roster carries the card''s football facts and the shared count'
);

-- ────────────────────────────────────────────────────────────────────
-- What a link buys you before you are on the roster
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_anon();

-- 9 — anon has no SELECT on either view (20260824000001 revokes it); the
-- caller predicate, which would return nothing, is the gate behind it
SELECT throws_ok(
  $$SELECT count(*) FROM public.v_fixture_roster$$,
  '42501',
  NULL,
  'v_fixture_roster: anon has no SELECT'
);

-- 9a
SELECT throws_ok(
  $$SELECT count(*) FROM public.v_fixture$$,
  '42501',
  NULL,
  'v_fixture: anon has no SELECT'
);

-- 10 — counts, never names
SELECT is(
  (SELECT gk_open || '/' || outfield_open FROM public.fixture_preview(
     (SELECT invite_token FROM t_links WHERE code = 'RLS-2030-0001'))),
  '2/7',
  'fixture_preview: anon sees spots open, not who is in them'
);

-- 10b — booking_id is returned (routing, not roster) and matches the real row
SELECT is(
  (SELECT booking_id FROM public.fixture_preview(
     (SELECT invite_token FROM t_links WHERE code = 'RLS-2030-0001'))),
  '00000000-0000-4000-8000-0000000000f1'::uuid,
  'fixture_preview: booking_id is returned so the client can route post-join'
);

-- 11
SELECT is(
  (SELECT count(*)::int FROM public.fixture_preview('not-a-real-token')),
  0,
  'fixture_preview: an unknown token resolves to nothing'
);

-- 12 — anon has no EXECUTE (20261020000002); the body's auth.uid() check
-- (NOT_SIGNED_IN) is the second gate behind it
SELECT throws_ok(
  $$SELECT public.join_fixture(
      (SELECT invite_token FROM t_links WHERE code = 'RLS-2030-0001'), 'gk')$$,
  '42501',
  NULL,
  'join_fixture: anon cannot take a slot'
);

-- ────────────────────────────────────────────────────────────────────
-- Joining
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);

-- 13 — also the uuid7()-inside-a-definer regression: this INSERT fires the
-- id DEFAULT from inside join_fixture's pinned search_path, which is where
-- gen_random_bytes went missing while W2 was being built.
SELECT lives_ok(
  $$SELECT public.join_fixture(
      (SELECT invite_token FROM t_links WHERE code = 'RLS-2030-0001'), 'gk')$$,
  'join_fixture: the token seats a stranger as keeper'
);

-- 14
SELECT is(
  (SELECT count(*)::int FROM public.v_fixture),
  1,
  'v_fixture: joining makes the fixture visible to the joiner'
);

-- 14b — W7: v_fixture's fill columns, the bookings-list "say so from the
-- list" numbers. One keeper in (a5, just joined); one outfield is already
-- the organiser, auto-seated by tg_bookings_seat_organiser on creation.
SELECT is(
  (SELECT gk_filled || '/' || outfield_filled FROM public.v_fixture
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  '1/1',
  'v_fixture: gk_filled/outfield_filled reflect the roster so far'
);

-- 15
SELECT is(
  (SELECT count(*)::int FROM public.v_fixture_roster),
  2,
  'v_fixture_roster: a participant sees the whole roster, not just themselves'
);

-- 16
SELECT is(
  (SELECT slot_kind FROM public.v_fixture_roster WHERE is_you),
  'gk',
  'v_fixture_roster: is_you marks the caller''s own row'
);

-- 17 — the organiser sees the newcomer
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.v_fixture_roster
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  2,
  'v_fixture_roster: the organiser sees who joined'
);

-- ────────────────────────────────────────────────────────────────────
-- Capacity
-- ────────────────────────────────────────────────────────────────────
-- 18 — second keeper fills the group
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT lives_ok(
  $$SELECT public.join_fixture(
      (SELECT invite_token FROM t_links WHERE code = 'RLS-2030-0001'), 'gk')$$,
  'join_fixture: the second keeper is allowed'
);

-- 19 — the third is not
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$SELECT public.join_fixture(
      (SELECT invite_token FROM t_links WHERE code = 'RLS-2030-0001'), 'gk')$$,
  'P0001',
  'FIXTURE_FULL',
  'tg_booking_participants_capacity: a third keeper is refused'
);

-- 20 — but the outfield still has room, so the same person gets in
SELECT lives_ok(
  $$SELECT public.join_fixture(
      (SELECT invite_token FROM t_links WHERE code = 'RLS-2030-0001'), 'outfield')$$,
  'tg_booking_participants_capacity: a full keeper group does not close the fixture'
);

-- 20b — W7: fill counts after two keepers and one extra outfield join
SELECT is(
  (SELECT gk_filled || '/' || outfield_filled FROM public.v_fixture
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  '2/2',
  'v_fixture: fill counts track a mixed-slot joiner correctly'
);

-- ────────────────────────────────────────────────────────────────────
-- W7: "my fixtures" — v_fixture with no booking_id filter
-- ────────────────────────────────────────────────────────────────────
-- The bookings tab now queries exactly this shape: WHERE organiser OR
-- participant OR admin, no booking_id filter, is "every fixture I am in".
-- a3 already joined f1 as the second keeper (test 18) and organises
-- nothing; joining f2 as well proves one query surfaces fixtures across
-- DIFFERENT bookings for one user — the mechanism that was missing before
-- W7, where a fixture joined as a teammate never appeared in the joiner's
-- own Bookings tab at all (it read straight from `bookings`, which is
-- self-or-owner-or-admin and a teammate is neither).
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT lives_ok(
  $$SELECT public.join_fixture(
      (SELECT invite_token FROM t_links WHERE code = 'RLS-2030-0002'), 'outfield')$$,
  'join_fixture: a participant of one fixture can join another as a teammate'
);

-- 20c
SELECT is(
  (SELECT count(*)::int FROM public.v_fixture),
  2,
  'v_fixture, unfiltered: "my fixtures" spans two different bookings for one user'
);

-- ────────────────────────────────────────────────────────────────────
-- Leaving is an UPDATE, and the row survives it
-- ────────────────────────────────────────────────────────────────────
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
UPDATE public.booking_participants
   SET status = 'out'
 WHERE user_id = '00000000-0000-4000-8000-0000000000a5'::uuid;

-- 21
SELECT is(
  (SELECT status || ':' || (left_at IS NOT NULL)::text
     FROM public.booking_participants
    WHERE user_id = '00000000-0000-4000-8000-0000000000a5'::uuid),
  'out:true',
  'leaving keeps the row and dates it — the keeper trial needs the record'
);

-- 21b — read access survives leaving. Found while building W6: the fixture
-- screen has to keep showing "you're out, want back in?" to the person who
-- just left, so is_participant_of_booking() deliberately does NOT filter to
-- status='in' (see the migration comment). A stranger who never had a row
-- still gets zero — proven by test 5/6/7 above with a4/a5 before they
-- joined; this proves the opposite direction holds too.
SELECT is(
  (SELECT count(*)::int FROM public.v_fixture
    WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  1,
  'v_fixture: a departed participant still reads their own fixture'
);

-- 22 — coming back in is not a bare UPDATE (20261020000002): it skipped
-- join_fixture()'s checks (started, cancelled, a split fixture's payment)
SELECT throws_ok(
  $$UPDATE public.booking_participants
       SET status = 'in'
     WHERE user_id = '00000000-0000-4000-8000-0000000000a5'::uuid$$,
  '42501',
  'rejoin through join_fixture(), not an UPDATE',
  'tg_booking_participants_block_identity_columns: a bare UPDATE cannot rejoin'
);

-- 22b — nor is changing slot (a5 joined in goal; moving out of it is
-- join_fixture()'s job too)
SELECT throws_ok(
  $$UPDATE public.booking_participants
       SET slot_kind = 'outfield'
     WHERE user_id = '00000000-0000-4000-8000-0000000000a5'::uuid$$,
  '42501',
  'change slot through join_fixture(), not an UPDATE',
  'tg_booking_participants_block_identity_columns: a bare UPDATE cannot change slot'
);

-- 22c — join_fixture() is the way back in, and the way to pick a slot:
-- volunteering to go in goal is how a keeper gap actually gets solved.
-- Capacity still applies (a5 is 'out', so the keeper group has a free
-- slot again).
SELECT lives_ok(
  $$SELECT public.join_fixture(
      (SELECT invite_token FROM t_links WHERE code = 'RLS-2030-0001'), 'gk')$$,
  'join_fixture: a departed participant rejoins, in goal'
);

-- 22d — the same row came back, now in goal
SELECT is(
  (SELECT status || ':' || slot_kind FROM public.booking_participants
    WHERE user_id = '00000000-0000-4000-8000-0000000000a5'::uuid
      AND booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  'in:gk',
  'join_fixture: rejoining flips the same row back to in, with the new slot'
);

-- 23 — but not whose row it is
SELECT throws_ok(
  $$UPDATE public.booking_participants
       SET user_id = '00000000-0000-4000-8000-0000000000a1'::uuid
     WHERE user_id = '00000000-0000-4000-8000-0000000000a5'::uuid$$,
  '42501',
  NULL,
  'tg_booking_participants_block_identity_columns: user_id is not editable'
);

-- ────────────────────────────────────────────────────────────────────
-- The write paths that must not exist
-- ────────────────────────────────────────────────────────────────────
-- 24 — no INSERT policy: join_fixture() is the only writer (ADR-0022)
SELECT throws_ok(
  $$INSERT INTO public.booking_participants (booking_id, user_id, slot_kind)
    VALUES ('00000000-0000-4000-8000-0000000000f2'::uuid,
            '00000000-0000-4000-8000-0000000000a5'::uuid, 'outfield')$$,
  '42501',
  NULL,
  'booking_participants: direct client INSERT is denied'
);

-- 25 — a fixture that has already kicked off cannot be joined
SELECT throws_ok(
  $$SELECT public.join_fixture(
      (SELECT invite_token FROM t_links WHERE code = 'RLS-2030-0003'), 'outfield')$$,
  'P0001',
  'FIXTURE_STARTED',
  'join_fixture: a fixture in the past refuses new players'
);

-- ────────────────────────────────────────────────────────────────────
-- Structural assertions — the properties behaviour cannot see
-- ────────────────────────────────────────────────────────────────────
-- 26
SELECT is(
  (SELECT count(*)::int FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('is_participant_of_booking', 'is_booking_organiser',
                        'join_fixture', 'fixture_preview')
      AND p.prosecdef),
  4,
  'the four policy/RPC helpers are SECURITY DEFINER (cf. #36)'
);

-- 27 — CVE-2018-1058: a definer function with a mutable search_path can be
-- hijacked by a same-named object in a schema the caller controls. The
-- `extensions` entry is not decoration: uuid7() reaches gen_random_bytes
-- through it, and its absence is what broke join_fixture during W2.
SELECT is(
  (SELECT count(*)::int FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('is_participant_of_booking', 'is_booking_organiser',
                        'join_fixture', 'fixture_preview', 'uuid7')
      AND p.proconfig @> ARRAY['search_path=public, extensions, pg_temp']),
  5,
  'every definer function pins search_path, and uuid7() carries its own'
);

SELECT * FROM finish();
ROLLBACK;
