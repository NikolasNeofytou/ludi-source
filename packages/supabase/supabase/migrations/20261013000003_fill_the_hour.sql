-- 20261013000003_fill_the_hour.sql
-- Fill the hour (plans/fill-the-hour.md, ADR-0045): an owner looking at an
-- empty hour offers it to the regulars who have played that court at that
-- hour before, each one a message from the owner's own WhatsApp, at the
-- price he types. Ludi ranks the venue's own contacts for the venue; it
-- sends nothing and markets to no one (Schedule B.5).
--
-- Contents:
--   1. venue_fill_enabled - the switch, per venue, flipped by Ludi once the
--      venue's processor terms name this use (Schedule B.2, amended)
--   2. venue_contacts.offers_opt_out_at - "doesn't want offers"
--   3. fill_offers / fill_offer_sends - the hour offered, and who was asked
--   4. functions: fill_hour_open, fill_hour_candidates, fill_hour_mark_sent,
--      fill_hour_state, venue_contact_set_offers, set_fill_offers_enabled
--
-- Owner-only, like the contact list itself (ADR-0041): a manager finds a
-- regular by typing his name and never sees the list.

-- ════════════════════════════════════════════════════════════════════
-- 1. The switch
-- ════════════════════════════════════════════════════════════════════
-- A row here means the venue has it. Its own table rather than a venues
-- column because the venue column guard is a deny-list and a new column
-- there would be the owner's to flip.
CREATE TABLE public.venue_fill_enabled (
  venue_id   uuid PRIMARY KEY REFERENCES public.venues (id) ON DELETE CASCADE,
  enabled_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  enabled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX venue_fill_enabled_by_idx ON public.venue_fill_enabled (enabled_by);

COMMENT ON TABLE public.venue_fill_enabled IS
'Venues where Fill the hour is switched on (ADR-0045). Written only by '
'set_fill_offers_enabled (admin), after the venue''s Schedule B names the use.';

ALTER TABLE public.venue_fill_enabled ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_fill_enabled_select_owner_or_admin ON public.venue_fill_enabled
FOR SELECT TO authenticated
USING (public.has_venue_role(venue_id, 'owner') OR public.is_admin());

GRANT SELECT ON public.venue_fill_enabled TO authenticated;
REVOKE ALL ON public.venue_fill_enabled FROM anon;

-- ════════════════════════════════════════════════════════════════════
-- 2. "Doesn't want offers"
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.venue_contacts
  ADD COLUMN offers_opt_out_at timestamptz;

COMMENT ON COLUMN public.venue_contacts.offers_opt_out_at IS
'The person told the venue they do not want offers (every offer message says '
'how). Fill the hour never suggests them again until the owner clears it.';

-- ════════════════════════════════════════════════════════════════════
-- 3. The offer, and who was asked
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE public.fill_offers (
  id          uuid PRIMARY KEY DEFAULT public.uuid7(),
  venue_id    uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  pitch_id    uuid NOT NULL REFERENCES public.pitches (id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  price_cents int CHECK (price_cents IS NULL OR price_cents >= 0),
  created_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fill_offers_ends_after_starts CHECK (ends_at > starts_at),
  CONSTRAINT fill_offers_one_per_slot UNIQUE (pitch_id, starts_at)
);

CREATE INDEX fill_offers_venue_idx ON public.fill_offers (venue_id, starts_at);
CREATE INDEX fill_offers_created_by_idx ON public.fill_offers (created_by);

COMMENT ON TABLE public.fill_offers IS
'An empty hour an owner offered to his regulars (ADR-0045). price_cents NULL '
'means the court''s usual price. Filled is derived: a live booking now covers it.';

CREATE TABLE public.fill_offer_sends (
  offer_id   uuid NOT NULL REFERENCES public.fill_offers (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.venue_contacts (id) ON DELETE CASCADE,
  sent_by    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offer_id, contact_id)
);

CREATE INDEX fill_offer_sends_contact_idx ON public.fill_offer_sends (contact_id);
CREATE INDEX fill_offer_sends_sent_by_idx ON public.fill_offer_sends (sent_by);

COMMENT ON TABLE public.fill_offer_sends IS
'Who the owner opened a WhatsApp message to for an offer. Ludi sent nothing: '
'the row records the tap, so the page shows who was asked.';

ALTER TABLE public.fill_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fill_offer_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY fill_offers_select_owner_or_admin ON public.fill_offers
FOR SELECT TO authenticated
USING (public.has_venue_role(venue_id, 'owner') OR public.is_admin());

CREATE POLICY fill_offer_sends_select_owner_or_admin ON public.fill_offer_sends
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.fill_offers AS o
  WHERE o.id = offer_id
    AND (public.has_venue_role(o.venue_id, 'owner') OR public.is_admin())
));

