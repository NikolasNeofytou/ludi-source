-- seed.sql
-- Applied after every `supabase db reset`.  Idempotent — rerunning does not
-- duplicate or break references.  NO personal data ever.
--
-- Layers:
--   1. Cities (reference table — always present)
--   2. Local-dev fixture venue + pitches + schedules so Discover renders
--      immediately after `supabase db reset`, no manual seeding required.
--      Production venues onboard via the admin flow, never via seed.
--
-- Fixture IDs are deterministic v4-shaped UUIDs in the 00000000-0000-4000-8000-…
-- namespace so reruns are stable and referenced cleanly from tests.

-- ────────────────────────────────────────────────────────────────────
-- 1. Cities (enable Larnaca; other cities staged for later)
-- ────────────────────────────────────────────────────────────────────
INSERT INTO public.cities (code, name_en, name_gr, is_enabled, display_order)
VALUES
  ('larnaca',   'Larnaca',   'Λάρνακα',   TRUE,  1),
  ('nicosia',   'Nicosia',   'Λευκωσία',  FALSE, 2),
  ('limassol',  'Limassol',  'Λεμεσός',   FALSE, 3),
  ('paphos',    'Paphos',    'Πάφος',     FALSE, 4),
  ('ayia_napa', 'Ayia Napa', 'Αγία Νάπα', FALSE, 5)
ON CONFLICT (code) DO UPDATE
  SET name_en       = excluded.name_en,
      name_gr       = excluded.name_gr,
      display_order = excluded.display_order;
-- Deliberately DO NOT touch is_enabled on conflict.  Once Larnaca is live,
-- reseeding must not toggle a city off; that's an ops action, not a schema one.

-- ────────────────────────────────────────────────────────────────────
-- 2. Local-dev fixture venue + pitches
-- ────────────────────────────────────────────────────────────────────
-- One Larnaca venue with three pitches of varied type/surface/price so the
-- Discover screen has content to filter across.  stripe_account_status is
-- pinned to 'active' so pitches can be is_verified=true and therefore
-- bookable without an owner-onboarding flow (M5 handles that).
--
-- Fake Stripe account id — a real create-booking call against this venue
-- will fail at Stripe, which is expected behaviour in local dev without
-- real keys.  For an end-to-end smoke test, replace stripe_account_id via
-- Studio with an actual test account's id.

INSERT INTO public.venues (
  id, name, address, city_id, coords,
  contact_phone, contact_email,
  stripe_account_id, stripe_account_status,
  take_rate_bps, cancellation_policy, slug
) VALUES (
  '00000000-0000-4000-8000-000000000100',
  'Larnaca Sportsplex',
  '1 Leoforos Makariou III, 6017 Larnaca, Cyprus',
  (SELECT id FROM public.cities WHERE code = 'larnaca'),
  ST_SetSRID(ST_MakePoint(33.6219, 34.9229), 4326)::geography,
  '+357 24 000 000',
  'hello@larnaca-sportsplex.local',
  'acct_seed_larnaca_fixture',
  'active',
  1000,          -- 10% take rate (default)
  'standard',
  'larnaca-sportsplex' -- the venue's own page, ludi.football/v/<slug> (reach R1)
)
ON CONFLICT (id) DO UPDATE
  SET name                   = excluded.name,
      address                = excluded.address,
      city_id                = excluded.city_id,
      coords                 = excluded.coords,
      contact_phone          = excluded.contact_phone,
      contact_email          = excluded.contact_email,
      stripe_account_status  = excluded.stripe_account_status,
      take_rate_bps          = excluded.take_rate_bps,
      cancellation_policy    = excluded.cancellation_policy,
      slug                   = excluded.slug;
-- Deliberately NOT updating stripe_account_id on conflict: devs often swap
-- this field in Studio for a real Stripe test account so create-booking can
-- reach Stripe end-to-end. Overwriting on every seed rerun would clobber
-- that local customization. Fixture value only seeds on first insert.

