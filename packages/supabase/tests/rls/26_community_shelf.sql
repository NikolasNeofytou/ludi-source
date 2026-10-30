-- 26_community_shelf.sql — the shelf substrate (migration 20260901000003)
--
-- Objects under test:
--   cities.whatsapp_group_url  — public read, admin-only write, URL shape
--   community_week_stats()     — counts from real completed fixtures;
--                                authenticated only
BEGIN;
SELECT plan(7);

-- Setup: one completed fixture inside the window (a4's, a5 seated), one
-- outside it — both created as superuser, both rolled back with the file.
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents,
  platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-00000000fb01',
  'RLS-2030-0011',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1',
  now() - interval '2 days',
  now() - interval '2 days' + interval '1 hour',
  'completed',
  4000, 0, 4000, 400, 'standard'
), (
  '00000000-0000-4000-8000-00000000fb02',
  'RLS-2030-0012',
  '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1',
  now() - interval '30 days',
  now() - interval '30 days' + interval '1 hour',
  'completed',
  4000, 0, 4000, 400, 'standard'
);
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind, status)
VALUES (
  '00000000-0000-4000-8000-00000000fb01',
  '00000000-0000-4000-8000-0000000000a5',
  'outfield', 'in'
);

-- 1 — the strip counts only the trailing week: 1 match, 2 players
-- (organiser auto-seated + a5)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT results_eq(
  $$SELECT matches_7d, players_7d FROM public.community_week_stats()$$,
  $$VALUES (1, 2)$$,
  'community_week_stats: trailing week only, distinct players'
);

-- 2 — anon has no grant
SELECT public.set_test_anon();
SELECT throws_ok(
  $$SELECT * FROM public.community_week_stats()$$,
  '42501',
  NULL,
  'community_week_stats: anon has no EXECUTE grant'
);

-- 3 — the group link is publicly readable (anon included: invite links
-- are public by nature, and Discover already reads cities signed-out)
SELECT lives_ok(
  $$SELECT whatsapp_group_url FROM public.cities LIMIT 1$$,
  'cities.whatsapp_group_url: anon can read'
);

-- 4 — but not writable by a signed-in non-admin
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT lives_ok(
  $$UPDATE public.cities
       SET whatsapp_group_url = 'https://chat.whatsapp.com/EVIL'
     WHERE name_en = 'Larnaca'$$,
  'cities_admin_write: non-admin update reaches zero rows silently'
);

-- 5
SELECT is(
  (SELECT count(*)::int FROM public.cities
    WHERE whatsapp_group_url IS NOT NULL),
  0,
  'the non-admin write landed on nothing'
);

-- 6 — the admin can set it, but only to a chat.whatsapp.com link
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT throws_ok(
  $$UPDATE public.cities
       SET whatsapp_group_url = 'https://evil.example/join'
     WHERE name_en = 'Larnaca'$$,
  '23514',
  NULL,
  'cities_whatsapp_url_shape: non-WhatsApp URLs are rejected'
);

-- 7
SELECT lives_ok(
  $$UPDATE public.cities
       SET whatsapp_group_url = 'https://chat.whatsapp.com/TESTGROUP'
     WHERE name_en = 'Larnaca'$$,
  'admin sets a well-shaped group link'
);

SELECT * FROM finish();
ROLLBACK;
