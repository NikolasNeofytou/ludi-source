-- 46_court_cameras.sql — court cameras (20261013000006, ADR-0042)
-- Under test:
--   camera_register / camera_retire: admin only; one working camera a court;
--     the device token works until the camera is retired
--   court_cameras: the owner reads his courts' cameras, a stranger nothing
--   set_recording: the organiser only; never a walk-in, a court without a
--     camera, or a roster with a player under 18; the column guard keeps
--     the organiser from writing the flag directly
--   invite_recorded: a joiner is told before he takes a spot
--   recorder_sync: service only; an unknown device refused; arms a consented
--     booking inside the window and nothing else; stamps the heartbeat
--   recorder_mark: the state machine, and never outside the booking's window
--   recordings: no row without consent; the roster reads, the owner and a
--     stranger do not; thirty days from the game
--   recording_for_viewer / recording_staff_read: players in; staff with a
--     reason, audited
--   recording_delete / recordings_to_purge / recording_purged
--
-- Fixtures: a4 organises on c1 (venue_a, owned by a2). New players: P (adult,
-- plays on the recorded game), M (under 18).
BEGIN;
SELECT plan(33);

INSERT INTO auth.users (id) VALUES
('00000000-0000-4000-8000-00000000c601'),
('00000000-0000-4000-8000-00000000c602')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (id, first_name, last_name, city_id, role, age_band)
SELECT v.id::uuid, v.n, 'Player', (SELECT id FROM public.cities WHERE code = 'larnaca'), 'player', v.age
FROM (VALUES
  ('00000000-0000-4000-8000-00000000c601', 'Petros', '26_35'),
  ('00000000-0000-4000-8000-00000000c602', 'Minas', 'u18')
) AS v (id, n, age)
ON CONFLICT (id) DO UPDATE
  SET first_name = excluded.first_name, city_id = excluded.city_id, age_band = excluded.age_band;

-- e601: on c1, kicked off ten minutes ago (switched on before kickoff).
-- e602: on c1, three days out. e603: a walk-in on c1. e604: on c2, which has
-- no camera. e605: on c1, ended seven hours ago, switched on.
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES
(
  '00000000-0000-4000-8000-00000000e601', 'RLS-2035-R001', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', now() - interval '10 minutes',
  now() + interval '50 minutes', 'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard'
),
(
  '00000000-0000-4000-8000-00000000e602', 'RLS-2035-R002', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '3 days',
  date_trunc('hour', now()) + interval '3 days 1 hour', 'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard'
),
(
  '00000000-0000-4000-8000-00000000e604', 'RLS-2035-R004', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c2', date_trunc('hour', now()) + interval '2 days',
  date_trunc('hour', now()) + interval '2 days 1 hour', 'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard'
),
(
  '00000000-0000-4000-8000-00000000e605', 'RLS-2035-R005', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', now() - interval '8 hours',
  now() - interval '7 hours', 'completed', 1, 4, 5000, 0, 5000, 500, 'standard'
);
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, origin, walk_in_name, walk_in_phone,
  base_price_cents, total_cents, platform_fee_cents, cancellation_policy
) VALUES (
  '00000000-0000-4000-8000-00000000e603', 'RLS-2035-R003', '00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) + interval '2 days',
  date_trunc('hour', now()) + interval '2 days 1 hour', 'confirmed', 'walk_in', 'Andreas', '99 111111',
  6000, 6000, 0, 'standard'
);
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind)
VALUES ('00000000-0000-4000-8000-00000000e601', '00000000-0000-4000-8000-00000000c601', 'outfield');
CREATE TEMP TABLE t_tok AS
SELECT invite_token FROM public.bookings WHERE id = '00000000-0000-4000-8000-00000000e602';
GRANT SELECT ON t_tok TO anon, authenticated;

-- 1–3. only Ludi puts a camera up, one per court
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$SELECT * FROM public.camera_register('00000000-0000-4000-8000-0000000000c1')$$,
  '42501', 'REC_NOT_STAFF',
  'camera_register: not the owner'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
CREATE TEMP TABLE t_cam AS
SELECT c.camera_id, c.device_token, encode(extensions.digest(c.device_token, 'sha256'), 'hex') AS token_hash
FROM public.camera_register('00000000-0000-4000-8000-0000000000c1', 'rtsp', 'court-1') AS c;
GRANT SELECT ON t_cam TO anon, authenticated;
SELECT isnt((SELECT camera_id FROM t_cam), NULL, 'camera_register: the admin registers a camera');
SELECT throws_ok(
  $$SELECT * FROM public.camera_register('00000000-0000-4000-8000-0000000000c1')$$,
  'P0001', 'REC_CAMERA_EXISTS',
  'camera_register: one working camera a court'
);

-- 4–5. the owner sees his camera, never seen yet; a stranger sees nothing
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is((SELECT health FROM public.v_court_cameras), 'never', 'v_court_cameras: the owner sees his camera');
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is((SELECT count(*) FROM public.court_cameras), 0::bigint, 'court_cameras: a stranger sees nothing');

