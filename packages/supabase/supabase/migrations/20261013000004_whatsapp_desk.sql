-- 20261013000004_whatsapp_desk.sql
-- The booking desk (plans/whatsapp-desk.md, ADR-0046): the messages a
-- venue's customers send to book — today by WhatsApp to the owner's phone —
-- land in one inbox beside the calendar, each with a proposed booking the
-- owner confirms with a tap. Two ways in:
--   paste    — the owner pastes the message (works today, no Meta)
--   whatsapp — the venue's WhatsApp Business number is connected to the
--              Cloud API and messages arrive by webhook
-- The reading happens in the dashboard (apps/admin/lib/booking-request.ts)
-- and only ever proposes; the booking is the owner's ordinary walk-in.
--
-- The messages are Venue Records (Schedule B): owner and manager — the
-- desk is the day (ADR-0041) — and purged thirty days after they arrive.

-- ════════════════════════════════════════════════════════════════════
-- 1. A venue's connected WhatsApp number
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE public.venue_whatsapp_numbers (
  venue_id        uuid PRIMARY KEY REFERENCES public.venues (id) ON DELETE CASCADE,
  phone_number_id text NOT NULL UNIQUE CHECK (phone_number_id ~ '^[0-9]{6,30}$'),
  display_phone   text NOT NULL CHECK (char_length(display_phone) <= 30),
  connected_by    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  connected_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX venue_whatsapp_numbers_connected_by_idx ON public.venue_whatsapp_numbers (connected_by);

COMMENT ON TABLE public.venue_whatsapp_numbers IS
'The venue''s WhatsApp Business number on the Cloud API (phone_number_id is '
'Meta''s id for it). Set by Ludi only (desk_connect_number), once the venue''s '
'Schedule B lists Meta as a sub-processor.';

ALTER TABLE public.venue_whatsapp_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_whatsapp_numbers_select_staff_or_admin ON public.venue_whatsapp_numbers
FOR SELECT TO authenticated
USING (public.is_venue_owner_of_venue(venue_id) OR public.is_admin());

GRANT SELECT ON public.venue_whatsapp_numbers TO authenticated;
REVOKE ALL ON public.venue_whatsapp_numbers FROM anon;

-- ════════════════════════════════════════════════════════════════════
-- 2. The inbox
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE public.venue_inbox (
  id                uuid PRIMARY KEY DEFAULT public.uuid7(),
  venue_id          uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  source            text NOT NULL CHECK (source IN ('paste', 'whatsapp')),
  sender_name       text CHECK (sender_name IS NULL OR char_length(sender_name) <= 120),
  sender_phone      text CHECK (sender_phone IS NULL OR char_length(sender_phone) <= 30),
  sender_phone_e164 text GENERATED ALWAYS AS (public.normalize_phone_cy(sender_phone)) STORED,
  body              text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  wa_message_id     text UNIQUE CHECK (wa_message_id IS NULL OR char_length(wa_message_id) <= 200),
  received_at       timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'booked', 'declined', 'dismissed')),
  booking_id        uuid REFERENCES public.bookings (id) ON DELETE SET NULL,
  handled_by        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  handled_at        timestamptz,
  created_by        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_inbox_handled_matches_status CHECK ((status = 'new') = (handled_at IS NULL)),
  CONSTRAINT venue_inbox_whatsapp_has_id CHECK (source <> 'whatsapp' OR wa_message_id IS NOT NULL)
);