GRANT SELECT ON public.fill_offers, public.fill_offer_sends TO authenticated;
REVOKE ALL ON public.fill_offers, public.fill_offer_sends FROM anon;

-- ════════════════════════════════════════════════════════════════════
-- 4. Functions
-- ════════════════════════════════════════════════════════════════════
-- The one gate, said once: the caller owns the venue and Ludi switched it on.
CREATE OR REPLACE FUNCTION public.assert_fill_allowed(p_venue_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_venue_role(p_venue_id, 'owner') THEN
    RAISE EXCEPTION 'FILL_NOT_YOURS' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_fill_enabled WHERE venue_id = p_venue_id) THEN
    RAISE EXCEPTION 'FILL_NOT_ENABLED' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Is anything live on this court, or a court that blocks it, in the window?
CREATE OR REPLACE FUNCTION public.fill_slot_taken(p_pitch_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings AS b
    WHERE b.pitch_id IN (SELECT public.pitch_blockers(p_pitch_id))
      AND b.state IN ('pending', 'collecting', 'paid', 'confirmed')
      AND b.starts_at < p_ends_at
      AND b.ends_at > p_starts_at
  );
$$;

-- Open (or re-open with a new price) the offer for one empty hour.
CREATE OR REPLACE FUNCTION public.fill_hour_open(
  p_pitch_id    uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_price_cents int DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue uuid;
  v_id    uuid;
  v_day   date := (p_starts_at AT TIME ZONE 'Europe/Nicosia')::date;
BEGIN
  SELECT venue_id INTO v_venue FROM public.pitches WHERE id = p_pitch_id AND is_active;
  IF v_venue IS NULL THEN
    RAISE EXCEPTION 'PITCH_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.assert_fill_allowed(v_venue);

  IF p_starts_at <= now() OR p_ends_at <= p_starts_at OR p_ends_at - p_starts_at > interval '4 hours' THEN
    RAISE EXCEPTION 'FILL_BAD_WINDOW' USING ERRCODE = 'P0001';
  END IF;
  IF p_price_cents IS NOT NULL AND (p_price_cents < 0 OR p_price_cents > 100000) THEN
    RAISE EXCEPTION 'FILL_BAD_PRICE' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pitch_schedule_overrides
    WHERE pitch_id = p_pitch_id AND override_date = v_day AND is_closed
  ) THEN
    RAISE EXCEPTION 'FILL_COURT_CLOSED' USING ERRCODE = 'P0001';
  END IF;
  IF public.fill_slot_taken(p_pitch_id, p_starts_at, p_ends_at) THEN
    RAISE EXCEPTION 'FILL_SLOT_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.fill_offers (venue_id, pitch_id, starts_at, ends_at, price_cents, created_by)
  VALUES (v_venue, p_pitch_id, p_starts_at, p_ends_at, p_price_cents, auth.uid())
  ON CONFLICT (pitch_id, starts_at) DO UPDATE
    SET ends_at = excluded.ends_at, price_cents = excluded.price_cents
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- The regulars to ask, best first: who played this weekday within an hour
-- of this time most often, then who plays here most, then most recently.
-- Never someone who said no to offers, never someone without a number,
-- never someone already booked across this hour.
CREATE OR REPLACE FUNCTION public.fill_hour_candidates(p_offer_id uuid, p_limit int DEFAULT 40)
RETURNS TABLE (
  contact_id   uuid,
  display_name text,
  phone_e164   text,
  at_this_hour int,
  same_court   int,
  here_total   int,
  last_played  date,
  sent_at      timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_offer public.fill_offers%ROWTYPE;
  v_dow   int;
  v_min   int;
BEGIN
  SELECT * INTO v_offer FROM public.fill_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FILL_OFFER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.assert_fill_allowed(v_offer.venue_id);

  v_dow := extract(DOW FROM v_offer.starts_at AT TIME ZONE 'Europe/Nicosia')::int;
  v_min := (extract(HOUR FROM v_offer.starts_at AT TIME ZONE 'Europe/Nicosia') * 60
            + extract(MINUTE FROM v_offer.starts_at AT TIME ZONE 'Europe/Nicosia'))::int;

  RETURN QUERY
  WITH played AS (
    SELECT
      b.contact_id AS cid,
      b.pitch_id,
      b.starts_at,
      extract(DOW FROM b.starts_at AT TIME ZONE 'Europe/Nicosia')::int AS dow,
      (extract(HOUR FROM b.starts_at AT TIME ZONE 'Europe/Nicosia') * 60
       + extract(MINUTE FROM b.starts_at AT TIME ZONE 'Europe/Nicosia'))::int AS minute_of_day
    FROM public.bookings AS b
    INNER JOIN public.pitches AS p ON b.pitch_id = p.id
    WHERE p.venue_id = v_offer.venue_id
      AND b.contact_id IS NOT NULL
      AND b.state IN ('confirmed', 'completed', 'paid')
      AND b.starts_at < now()
      AND b.starts_at > now() - interval '365 days'
  ),
  scored AS (
    SELECT
      pl.cid,
      count(*) FILTER (
        WHERE pl.dow = v_dow AND abs(pl.minute_of_day - v_min) <= 60
      )::int AS at_hour,
      count(*) FILTER (WHERE pl.pitch_id = v_offer.pitch_id)::int AS court,
      count(*)::int AS total,
      max((pl.starts_at AT TIME ZONE 'Europe/Nicosia')::date) AS last_day
    FROM played AS pl
    GROUP BY pl.cid
  )
  SELECT
    c.id,
    c.display_name,
    c.phone_e164,
    coalesce(s.at_hour, 0),
    coalesce(s.court, 0),
    coalesce(s.total, 0),
    s.last_day,
    snd.sent_at
  FROM public.venue_contacts AS c
  LEFT JOIN scored AS s ON c.id = s.cid
  LEFT JOIN public.fill_offer_sends AS snd ON snd.offer_id = v_offer.id AND c.id = snd.contact_id
  WHERE c.venue_id = v_offer.venue_id
    AND c.phone_e164 IS NOT NULL
    AND c.offers_opt_out_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings AS busy
      WHERE busy.contact_id = c.id
        AND busy.state IN ('pending', 'collecting', 'paid', 'confirmed')
        AND busy.starts_at < v_offer.ends_at
        AND busy.ends_at > v_offer.starts_at
    )
  ORDER BY
    coalesce(s.at_hour, 0) DESC,
    coalesce(s.total, 0) DESC,
    s.last_day DESC NULLS LAST,
    c.display_name
  LIMIT greatest(1, least(coalesce(p_limit, 40), 100));
