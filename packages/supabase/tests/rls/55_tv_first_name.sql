-- 55_tv_first_name.sql — whose court it is, on the lobby screen (20261016000006, ADR-0054)
-- Under test:
--   public_venue_schedule: today, a walk-in carries the first word of its
--     name and an app booking its player's first name; no surname, phone or
--     user id; any other day carries no `who` at all; an anonymised player
--     reads NULL
--   display_first_name (20261021000101, audit C5): a name is letters in any
--     script — Greek survives — with one internal hyphen or apostrophe at
--     most; links, emoji, controls and bidi characters do not reach the
--     screen; 24 characters; capitalised; whatever the database's collation.
--     Clients cannot call it. functions/_tests/display-name.test.ts pins the
--     same cases on the TypeScript copy of the rule.
--
-- Fixtures: a2 owns venue_a (b1) with c1 and c2; a4 is a player ('Other User').
-- Dates: the Cyprus today, not current_date, and three days out.
BEGIN;
SELECT plan(14);

CREATE TEMP TABLE t_ctx AS
SELECT (now() AT TIME ZONE 'Europe/Nicosia')::date AS d,
       ((now() AT TIME ZONE 'Europe/Nicosia')::date + 3) AS later;
GRANT SELECT ON t_ctx TO anon, authenticated;

RESET ROLE;
-- t1: today's walk-in, typed with a surname and a phone
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, origin, walk_in_name, walk_in_phone,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
)
SELECT v.id::uuid, v.code, '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c1',
  (v.day + time '22:00') AT TIME ZONE 'Europe/Nicosia', (v.day + time '23:00') AT TIME ZONE 'Europe/Nicosia',
  'confirmed', 'walk_in', '  Σώζος   Παπαδόπουλος ', '+35799000055', 6000, 0, 6000, 0, 'standard'
FROM t_ctx, LATERAL (VALUES
  ('00000000-0000-4000-8000-00000000f501', 'RLS-2030-5501', d),
  -- t3: the same walk-in three days out
  ('00000000-0000-4000-8000-00000000f503', 'RLS-2030-5503', later)
) AS v (id, code, day);

-- t2: today's app booking by a4
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
)
SELECT '00000000-0000-4000-8000-00000000f502', 'RLS-2030-5502', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2',
  (d + time '22:00') AT TIME ZONE 'Europe/Nicosia', (d + time '23:00') AT TIME ZONE 'Europe/Nicosia',
  'confirmed', 4000, 0, 4000, 400, 'standard'
FROM t_ctx;

SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
CREATE TEMP TABLE t_tok AS SELECT public.venue_display_token('00000000-0000-4000-8000-0000000000b1') AS tok;
GRANT SELECT ON t_tok TO anon, authenticated;

SELECT public.set_test_anon();
CREATE TEMP TABLE t_day AS
SELECT i AS item FROM t_ctx, jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_tok), d) -> 'items') AS i;
CREATE TEMP TABLE t_later AS
SELECT i AS item FROM t_ctx, jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_tok), later) -> 'items') AS i;

-- 1. the walk-in: its first word, trimmed
SELECT is(
  (SELECT item ->> 'who' FROM t_day, t_ctx
    WHERE item ->> 'pitch_id' = '00000000-0000-4000-8000-0000000000c1'
      AND (item ->> 'starts_at')::timestamptz = (d + time '22:00') AT TIME ZONE 'Europe/Nicosia'),
  'Σώζος',
  'tv: a walk-in shows the first word of its name'
);

-- 2. the app booking: the player's first name
SELECT is(
  (SELECT item ->> 'who' FROM t_day, t_ctx
    WHERE item ->> 'pitch_id' = '00000000-0000-4000-8000-0000000000c2'
      AND (item ->> 'starts_at')::timestamptz = (d + time '22:00') AT TIME ZONE 'Europe/Nicosia'),
  'Other',
  'tv: an app booking shows its player''s first name'
);

-- 3. no surname, phone or user id anywhere on the day
SELECT is(
  (SELECT count(*) FROM t_day
    WHERE item::text LIKE '%Παπαδόπουλος%' OR item::text LIKE '%User%'
       OR item::text LIKE '%99000055%' OR item::text LIKE '%0000000000a4%'),
  0::bigint,
  'tv: no surname, phone or user id'
);

-- 4. any other day carries no name
SELECT is(
  (SELECT count(*) FROM t_later WHERE item ->> 'who' IS NOT NULL),
  0::bigint,
  'tv: another day names no one'
);
SELECT is(
  (SELECT count(*) FROM t_later
    WHERE item ->> 'pitch_id' = '00000000-0000-4000-8000-0000000000c1' AND item ->> 'kind' = 'booked'),
  1::bigint,
  'tv: another day still shows the booking as booked'
);

