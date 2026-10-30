-- 47_the_venues_link.sql — the venue's own link (20261014000001, reach R1)
-- Under test:
--   venues.slug: the shape; an owner cannot change it, Ludi can
--   venue_page: an active venue by slug, signed out; its live courts,
--     formats, lowest price, today's hours less a court closed today;
--     bookable; an inactive venue and an unknown slug return nothing
--   venue_slugs: the active venues only
--
-- Fixtures: venue_a (b1, active, Stripe active) owned by a2 with c1
-- (verified) and c2 (unverified); venue_b (b2, inactive) with c3; a1 admin.
BEGIN;
SELECT plan(12);

-- 1. the shape
SELECT throws_ok(
  $$UPDATE public.venues SET slug = 'Bad Slug' WHERE id = '00000000-0000-4000-8000-0000000000b1'$$,
  '23514', NULL,
  'venues.slug: uppercase and spaces are refused'
);

-- 2. an owner cannot set it
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$UPDATE public.venues SET slug = 'mine' WHERE id = '00000000-0000-4000-8000-0000000000b1'$$,
  '42501', NULL,
  'venues.slug: not the owner''s to change'
);

-- 3. Ludi can
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT lives_ok(
  $$UPDATE public.venues SET slug = 'rls-venue' WHERE id = '00000000-0000-4000-8000-0000000000b1'$$,
  'venues.slug: the admin sets it'
);
RESET ROLE;
UPDATE public.venues SET slug = 'rls-b' WHERE id = '00000000-0000-4000-8000-0000000000b2';

-- hours every day for the verified court, and for the unverified one
-- (which must not count); Monday is already there from the bootstrap
INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at, slot_duration_minutes)
SELECT '00000000-0000-4000-8000-0000000000c1', d, '09:00', '17:00', 60
FROM generate_series(0, 6) AS d WHERE d <> 1;
INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at, slot_duration_minutes)
SELECT '00000000-0000-4000-8000-0000000000c2', d, '07:00', '23:00', 60
FROM generate_series(0, 6) AS d;

-- 4–8. signed out, the page reads the venue
SELECT public.set_test_anon();
SELECT is(
  (SELECT name FROM public.venue_page('rls-venue')),
  'RLS Fixture Venue A',
  'venue_page: an active venue by slug, signed out'
);
SELECT is(
  (SELECT courts || '/' || array_to_string(formats, ',') || '/' || from_price_cents FROM public.venue_page('rls-venue')),
  '1/5-a-side/4000',
  'venue_page: the verified court only, its format, its price'
);
SELECT ok(
  (SELECT bookable FROM public.venue_page('rls-venue')),
  'venue_page: bookable when Stripe is active and a court is live'
);
SELECT is(
  (SELECT opens_today::text || '-' || closes_today::text FROM public.venue_page('rls-venue')),
  '09:00:00-17:00:00',
  'venue_page: today''s hours from the live court, not the unverified one'
);
SELECT is(
  (SELECT city_code FROM public.venue_page('rls-venue')),
  'larnaca',
  'venue_page: the city'
);

-- 9. a court closed today has no hours
RESET ROLE;
INSERT INTO public.pitch_schedule_overrides (pitch_id, override_date, is_closed, reason)
VALUES (
  '00000000-0000-4000-8000-0000000000c1',
  (now() AT TIME ZONE 'Europe/Nicosia')::date, TRUE, 'test'
);
SELECT public.set_test_anon();
SELECT is(
  (SELECT opens_today FROM public.venue_page('rls-venue')),
  NULL,
  'venue_page: closed today means no hours today'
);

-- 10–11. an inactive venue and an unknown slug are nothing
SELECT is((SELECT count(*) FROM public.venue_page('rls-b')), 0::bigint, 'venue_page: an inactive venue has no page');
SELECT is((SELECT count(*) FROM public.venue_page('nope')), 0::bigint, 'venue_page: an unknown slug has no page');

-- 12. the sitemap lists the active venues only
SELECT ok(
  'rls-venue' IN (SELECT slug FROM public.venue_slugs())
  AND 'rls-b' NOT IN (SELECT slug FROM public.venue_slugs()),
  'venue_slugs: active venues only'
);

SELECT * FROM finish();
ROLLBACK;
