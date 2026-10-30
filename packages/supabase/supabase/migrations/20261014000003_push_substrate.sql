-- 20261014000003_push_substrate.sql
-- The push substrate (plans/reach.md, R2): where a player's device tokens
-- live and the two switches that say what they want to hear about. No
-- notice is minted here — that is R3's ledger (ADR-0048). This migration
-- only makes it possible for a later sender to find a phone.
--
-- Contents:
--   1. push_tokens - one row per device token, owned by whoever signed in
--      on that device last; written only through the two functions
--   2. users.notify_games / users.notify_asks - the two switches
--   3. register_push_token / unregister_push_token

-- ════════════════════════════════════════════════════════════════════
-- 1. The tokens
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  disabled_reason text CHECK (char_length(disabled_reason) <= 120),
  CONSTRAINT push_tokens_token_shape
  CHECK (token ~ '^ExponentPushToken\[[A-Za-z0-9_-]{8,}\]$'),
  CONSTRAINT push_tokens_disabled_pair
  CHECK ((disabled_at IS NULL) = (disabled_reason IS NULL))
);

CREATE INDEX push_tokens_user_idx ON public.push_tokens (user_id)
WHERE disabled_at IS NULL;

COMMENT ON TABLE public.push_tokens IS
'A device''s Expo push token and the player signed in on it (plans/'
'reach.md R2). Written only through register_push_token / '
'unregister_push_token; read by the service role when a notice is sent '
'(R3). A token moves to whoever signs in on the device; disabled_at is '
'set by the sender when Expo reports the device gone, and cleared when '
'the device registers again. Erasure deletes the rows.';

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: the app never reads or writes the table
-- directly, so there is nothing for RLS to allow. The functions below are
-- SECURITY DEFINER; the service role bypasses RLS.
REVOKE ALL ON public.push_tokens FROM public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2. The switches
-- ════════════════════════════════════════════════════════════════════
-- "Games" is the player's own fixtures: confirmed, two hours before,
-- cancelled. "Asks" is what they opted into by going in goal or by playing
-- with a crew: a keeper wanted, a seat offered. Both default on; the
-- settings screen writes them through the player's own-row policy.
ALTER TABLE public.users
ADD COLUMN notify_games boolean NOT NULL DEFAULT TRUE,
ADD COLUMN notify_asks boolean NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.users.notify_games IS
'Notices about the player''s own games (confirmed, reminder, cancelled). '
'A switch in Settings; the sender skips the player when it is off.';
COMMENT ON COLUMN public.users.notify_asks IS
'Asks the player opted into: a keeper wanted where they said they go in '
'goal, a seat offered in a crew they play with. A switch in Settings.';

-- ════════════════════════════════════════════════════════════════════
-- 3. Register and unregister
-- ════════════════════════════════════════════════════════════════════
-- The app calls this whenever it holds a granted permission and a token:
-- after the player says yes, and on every later launch to keep
-- last_seen_at honest. A token that already exists moves to the caller —
-- a device belongs to whoever is signed in on it now — and comes back to
-- life if the sender had disabled it.
CREATE OR REPLACE FUNCTION public.register_push_token(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.push_tokens (user_id, token, platform)
  VALUES (auth.uid(), p_token, p_platform)
  ON CONFLICT (token) DO UPDATE
    SET user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = now(),
        disabled_at = NULL,
        disabled_reason = NULL;
END;
$$;

-- Sign-out: the device is nobody's until someone signs in on it again.
CREATE OR REPLACE FUNCTION public.unregister_push_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.push_tokens
  WHERE token = p_token AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_token(text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.unregister_push_token(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(text) TO authenticated;

COMMENT ON FUNCTION public.register_push_token(text, text) IS
'Claims an Expo push token for the signed-in player (plans/reach.md R2): '
'inserts it, or moves it to the caller and revives it if the sender had '
'disabled it. Called after permission is granted and on every launch.';
COMMENT ON FUNCTION public.unregister_push_token(text) IS
'Drops the caller''s own token on sign-out; a token held by someone else '
'is left alone.';