-- 6. checkout can ask before the booking exists
SELECT public.set_test_anon();
SELECT is(
  ARRAY[
    public.pitch_has_camera('00000000-0000-4000-8000-0000000000c1'),
    public.pitch_has_camera('00000000-0000-4000-8000-0000000000c2')
  ],
  ARRAY[TRUE, FALSE],
  'pitch_has_camera: c1 has one, c2 does not'
);

-- 7–10. who may switch it on
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT throws_ok(
  $$SELECT public.set_recording('00000000-0000-4000-8000-00000000e602', TRUE)$$,
  '42501', 'REC_NOT_ORGANISER',
  'set_recording: not a stranger'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$SELECT public.set_recording('00000000-0000-4000-8000-00000000e604', TRUE)$$,
  'P0001', 'REC_NO_CAMERA',
  'set_recording: not on a court without a camera'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$SELECT public.set_recording('00000000-0000-4000-8000-00000000e603', TRUE)$$,
  'P0001', 'REC_NOT_APP',
  'set_recording: never a walk-in'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT public.set_recording('00000000-0000-4000-8000-00000000e602', TRUE);
SELECT is(
  (SELECT has_camera::text || '/' || consented::text || '/' || can_toggle::text
   FROM public.recording_state('00000000-0000-4000-8000-00000000e602')),
  'true/true/true',
  'set_recording: the organiser switches it on before kickoff'
);

-- 11. a joiner is told
SELECT public.set_test_anon();
SELECT ok(
  public.invite_recorded((SELECT invite_token FROM t_tok)),
  'invite_recorded: the invite says the game is recorded'
);

-- 12. the flag does not move by a direct write
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$UPDATE public.bookings SET recording_consented = FALSE WHERE id = '00000000-0000-4000-8000-00000000e602'$$,
  '42501', NULL,
  'column guard: the organiser cannot write the flag directly'
);

-- 13–14. a player under 18 on the roster: never recorded
RESET ROLE;
INSERT INTO public.booking_participants (booking_id, user_id, slot_kind)
VALUES ('00000000-0000-4000-8000-00000000e602', '00000000-0000-4000-8000-00000000c602', 'outfield');
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT blocked_reason FROM public.recording_state('00000000-0000-4000-8000-00000000e602')),
  'REC_MINOR',
  'recording_state: a player under 18 blocks it'
);
SELECT throws_ok(
  $$SELECT public.set_recording('00000000-0000-4000-8000-00000000e602', TRUE)$$,
  'P0001', 'REC_MINOR',
  'set_recording: never with a player under 18'
);

-- 15. no recordings row without consent
RESET ROLE;
SELECT throws_ok(
  $$INSERT INTO public.recordings (booking_id, camera_id, expires_at)
    VALUES ('00000000-0000-4000-8000-00000000e604', (SELECT camera_id FROM t_cam), now())$$,
  'P0001', 'REC_NOT_CONSENTED',
  'recordings: no row without consent'
);

-- e601 and e605 were switched on before they kicked off
UPDATE public.bookings SET recording_consented = TRUE
WHERE id IN ('00000000-0000-4000-8000-00000000e601', '00000000-0000-4000-8000-00000000e605');

-- 16–19. the recorder's door
SELECT throws_ok(
  format('SELECT * FROM public.recorder_sync(%L)', (SELECT token_hash FROM t_cam)),
  'P0001', 'SERVICE_ROLE_ONLY',
  'recorder_sync: service only'
);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SELECT throws_ok(
  $$SELECT * FROM public.recorder_sync('not-a-device')$$,
  '42501', 'REC_UNKNOWN_DEVICE',
  'recorder_sync: an unknown device is refused'
);
CREATE TEMP TABLE t_sync AS SELECT * FROM public.recorder_sync((SELECT token_hash FROM t_cam));
GRANT SELECT ON t_sync TO anon, authenticated;
SELECT is(
  (SELECT array_agg(booking_id) FROM t_sync),
  ARRAY['00000000-0000-4000-8000-00000000e601'::uuid],
  'recorder_sync: arms the consented game in the window, nothing else'
);
SELECT is(
  (SELECT expires_at FROM public.recordings WHERE booking_id = '00000000-0000-4000-8000-00000000e601'),
  (SELECT ends_at + interval '30 days' FROM public.bookings WHERE id = '00000000-0000-4000-8000-00000000e601'),
  'recordings: thirty days from the game'
);

-- 20. the heartbeat
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', TRUE);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is((SELECT health FROM public.v_court_cameras), 'online', 'recorder_sync: the camera shows online');

-- 21–23. the state machine
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SELECT public.recorder_mark((SELECT token_hash FROM t_cam), (SELECT recording_id FROM t_sync), 'recording');
SELECT is(
  public.recorder_mark((SELECT token_hash FROM t_cam), (SELECT recording_id FROM t_sync), 'processing'),
  'bookings/00000000-0000-4000-8000-00000000e601/' || (SELECT recording_id FROM t_sync) || '.mp4',
  'recorder_mark: processing names the file'
);
SELECT public.recorder_mark((SELECT token_hash FROM t_cam), (SELECT recording_id FROM t_sync), 'ready', 123456, 3600);
SELECT is(
  (SELECT state || '/' || bytes::text FROM public.recordings WHERE id = (SELECT recording_id FROM t_sync)),
  'ready/123456',
  'recorder_mark: ready'
);
SELECT throws_ok(
  format('SELECT public.recorder_mark(%L, %L, %L)', (SELECT token_hash FROM t_cam), (SELECT recording_id FROM t_sync), 'recording'),
  'P0001', 'REC_BAD_TRANSITION',
  'recorder_mark: no going back'
);