-- Three pitches: MVP filter UI has chips for type and surface, so the seed
-- covers each variant so the filter reductions are visibly meaningful.
INSERT INTO public.pitches (
  id, venue_id, name, type, surface, price_per_hour_cents, amenities, is_verified
) VALUES
  ('00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000100',
   'Pitch 1 — Main turf',
   '7-a-side', 'turf', 4500,
   ARRAY['Showers','Parking','Lights','Ball rental'],
   TRUE),
  ('00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000100',
   'Pitch 2 — Indoor',
   '5-a-side', 'indoor', 3500,
   ARRAY['Showers','Parking','Ball rental'],
   TRUE),
  ('00000000-0000-4000-8000-000000000103',
   '00000000-0000-4000-8000-000000000100',
   'Pitch 3 — Grass',
   '11-a-side', 'grass', 6000,
   ARRAY['Showers','Parking','Lights'],
   TRUE)
ON CONFLICT (id) DO UPDATE
  SET venue_id             = excluded.venue_id,
      name                 = excluded.name,
      type                 = excluded.type,
      surface              = excluded.surface,
      price_per_hour_cents = excluded.price_per_hour_cents,
      amenities            = excluded.amenities,
      is_verified          = excluded.is_verified;
-- venue_id included so a fixture pitch accidentally moved to another venue
-- (manually in Studio) self-heals on reseed. The CI sanity check asserts
-- 3 pitches at the fixture venue_id; without this, reseeding wouldn't undo
-- the drift.

-- Weekly schedules: 60-min slots for the three seeded pitches.
--   Pitch 1 (turf):   Mon–Sat 09:00–23:00, Sun 09:00–22:00 (early close).
--   Pitch 2 (indoor): every day  08:00–23:00.
--   Pitch 3 (grass):  Tue–Sun  10:00–22:00 (closed Mondays).
--
-- pitch_schedules has NO unique constraint on (pitch_id, day_of_week)
-- because the schema allows split windows, so we DELETE-then-INSERT by
-- the known fixture pitch ids rather than use ON CONFLICT.
DELETE FROM public.pitch_schedules
  WHERE pitch_id IN (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000103'
  );

INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at, slot_duration_minutes)
SELECT pitch_id, dow, opens, closes, 60
FROM (VALUES
  -- Pitch 1 (main turf) — Mon..Sun 09:00–23:00
  ('00000000-0000-4000-8000-000000000101'::uuid, 1, time '09:00', time '23:00'),
  ('00000000-0000-4000-8000-000000000101'::uuid, 2, time '09:00', time '23:00'),
  ('00000000-0000-4000-8000-000000000101'::uuid, 3, time '09:00', time '23:00'),
  ('00000000-0000-4000-8000-000000000101'::uuid, 4, time '09:00', time '23:00'),
  ('00000000-0000-4000-8000-000000000101'::uuid, 5, time '09:00', time '23:00'),
  ('00000000-0000-4000-8000-000000000101'::uuid, 6, time '09:00', time '23:00'),
  ('00000000-0000-4000-8000-000000000101'::uuid, 0, time '09:00', time '22:00'),
  -- Pitch 2 (indoor) — longer days, every day
  ('00000000-0000-4000-8000-000000000102'::uuid, 1, time '08:00', time '23:00'),
  ('00000000-0000-4000-8000-000000000102'::uuid, 2, time '08:00', time '23:00'),
  ('00000000-0000-4000-8000-000000000102'::uuid, 3, time '08:00', time '23:00'),
  ('00000000-0000-4000-8000-000000000102'::uuid, 4, time '08:00', time '23:00'),
  ('00000000-0000-4000-8000-000000000102'::uuid, 5, time '08:00', time '23:00'),
  ('00000000-0000-4000-8000-000000000102'::uuid, 6, time '08:00', time '23:00'),
  ('00000000-0000-4000-8000-000000000102'::uuid, 0, time '08:00', time '23:00'),
  -- Pitch 3 (grass 11-a-side) — closed Mondays, reduced hours elsewhere
  ('00000000-0000-4000-8000-000000000103'::uuid, 2, time '10:00', time '22:00'),
  ('00000000-0000-4000-8000-000000000103'::uuid, 3, time '10:00', time '22:00'),
  ('00000000-0000-4000-8000-000000000103'::uuid, 4, time '10:00', time '22:00'),
  ('00000000-0000-4000-8000-000000000103'::uuid, 5, time '10:00', time '22:00'),
  ('00000000-0000-4000-8000-000000000103'::uuid, 6, time '10:00', time '22:00'),
  ('00000000-0000-4000-8000-000000000103'::uuid, 0, time '10:00', time '22:00')
) AS v(pitch_id, dow, opens, closes);

