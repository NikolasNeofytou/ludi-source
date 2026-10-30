-- 39_venue_contacts.sql — the owner's regulars (20260918000002)
--
-- Pins the three properties the plan calls the architecture, and the
-- read line it drew for managers:
--   * the phone number is the identity — four spellings, one contact;
--   * the list fills itself — a walk-in makes or finds its contact, a
--     series occurrence inherits its series', and no key means no row;
--   * scoped to the venue — a booking cannot point across venues;
--   * a manager SEARCHES the list and never lists it; deleting is the
--     owner's, and deleting a contact never deletes a booking.
--
-- Fixtures (_bootstrap): a1 admin, a2 owns venue_a (b1, pitch c1), a3
-- manages it, a4 player with app booking f1, a5 stranger; venue_b (b2,
-- pitch c3) is owned by nobody. Walk-ins go in as superuser, as every
-- real walk-in does (there is no bookings INSERT policy).
BEGIN;
SELECT plan(24);

-- ── The normalisers ─────────────────────────────────────────────────
-- 1. four ways the counter writes one Cypriot number are one key
SELECT is(
  ARRAY[
    public.normalize_phone_cy('+357 99 123456'),
    public.normalize_phone_cy('0035799123456'),
    public.normalize_phone_cy('35799123456'),
    public.normalize_phone_cy('99123456')
  ],
  ARRAY['+35799123456', '+35799123456', '+35799123456', '+35799123456'],
  'normalize_phone_cy: four spellings of one number are one key'
);

-- 2. and a number it cannot be sure of is no key at all
SELECT is(
  public.normalize_phone_cy('6912345678'),
  NULL,
  'normalize_phone_cy: a bare 10-digit number is not guessed at'
);

-- 3. Greek and Latin meet in one alphabet
SELECT is(
  public.normalize_contact_text('Ανδρέας'),
  public.normalize_contact_text('Andreas'),
  'normalize_contact_text: Ανδρέας and Andreas fold to the same key'
);

-- ── The list fills itself ───────────────────────────────────────────
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, origin,
  walk_in_name, walk_in_phone,
  base_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000d1'::uuid, 'RLS-2032-C001',
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  '00000000-0000-4000-8000-0000000000c1'::uuid,
  '2032-05-04 18:00+00', '2032-05-04 19:00+00', 'confirmed', 'walk_in',
  'Andreas', '99 123456', 6000, 6000, 0, 'standard'
);

-- 4. a walk-in with a number made its venue's contact
SELECT is(
  (SELECT c.display_name || '|' || c.phone_e164 || '|' || c.source
   FROM public.venue_contacts AS c
   INNER JOIN public.bookings AS b ON b.contact_id = c.id
   WHERE b.id = '00000000-0000-4000-8000-0000000000d1'::uuid
     AND c.venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid),
  'Andreas|+35799123456|counter',
  'trigger: a walk-in with a number makes its venue''s contact'
);

-- The owner curates the name. The next walk-in must not undo that.
UPDATE public.venue_contacts
   SET display_name = 'Ανδρέας — Τρίτη 20:00'
 WHERE venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid
   AND phone_e164 = '+35799123456';

INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, origin,
  walk_in_name, walk_in_phone,
  base_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000d2'::uuid, 'RLS-2032-C002',
  '00000000-0000-4000-8000-0000000000a3'::uuid,
  '00000000-0000-4000-8000-0000000000c1'::uuid,
  '2032-05-11 18:00+00', '2032-05-11 19:00+00', 'confirmed', 'walk_in',
  'Andy', '+357 99 123 456', 6000, 6000, 0, 'standard'
);

-- 5. the same man three weeks later is the same contact, not a second
SELECT is(
  (SELECT count(*)::int FROM public.venue_contacts AS c
   WHERE c.venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid
     AND c.phone_e164 = '+35799123456'),
  1,
  'trigger: the same number typed differently is still one contact'
);

-- 6. and both bookings point at it
SELECT is(
  (SELECT count(DISTINCT b.contact_id)::int FROM public.bookings AS b
   WHERE b.id IN ('00000000-0000-4000-8000-0000000000d1'::uuid,
                  '00000000-0000-4000-8000-0000000000d2'::uuid)),
  1,
  'trigger: both walk-ins point at the one contact'
);