-- 24. never outside the booking: a game that ended hours ago does not start
INSERT INTO public.recordings (id, booking_id, camera_id, expires_at)
VALUES (
  '00000000-0000-4000-8000-00000000f605', '00000000-0000-4000-8000-00000000e605',
  (SELECT camera_id FROM t_cam), now() + interval '29 days'
);
SELECT throws_ok(
  format('SELECT public.recorder_mark(%L, %L, %L)', (SELECT token_hash FROM t_cam), '00000000-0000-4000-8000-00000000f605', 'recording'),
  'P0001', 'REC_OUTSIDE_WINDOW',
  'recorder_mark: the camera never runs outside the booking'
);

-- 25. nor before it: the next game on the court does not start early
INSERT INTO public.bookings (
  id, code, user_id, pitch_id, starts_at, ends_at, state, gk_slots, outfield_slots,
  base_price_cents, addons_price_cents, total_cents, platform_fee_cents, cancellation_policy, recording_consented
) VALUES (
  '00000000-0000-4000-8000-00000000e606', 'RLS-2035-R006', '00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000c1', now() + interval '55 minutes', now() + interval '115 minutes',
  'confirmed', 1, 4, 5000, 0, 5000, 500, 'standard', TRUE
);
INSERT INTO public.recordings (id, booking_id, camera_id, expires_at)
VALUES (
  '00000000-0000-4000-8000-00000000f606', '00000000-0000-4000-8000-00000000e606',
  (SELECT camera_id FROM t_cam), now() + interval '29 days'
);
SELECT throws_ok(
  format('SELECT public.recorder_mark(%L, %L, %L)', (SELECT token_hash FROM t_cam), '00000000-0000-4000-8000-00000000f606', 'recording'),
  'P0001', 'REC_OUTSIDE_WINDOW',
  'recorder_mark: nor before kickoff (the minute before is somebody else''s game)'
);

-- 26–28. who watches
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', TRUE);
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c601'::uuid);
SELECT is(
  (SELECT storage_key FROM public.recording_for_viewer('00000000-0000-4000-8000-00000000e601')),
  'bookings/00000000-0000-4000-8000-00000000e601/' || (SELECT recording_id FROM t_sync) || '.mp4',
  'recording_for_viewer: a player on the roster'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$SELECT * FROM public.recording_for_viewer('00000000-0000-4000-8000-00000000e601')$$,
  '42501', 'REC_NOT_VIEWER',
  'recording_for_viewer: never the owner'
);
SELECT is((SELECT count(*) FROM public.recordings), 0::bigint, 'RLS: the owner reads no recordings');

-- 29–30. staff: a reason, and the read is written down
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT throws_ok(
  format('SELECT public.recording_staff_read(%L, %L)', (SELECT recording_id FROM t_sync), ' '),
  'P0001', 'REC_REASON_REQUIRED',
  'recording_staff_read: a reason is required'
);
SELECT public.recording_staff_read((SELECT recording_id FROM t_sync), 'player reported the file will not play');
SELECT is((SELECT count(*) FROM public.recording_access), 1::bigint, 'recording_staff_read: the read is audited');

-- 31. the organiser deletes; a player cannot
SELECT public.set_test_user('00000000-0000-4000-8000-00000000c601'::uuid);
SELECT throws_ok(
  format('SELECT public.recording_delete(%L)', (SELECT recording_id FROM t_sync)),
  '42501', 'REC_NOT_ORGANISER',
  'recording_delete: not a player'
);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT public.recording_delete((SELECT recording_id FROM t_sync));

-- 32. the sweep: the deleted file goes, the stalled one fails
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
CREATE TEMP TABLE t_purge AS SELECT * FROM public.recordings_to_purge();
SELECT is(
  (SELECT reason FROM t_purge WHERE recording_id = (SELECT recording_id FROM t_sync))
  || '/' || (SELECT state FROM public.recordings WHERE id = '00000000-0000-4000-8000-00000000f605'),
  'deleted/failed',
  'recordings_to_purge: the deleted file goes, a stalled one fails'
);
SELECT public.recording_purged((SELECT recording_id FROM t_sync));

-- 33. a retired camera's token stops working
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', TRUE);
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT public.camera_retire((SELECT camera_id FROM t_cam));
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SELECT throws_ok(
  format('SELECT * FROM public.recorder_sync(%L)', (SELECT token_hash FROM t_cam)),
  '42501', 'REC_UNKNOWN_DEVICE',
  'camera_retire: the device is refused'
);

SELECT * FROM finish();
ROLLBACK;
