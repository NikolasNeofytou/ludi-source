-- ────────────────────────────────────────────────────────────────────
-- The owner's regulars — a contact list that fills itself
-- ────────────────────────────────────────────────────────────────────
-- Slice A of docs/plans/owner-contacts.md: the schema, the writers, the
-- search, and the backfill. No UI — slice C puts the typeahead in the
-- booking form, slice B the Contacts page.
--
-- Until now a customer existed only as two strings on a booking
-- (bookings.walk_in_name / walk_in_phone, 20260829000001), copied onto
-- every occurrence of a standing series. The same man was N strings.
-- This makes him one row per venue, keyed on his phone number, and
-- points every walk-in and series at that row.
--
-- The three properties the plan calls the whole architecture (ADR-0040
-- candidate), and where each is enforced below:
--   1. Scoped to the venue — venue_id on every row, no cross-venue person,
--      and a booking may only point at a contact of ITS venue (§4).
--   2. Derived first — a trigger makes the contact from the walk-in
--      itself (§4), and a backfill does the same for history (§7). The
--      owner never has to seed the list for it to be useful.
--   3. The phone number is the identity — normalised to E.164 with a
--      Cypriot default, unique per venue (§1, §2). A contact with no
--      usable number is allowed but never deduplicated, and a walk-in
--      with no usable number makes no contact at all: without a key,
--      "Academy U12" forty times is forty rows.
--
-- One deliberate departure from the plan's RLS sketch, answering its
-- Open question 4 ("who else stands at that counter?") the way
-- ADR-0041 answered everything else: a MANAGER does not list the
-- contacts. He searches them (§6) — the typeahead is the whole of what
-- the counter needs — and the list, its export and delete-all are the
-- owner's. See §5 for exactly how much that is and is not a boundary.

