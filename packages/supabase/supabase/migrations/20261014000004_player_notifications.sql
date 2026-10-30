-- 20261014000004_player_notifications.sql
-- The player's notices are a ledger (ADR-0048, plans/reach.md R3): one row
-- per player, per cause, per channel, minted once however often the cause
-- is observed, drained every minute by the notify-players Edge Function.
-- The database decides THAT a player is told; the sweeper decides WHEN;
-- a transport decides HOW — ADR-0030's shape, now for players. Nothing
-- mints here yet: the triggers are R4 and R5. This migration is the
-- table, the one minting function they will call, the quiet-hours rule,
-- and the sender's helpers.
--
-- Contents:
--   1. player_notifications — the ledger
--   2. notice_send_after    — quiet hours for asks
--   3. mint_player_notice   — the one way a row is born
--   4. the sender's helpers — claim, sent, failed, skipped, receipts,
--      disable a dead token (service role only)
--   5. the clock           — ludi-notify-players, every minute

-- ════════════════════════════════════════════════════════════════════
-- 1. The ledger
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE public.player_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (
    kind IN (
      'booking_confirmed', 'reminder', 'fixture_cancelled',
      'keeper_wanted', 'keeper_found', 'seat_offered', 'seat_taken', 'game_full'
    )
  ),
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  -- the keeper request or the seat the notice is about; NULL for the
  -- booking itself
  ref_id uuid,
  channel text NOT NULL CHECK (channel IN ('push', 'email')),
  send_after timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts int NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  error text CHECK (char_length(error) <= 300),
  -- Expo's tickets, one per device: [{"token": "...", "id": "..."}]
  expo_tickets jsonb,
  receipt_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The ADR-0030 rule: a notice is minted once per cause and recipient,
  -- however many times the cause is observed. NULLS NOT DISTINCT so "the
  -- booking itself" (ref_id NULL) dedups too.
  UNIQUE NULLS NOT DISTINCT (kind, booking_id, ref_id, user_id, channel)
);

CREATE INDEX player_notifications_due_idx
ON public.player_notifications (send_after)
WHERE status = 'pending';

CREATE INDEX player_notifications_receipts_idx
ON public.player_notifications (sent_at)
WHERE status = 'sent' AND channel = 'push' AND receipt_checked_at IS NULL;

CREATE INDEX player_notifications_user_idx
ON public.player_notifications (user_id, created_at DESC);

COMMENT ON TABLE public.player_notifications IS
'The player''s notices, a ledger and a queue (ADR-0048, plans/reach.md). '
'Minted by mint_player_notice from the triggers of R4/R5, drained every '
'minute by notify-players. status: pending (due at send_after), sending '
'(claimed by a tick; stale after ten minutes), sent, failed (after five '
'attempts), skipped (deliberately not sent: no token, switched off). '
'A player reads their own rows; nobody writes from the app.';

ALTER TABLE public.player_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY player_notifications_select_own ON public.player_notifications
FOR SELECT TO authenticated
USING (user_id = auth.uid());