-- 7. the curated name survived the counter typing "Andy"
SELECT is(
  (SELECT c.display_name FROM public.venue_contacts AS c
   WHERE c.venue_id = '00000000-0000-4000-8000-0000000000b1'::uuid
     AND c.phone_e164 = '+35799123456'),
  'Ανδρέας — Τρίτη 20:00',
  'trigger: a name typed at the counter never overwrites a curated one'
);

-- 8. a walk-in with no usable number makes no contact — no key, no row
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, origin,
  walk_in_name, walk_in_phone,
  base_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000d3'::uuid, 'RLS-2032-C003',
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  '00000000-0000-4000-8000-0000000000c1'::uuid,
  '2032-05-18 18:00+00', '2032-05-18 19:00+00', 'confirmed', 'walk_in',
  'Academy U12', NULL, 6000, 6000, 0, 'standard'
);
SELECT is(
  (SELECT b.contact_id FROM public.bookings AS b
   WHERE b.id = '00000000-0000-4000-8000-0000000000d3'::uuid),
  NULL,
  'trigger: a walk-in with no number makes no contact'
);

-- 9. an app booking is never folded into a venue's list
SELECT is(
  (SELECT b.contact_id FROM public.bookings AS b
   WHERE b.id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  NULL,
  'trigger: an app booking has no venue contact'
);

-- 10. a booking cannot point at another venue's contact
INSERT INTO public.venue_contacts (id, venue_id, display_name, phone, source)
VALUES ('00000000-0000-4000-8000-0000000000d9'::uuid,
        '00000000-0000-4000-8000-0000000000b2'::uuid,
        'Someone Elsewhere', '99 555 000', 'manual');
SELECT throws_ok(
  $$INSERT INTO public.bookings (
      code, user_id, pitch_id, starts_at, ends_at, state, origin,
      walk_in_name, walk_in_phone, contact_id,
      base_price_cents, total_cents, platform_fee_cents, cancellation_policy
    ) VALUES (
      'RLS-2032-C004', '00000000-0000-4000-8000-0000000000a2'::uuid,
      '00000000-0000-4000-8000-0000000000c1'::uuid,
      '2032-05-25 18:00+00', '2032-05-25 19:00+00', 'confirmed', 'walk_in',
      'Someone Elsewhere', '99 555 000',
      '00000000-0000-4000-8000-0000000000d9'::uuid,
      6000, 6000, 0, 'standard')$$,
  '23514',
  NULL,
  'trigger: a booking cannot point at another venue''s contact'
);

-- 11. a series makes its contact, and its occurrence inherits it rather
--     than looking the number up again
INSERT INTO public.booking_series (
  id, venue_id, name, phone, weekdays, starts_time, duration_minutes,
  starts_on, created_by
) VALUES (
  '00000000-0000-4000-8000-0000000000d4'::uuid,
  '00000000-0000-4000-8000-0000000000b1'::uuid,
  'Κώστας', '99 777 888', ARRAY[2]::smallint[], '20:00', 60,
  '2032-06-01', '00000000-0000-4000-8000-0000000000a2'::uuid
);
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, origin,
  walk_in_name, walk_in_phone, series_id,
  base_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-0000000000d5'::uuid, 'RLS-2032-C005',
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  '00000000-0000-4000-8000-0000000000c1'::uuid,
  '2032-06-01 17:00+00', '2032-06-01 18:00+00', 'confirmed', 'walk_in',
  'Κώστας', '99 777 888', '00000000-0000-4000-8000-0000000000d4'::uuid,
  6000, 6000, 0, 'standard'
);
SELECT is(
  (SELECT b.contact_id FROM public.bookings AS b
   WHERE b.id = '00000000-0000-4000-8000-0000000000d5'::uuid),
  (SELECT s.contact_id FROM public.booking_series AS s
   WHERE s.id = '00000000-0000-4000-8000-0000000000d4'::uuid),
  'trigger: a series occurrence inherits its series'' contact'
);