-- One sample schedule override to exercise the override code path:
-- Pitch 1 closed on 2026-12-25 for Christmas.
--
-- Delete-then-insert rather than ON CONFLICT: M6 #41b replaced
-- UNIQUE (pitch_id, override_date) with an exclusion constraint so a date
-- can carry several non-overlapping windows, and ON CONFLICT cannot use an
-- exclusion constraint as its arbiter. This keeps the seed re-runnable.
DELETE FROM public.pitch_schedule_overrides
WHERE pitch_id = '00000000-0000-4000-8000-000000000101'
  AND override_date = '2026-12-25';

INSERT INTO public.pitch_schedule_overrides (pitch_id, override_date, is_closed, reason)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  '2026-12-25',
  TRUE,
  'Christmas Day — closed'
)
;

-- ────────────────────────────────────────────────────────────────────
-- 3. Nicosia sales-demo fixtures (the 18 venues from the visit plan)
-- ────────────────────────────────────────────────────────────────────
-- Source: docs/plans/Nicosia/nicosia-visit-plan.pdf (desk scan 2026-08-25).
-- Purpose: walk into a venue on the sales round and show the manager their
-- own venue inside Discover — real name, real district, real pitch mix and
-- published prices where the scan found them.
--
-- These are UNQUALIFIED PROSPECTS, not partners. They exist only in local
-- dev (seed.sql never runs against the hosted project); onboarding a real
-- signed venue still goes through the admin flow.
--
-- Data honesty:
--   · Pitch counts/formats follow the scan where published; single-court
--     defaults where the scan says "needs visit to qualify".
--   · Prices are the published ones where known (City Fields €60, PAEEK €60,
--     Strovolos SC €50, DAKA €40); everything else is a plausible placeholder
--     inside the €40–60 Nicosia band the scan established.
--   · Coords are district-level, good enough for the Discover map, not for
--     navigation. Contact details are fakes — the real ones are personal
--     mobiles and seed.sql carries no personal data.
--
-- ID namespace: venues …-0000000002VV, pitches …-00000003VVPP, where VV is
-- the venue's stop number (01–18) in the visit plan and PP the pitch number.

-- Nicosia must be enabled or Discover never shows the chip. Local-only
-- flip; the hosted project's cities row is untouched by definition.
UPDATE public.cities SET is_enabled = TRUE WHERE code = 'nicosia';

INSERT INTO public.venues (
  id, name, address, city_id, coords,
  contact_phone, contact_email,
  stripe_account_id, stripe_account_status,
  take_rate_bps, cancellation_policy
)
SELECT
  format('00000000-0000-4000-8000-0000000002%s', lpad(v.idx::text, 2, '0'))::uuid,
  v.name,
  v.address,
  (SELECT id FROM public.cities WHERE code = 'nicosia'),
  ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326)::geography,
  format('+357 22 000 0%s', lpad(v.idx::text, 2, '0')),
  format('demo-%s@nicosia-fixture.local', lpad(v.idx::text, 2, '0')),
  format('acct_seed_nicosia_%s', lpad(v.idx::text, 2, '0')),
  'active',
  1000,
  'standard'
