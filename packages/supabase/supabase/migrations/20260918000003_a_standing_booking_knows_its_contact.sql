-- ────────────────────────────────────────────────────────────────────
-- A standing booking knows its contact
-- ────────────────────────────────────────────────────────────────────
-- Slice C of docs/plans/owner-contacts.md. The booking form now offers
-- the venue's contacts as a typeahead, and picking one carries its id.
-- A one-off walk-in takes that id through create-walk-in-booking; this
-- is the other path out of the same form — "repeat every week" — which
-- goes through create_booking_series and had nowhere to put it.
--
-- Why pass the id at all, when the series trigger (20260918000002)
-- already finds the contact from the phone? Because not every contact
-- HAS a usable phone: one added by hand may carry only a name, or a
-- number normalize_phone_cy will not guess at. Picking that person must
-- still link them, and only the id can.
--
-- The body is 20260915000002 verbatim — confirmed against the live
-- definition before writing this — plus one column in the INSERT. The
-- new parameter defaults to NULL, so every existing caller, positional
-- or named, keeps working unchanged. The series trigger checks a
-- supplied contact belongs to p_venue_id and raises 23514 if not.
--
-- DROP then CREATE rather than CREATE OR REPLACE: adding a parameter is
-- a new signature to Postgres, and OR REPLACE would leave the old one
-- beside it as an overload PostgREST cannot choose between.
DROP FUNCTION public.create_booking_series(
  uuid, text, text, uuid[], smallint[], time, int, date, date
);

CREATE FUNCTION public.create_booking_series(
  p_venue_id         uuid,
  p_name             text,
  p_phone            text,
  p_pitch_ids        uuid[],
  p_weekdays         smallint[],
  p_starts_time      time,
  p_duration_minutes int,
  p_starts_on        date,
  p_ends_on          date,
  p_contact_id       uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id   uuid;
  v_made int;
BEGIN
  IF NOT (public.is_admin() OR public.is_venue_owner_of_venue(p_venue_id)) THEN
    RAISE EXCEPTION 'create_booking_series: not your venue' USING ERRCODE = '42501';
  END IF;
  IF p_pitch_ids IS NULL OR cardinality(p_pitch_ids) = 0 THEN
    RAISE EXCEPTION 'create_booking_series: pick at least one court' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.booking_series (
    venue_id, name, phone, weekdays, starts_time, duration_minutes, starts_on, ends_on, created_by,
    contact_id
  ) VALUES (
    p_venue_id, p_name, p_phone, p_weekdays, p_starts_time, p_duration_minutes, p_starts_on, p_ends_on, auth.uid(),
    p_contact_id
  )
  RETURNING id INTO v_id;

  INSERT INTO public.booking_series_pitches (series_id, pitch_id)
  SELECT v_id, unnest(p_pitch_ids);

  v_made := public.materialise_booking_series(v_id);

  INSERT INTO public.admin_actions (admin_user_id, action_type, target_type, target_id, reason, payload)
  VALUES (
    auth.uid(), 'series_created', 'venue', p_venue_id,
    format('standing booking "%s" created (%s instances)', p_name, v_made),
    jsonb_build_object('series_id', v_id, 'instances', v_made, 'pitch_ids', p_pitch_ids, 'weekdays', p_weekdays)
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking_series(
  uuid, text, text, uuid[], smallint[], time, int, date, date, uuid
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_series(
  uuid, text, text, uuid[], smallint[], time, int, date, date, uuid
) TO authenticated;
