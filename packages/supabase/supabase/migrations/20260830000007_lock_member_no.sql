-- Lock member_no against self-service edits. The users UPDATE policy is
-- row-level (self-or-admin), so without this a player could PATCH their own
-- member_no via PostgREST and claim any unused number. Same trigger pattern
-- as tg_users_block_role_change (column-level RLS via trigger, ADR-free
-- repo convention since 20260421000005).
--
-- Manual fixes from the SQL editor / psql must bypass it the same way as
-- role changes: SET LOCAL session_replication_role = 'replica' inside the
-- transaction (see docs/JOURNAL.md, "Local-dev admin promotion").

CREATE OR REPLACE FUNCTION public.tg_users_block_member_no_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.member_no IS DISTINCT FROM OLD.member_no AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'member_no change not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_users_block_member_no_change
  BEFORE UPDATE OF member_no ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_users_block_member_no_change();