-- ── Who reads the list ──────────────────────────────────────────────
-- 12. the owner lists his venue's contacts, and only his
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.venue_contacts),
  2,
  'owner: lists his venue''s two contacts, not venue_b''s'
);

-- 13. the manager lists NOTHING. This is the assertion that says the
--     counter finds a customer and does not download the list.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.venue_contacts),
  0,
  'manager: cannot list the contacts'
);

-- 14. but he finds Andreas by typing the Greek he'd say out loud, against
--     a name the owner curated in Greek — the typeahead's whole job
SELECT is(
  (SELECT s.phone_e164 FROM public.venue_contacts_search(
     '00000000-0000-4000-8000-0000000000b1'::uuid, 'Ανδρ') AS s),
  '+35799123456',
  'manager: search finds a contact by a Greek prefix'
);

-- 15. and by a Latin spelling of the same name
SELECT is(
  (SELECT s.phone_e164 FROM public.venue_contacts_search(
     '00000000-0000-4000-8000-0000000000b1'::uuid, 'andr') AS s),
  '+35799123456',
  'manager: search finds the same contact by a Latin prefix'
);

-- 16. and by digits of the number
SELECT is(
  (SELECT s.phone_e164 FROM public.venue_contacts_search(
     '00000000-0000-4000-8000-0000000000b1'::uuid, '777 8') AS s),
  '+35799777888',
  'manager: search finds a contact by digits of the number'
);

-- 17. a query that says nothing answers nothing — this is how a search
--     would become a list
SELECT is(
  (SELECT count(*)::int FROM public.venue_contacts_search(
     '00000000-0000-4000-8000-0000000000b1'::uuid, 'a')),
  0,
  'manager: a one-letter query returns nothing'
);

-- 18. he may add a regular — that is the day
SELECT isnt(
  public.venue_contact_create(
    '00000000-0000-4000-8000-0000000000b1'::uuid, 'Μαρία', '97 000 111', NULL),
  NULL,
  'manager: may add a contact'
);

-- 19. but not a second contact with a number the venue already has
SELECT throws_ok(
  $$SELECT public.venue_contact_create(
      '00000000-0000-4000-8000-0000000000b1'::uuid, 'Andreas again', '0035799123456', NULL)$$,
  '23505',
  NULL,
  'manager: a duplicate number is refused, not merged'
);

-- 20. and he may not delete one
SELECT throws_ok(
  $$SELECT public.venue_contact_delete(
      (SELECT id FROM public.venue_contacts_search(
         '00000000-0000-4000-8000-0000000000b1'::uuid, 'Ανδρ') LIMIT 1))$$,
  '42501',
  NULL,
  'manager: may not delete a contact'
);

-- 21. nor all of them
SELECT throws_ok(
  $$SELECT public.venue_contacts_delete_all('00000000-0000-4000-8000-0000000000b1'::uuid)$$,
  '42501',
  NULL,
  'manager: may not delete all contacts'
);

-- 22. a stranger cannot even search
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT throws_ok(
  $$SELECT * FROM public.venue_contacts_search(
      '00000000-0000-4000-8000-0000000000b1'::uuid, 'Ανδρ')$$,
  '42501',
  NULL,
  'stranger: cannot search another venue''s contacts'
);

-- ── Deleting is the owner's, and never deletes a booking ────────────
-- 23. the owner deletes the whole list — three: Andreas, Κώστας, Μαρία
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  public.venue_contacts_delete_all('00000000-0000-4000-8000-0000000000b1'::uuid),
  3,
  'owner: deletes all his venue''s contacts'
);

-- 24. and every booking survives it, with what was typed on the day
RESET ROLE;
SELECT is(
  (SELECT string_agg(b.walk_in_name || ':' || coalesce(b.contact_id::text, 'none'), ',' ORDER BY b.code)
   FROM public.bookings AS b
   WHERE b.id IN ('00000000-0000-4000-8000-0000000000d1'::uuid,
                  '00000000-0000-4000-8000-0000000000d2'::uuid)),
  'Andreas:none,Andy:none',
  'owner: deleting contacts keeps the bookings and their typed names'
);

SELECT * FROM finish();
ROLLBACK;