REVOKE ALL ON public.player_notifications FROM public, anon;
GRANT SELECT ON public.player_notifications TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2. Quiet hours
-- ════════════════════════════════════════════════════════════════════
-- An ask minted between 23:00 and 08:00 Cyprus time waits for 08:00 —
-- unless the game is so soon that waiting leaves under three hours to
-- answer (kickoff before 11:00). A player's own game — confirmed, the
-- reminder, cancelled, a keeper found, a seat taken, full — is never
-- held: it is their game. Pure, so pgtap can inject the clock.
CREATE OR REPLACE FUNCTION public.notice_send_after(
  p_kind text, p_kickoff timestamptz, p_now timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_local timestamp;
  v_release timestamptz;
BEGIN
  IF p_kind NOT IN ('keeper_wanted', 'seat_offered') THEN
    RETURN p_now;
  END IF;
  v_local := p_now AT TIME ZONE 'Asia/Nicosia';
  IF v_local::time >= time '23:00' THEN
    v_release := (date_trunc('day', v_local) + interval '1 day 8 hours') AT TIME ZONE 'Asia/Nicosia';
  ELSIF v_local::time < time '08:00' THEN
    v_release := (date_trunc('day', v_local) + interval '8 hours') AT TIME ZONE 'Asia/Nicosia';
  ELSE
    RETURN p_now;
  END IF;
  IF p_kickoff < v_release + interval '3 hours' THEN
    RETURN p_now;
  END IF;
  RETURN v_release;
END;
$$;

COMMENT ON FUNCTION public.notice_send_after(text, timestamptz, timestamptz) IS
'When a notice may go: now, or 08:00 Cyprus time for an ask minted in the '
'night (23:00-08:00), unless kickoff is before 11:00 (plans/reach.md). '
'The player''s own game is never held.';

-- ════════════════════════════════════════════════════════════════════
-- 3. Minting
-- ════════════════════════════════════════════════════════════════════
-- The one way a row is born. Reads the player's switch for the kind
-- ("games" for their own fixture, "asks" for a keeper wanted or a seat
-- offered) and their live tokens, and mints:
--   push  — pending when there is a token; skipped (no_token /
--           switched_off) otherwise, so the ledger says why nothing came
--   email — pending for the kinds a player wants in writing (confirmed,
--           cancelled) when they have an address and the switch is on
-- Nothing for an erased account. ON CONFLICT DO NOTHING, so a trigger
-- firing twice, a sweeper re-running or an admin double-clicking mints
-- nothing new. Returns the rows inserted.
CREATE OR REPLACE FUNCTION public.mint_player_notice(
  p_user_id uuid,
  p_kind text,
  p_booking_id uuid,
  p_ref_id uuid DEFAULT NULL,
  p_send_after timestamptz DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_ask boolean := p_kind IN ('keeper_wanted', 'seat_offered');
  v_wants_email boolean := p_kind IN ('booking_confirmed', 'fixture_cancelled');
  v_switch boolean;
  v_erased boolean;
  v_email text;
  v_has_token boolean;
  v_kickoff timestamptz;
  v_send_after timestamptz;
  v_push_status text;
  v_push_error text;
  v_inserted int := 0;
  v_n int;
BEGIN
  SELECT
    CASE WHEN v_is_ask THEN u.notify_asks ELSE u.notify_games END,
    u.anonymized_at IS NOT NULL,
    au.email
  INTO v_switch, v_erased, v_email
  FROM public.users AS u
  LEFT JOIN auth.users AS au ON au.id = u.id
  WHERE u.id = p_user_id;
  IF NOT FOUND OR v_erased THEN
    RETURN 0;
  END IF;

  SELECT b.starts_at INTO v_kickoff FROM public.bookings AS b WHERE b.id = p_booking_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  v_send_after := coalesce(p_send_after, public.notice_send_after(p_kind, v_kickoff));

  SELECT exists(
    SELECT 1 FROM public.push_tokens AS t
    WHERE t.user_id = p_user_id AND t.disabled_at IS NULL
  ) INTO v_has_token;

  IF NOT v_switch THEN
    v_push_status := 'skipped';
    v_push_error := 'switched_off';
  ELSIF NOT v_has_token THEN
    v_push_status := 'skipped';
    v_push_error := 'no_token';
  ELSE
    v_push_status := 'pending';
    v_push_error := NULL;
  END IF;

  INSERT INTO public.player_notifications
  (user_id, kind, booking_id, ref_id, channel, send_after, status, error)
  VALUES (p_user_id, p_kind, p_booking_id, p_ref_id, 'push', v_send_after, v_push_status, v_push_error)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_inserted := v_inserted + v_n;

  IF v_wants_email AND v_switch AND v_email IS NOT NULL THEN
    INSERT INTO public.player_notifications
    (user_id, kind, booking_id, ref_id, channel, send_after)
    VALUES (p_user_id, p_kind, p_booking_id, p_ref_id, 'email', v_send_after)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_inserted := v_inserted + v_n;
  END IF;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.mint_player_notice(uuid, text, uuid, uuid, timestamptz)
FROM public, anon, authenticated;

COMMENT ON FUNCTION public.mint_player_notice(uuid, text, uuid, uuid, timestamptz) IS
'Mints a player''s notice for a cause (ADR-0048): a push row (pending, or '
'skipped with the reason when there is no token or the switch is off) and '
'an email row for the kinds a player wants in writing. Once per cause and '
'recipient. Called by the R4/R5 triggers, never by the app.';

-- ════════════════════════════════════════════════════════════════════
-- 4. The sender's helpers (service role only)
-- ════════════════════════════════════════════════════════════════════
-- Claim a batch: rows due now flip to sending (a tick that dies leaves
-- them there; ten minutes later they are pending again), and come back
-- with everything the sender needs to render — the player's language
-- and address, their live tokens, the game, and what the notice is
-- about. One query, FOR UPDATE SKIP LOCKED, so two ticks never claim
-- the same row.
CREATE OR REPLACE FUNCTION public.claim_player_notifications(p_limit int DEFAULT 100)
RETURNS TABLE (
  id uuid,
  kind text,
  channel text,
  user_id uuid,
  attempts int,
  locale text,
  first_name text,
  email text,
  tokens text [],
  booking_id uuid,
  code text,
  starts_at timestamptz,
  invite_token text,
  pitch_name text,
  venue_name text,
  context jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();

  -- A claim older than ten minutes belongs to a tick that died.
  UPDATE public.player_notifications AS n
  SET status = 'pending', claimed_at = NULL
  WHERE n.status = 'sending' AND n.claimed_at < now() - interval '10 minutes';

  RETURN QUERY
  WITH claimed AS (
    UPDATE public.player_notifications AS n
    SET status = 'sending', claimed_at = now(), attempts = n.attempts + 1
    WHERE n.id IN (
      SELECT p.id FROM public.player_notifications AS p
      WHERE p.status = 'pending' AND p.send_after <= now()
      ORDER BY p.send_after
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING n.id, n.kind, n.channel, n.user_id, n.attempts, n.booking_id, n.ref_id
  )

  SELECT
    c.id,
    c.kind,
    c.channel,
    c.user_id,
    c.attempts,
    coalesce(u.preferred_locale, 'en') AS locale,
    u.first_name,
    au.email::text,
    array(
      SELECT t.token FROM public.push_tokens AS t
      WHERE t.user_id = c.user_id AND t.disabled_at IS NULL
    ) AS tokens,
    c.booking_id,
    b.code,
    b.starts_at,
    b.invite_token,
    p.name AS pitch_name,
    v.name AS venue_name,
    jsonb_strip_nulls(jsonb_build_object(
      'shape', gk.shape,
      'keeper_name', ku.first_name,
      'slot_kind', bp.slot_kind
    )) AS context
  FROM claimed AS c
  INNER JOIN public.users AS u ON u.id = c.user_id
  LEFT JOIN auth.users AS au ON au.id = c.user_id
  INNER JOIN public.bookings AS b ON b.id = c.booking_id
  INNER JOIN public.pitches AS p ON p.id = b.pitch_id
  INNER JOIN public.venues AS v ON v.id = p.venue_id
  LEFT JOIN public.gk_requests AS gk ON gk.id = c.ref_id
  LEFT JOIN public.users AS ku ON ku.id = gk.claimed_by
  LEFT JOIN public.booking_participants AS bp ON bp.id = c.ref_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.player_notification_sent(p_id uuid, p_tickets jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  UPDATE public.player_notifications
  SET status = 'sent', sent_at = now(), error = NULL, expo_tickets = p_tickets
  WHERE id = p_id AND status = 'sending';
END;
$$;

-- A transport that said no: back to pending with a growing wait, five
-- times; then failed for good, with the last error kept.
CREATE OR REPLACE FUNCTION public.player_notification_failed(p_id uuid, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  UPDATE public.player_notifications AS n
  SET
    status = CASE WHEN n.attempts >= 5 THEN 'failed' ELSE 'pending' END,
    send_after = CASE WHEN n.attempts >= 5 THEN n.send_after ELSE now() + (n.attempts * interval '2 minutes') END,
    claimed_at = NULL,
    error = left(p_error, 300)
  WHERE n.id = p_id AND n.status = 'sending';
END;
$$;

-- Deliberately not sent, and the ledger says why (no live token left,
-- no email channel configured).
CREATE OR REPLACE FUNCTION public.player_notification_skipped(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  UPDATE public.player_notifications
  SET status = 'skipped', claimed_at = NULL, error = left(p_reason, 300)
  WHERE id = p_id AND status = 'sending';
END;
$$;

-- Expo answered for a device that is gone (DeviceNotRegistered): the
-- token is disabled until that device registers again.
CREATE OR REPLACE FUNCTION public.disable_push_token(p_token text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  UPDATE public.push_tokens
  SET disabled_at = now(), disabled_reason = left(p_reason, 120)
  WHERE token = p_token AND disabled_at IS NULL;
END;
$$;

-- Sent pushes whose receipts are old enough to read (Expo settles them
-- within fifteen minutes) and not read yet.
CREATE OR REPLACE FUNCTION public.player_notification_receipts(p_limit int DEFAULT 100)
RETURNS TABLE (id uuid, expo_tickets jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  RETURN QUERY
  SELECT n.id, n.expo_tickets
  FROM public.player_notifications AS n
  WHERE n.status = 'sent' AND n.channel = 'push'
    AND n.receipt_checked_at IS NULL
    AND n.expo_tickets IS NOT NULL
    AND n.sent_at < now() - interval '15 minutes'
  ORDER BY n.sent_at
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.player_notification_receipt_checked(p_id uuid, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_service_role();
  UPDATE public.player_notifications
  SET receipt_checked_at = now(), error = coalesce(left(p_error, 300), error)
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_player_notifications(int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.player_notification_sent(uuid, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.player_notification_failed(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.player_notification_skipped(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.disable_push_token(text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.player_notification_receipts(int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.player_notification_receipt_checked(uuid, text) FROM public, anon, authenticated;

COMMENT ON FUNCTION public.claim_player_notifications(int) IS
'The sender''s batch (ADR-0048): due rows flip to sending and come back '
'rendered-ready — the player''s language, address and live tokens, the '
'game, and the request or seat the notice is about. FOR UPDATE SKIP '
'LOCKED; a claim older than ten minutes is released first. Service role.';

-- ════════════════════════════════════════════════════════════════════
-- 5. The clock: every minute, POST to notify-players
-- ════════════════════════════════════════════════════════════════════
-- The expire-collecting shape: guarded so CI's vanilla Postgres applies
-- the migration; URL and secret from Vault under
--   notify_players_url     https://<ref>.supabase.co/functions/v1/notify-players
--   notify_players_secret  the NOTIFY_PLAYERS_SECRET the function checks
-- Until both exist the job errors visibly in cron.job_run_details each
-- minute — seeding them is a deploy-day step (plans/reach.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
    OR NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE NOTICE 'pg_cron/pg_net unavailable; skipping notify-players schedule.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  PERFORM cron.schedule(
    'ludi-notify-players',
    '* * * * *',
    $job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets
               WHERE name = 'notify_players_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-notify-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                             WHERE name = 'notify_players_secret')
      ),
      body := '{}'::jsonb
    )
    $job$
  );

  RAISE NOTICE 'Scheduled ludi-notify-players every minute.';
END;
$$;
