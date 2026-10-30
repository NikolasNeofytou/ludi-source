-- 20261015000001_confirmation_and_reminder.sql
-- The player's own game is minted (plans/reach.md R5, ADR-0048): a
-- booking confirmed → its organiser; two hours before kickoff → everyone
-- in; cancelled → everyone in. The ledger and the sender exist
-- (20261014000004); this migration is the first two minters — a trigger
-- on the booking's state, and a clock for the reminder.
--
-- The venue's own bookings — walk-ins at the counter and the standing
-- series — are not a player's game and mint nothing: the owner books
-- them, the owner knows.
--
-- Contents:
--   1. tg_bookings_notify_state — confirmed, cancelled
--   2. mint_reminders           — two hours before, on a five-minute clock
--   3. the clock               — ludi-mint-reminders

-- ════════════════════════════════════════════════════════════════════
-- 1. The booking's state
-- ════════════════════════════════════════════════════════════════════
-- A booking becomes a player's game when it enters paid or confirmed from
-- anything else (pending → paid at the webhook, collecting → confirmed at
-- settlement); the organiser is told once, however many times the state
-- is touched after that. It stops being one when it leaves a live state
-- for a dead one; everyone still in — the organiser included — is told.
-- SECURITY DEFINER: the trigger fires under whichever role changed the
-- row, and minting is the database's, not theirs.
CREATE OR REPLACE FUNCTION public.tg_bookings_notify_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_was_live boolean;
  v_is_live boolean;
  v_is_dead boolean;
  v_seat record;
BEGIN
  IF NEW.origin = 'walk_in' OR NEW.series_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_was_live := tg_op = 'UPDATE' AND OLD.state IN ('paid', 'confirmed');
  v_is_live := NEW.state IN ('paid', 'confirmed');
  v_is_dead := NEW.state IN ('cancelled', 'cancelled_no_refund', 'refunded', 'refunded_by_admin');

  IF v_is_live AND NOT v_was_live THEN
    PERFORM public.mint_player_notice(NEW.user_id, 'booking_confirmed', NEW.id);
  ELSIF v_is_dead AND v_was_live THEN
    FOR v_seat IN
      SELECT bp.user_id FROM public.booking_participants AS bp
      WHERE bp.booking_id = NEW.id AND bp.status = 'in'
    LOOP
      PERFORM public.mint_player_notice(v_seat.user_id, 'fixture_cancelled', NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_bookings_notify_state() FROM public, anon, authenticated;

CREATE TRIGGER tg_bookings_notify_state
AFTER INSERT OR UPDATE OF state ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_bookings_notify_state();

COMMENT ON FUNCTION public.tg_bookings_notify_state() IS
'Mints the organiser''s booking_confirmed when a booking enters paid or '
'confirmed, and everyone''s fixture_cancelled when it leaves a live state '
'for a dead one (ADR-0048, plans/reach.md R5). Walk-ins and standing '
'series mint nothing.';

-- ════════════════════════════════════════════════════════════════════
-- 2. The reminder
-- ════════════════════════════════════════════════════════════════════
-- Every five minutes: the live app games kicking off in the next two
-- hours that have not been reminded get one row per seat still in. The
-- window overlaps itself on purpose (ten minutes for a five-minute
-- clock); the ledger's UNIQUE makes the overlap mint nothing twice. A
-- game booked inside the two hours gets no reminder — its confirmation
-- just said when it is.
CREATE OR REPLACE FUNCTION public.mint_reminders(p_now timestamptz DEFAULT now())
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seat record;
  v_n int := 0;
BEGIN
  FOR v_seat IN
    SELECT b.id AS booking_id, bp.user_id
    FROM public.bookings AS b
    INNER JOIN public.booking_participants AS bp
      ON bp.booking_id = b.id AND bp.status = 'in'
    WHERE b.state IN ('paid', 'confirmed')
      AND b.origin = 'app'
      AND b.series_id IS NULL
      AND b.starts_at > p_now + interval '1 hour 50 minutes'
      AND b.starts_at <= p_now + interval '2 hours'
  LOOP
    v_n := v_n + public.mint_player_notice(v_seat.user_id, 'reminder', v_seat.booking_id, NULL, p_now);
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.mint_reminders(timestamptz) FROM public, anon, authenticated;

COMMENT ON FUNCTION public.mint_reminders(timestamptz) IS
'Mints the reminder for every seat still in a live app game kicking off '
'in the next two hours (ADR-0048, plans/reach.md R5). Runs every five '
'minutes from pg_cron; the window overlaps and the ledger dedups.';

-- ════════════════════════════════════════════════════════════════════
-- 3. The clock
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron unavailable; skipping mint-reminders schedule.';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS pg_cron;

  PERFORM cron.schedule(
    'ludi-mint-reminders',
    '*/5 * * * *',
    $cmd$SELECT public.mint_reminders();$cmd$
  );

  RAISE NOTICE 'Scheduled ludi-mint-reminders every 5 minutes.';
END;
$$;