CREATE INDEX venue_inbox_venue_idx ON public.venue_inbox (venue_id, received_at DESC);
CREATE INDEX venue_inbox_new_idx ON public.venue_inbox (venue_id) WHERE status = 'new';
CREATE INDEX venue_inbox_booking_idx ON public.venue_inbox (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX venue_inbox_handled_by_idx ON public.venue_inbox (handled_by);
CREATE INDEX venue_inbox_created_by_idx ON public.venue_inbox (created_by);

COMMENT ON TABLE public.venue_inbox IS
'Booking requests sent to a venue (ADR-0046): pasted by the owner or received '
'on its connected WhatsApp number. A Venue Record (Schedule B); purged thirty '
'days after it arrives (desk_purge).';

ALTER TABLE public.venue_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_inbox_select_staff ON public.venue_inbox
FOR SELECT TO authenticated
USING (public.is_venue_owner_of_venue(venue_id));

GRANT SELECT ON public.venue_inbox TO authenticated;
REVOKE ALL ON public.venue_inbox FROM anon;

-- ════════════════════════════════════════════════════════════════════
-- 3. Functions
-- ════════════════════════════════════════════════════════════════════
-- The owner (or a manager) pastes a message.
CREATE OR REPLACE FUNCTION public.desk_add(
  p_venue_id     uuid,
  p_sender_name  text,
  p_sender_phone text,
  p_body         text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_venue_owner_of_venue(p_venue_id) THEN
    RAISE EXCEPTION 'desk_add: not your venue' USING ERRCODE = '42501';
  END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'DESK_EMPTY' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.venue_inbox (venue_id, source, sender_name, sender_phone, body, created_by)
  VALUES (
    p_venue_id, 'paste',
    nullif(btrim(left(p_sender_name, 120)), ''),
    nullif(btrim(left(p_sender_phone, 30)), ''),
    left(btrim(p_body), 2000),
    auth.uid()
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Booked (with the walk-in's code), declined or dismissed.
CREATE OR REPLACE FUNCTION public.desk_set_status(
  p_id           uuid,
  p_status       text,
  p_booking_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row     public.venue_inbox%ROWTYPE;
  v_booking uuid;
BEGIN
  SELECT * INTO v_row FROM public.venue_inbox WHERE id = p_id;
  IF NOT FOUND OR NOT public.is_venue_owner_of_venue(v_row.venue_id) THEN
    RAISE EXCEPTION 'desk_set_status: not your venue' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('new', 'booked', 'declined', 'dismissed') THEN
    RAISE EXCEPTION 'DESK_BAD_STATUS' USING ERRCODE = 'P0001';
  END IF;

  IF p_status = 'booked' THEN
    SELECT b.id INTO v_booking
    FROM public.bookings AS b
    INNER JOIN public.pitches AS p ON b.pitch_id = p.id
    WHERE b.code = p_booking_code AND p.venue_id = v_row.venue_id;
    IF v_booking IS NULL THEN
      RAISE EXCEPTION 'DESK_BOOKING_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.venue_inbox
  SET
    status = p_status,
    booking_id = v_booking,
    handled_by = CASE WHEN p_status = 'new' THEN NULL ELSE auth.uid() END,
    handled_at = CASE WHEN p_status = 'new' THEN NULL ELSE now() END
  WHERE id = p_id;
END;
$$;

-- Which of the venue's courts are free across a window: active, not
-- closed that day, nothing live on it or on a court that blocks it.
CREATE OR REPLACE FUNCTION public.desk_free_courts(
  p_venue_id  uuid,
  p_starts_at timestamptz,
  p_ends_at   timestamptz
)
RETURNS TABLE (pitch_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_venue_owner_of_venue(p_venue_id) THEN
    RAISE EXCEPTION 'desk_free_courts: not your venue' USING ERRCODE = '42501';
  END IF;
  IF p_ends_at <= p_starts_at OR p_ends_at - p_starts_at > interval '6 hours' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id
  FROM public.pitches AS p
  WHERE p.venue_id = p_venue_id
    AND p.is_active
    AND NOT EXISTS (
      SELECT 1 FROM public.pitch_schedule_overrides AS o
      WHERE o.pitch_id = p.id
        AND o.override_date = (p_starts_at AT TIME ZONE 'Europe/Nicosia')::date
        AND o.is_closed
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings AS b
      WHERE b.pitch_id IN (SELECT public.pitch_blockers(p.id))
        AND b.state IN ('pending', 'collecting', 'paid', 'confirmed')
        AND b.starts_at < p_ends_at
        AND b.ends_at > p_starts_at
    )
  ORDER BY p.name;
END;
$$;

-- Service: the webhook hands over one message received on a connected
-- number. A redelivery is the same wa_message_id and does nothing.
CREATE OR REPLACE FUNCTION public.desk_receive_whatsapp(
  p_phone_number_id text,
  p_wa_message_id   text,
  p_from            text,
  p_name            text,
  p_body            text,
  p_received_at     timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue uuid;
  v_id    uuid;
BEGIN
  PERFORM public.assert_service_role();

  SELECT venue_id INTO v_venue FROM public.venue_whatsapp_numbers WHERE phone_number_id = p_phone_number_id;
  IF v_venue IS NULL OR p_body IS NULL OR btrim(p_body) = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.venue_inbox (venue_id, source, sender_name, sender_phone, body, wa_message_id, received_at)
  VALUES (
    v_venue, 'whatsapp',
    nullif(btrim(left(p_name, 120)), ''),
    -- Cloud API sends the number without a plus; the stored form is what a
    -- person would type, so normalize_phone_cy reads it like any other
    CASE WHEN p_from ~ '^[0-9]{8,15}$' THEN '+' || p_from ELSE left(p_from, 30) END,
    left(btrim(p_body), 2000),
    p_wa_message_id,
    coalesce(p_received_at, now())
  )
  ON CONFLICT (wa_message_id) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Ludi connects a venue's number, or disconnects it.
CREATE OR REPLACE FUNCTION public.desk_connect_number(
  p_venue_id        uuid,
  p_phone_number_id text,
  p_display_phone   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'desk_connect_number: admin only' USING ERRCODE = '42501';
  END IF;
  IF p_phone_number_id IS NULL THEN
    DELETE FROM public.venue_whatsapp_numbers WHERE venue_id = p_venue_id;
    RETURN;
  END IF;
  INSERT INTO public.venue_whatsapp_numbers (venue_id, phone_number_id, display_phone, connected_by)
  VALUES (p_venue_id, btrim(p_phone_number_id), btrim(p_display_phone), auth.uid())
  ON CONFLICT (venue_id) DO UPDATE
    SET phone_number_id = excluded.phone_number_id,
        display_phone = excluded.display_phone,
        connected_by = excluded.connected_by,
        connected_at = now();
END;
$$;

-- Thirty days after a message arrives it goes, handled or not.
CREATE OR REPLACE FUNCTION public.desk_purge()
RETURNS int
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  WITH gone AS (
    DELETE FROM public.venue_inbox
    WHERE received_at < now() - interval '30 days'
    RETURNING 1
  )
  SELECT count(*)::int FROM gone;
$$;

REVOKE ALL ON FUNCTION public.desk_add(uuid, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.desk_set_status(uuid, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.desk_free_courts(uuid, timestamptz, timestamptz) FROM public, anon;
REVOKE ALL ON FUNCTION public.desk_receive_whatsapp(text, text, text, text, text, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.desk_connect_number(uuid, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.desk_purge() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_add(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.desk_set_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.desk_free_courts(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.desk_connect_number(uuid, text, text) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not available; skipping desk-purge schedule.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- Daily, 03:20 UTC - the quietest hour, after the backups.
  PERFORM cron.schedule(
    'ludi-desk-purge',
    '20 3 * * *',
    $cmd$SELECT public.desk_purge();$cmd$
  );
END;
$$;