FROM (VALUES
  ( 1, 'Alion Park',                     'Dali–Nisou, Nicosia, Cyprus',                 33.4200, 35.0200),
  ( 2, 'Municipal Futsal Tseri',         'Tseri, Nicosia, Cyprus',                      33.3200, 35.0700),
  ( 3, 'Nuevo Campo',                    'Latsia, Nicosia, Cyprus',                     33.3750, 35.1050),
  ( 4, 'City Fields',                    'Strovolos, Nicosia, Cyprus',                  33.3480, 35.1330),
  ( 5, 'Selecao FA',                     'Valtsetsiou, Nicosia centre, Cyprus',         33.3600, 35.1700),
  ( 6, 'Strovolos Sport Center',         'Glafkos Clerides Centre, Strovolos, Cyprus',  33.3400, 35.1350),
  ( 7, 'Central Park Futsal',            'English School Park, Nicosia, Cyprus',        33.3790, 35.1660),
  ( 8, 'The GCS Sports Centre',          'Strovolos, Nicosia, Cyprus',                  33.3300, 35.1400),
  ( 9, 'ETHA Engomi Futsal',             'Grigori Afxentiou 52, Engomi, Cyprus',        33.3240, 35.1660),
  (10, 'goAll Padel Centers Nicosia',    'Strovolos, Nicosia, Cyprus',                  33.3500, 35.1200),
  (11, 'Wembley Futsal Fields',          'Kifea, Lakatamia, Cyprus',                    33.3030, 35.1060),
  (12, 'PAEEK Kerynia Sports Center',    'Kifea 1, Lakatamia, Cyprus',                  33.3030, 35.1040),
  (13, 'Futsal Time THOI',               'Lakatamia, Nicosia, Cyprus',                  33.2950, 35.1100),
  (14, 'Campeone Mini Football',         'Anthoupoli, Nicosia, Cyprus',                 33.2880, 35.1220),
  (15, 'Spazio Padel',                   'Anthoupoli road, Nicosia, Cyprus',            33.2800, 35.1300),
  (16, 'Da Luz Soccer Fields',           'Kato Deftera, Nicosia, Cyprus',               33.2570, 35.0990),
  (17, 'Ararat Futsal Arena',            'Kyrenias 200, Aglantzia, Cyprus',             33.3970, 35.1530),
  (18, 'DAKA Aglantzia',                 'Aglantzia, Nicosia, Cyprus',                  33.4100, 35.1450)
) AS v(idx, name, address, lon, lat)
ON CONFLICT (id) DO UPDATE
  SET name                  = excluded.name,
      address               = excluded.address,
      city_id               = excluded.city_id,
      coords                = excluded.coords,
      contact_phone         = excluded.contact_phone,
      contact_email         = excluded.contact_email,
      stripe_account_status = excluded.stripe_account_status,
      take_rate_bps         = excluded.take_rate_bps,
      cancellation_policy   = excluded.cancellation_policy;

-- Pitch specs: (venue idx, first court number, how many, type, surface,
-- price in cents, amenities). Multiple rows per venue express a mixed
-- format inventory (e.g. City Fields: 3× 5v5 + the 9v9 hall).
INSERT INTO public.pitches (
  id, venue_id, name, type, surface, price_per_hour_cents, amenities, is_verified
)
SELECT
  format('00000000-0000-4000-8000-00000003%s%s',
         lpad(s.vidx::text, 2, '0'), lpad((s.start_n + i)::text, 2, '0'))::uuid,
  format('00000000-0000-4000-8000-0000000002%s', lpad(s.vidx::text, 2, '0'))::uuid,
  format('Court %s', s.start_n + i),
  s.ptype, s.surface, s.price, s.amenities,
  TRUE
