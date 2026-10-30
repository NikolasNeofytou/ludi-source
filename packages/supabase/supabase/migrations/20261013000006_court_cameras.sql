-- 20261013000006_court_cameras.sql
-- Court cameras (plans/court-cameras.md, ADR-0042): the recording belongs
-- to the booking. A fixed camera on a court records a booking whose
-- organiser switched recording on, and only the players on that booking's
-- roster can watch it. Nothing runs between bookings; nothing is kept
-- past thirty days; the venue's owner sees his cameras, never footage.
--
-- Dark until a camera row exists: no court has one, so no switch shows
-- and nothing arms.
--
-- Contents:
--   1. court_cameras (+ court_camera_tokens, the device's hashed secret)
--   2. bookings.recording_consented and who may turn it on
--   3. recordings, recording_access (the staff-read audit)
--   4. What the app reads: recording_state, pitch_has_camera,
--      invite_recorded, my_recording_default
--   5. The organiser: set_recording, recording_delete
--   6. The recorder on site (service only, behind the device token):
--      recorder_sync arms and lists, recorder_mark moves the state
--   7. Watching: recording_for_viewer, recording_staff_read
--   8. Expiry: recordings_to_purge, recording_purged
--   9. Admin: camera_register, camera_retire
--  10. The storage bucket

-- ════════════════════════════════════════════════════════════════════
-- 1. A camera belongs to a court
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE public.court_cameras (
  id           uuid PRIMARY KEY DEFAULT public.uuid7(),
  pitch_id     uuid NOT NULL REFERENCES public.pitches (id) ON DELETE CASCADE,
  vendor       text NOT NULL DEFAULT 'rtsp',
  device_ref   text,
  installed_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  retired_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One working camera per court; a retired one stays for the record.
CREATE UNIQUE INDEX court_cameras_one_per_pitch
ON public.court_cameras (pitch_id) WHERE retired_at IS NULL;

COMMENT ON TABLE public.court_cameras IS
'A fixed camera on a court (ADR-0042). Health is derived from last_seen_at, '
'which the recorder''s sync stamps. The owner reads his courts'' rows; '
'nobody reads footage through this table.';

-- The device's secret, hashed. No policies: only definer functions read it.
CREATE TABLE public.court_camera_tokens (
  camera_id  uuid PRIMARY KEY REFERENCES public.court_cameras (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE
);

ALTER TABLE public.court_cameras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_camera_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY court_cameras_select_staff ON public.court_cameras
FOR SELECT TO authenticated
USING (public.is_venue_owner_of_pitch(pitch_id) OR public.is_admin());

GRANT SELECT ON public.court_cameras TO authenticated;
REVOKE ALL ON public.court_cameras FROM anon;
REVOKE ALL ON public.court_camera_tokens FROM anon, authenticated;

-- Health, for the owner's Courts page and the founder's venue page.
CREATE OR REPLACE VIEW public.v_court_cameras
WITH (security_invoker = on) AS
SELECT
  cc.id,
  cc.pitch_id,
  cc.vendor,
  cc.device_ref,
  cc.installed_at,
  cc.last_seen_at,
  cc.retired_at,
  CASE
    WHEN cc.retired_at IS NOT NULL THEN 'retired'
    WHEN cc.last_seen_at IS NULL THEN 'never'
    WHEN cc.last_seen_at > now() - interval '3 minutes' THEN 'online'
    ELSE 'offline'
  END AS health
FROM public.court_cameras AS cc;

GRANT SELECT ON public.v_court_cameras TO authenticated;
REVOKE ALL ON public.v_court_cameras FROM anon;

-- ════════════════════════════════════════════════════════════════════
-- 2. The organiser's switch
-- ════════════════════════════════════════════════════════════════════
-- Frozen for direct writes by the organiser column guard (it is not in
-- the guard's writable list); it moves only through set_recording.
ALTER TABLE public.bookings
ADD COLUMN recording_consented boolean NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.bookings.recording_consented IS
'The organiser switched recording on (ADR-0042). Only on an app fixture '
'with an adult roster at a court with a camera; frozen at kickoff. '
'Off means no file is ever created.';

-- Why a booking cannot be recorded, or NULL when it can. Enforced in the
-- model, not the UI: walk-ins, standing bookings and CFA matches never; a
-- court without a working camera never; a roster with a player under 18
-- never.
CREATE OR REPLACE FUNCTION public.recording_blocked_reason(p_booking_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN b.id IS NULL THEN 'REC_NOT_FOUND'
    WHEN b.origin <> 'app' OR b.series_id IS NOT NULL THEN 'REC_NOT_APP'
    WHEN EXISTS (SELECT 1 FROM public.cfa_matches AS m WHERE m.booking_id = b.id) THEN 'REC_NOT_APP'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.court_cameras AS cc
      WHERE cc.pitch_id = b.pitch_id AND cc.retired_at IS NULL
    ) THEN 'REC_NO_CAMERA'
    WHEN EXISTS (
      SELECT 1 FROM public.booking_participants AS x
      INNER JOIN public.users AS u ON x.user_id = u.id
      WHERE x.booking_id = b.id AND x.status = 'in' AND u.age_band = 'u18'
    ) THEN 'REC_MINOR'
  END
  FROM (SELECT p_booking_id AS id) AS q
  LEFT JOIN public.bookings AS b ON q.id = b.id;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 3. Recordings and the staff-read audit
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE public.recordings (
  id          uuid PRIMARY KEY DEFAULT public.uuid7(),
  booking_id  uuid NOT NULL UNIQUE REFERENCES public.bookings (id) ON DELETE CASCADE,
  camera_id   uuid NOT NULL REFERENCES public.court_cameras (id),
  state       text NOT NULL DEFAULT 'scheduled'
  CHECK (state IN ('scheduled', 'recording', 'processing', 'ready', 'failed', 'deleted')),
  started_at  timestamptz,
  ended_at    timestamptz,
  storage_key text,
  bytes       bigint,
  duration_s  int,
  expires_at  timestamptz NOT NULL,
  failure     text,
  deleted_at  timestamptz,
  deleted_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  purged_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recordings_ready_has_file CHECK (
    state <> 'ready' OR (storage_key IS NOT NULL AND ended_at IS NOT NULL)
  )
);

CREATE INDEX recordings_camera_state_idx ON public.recordings (camera_id, state);
CREATE INDEX recordings_expires_idx ON public.recordings (expires_at) WHERE purged_at IS NULL;

COMMENT ON TABLE public.recordings IS
'One recording per consented booking (ADR-0042). The roster (players in) '
'reads it; footage is reached only through a signed URL the recording '
'function mints. Expires thirty days after the game.';

-- No row without consent; the clock is the booking's, whatever was asked.
CREATE OR REPLACE FUNCTION public.tg_recordings_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_reason  text;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = new.booking_id;
  IF NOT v_booking.recording_consented THEN
    RAISE EXCEPTION 'REC_NOT_CONSENTED' USING ERRCODE = 'P0001';
  END IF;
  v_reason := public.recording_blocked_reason(new.booking_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason USING ERRCODE = 'P0001';
  END IF;
  new.expires_at := v_booking.ends_at + interval '30 days';
  RETURN new;
END;
$$;

CREATE TRIGGER recordings_guard
BEFORE INSERT ON public.recordings
FOR EACH ROW EXECUTE FUNCTION public.tg_recordings_guard();

CREATE TABLE public.recording_access (
  id           uuid PRIMARY KEY DEFAULT public.uuid7(),
  recording_id uuid NOT NULL REFERENCES public.recordings (id) ON DELETE CASCADE,
  read_by      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  read_at      timestamptz NOT NULL DEFAULT now(),
  reason       text NOT NULL CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE public.recording_access IS
'Every time Ludi staff reach a recording''s footage, and why (ADR-0042).';

-- Players who are in on the booking, nobody else: not the owner, not a
-- player who left before the game.
CREATE OR REPLACE FUNCTION public.is_recording_viewer(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.booking_participants
    WHERE booking_id = p_booking_id AND user_id = auth.uid() AND status = 'in'
  );
$$;

ALTER TABLE public.recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recording_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY recordings_select_roster ON public.recordings
FOR SELECT TO authenticated
USING (public.is_recording_viewer(booking_id) OR public.is_admin());

CREATE POLICY recording_access_select_admin ON public.recording_access
FOR SELECT TO authenticated
USING (public.is_admin());

GRANT SELECT ON public.recordings, public.recording_access TO authenticated;
REVOKE ALL ON public.recordings, public.recording_access FROM anon;

-- ════════════════════════════════════════════════════════════════════
-- 4. What the app reads
-- ════════════════════════════════════════════════════════════════════
-- The fixture screen's one call: is there a camera, is the switch on, may
-- the caller flip it, and where the recording is.
CREATE OR REPLACE FUNCTION public.recording_state(p_booking_id uuid)
RETURNS TABLE (
  has_camera boolean,
  consented boolean,
  can_toggle boolean,
  blocked_reason text,
  recording_id uuid,
  state text,
  duration_s int,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.court_cameras AS cc
      WHERE cc.pitch_id = b.pitch_id AND cc.retired_at IS NULL
    ),
    b.recording_consented,
    b.user_id = auth.uid()
    AND b.starts_at > now()
    AND b.state IN ('pending', 'collecting', 'paid', 'confirmed'),
    public.recording_blocked_reason(b.id),
    r.id,
    r.state,
    r.duration_s,
    r.expires_at
  FROM public.bookings AS b
  LEFT JOIN public.recordings AS r ON b.id = r.booking_id
  WHERE b.id = p_booking_id
    AND (b.user_id = auth.uid() OR public.is_participant_of_booking(b.id));
$$;

-- Checkout asks before the booking exists.
CREATE OR REPLACE FUNCTION public.pitch_has_camera(p_pitch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.court_cameras
    WHERE pitch_id = p_pitch_id AND retired_at IS NULL
  );
$$;

-- The invite preview tells a joiner before he takes a spot.
CREATE OR REPLACE FUNCTION public.invite_recorded(p_invite_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT b.recording_consented FROM public.bookings AS b
    WHERE b.invite_token = p_invite_token
  ), FALSE);
$$;

-- The switch remembers: the caller's last answer at a court with a camera.
CREATE OR REPLACE FUNCTION public.my_recording_default()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT b.recording_consented FROM public.bookings AS b
    WHERE b.user_id = auth.uid()
      AND EXISTS (SELECT 1 FROM public.court_cameras AS cc WHERE cc.pitch_id = b.pitch_id)
    ORDER BY b.created_at DESC
    LIMIT 1
  ), FALSE);
$$;

-- ════════════════════════════════════════════════════════════════════
-- 5. The organiser
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_recording(p_booking_id uuid, p_on boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_reason  text;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'REC_NOT_ORGANISER' USING ERRCODE = '42501';
  END IF;
  IF v_booking.starts_at <= now() THEN
    RAISE EXCEPTION 'REC_FROZEN' USING ERRCODE = 'P0001';
  END IF;
  IF v_booking.state NOT IN ('pending', 'collecting', 'paid', 'confirmed') THEN
    RAISE EXCEPTION 'REC_NOT_LIVE' USING ERRCODE = 'P0001';
  END IF;
  IF p_on THEN
    v_reason := public.recording_blocked_reason(p_booking_id);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION '%', v_reason USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- off means no file: an armed row that has not started goes
    DELETE FROM public.recordings WHERE booking_id = p_booking_id AND state = 'scheduled';
  END IF;
  UPDATE public.bookings SET recording_consented = p_on WHERE id = p_booking_id;
END;
$$;

-- The organiser deletes the match for everyone. Returns the file to remove;
-- the recording function removes it and stamps purged_at.
CREATE OR REPLACE FUNCTION public.recording_delete(p_recording_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec public.recordings%ROWTYPE;
BEGIN
  SELECT r.* INTO v_rec
  FROM public.recordings AS r
  INNER JOIN public.bookings AS b ON r.booking_id = b.id
  WHERE r.id = p_recording_id AND b.user_id = auth.uid()
  FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REC_NOT_ORGANISER' USING ERRCODE = '42501';
  END IF;
  IF v_rec.state IN ('scheduled', 'recording') THEN
    RAISE EXCEPTION 'REC_NOT_FINISHED' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.recordings
  SET state = 'deleted', deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
  WHERE id = p_recording_id;
  RETURN v_rec.storage_key;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 6. The recorder on site
-- ════════════════════════════════════════════════════════════════════
-- Called by the recorder function on every tick with the hash of the
-- device's token. Stamps the heartbeat, arms consented bookings starting
-- inside the window, disarms rows whose booking no longer qualifies, and
-- returns what this camera should be doing.
CREATE OR REPLACE FUNCTION public.recorder_sync(p_token_hash text, p_window interval DEFAULT interval '2 hours')
RETURNS TABLE (
  recording_id uuid,
  booking_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cam public.court_cameras%ROWTYPE;
BEGIN
  PERFORM public.assert_service_role();
  SELECT cc.* INTO v_cam
  FROM public.court_cameras AS cc
  INNER JOIN public.court_camera_tokens AS t ON cc.id = t.camera_id
  WHERE t.token_hash = p_token_hash AND cc.retired_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REC_UNKNOWN_DEVICE' USING ERRCODE = '42501';
  END IF;

  UPDATE public.court_cameras SET last_seen_at = now() WHERE id = v_cam.id;

  -- disarm: not started, and the booking no longer qualifies
  DELETE FROM public.recordings AS r
  USING public.bookings AS b
  WHERE r.booking_id = b.id
    AND r.camera_id = v_cam.id
    AND r.state = 'scheduled'
    AND (
      NOT b.recording_consented
      OR b.state NOT IN ('paid', 'confirmed')
      OR public.recording_blocked_reason(b.id) IS NOT NULL
    );

  -- arm
  INSERT INTO public.recordings (booking_id, camera_id, expires_at)
  SELECT b.id, v_cam.id, b.ends_at + interval '30 days'
  FROM public.bookings AS b
  WHERE b.pitch_id = v_cam.pitch_id
    AND b.recording_consented
    AND b.state IN ('paid', 'confirmed')
    AND b.starts_at < now() + p_window
    AND b.ends_at > now()
    AND public.recording_blocked_reason(b.id) IS NULL
  ON CONFLICT ON CONSTRAINT recordings_booking_id_key DO NOTHING;

  RETURN QUERY
  SELECT r.id, b.id, b.starts_at, b.ends_at, r.state
  FROM public.recordings AS r
  INNER JOIN public.bookings AS b ON r.booking_id = b.id
  WHERE r.camera_id = v_cam.id
    AND r.state IN ('scheduled', 'recording')
  ORDER BY b.starts_at;
END;
$$;

-- The recorder reports. scheduled → recording (only inside the booking's
-- window) → processing (the file is being uploaded; returns where) →
-- ready; anything unfinished may fail. A recording that never reached
-- ready by the booking's end plus six hours is the sweep's to fail.
CREATE OR REPLACE FUNCTION public.recorder_mark(
  p_token_hash text,
  p_recording_id uuid,
  p_state text,
  p_bytes bigint DEFAULT NULL,
  p_duration_s int DEFAULT NULL,
  p_failure text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec     public.recordings%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_key     text;
BEGIN
  PERFORM public.assert_service_role();
  SELECT r.* INTO v_rec
  FROM public.recordings AS r
  INNER JOIN public.court_camera_tokens AS t ON r.camera_id = t.camera_id
  WHERE r.id = p_recording_id AND t.token_hash = p_token_hash
  FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REC_UNKNOWN_DEVICE' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = v_rec.booking_id;

  IF p_state = 'recording' THEN
    IF v_rec.state <> 'scheduled' THEN
      RAISE EXCEPTION 'REC_BAD_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    -- the camera never runs outside the booking (fifteen seconds for clocks)
    IF now() < v_booking.starts_at - interval '15 seconds' OR now() >= v_booking.ends_at THEN
      RAISE EXCEPTION 'REC_OUTSIDE_WINDOW' USING ERRCODE = 'P0001';
    END IF;
    IF NOT v_booking.recording_consented OR public.recording_blocked_reason(v_booking.id) IS NOT NULL THEN
      RAISE EXCEPTION 'REC_NOT_CONSENTED' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.recordings SET state = 'recording', started_at = now(), updated_at = now()
    WHERE id = p_recording_id;
  ELSIF p_state = 'processing' THEN
    IF v_rec.state <> 'recording' THEN
      RAISE EXCEPTION 'REC_BAD_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    v_key := 'bookings/' || v_rec.booking_id || '/' || v_rec.id || '.mp4';
    UPDATE public.recordings
    SET state = 'processing', ended_at = least(now(), v_booking.ends_at), storage_key = v_key, updated_at = now()
    WHERE id = p_recording_id;
  ELSIF p_state = 'ready' THEN
    IF v_rec.state <> 'processing' THEN
      RAISE EXCEPTION 'REC_BAD_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.recordings
    SET state = 'ready', bytes = p_bytes, duration_s = p_duration_s, updated_at = now()
    WHERE id = p_recording_id;
    v_key := v_rec.storage_key;
  ELSIF p_state = 'failed' THEN
    IF v_rec.state NOT IN ('scheduled', 'recording', 'processing') THEN
      RAISE EXCEPTION 'REC_BAD_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.recordings
    SET state = 'failed', failure = left(coalesce(p_failure, 'unknown'), 500), updated_at = now()
    WHERE id = p_recording_id;
    v_key := v_rec.storage_key;
  ELSE
    RAISE EXCEPTION 'REC_BAD_TRANSITION' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_key;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 7. Watching
-- ════════════════════════════════════════════════════════════════════
-- A player in on the booking gets the file to sign; nobody else.
CREATE OR REPLACE FUNCTION public.recording_for_viewer(p_booking_id uuid)
RETURNS TABLE (recording_id uuid, storage_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_recording_viewer(p_booking_id) THEN
    RAISE EXCEPTION 'REC_NOT_VIEWER' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.id, r.storage_key FROM public.recordings AS r
  WHERE r.booking_id = p_booking_id AND r.state = 'ready' AND r.expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REC_NOT_READY' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Ludi staff, for support only, with a reason, audited.
CREATE OR REPLACE FUNCTION public.recording_staff_read(p_recording_id uuid, p_reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'REC_NOT_STAFF' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REC_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  SELECT storage_key INTO v_key FROM public.recordings
  WHERE id = p_recording_id AND state = 'ready';
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'REC_NOT_READY' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.recording_access (recording_id, read_by, reason)
  VALUES (p_recording_id, auth.uid(), btrim(p_reason));
  RETURN v_key;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 8. Expiry
-- ════════════════════════════════════════════════════════════════════
-- What the daily sweep removes: past thirty days, deleted but not yet
-- removed, or stuck short of ready six hours after the game.
CREATE OR REPLACE FUNCTION public.recordings_to_purge()
RETURNS TABLE (recording_id uuid, storage_key text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  -- stuck: armed or running long after the booking ended
  UPDATE public.recordings AS r
  SET state = 'failed', failure = 'stalled', updated_at = now()
  FROM public.bookings AS b
  WHERE r.booking_id = b.id
    AND r.state IN ('scheduled', 'recording', 'processing')
    AND b.ends_at < now() - interval '6 hours';

  RETURN QUERY
  SELECT r.id, r.storage_key,
    CASE WHEN r.state = 'deleted' THEN 'deleted' ELSE 'expired' END
  FROM public.recordings AS r
  WHERE r.purged_at IS NULL
    AND (r.state = 'deleted' OR r.expires_at <= now());
END;
$$;

CREATE OR REPLACE FUNCTION public.recording_purged(p_recording_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  UPDATE public.recordings
  SET state = 'deleted', deleted_at = coalesce(deleted_at, now()), purged_at = now(), updated_at = now()
  WHERE id = p_recording_id;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 9. Admin: a camera goes up, a camera comes down
-- ════════════════════════════════════════════════════════════════════
-- Returns the device token once; only its hash is kept.
CREATE OR REPLACE FUNCTION public.camera_register(p_pitch_id uuid, p_vendor text DEFAULT 'rtsp', p_device_ref text DEFAULT NULL)
RETURNS TABLE (camera_id uuid, device_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_id    uuid;
  v_token text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'REC_NOT_STAFF' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.court_cameras WHERE pitch_id = p_pitch_id AND retired_at IS NULL) THEN
    RAISE EXCEPTION 'REC_CAMERA_EXISTS' USING ERRCODE = 'P0001';
  END IF;
  v_token := 'cam_' || encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.court_cameras (pitch_id, vendor, device_ref)
  VALUES (p_pitch_id, coalesce(nullif(btrim(p_vendor), ''), 'rtsp'), nullif(btrim(p_device_ref), ''))
  RETURNING id INTO v_id;
  INSERT INTO public.court_camera_tokens (camera_id, token_hash)
  VALUES (v_id, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  RETURN QUERY SELECT v_id, v_token;
END;
$$;

-- A retired camera stops arming; bookings already switched on keep the
-- flag but no new recording is made.
CREATE OR REPLACE FUNCTION public.camera_retire(p_camera_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'REC_NOT_STAFF' USING ERRCODE = '42501';
  END IF;
  UPDATE public.court_cameras SET retired_at = now() WHERE id = p_camera_id AND retired_at IS NULL;
  DELETE FROM public.court_camera_tokens WHERE camera_id = p_camera_id;
  DELETE FROM public.recordings WHERE camera_id = p_camera_id AND state = 'scheduled';
END;
$$;

REVOKE ALL ON FUNCTION public.recording_blocked_reason(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_recordings_guard() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_recording_viewer(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.recording_state(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.pitch_has_camera(uuid) FROM public;
REVOKE ALL ON FUNCTION public.invite_recorded(text) FROM public;
REVOKE ALL ON FUNCTION public.my_recording_default() FROM public, anon;
REVOKE ALL ON FUNCTION public.set_recording(uuid, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.recording_delete(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.recorder_sync(text, interval) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.recorder_mark(text, uuid, text, bigint, int, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.recording_for_viewer(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.recording_staff_read(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.recordings_to_purge() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.recording_purged(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.camera_register(uuid, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.camera_retire(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_recording_viewer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recording_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pitch_has_camera(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_recorded(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_recording_default() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_recording(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recording_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recording_for_viewer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recording_staff_read(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.camera_register(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.camera_retire(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 10. The bucket: private, video only. Reached through signed URLs the
-- recording and recorder functions mint with the service role; no storage
-- policy grants anyone else a read. Guarded: CI's dry-run image may not
-- carry the storage schema.
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets absent; skipping the recordings bucket.';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('recordings', 'recordings', FALSE, 4294967296, ARRAY['video/mp4'])
  ON CONFLICT (id) DO NOTHING;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 11. The daily sweep: POST to the recordings-sweep function. Guarded
-- like ludi-expire-collecting; URL and secret come from Vault
-- (recordings_sweep_url, recordings_sweep_secret).
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE 'pg_cron/pg_net unavailable; skipping the recordings sweep schedule.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  PERFORM cron.schedule(
    'ludi-recordings-sweep',
    '17 4 * * *',
    $job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets
               WHERE name = 'recordings_sweep_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sweep-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                             WHERE name = 'recordings_sweep_secret')
      ),
      body := '{}'::jsonb
    )
    $job$
  );
END;
$$;