END;
$$;

-- The owner tapped "Send on WhatsApp" for this contact.
CREATE OR REPLACE FUNCTION public.fill_hour_mark_sent(p_offer_id uuid, p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue uuid;
BEGIN
  SELECT venue_id INTO v_venue FROM public.fill_offers WHERE id = p_offer_id;
  IF v_venue IS NULL THEN
    RAISE EXCEPTION 'FILL_OFFER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.assert_fill_allowed(v_venue);
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_contacts WHERE id = p_contact_id AND venue_id = v_venue
  ) THEN
    RAISE EXCEPTION 'FILL_CONTACT_NOT_HERE' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.fill_offer_sends (offer_id, contact_id, sent_by)
  VALUES (p_offer_id, p_contact_id, auth.uid())
  ON CONFLICT (offer_id, contact_id) DO UPDATE SET sent_at = now(), sent_by = auth.uid();
END;
$$;

-- Is the hour still free, and if not, did one of the people asked take it?
CREATE OR REPLACE FUNCTION public.fill_hour_state(p_offer_id uuid)
RETURNS TABLE (
  filled          boolean,
  filled_by_asked boolean,
  booking_code    text,
  asked           int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_offer public.fill_offers%ROWTYPE;
BEGIN
  SELECT * INTO v_offer FROM public.fill_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FILL_OFFER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.assert_fill_allowed(v_offer.venue_id);

  RETURN QUERY
  SELECT
    (b.id IS NOT NULL),
    coalesce(EXISTS (
      SELECT 1 FROM public.fill_offer_sends AS s
      WHERE s.offer_id = v_offer.id AND s.contact_id = b.contact_id
    ), FALSE),
    b.code,
    (SELECT count(*)::int FROM public.fill_offer_sends AS s WHERE s.offer_id = v_offer.id)
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (
    SELECT bk.id, bk.code, bk.contact_id
    FROM public.bookings AS bk
    WHERE bk.pitch_id IN (SELECT public.pitch_blockers(v_offer.pitch_id))
      AND bk.state IN ('pending', 'collecting', 'paid', 'confirmed', 'completed')
      AND bk.starts_at < v_offer.ends_at
      AND bk.ends_at > v_offer.starts_at
    ORDER BY bk.created_at
    LIMIT 1
  ) AS b ON TRUE;
END;
$$;

-- "Doesn't want offers", set or cleared by the owner.
CREATE OR REPLACE FUNCTION public.venue_contact_set_offers(p_contact_id uuid, p_opt_out boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue uuid;
BEGIN
  SELECT venue_id INTO v_venue FROM public.venue_contacts WHERE id = p_contact_id;
  IF v_venue IS NULL OR NOT (public.has_venue_role(v_venue, 'owner') OR public.is_admin()) THEN
    RAISE EXCEPTION 'venue_contact_set_offers: not your contact' USING ERRCODE = '42501';
  END IF;
  UPDATE public.venue_contacts
  SET offers_opt_out_at = CASE WHEN p_opt_out THEN coalesce(offers_opt_out_at, now()) END
  WHERE id = p_contact_id;
END;
$$;

-- Ludi switches it on for a venue once its Schedule B names the use.
CREATE OR REPLACE FUNCTION public.set_fill_offers_enabled(p_venue_id uuid, p_on boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'set_fill_offers_enabled: admin only' USING ERRCODE = '42501';
  END IF;
  IF p_on THEN
    INSERT INTO public.venue_fill_enabled (venue_id, enabled_by)
    VALUES (p_venue_id, auth.uid())
    ON CONFLICT (venue_id) DO NOTHING;
  ELSE
    DELETE FROM public.venue_fill_enabled WHERE venue_id = p_venue_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_fill_allowed(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fill_slot_taken(uuid, timestamptz, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fill_hour_open(uuid, timestamptz, timestamptz, int) FROM public, anon;
REVOKE ALL ON FUNCTION public.fill_hour_candidates(uuid, int) FROM public, anon;
REVOKE ALL ON FUNCTION public.fill_hour_mark_sent(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.fill_hour_state(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.venue_contact_set_offers(uuid, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.set_fill_offers_enabled(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fill_hour_open(uuid, timestamptz, timestamptz, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fill_hour_candidates(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fill_hour_mark_sent(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fill_hour_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.venue_contact_set_offers(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_fill_offers_enabled(uuid, boolean) TO authenticated;