FROM (VALUES
  ( 1, 1,  2, '5-a-side',  'turf',   5000, ARRAY['Lights','Parking','Ball rental']),
  ( 2, 1,  1, '5-a-side',  'turf',   4000, ARRAY['Lights','Ball rental']),
  ( 3, 1, 11, '5-a-side',  'turf',   5000, ARRAY['Lights','Parking','Showers','Ball rental']),
  ( 4, 1,  3, '5-a-side',  'indoor', 6000, ARRAY['Showers','Parking','Lights','Ball rental']),
  ( 4, 4,  1, '11-a-side', 'indoor', 9000, ARRAY['Showers','Parking','Lights','Ball rental']),
  ( 5, 1,  1, '5-a-side',  'indoor', 4500, ARRAY['Ball rental']),
  ( 6, 1,  4, '5-a-side',  'turf',   5000, ARRAY['Showers','Parking','Lights','Ball rental']),
  ( 7, 1,  6, '5-a-side',  'turf',   5000, ARRAY['Parking','Lights','Ball rental']),
  ( 7, 7,  2, '7-a-side',  'turf',   7000, ARRAY['Parking','Lights','Ball rental']),
  ( 7, 9,  2, '11-a-side', 'turf',  11000, ARRAY['Parking','Lights','Ball rental']),
  ( 8, 1,  2, '5-a-side',  'turf',   5000, ARRAY['Showers','Parking','Lights','Ball rental']),
  ( 9, 1,  2, '5-a-side',  'turf',   4500, ARRAY['Lights','Ball rental']),
  (10, 1,  1, '5-a-side',  'turf',   4000, ARRAY['Parking','Lights','Ball rental']),
  (11, 1,  1, '5-a-side',  'turf',   4500, ARRAY['Lights','Ball rental']),
  (12, 1,  2, '5-a-side',  'turf',   6000, ARRAY['Showers','Parking','Lights','Ball rental']),
  (12, 3,  1, '7-a-side',  'turf',   8000, ARRAY['Showers','Parking','Lights','Ball rental']),
  (13, 1,  3, '5-a-side',  'turf',   5000, ARRAY['Lights','Parking','Ball rental']),
  (14, 1,  7, '5-a-side',  'turf',   4500, ARRAY['Lights','Parking','Ball rental']),
  (14, 8,  3, '7-a-side',  'turf',   6500, ARRAY['Lights','Parking','Ball rental']),
  (14,11,  2, '11-a-side', 'turf',  10000, ARRAY['Lights','Parking','Ball rental']),
  (15, 1,  1, '5-a-side',  'turf',   4500, ARRAY['Showers','Parking','Ball rental']),
  (16, 1,  2, '5-a-side',  'turf',   4000, ARRAY['Lights','Ball rental']),
  (17, 1,  1, '5-a-side',  'indoor', 4500, ARRAY['Ball rental']),
  (18, 1,  2, '5-a-side',  'turf',   4000, ARRAY['Parking','Lights','Ball rental'])
) AS s(vidx, start_n, cnt, ptype, surface, price, amenities)
CROSS JOIN LATERAL generate_series(0, s.cnt - 1) AS i
ON CONFLICT (id) DO UPDATE
  SET venue_id             = excluded.venue_id,
      name                 = excluded.name,
      type                 = excluded.type,
      surface              = excluded.surface,
      price_per_hour_cents = excluded.price_per_hour_cents,
      amenities            = excluded.amenities,
      is_verified          = excluded.is_verified;

-- Weekly schedules: uniform daily hours per venue (the scan's published
-- hours where known — Alion 10:00, Nuevo Campo/City Fields from 15:00,
-- GCS from 07:00, Ararat from 17:00). Delete-then-insert by the fixture
-- venue namespace, same reasoning as the Larnaca fixture above.
DELETE FROM public.pitch_schedules
WHERE pitch_id IN (
  SELECT p.id FROM public.pitches p
  WHERE p.venue_id::text LIKE '00000000-0000-4000-8000-0000000002%'
);

INSERT INTO public.pitch_schedules (pitch_id, day_of_week, opens_at, closes_at, slot_duration_minutes)
SELECT p.id, d.dow, h.opens, h.closes, 60
FROM (VALUES
  ( 1, time '10:00', time '23:00'),
  ( 2, time '09:00', time '22:00'),
  ( 3, time '15:00', time '23:00'),
  ( 4, time '15:00', time '23:00'),
  ( 5, time '16:00', time '22:00'),
  ( 6, time '09:00', time '23:00'),
  ( 7, time '09:00', time '23:00'),
  ( 8, time '07:00', time '23:00'),
  ( 9, time '16:00', time '23:00'),
  (10, time '09:00', time '23:00'),
  (11, time '16:00', time '22:00'),
  (12, time '09:00', time '23:00'),
  (13, time '15:00', time '23:00'),
  (14, time '09:00', time '23:00'),
  (15, time '09:00', time '23:00'),
  (16, time '16:00', time '22:00'),
  (17, time '17:00', time '23:00'),
  (18, time '09:00', time '22:00')
) AS h(vidx, opens, closes)
JOIN public.pitches p
  ON p.venue_id = format('00000000-0000-4000-8000-0000000002%s',
                         lpad(h.vidx::text, 2, '0'))::uuid
CROSS JOIN generate_series(0, 6) AS d(dow);
