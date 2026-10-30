-- 20260916000001_counter_follow_through.sql
-- Counter follow-through (plans/counter-follow-through.md).
--
-- One audit word and one audit target: enabling a city for players is a
-- founder decision taken on the enrolment Review page, and the log should
-- say so — `enable_city` on target `city` — rather than hide it under
-- 'other' on a venue.
--
-- Both CHECKs are widened FROM THEIR LIVE DEFINITION, never from a retyped
-- list: the action_type list has been re-stated by five migrations and the
-- one that missed a word failed on prod this morning (JOURNAL 2026-09-15).
-- pg_get_constraintdef keeps every word the database already accepts; only
-- the new one is appended. Idempotent: a word already present is skipped.

DO $$
DECLARE
  v_pair  text[];
  v_def   text;
  v_list  text;
BEGIN
  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['admin_actions_action_type_check', 'action_type', 'enable_city'],
    ARRAY['admin_actions_target_type_check', 'target_type', 'city']
  ]
  LOOP
    SELECT pg_get_constraintdef(c.oid)
    INTO v_def
    FROM pg_constraint AS c
    WHERE c.conname = v_pair[1]
      AND c.conrelid = 'public.admin_actions'::regclass;

    IF v_def IS NULL THEN
      RAISE EXCEPTION '%: constraint not found', v_pair[1];
    END IF;

    -- CHECK ((col = ANY (ARRAY['a'::text, 'b'::text, …])))
    v_list := substring(v_def FROM 'ARRAY\[(.*)\]');
    IF v_list IS NULL THEN
      RAISE EXCEPTION '%: unexpected definition %', v_pair[1], v_def;
    END IF;

    IF v_list LIKE '%' || quote_literal(v_pair[3]) || '::text%' THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.admin_actions DROP CONSTRAINT %I', v_pair[1]);
    EXECUTE format(
      'ALTER TABLE public.admin_actions ADD CONSTRAINT %I CHECK (%I = ANY (ARRAY[%s, %L::text]))',
      v_pair[1], v_pair[2], v_list, v_pair[3]
    );
  END LOOP;
END
$$;

COMMENT ON COLUMN public.admin_actions.target_type IS
  'What the action touched: booking, pitch, venue, user, payment — or, '
  'since 2026-09-16, city (enable_city from the enrolment Review page).';