-- ── display_first_name (audit C5) ───────────────────────────────────
RESET ROLE;

-- 5. Greek survives, capitalised with its final sigma
SELECT is(
  ARRAY[
    public.display_first_name('Σώζος'),
    public.display_first_name('ΣΩΖΟΣ'),
    public.display_first_name('σώζος'),
    public.display_first_name('Анна')
  ],
  ARRAY['Σώζος', 'Σωζος', 'Σώζος', 'Анна'],
  'display_first_name: Greek and Cyrillic names are kept and capitalised'
);

-- 6. a link is cut at its first dot, slash or colon
SELECT is(
  ARRAY[
    public.display_first_name('scam-site.cy/win'),
    public.display_first_name('www.ludi-prize.com'),
    public.display_first_name('https://scam.cy')
  ],
  ARRAY['Scam-Site', 'Www', 'Https'],
  'display_first_name: a URL never reaches the screen'
);

-- 7. emoji go; only emoji is NULL
SELECT is(
  ARRAY[
    public.display_first_name('🔥🔥 Maria 🔥'),
    public.display_first_name('Maria😀'),
    public.display_first_name('😀😀😀'),
    public.display_first_name('12345'),
    public.display_first_name('   ')
  ],
  ARRAY['Maria', 'Maria', NULL, NULL, NULL],
  'display_first_name: emoji and digits go, and nothing left is NULL'
);

-- 8. bidi and control characters are removed without splitting the name
SELECT is(
  ARRAY[
    public.display_first_name(E'\u202Eniw/yc.mac'),
    public.display_first_name(E'\u2066Anna\u2069'),
    public.display_first_name(E'\u200FMaria\u200E'),
    public.display_first_name(E'Ma\u200Bria'),
    public.display_first_name(E'An\u0007na')
  ],
  ARRAY['Niw', 'Anna', 'Maria', 'Maria', 'Anna'],
  'display_first_name: bidi, zero-width and control characters go'
);

-- 9. one internal hyphen or apostrophe; 24 characters
SELECT is(
  ARRAY[
    public.display_first_name('jean-luc'),
    public.display_first_name('o''brien'),
    public.display_first_name('Anne--Marie'),
    public.display_first_name('McKenzie'),
    public.display_first_name('Abcdefghijklmnopqrstuvwxyzabcdef')
  ],
  ARRAY['Jean-Luc', 'O''Brien', 'Anne', 'McKenzie', 'Abcdefghijklmnopqrstuvwx'],
  'display_first_name: one joiner at most, 24 characters, mixed case kept'
);

-- 10. letters are letters under any input collation, "C" included
SELECT is(
  public.display_first_name('Σώζος' COLLATE "C"),
  'Σώζος',
  'display_first_name: Greek survives a C-collated input'
);

-- 11. the clients cannot call it; the screen calls it as its owner
SELECT is(
  ARRAY[
    has_function_privilege('anon', 'public.display_first_name(text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.display_first_name(text)', 'EXECUTE')
  ],
  ARRAY[FALSE, FALSE],
  'display_first_name: no EXECUTE for anon or authenticated'
);

-- 12. on the screen: a player's "first name" with an override, a link and
--     an emoji shows as a name
UPDATE public.users SET first_name = E'\u202Escam-site.cy/win 🔥'
WHERE id = '00000000-0000-4000-8000-0000000000a4';
SELECT public.set_test_anon();
SELECT is(
  (SELECT i ->> 'who' FROM t_ctx, jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_tok), d) -> 'items') AS i
    WHERE i ->> 'pitch_id' = '00000000-0000-4000-8000-0000000000c2'
      AND (i ->> 'starts_at')::timestamptz = (d + time '22:00') AT TIME ZONE 'Europe/Nicosia'),
  'Scam-Site',
  'tv: a player''s first name reaches the screen as letters only'
);

-- 13. an anonymised player reads NULL
RESET ROLE;
UPDATE public.users SET anonymized_at = now() WHERE id = '00000000-0000-4000-8000-0000000000a4';
SELECT public.set_test_anon();
SELECT is(
  (SELECT i ->> 'who' FROM t_ctx, jsonb_array_elements(public.public_venue_schedule((SELECT tok FROM t_tok), d) -> 'items') AS i
    WHERE i ->> 'pitch_id' = '00000000-0000-4000-8000-0000000000c2'
      AND (i ->> 'starts_at')::timestamptz = (d + time '22:00') AT TIME ZONE 'Europe/Nicosia'),
  NULL,
  'tv: an anonymised player is named by no one'
);

SELECT * FROM finish();
ROLLBACK;
