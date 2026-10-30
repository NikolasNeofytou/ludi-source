-- 20261021000101_lobby_names_are_names.sql
-- The lobby screen shows a first name, and only a name (pre-public security
-- audit 2026-10-19, C5).
--
-- Since 20261016000006 each of today's bookings on the screen carries `who`:
-- the first word of the name on the booking. A player types their own first
-- name, and the screen hangs in a public lobby, so today "scam-site.cy/win",
-- a row of emoji or a right-to-left override shows on the venue's TV under
-- the venue's name. A first word is not yet a first name.
--
-- display_first_name() makes it one. The rule, the same one
-- functions/_shared/display-name.ts applies to the names in a player's
-- notices:
--
--   1. NFKC first: styled and full-width letters fold to plain ones;
--   2. control and format characters are removed — bidi embeddings,
--      overrides and isolates (U+202A–202E, U+2066–2069), LRM/RLM
--      (U+200E/F), zero-widths, the soft hyphen — so they neither reorder
--      the line nor split a word;
--   3. the first run of letters, any script (Unicode Alphabetic: Greek,
--      Latin and Cyrillic alike), with at most one hyphen or apostrophe
--      inside it. A space, dot, slash, digit or emoji ends it, so
--      "scam-site.cy/win" shows "Scam-Site";
--   4. at most 24 characters;
--   5. typed all in capitals or all in small letters, it is capitalised
--      (ΣΩΖΟΣ → Σωζος, with the final sigma); mixed case keeps its letters
--      with a capital first.
--
-- Nothing left is NULL, and the screen shows Κρατημένο as for an anonymised
-- player.
--
-- Letters (and lower/upper/initcap) are judged under the ICU collation
-- "und-x-icu", named in the function, not under the database's default:
-- under "C" [[:alpha:]] is ASCII-only and would turn every Greek name into
-- NULL. ICU classifies by Unicode whatever locale the cluster was made
-- with, and it exists on Postgres 15 (the local stack and E2E, per
-- config.toml) as well as 17 (prod, the dry-run). pg_c_utf8 would be the
-- 17-only builtin equivalent; it broke the PG15 stack.
--
-- The walk-in name the counter types goes through the same rule: the screen
-- shows one kind of name.
--
-- What is NOT changed, after reading what the screen asks for
-- (apps/admin/app/tv/[token], components/tv-screen.tsx):
--   - the day window stays today−1 … today+31. The TV itself asks for
--     today; the other caller is the printed CFA programme, whose QR opens
--     the screen on the round's day (`?day=`), and rounds are loaded and
--     printed up to weeks ahead (tests 35 and 54 read +7 … +27). Another day
--     carries no name since 20261016000006: booked blocks, open-seat counts
--     and CFA fixtures, which get_available_slots and venue_open_games
--     already answer to anyone.
--   - `join` stays for every listed fixture on the day read. The CFA view
--     shows the want card on whatever day it is opened at, and the same
--     invite tokens are public through venue_open_games(slug) (ADR-0056)
--     for every open fixture at the venue.
--
-- Everything else is 20261021000001 verbatim (the Strava Wave 1 version:
-- a player who turned show_name_on_screens off is never named, #360);
-- CREATE OR REPLACE keeps the
-- function's grants.

-- ════════════════════════════════════════════════════════════════════
-- 1. display_first_name
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.display_first_name(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v text COLLATE "und-x-icu";
  j text;
  p1 text;
  p2 text;
BEGIN
  IF p_name IS NULL THEN
    RETURN NULL;
  END IF;
  -- 1–2. fold, then drop controls and format characters
  v := regexp_replace(
    normalize(p_name, NFKC),
    '[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\U000E0000-\U000E007F]',
    '',
    'g'
  );
  -- 3. the first run of letters, one internal hyphen or apostrophe at most
  v := (regexp_match(v, '[[:alpha:]]+(?:[''\u2019-][[:alpha:]]+)?'))[1];
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  -- 4. one kind of apostrophe, 24 characters, never ending on a joiner
  v := rtrim(left(replace(v, U&'\2019', ''''), 24), '''-');
  -- 5. capitals: typed all small or all capital, a capital starts each part
  --    either side of the joiner (jean-luc → Jean-Luc, o'brien → O'Brien),
  --    the same rule as display-name.ts. Not initcap(): under ICU it reads
  --    the apostrophe as part of the word and gives O'brien.
  IF v = lower(v) OR v = upper(v) THEN
    v := lower(v);
    j := substring(v FROM '[''-]');
    IF j IS NULL THEN
      v := upper(left(v, 1)) || substr(v, 2);
    ELSE
      p1 := split_part(v, j, 1);
      p2 := split_part(v, j, 2);
      v := upper(left(p1, 1)) || substr(p1, 2) || j || upper(left(p2, 1)) || substr(p2, 2);
    END IF;
  ELSE
    v := upper(left(v, 1)) || substr(v, 2);
  END IF;
  RETURN regexp_replace(v, 'σ(?=$|[''-])', 'ς', 'g');
END;
$$;

COMMENT ON FUNCTION public.display_first_name(text) IS
'A name to show other people (audit 2026-10-19, C5): the first run of letters '
'in any script, one internal hyphen or apostrophe at most, no controls or bidi '
'characters, 24 characters, capitalised; NULL when nothing is left. The same '
'rule as functions/_shared/display-name.ts.';

-- Called from definer bodies (the owner's EXECUTE), never from a client.
REVOKE ALL ON FUNCTION public.display_first_name(text) FROM public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2. public_venue_schedule: `who` through display_first_name
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.public_venue_schedule(p_token text, p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today  date := (now() AT TIME ZONE 'Europe/Nicosia')::date;
  v_date   date := coalesce(p_date, v_today);
  v_venue  record;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 32 THEN
    RETURN NULL;
  END IF;
  SELECT v.id, v.name, v.slug INTO v_venue
  FROM public.venue_displays AS d
  INNER JOIN public.venues AS v ON v.id = d.venue_id
  WHERE d.token = p_token AND v.is_active;
  IF v_venue.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_date NOT BETWEEN v_today - 1 AND v_today + 31 THEN
    v_date := v_today;
  END IF;

  RETURN jsonb_build_object(
    'venue', v_venue.name,
    'slug', v_venue.slug,
    'date', v_date,
    'courts', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'type', p.type,
          'parts', coalesce((
            SELECT jsonb_agg(c.child_pitch_id)
            FROM public.pitch_components AS c
            WHERE c.parent_pitch_id = p.id
          ), '[]'::jsonb)
        ) ORDER BY p.name
      )
      FROM public.pitches AS p
      WHERE p.venue_id = v_venue.id AND p.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'pitch_id', b.pitch_id,
          'starts_at', b.starts_at,
          'ends_at', b.ends_at,
          'kind', CASE WHEN m.id IS NULL THEN 'booked' ELSE 'cfa' END,
          'category', m.category,
          'home', m.home_team,
          'away', m.away_team,
          'round', m.round_label,
          'status', m.status,
          'open_gk', CASE WHEN w.listed THEN w.gk_open END,
          'open_outfield', CASE WHEN w.listed THEN w.outfield_open END,
          'share_cents', CASE WHEN w.listed AND b.is_split THEN b.share_amount_cents END,
          'join', CASE WHEN w.listed THEN b.invite_token END,
          'who', CASE
            WHEN m.id IS NOT NULL OR v_date <> v_today THEN NULL
            WHEN b.origin = 'walk_in' THEN public.display_first_name(b.walk_in_name)
            WHEN u.anonymized_at IS NULL AND u.show_name_on_screens THEN public.display_first_name(u.first_name)
          END
        ) ORDER BY b.starts_at, b.pitch_id
      )
      FROM public.bookings AS b
      INNER JOIN public.pitches AS p ON p.id = b.pitch_id
      LEFT JOIN public.cfa_matches AS m ON m.booking_id = b.id
      LEFT JOIN public.users AS u ON u.id = b.user_id AND b.origin <> 'walk_in'
      CROSS JOIN LATERAL (
        SELECT
          s.gk_open,
          s.outfield_open,
          (
            b.is_open
            AND b.state IN ('collecting', 'paid', 'confirmed')
            AND b.starts_at > now()
            AND (s.gk_open > 0 OR s.outfield_open > 0)
          ) AS listed
        FROM (
          SELECT
            coalesce(b.gk_slots, 0)
            - count(*) FILTER (WHERE x.slot_kind = 'gk' AND x.replacing_since IS NULL)::int AS gk_open,
            coalesce(b.outfield_slots, 0)
            - count(*) FILTER (WHERE x.slot_kind = 'outfield' AND x.replacing_since IS NULL)::int AS outfield_open
          FROM public.booking_participants AS x
          WHERE x.booking_id = b.id AND x.status = 'in'
        ) AS s
      ) AS w
      WHERE p.venue_id = v_venue.id
        AND p.is_active
        AND b.state IN ('pending', 'collecting', 'paid', 'confirmed', 'completed')
        AND (b.starts_at AT TIME ZONE 'Europe/Nicosia')::date = v_date
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.public_venue_schedule(text, date) TO anon, authenticated;