-- pg_trgm, for fuzzy matching on names. No schema clause, like
-- btree_gist and citext before it (20260421000003): on this project an
-- extension created that way lands in public, which keeps gin_trgm_ops
-- resolvable in CI's vanilla Postgres, where there is no `extensions`.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ────────────────────────────────────────────────────────────────────
-- 1. normalize_phone_cy — the identity
-- ────────────────────────────────────────────────────────────────────
-- What the counter types is whatever the customer said. What is stored
-- today is create-walk-in-booking's digits-only form, with a leading 00
-- stripped: '35799123456' when the country code was typed, but
-- '99123456' when it was not. Both must come out as the same key.
--
--   '+357 99 123456', '0035799123456', '35799123456', '99123456'
--                                                   → '+35799123456'
--   '+30 691 234 5678', '306912345678'              → '+306912345678'
--
-- Conservative on purpose. A bare 8-digit number starting 2 or 9 is a
-- Cypriot landline or mobile. 11–15 digits is taken to carry its country
-- code. A bare 10-digit number is most likely a Greek number typed
-- without +30 — but "most likely" is not a key, so it returns NULL, the
-- contact is kept un-deduplicated, and nothing is merged on a guess.
-- IMMUTABLE so it can back a generated column.
CREATE OR REPLACE FUNCTION public.normalize_phone_cy(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  v_raw    text    := btrim(coalesce(p, ''));
  v_plus   boolean := left(v_raw, 1) = '+';
  v_digits text    := regexp_replace(v_raw, '[^0-9]', '', 'g');
BEGIN
  IF v_digits = '' THEN
    RETURN NULL;
  END IF;

  IF left(v_digits, 2) = '00' THEN
    v_digits := substr(v_digits, 3);
    v_plus := TRUE;
  END IF;

  IF v_plus THEN
    IF length(v_digits) BETWEEN 8 AND 15 AND left(v_digits, 1) <> '0' THEN
      RETURN '+' || v_digits;
    END IF;
    RETURN NULL;
  END IF;

  IF length(v_digits) = 8 AND left(v_digits, 1) IN ('2', '9') THEN
    RETURN '+357' || v_digits;
  END IF;

  IF length(v_digits) BETWEEN 11 AND 15 AND left(v_digits, 1) <> '0' THEN
    RETURN '+' || v_digits;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.normalize_phone_cy(text) IS
  'A phone number as typed → E.164, with a Cypriot default for a bare '
  '8-digit 2x/9x number. NULL when the input is not confidently one '
  'number (e.g. a bare 10-digit one). The identity of a venue_contact.';

-- ────────────────────────────────────────────────────────────────────
-- 2. normalize_contact_text — so «Ανδ» finds "Andreas"
-- ────────────────────────────────────────────────────────────────────
-- Giorgos saves his regulars the way he says them, and the counter
-- types them the way it types: sometimes Greek, sometimes Latin,
-- rarely with the accent. Both sides of every search go through this,
-- so they meet in one alphabet:
--
--   'Ανδρέας' → 'andreas'      'Χριστόδουλος' → 'christodoulos'
--   'Γιώργος' → 'giorgos'      'Ευάγγελος'    → 'evangelos'
--   'Θωμάς'   → 'thomas'       'Ανδρέας — Τρίτη 20:00' → 'andreas triti 20 00'
--
-- Case folding and accents are done by translate(), not lower(): lower()
-- follows the database's LC_CTYPE, and under C it leaves Greek alone.
-- Digraphs (ου, αυ, ευ, γγ) and the two-letter sounds (θ, χ, ψ) go
-- before the single letters, or 'ου' would come out 'oy'. Anything left
-- outside a–z0–9 collapses to a space. Latin spellings of Greek names
-- vary (Nikolas/Nicholas, Christos/Hristos) and no table fixes that;
-- trigram similarity in §6 is what absorbs the rest. IMMUTABLE for the
-- generated column — if this function ever changes, rewrite the rows
-- (a no-op UPDATE recomputes every stored search_key).
CREATE OR REPLACE FUNCTION public.normalize_contact_text(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
    translate(
      replace(replace(replace(replace(replace(replace(replace(
        lower(translate(
          coalesce(p, ''),
          'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰς',
          'αβγδεζηθικλμνξοπρστυφχψωαεηιουωιυαεηιουωιυιυσ'
        )),
        'ου', 'ou'), 'αυ', 'av'), 'ευ', 'ev'), 'γγ', 'ng'),
        'θ', 'th'), 'χ', 'ch'), 'ψ', 'ps'),
      'αβγδεζηικλμνξοπρστυφω',
      'avgdeziiklmnxoprstyfo'
    ),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

COMMENT ON FUNCTION public.normalize_contact_text(text) IS
  'Folds Greek and Latin text to one searchable form: lower-case, '
  'unaccented, Greek transliterated to Latin, punctuation to spaces. '
  'Both a contact''s search_key and every search query go through it.';

-- ────────────────────────────────────────────────────────────────────
-- 3. venue_contacts
-- ────────────────────────────────────────────────────────────────────
-- phone_e164 and search_key are GENERATED from what was typed, so there
-- is no code path that can store one without the other being right.
-- display_name may be empty — a walk-in can carry a phone and no name —
-- and the UI shows the number then. `source` already lists 'csv' and
-- 'google' for slices D and E: widening a CHECK later means retyping it
-- from the live definition, which has bitten this project once.
CREATE TABLE public.venue_contacts (
  id              uuid        PRIMARY KEY DEFAULT public.uuid7(),
  venue_id        uuid        NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  display_name    text        NOT NULL DEFAULT ''
                              CHECK (char_length(display_name) <= 120),
  phone           text        CHECK (phone IS NULL OR char_length(phone) <= 30),
  phone_e164      text        GENERATED ALWAYS AS (public.normalize_phone_cy(phone)) STORED,
  note            text        CHECK (note IS NULL OR char_length(note) <= 280),
  search_key      text        GENERATED ALWAYS AS (
                                public.normalize_contact_text(display_name || ' ' || coalesce(note, ''))
                              ) STORED,
  source          text        NOT NULL
                              CHECK (source IN ('counter', 'manual', 'backfill', 'csv', 'google')),
  google_resource text        CHECK (google_resource IS NULL OR char_length(google_resource) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_contacts_name_or_phone
    CHECK (display_name <> '' OR phone IS NOT NULL)
);

CREATE UNIQUE INDEX venue_contacts_venue_phone_key
  ON public.venue_contacts (venue_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;

CREATE UNIQUE INDEX venue_contacts_venue_google_key
  ON public.venue_contacts (venue_id, google_resource)
  WHERE google_resource IS NOT NULL;

CREATE INDEX venue_contacts_venue_name_idx
  ON public.venue_contacts (venue_id, display_name);

CREATE INDEX venue_contacts_search_trgm_idx
  ON public.venue_contacts USING gin (search_key gin_trgm_ops);

CREATE TRIGGER tg_venue_contacts_updated_at
  BEFORE UPDATE ON public.venue_contacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE public.venue_contacts IS
  'A venue''s own regulars (plans/owner-contacts.md). Venue-scoped, keyed '
  'on phone_e164, derived from walk-ins and standing bookings. The venue '
  'is the controller of this data and Ludi the processor — never shared '
  'across venues, never used to contact anyone on Ludi''s behalf.';

-- ────────────────────────────────────────────────────────────────────
-- 4. Bookings and series point at a contact — and fill the list
-- ────────────────────────────────────────────────────────────────────
-- contact_id is ON DELETE SET NULL: deleting a contact (the owner's
-- right, §5) must never delete a booking. The typed walk_in_name /
-- walk_in_phone stay on the booking as the venue's commercial record of
-- the day; contact_id is who that turned out to be.
ALTER TABLE public.bookings
  ADD COLUMN contact_id uuid REFERENCES public.venue_contacts (id) ON DELETE SET NULL;
ALTER TABLE public.booking_series
  ADD COLUMN contact_id uuid REFERENCES public.venue_contacts (id) ON DELETE SET NULL;

CREATE INDEX bookings_contact_idx ON public.bookings (contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX booking_series_contact_idx ON public.booking_series (contact_id)
  WHERE contact_id IS NOT NULL;

-- Find the venue's contact for this number, or make one. NULL when the
-- number is not usable (see normalize_phone_cy) — no key, no row. An
-- existing contact's name is never overwritten from the counter: the
-- owner may have curated it ("Andreas — Tuesday 20:00"), and the next
-- walk-in typing "Andreas" must not undo that. The one exception is a
-- contact with no name yet, which the first name typed fills in.
-- Insert-then-reselect so two walk-ins for the same new number at the
-- same moment still land on one row.
CREATE OR REPLACE FUNCTION public.venue_contact_find_or_create(
  p_venue_id uuid,
  p_name text,
  p_phone text,
  p_source text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_e164 text := public.normalize_phone_cy(p_phone);
  v_name text := left(btrim(coalesce(p_name, '')), 120);
  v_id   uuid;
BEGIN
  IF v_e164 IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.id INTO v_id
  FROM public.venue_contacts AS c
  WHERE c.venue_id = p_venue_id AND c.phone_e164 = v_e164;

  IF v_id IS NULL THEN
    INSERT INTO public.venue_contacts (venue_id, display_name, phone, source)
    VALUES (p_venue_id, v_name, left(btrim(p_phone), 30), p_source)
    ON CONFLICT (venue_id, phone_e164) WHERE phone_e164 IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      SELECT c.id INTO v_id
      FROM public.venue_contacts AS c
      WHERE c.venue_id = p_venue_id AND c.phone_e164 = v_e164;
    END IF;
  ELSIF v_name <> '' THEN
    UPDATE public.venue_contacts AS c
       SET display_name = v_name
     WHERE c.id = v_id AND c.display_name = '';
  END IF;

  RETURN v_id;
END;
$$;

-- The bookings trigger. Every walk-in, from every path — the walk-in
-- modal, book-from-a-cell, the series materialiser — goes through here,
-- which is what makes the list fill itself. No bookings INSERT policy
-- exists for an authenticated user, so this only ever runs under a
-- service role or a definer function; SECURITY DEFINER is so the
-- contact insert is not refused by venue_contacts' RLS.
--
--   * an app booking: nothing — its organiser is a Ludi account, and
--     folding players into a venue's list is parked (plan §Open 5);
--   * a series occurrence: the series' contact, not a fresh lookup, so
--     one standing booking is one person however its phone normalises;
--   * a walk-in with a contact_id already (slice C's picker): checked
--     to belong to THIS booking's venue, and kept;
--   * otherwise: found or made from the typed name and phone.
CREATE OR REPLACE FUNCTION public.tg_bookings_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  IF NEW.origin <> 'walk_in' THEN
    IF NEW.contact_id IS NOT NULL THEN
      RAISE EXCEPTION 'only a walk-in can point at a venue contact'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT p.venue_id INTO v_venue_id
  FROM public.pitches AS p
  WHERE p.id = NEW.pitch_id;

  IF NEW.contact_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.venue_contacts AS c
      WHERE c.id = NEW.contact_id AND c.venue_id = v_venue_id
    ) THEN
      RAISE EXCEPTION 'a booking can only point at a contact of its own venue'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.series_id IS NOT NULL THEN
    SELECT s.contact_id INTO NEW.contact_id
    FROM public.booking_series AS s
    WHERE s.id = NEW.series_id;
    RETURN NEW;
  END IF;

  NEW.contact_id := public.venue_contact_find_or_create(
    v_venue_id, NEW.walk_in_name, NEW.walk_in_phone, 'counter'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_bookings_contact
  BEFORE INSERT OR UPDATE OF contact_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_bookings_contact();

-- The same for a standing series, which carries its venue directly.
CREATE OR REPLACE FUNCTION public.tg_booking_series_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.venue_contacts AS c
      WHERE c.id = NEW.contact_id AND c.venue_id = NEW.venue_id
    ) THEN
      RAISE EXCEPTION 'a series can only point at a contact of its own venue'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.contact_id := public.venue_contact_find_or_create(
      NEW.venue_id, NEW.name, NEW.phone, 'counter'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_booking_series_contact
  BEFORE INSERT OR UPDATE OF contact_id ON public.booking_series
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_series_contact();

-- ────────────────────────────────────────────────────────────────────
-- 5. Who may read the list
-- ────────────────────────────────────────────────────────────────────
-- The OWNER lists his contacts (and an admin, for support). That is the
-- only SELECT policy. A manager has no direct read — he has the search
-- in §6, which answers a typed query with at most eight people. That is
-- the ADR-0041 line applied to the first table of other people's
-- personal data an owner has put in Ludi: the counter finds a customer;
-- the list, its export and its deletion are the owner's.
--
-- Said as plainly as slice F said it about booked value: this RAISES
-- THE COST of bulk extraction, it does not make it impossible. A manager
-- who typed every two-letter prefix could reassemble most of the list,
-- eight rows at a time. What it removes is the one-request download, and
-- the list ever being on a manager's screen by default.
--
-- No INSERT/UPDATE/DELETE policies: every write is one of the definer
-- functions below, each with its gate as its first statement.
ALTER TABLE public.venue_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_contacts_owner_or_admin_select ON public.venue_contacts
  FOR SELECT
  TO authenticated
  USING (public.has_venue_role(venue_id, 'owner') OR public.is_admin());

REVOKE ALL ON public.venue_contacts FROM anon;
GRANT SELECT ON public.venue_contacts TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 6. The writers, and the search
-- ────────────────────────────────────────────────────────────────────
-- Create and update are the day (ADR-0041): anyone who runs the counter
-- may add a regular or fix a number. A duplicate number raises 23505 so
-- the page can say "already a contact" instead of silently merging.

CREATE OR REPLACE FUNCTION public.venue_contact_create(
  p_venue_id uuid,
  p_display_name text,
  p_phone text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT (public.is_venue_owner_of_venue(p_venue_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'venue_contact_create: not your venue'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.venue_contacts (venue_id, display_name, phone, note, source)
  VALUES (
    p_venue_id,
    left(btrim(coalesce(p_display_name, '')), 120),
    NULLIF(left(btrim(coalesce(p_phone, '')), 30), ''),
    NULLIF(left(btrim(coalesce(p_note, '')), 280), ''),
    'manual'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.venue_contact_update(
  p_contact_id uuid,
  p_display_name text,
  p_phone text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  SELECT c.venue_id INTO v_venue_id
  FROM public.venue_contacts AS c
  WHERE c.id = p_contact_id;

  -- One refusal for "no such contact" and "not yours", so the function is
  -- not a probe for which contact ids exist at other venues.
  IF v_venue_id IS NULL
     OR NOT (public.is_venue_owner_of_venue(v_venue_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'venue_contact_update: no such contact at your venue'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.venue_contacts AS c
     SET display_name = left(btrim(coalesce(p_display_name, '')), 120),
         phone        = NULLIF(left(btrim(coalesce(p_phone, '')), 30), ''),
         note         = NULLIF(left(btrim(coalesce(p_note, '')), 280), '')
   WHERE c.id = p_contact_id;
END;
$$;

-- Deleting is the owner's (the plan's §Legal: "the venue can exercise its
-- own obligations"), and audited, because it cannot be undone. Bookings
-- survive it: contact_id goes NULL, the typed name and phone stay.
CREATE OR REPLACE FUNCTION public.venue_contact_delete(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  SELECT c.venue_id INTO v_venue_id
  FROM public.venue_contacts AS c
  WHERE c.id = p_contact_id;

  IF v_venue_id IS NULL
     OR NOT (public.has_venue_role(v_venue_id, 'owner') OR public.is_admin()) THEN
    RAISE EXCEPTION 'venue_contact_delete: owner of this venue only'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.venue_contacts AS c WHERE c.id = p_contact_id;

  INSERT INTO public.admin_actions (
    admin_user_id, action_type, target_type, target_id, reason, payload
  ) VALUES (
    auth.uid(), 'other', 'venue', v_venue_id, 'owner deleted a contact',
    jsonb_build_object('kind', 'venue_contact_deleted', 'contact_id', p_contact_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.venue_contacts_delete_all(p_venue_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT (public.has_venue_role(p_venue_id, 'owner') OR public.is_admin()) THEN
    RAISE EXCEPTION 'venue_contacts_delete_all: owner of this venue only'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.venue_contacts AS c WHERE c.venue_id = p_venue_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.admin_actions (
    admin_user_id, action_type, target_type, target_id, reason, payload
  ) VALUES (
    auth.uid(), 'other', 'venue', p_venue_id,
    format('owner deleted all %s contacts', v_count),
    jsonb_build_object('kind', 'venue_contacts_deleted_all', 'count', v_count)
  );

  RETURN v_count;
END;
$$;

-- The search — the typeahead's whole read path, and a manager's only one.
-- A query must say something (two characters of a name, or three digits
-- of a number) or it answers nothing: an empty or one-letter query is
-- how a search becomes a list. At most eight rows, ranked: a name that
-- starts with what was typed, then a word inside the name that does, then
-- a number containing the digits, then trigram similarity for the
-- spellings no table catches (Nikolas / Nicholas).
CREATE OR REPLACE FUNCTION public.venue_contacts_search(
  p_venue_id uuid,
  p_query text
)
RETURNS TABLE (
  id           uuid,
  display_name text,
  phone        text,
  phone_e164   text,
  note         text
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q      text := public.normalize_contact_text(p_query);
  v_digits text := regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g');
BEGIN
  IF NOT (public.is_venue_owner_of_venue(p_venue_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'venue_contacts_search: not your venue'
      USING ERRCODE = '42501';
  END IF;

  IF length(v_q) < 2 AND length(v_digits) < 3 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.id, c.display_name, c.phone, c.phone_e164, c.note
  FROM public.venue_contacts AS c
  WHERE c.venue_id = p_venue_id
    AND (
      (length(v_q) >= 2 AND (
         c.search_key LIKE v_q || '%'
         OR c.search_key LIKE '% ' || v_q || '%'
         OR similarity(c.search_key, v_q) > 0.3
      ))
      OR (length(v_digits) >= 3
          AND regexp_replace(coalesce(c.phone_e164, ''), '[^0-9]', '', 'g') LIKE '%' || v_digits || '%')
    )
  ORDER BY
    (length(v_q) >= 2 AND c.search_key LIKE v_q || '%') DESC,
    (length(v_q) >= 2 AND c.search_key LIKE '% ' || v_q || '%') DESC,
    CASE WHEN length(v_q) >= 2 THEN similarity(c.search_key, v_q) ELSE 0 END DESC,
    c.display_name
  LIMIT 8;
END;
$$;

REVOKE ALL ON FUNCTION public.venue_contact_find_or_create(uuid, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.venue_contact_create(uuid, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.venue_contact_update(uuid, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.venue_contact_delete(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.venue_contacts_delete_all(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.venue_contacts_search(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.venue_contact_create(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.venue_contact_update(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.venue_contact_delete(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.venue_contacts_delete_all(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.venue_contacts_search(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.venue_contact_find_or_create(uuid, text, text, text) TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- 7. Backfill — the list on day one, from the venue's own bookings
-- ────────────────────────────────────────────────────────────────────
-- Every walk-in and every standing series that carries a usable number
-- becomes a contact, one per number per venue, named by the most recent
-- name typed for it. Then every walk-in and series points at its
-- contact. Not an import: nothing leaves or enters the venue's data,
-- it is only regrouped — the plan's legal clause gates imports (slices
-- D and E), not this. Idempotent: the ON CONFLICT and the IS NULL guards
-- make a re-run a no-op.
WITH typed AS (
  SELECT p.venue_id, b.walk_in_name AS name, b.walk_in_phone AS phone,
         public.normalize_phone_cy(b.walk_in_phone) AS e164, b.created_at
  FROM public.bookings AS b
  INNER JOIN public.pitches AS p ON p.id = b.pitch_id
  WHERE b.origin = 'walk_in'
    AND public.normalize_phone_cy(b.walk_in_phone) IS NOT NULL
  UNION ALL
  SELECT s.venue_id, s.name, s.phone,
         public.normalize_phone_cy(s.phone), s.created_at
  FROM public.booking_series AS s
  WHERE public.normalize_phone_cy(s.phone) IS NOT NULL
),

latest AS (
  SELECT DISTINCT ON (t.venue_id, t.e164)
    t.venue_id, t.name, t.phone
  FROM typed AS t
  ORDER BY t.venue_id, t.e164, t.created_at DESC
)

INSERT INTO public.venue_contacts (venue_id, display_name, phone, source)
SELECT l.venue_id, left(btrim(coalesce(l.name, '')), 120), left(btrim(l.phone), 30), 'backfill'
FROM latest AS l
ON CONFLICT (venue_id, phone_e164) WHERE phone_e164 IS NOT NULL DO NOTHING;

UPDATE public.booking_series AS s
   SET contact_id = c.id
  FROM public.venue_contacts AS c
 WHERE s.contact_id IS NULL
   AND c.venue_id = s.venue_id
   AND c.phone_e164 = public.normalize_phone_cy(s.phone);

UPDATE public.bookings AS b
   SET contact_id = c.id
  FROM public.pitches AS p, public.venue_contacts AS c
 WHERE b.contact_id IS NULL
   AND b.origin = 'walk_in'
   AND p.id = b.pitch_id
   AND c.venue_id = p.venue_id
   AND c.phone_e164 = public.normalize_phone_cy(b.walk_in_phone);
