-- 20261016000004_cfa_app_reads.sql
-- Two reads the app's CFA screens need (plans/cfa-in-the-app.md K3, K6).
--
--   my_follows       — the parent's own follows with the team's name, age
--                      group, group and venue, for the list in settings
--                      (competition_teams is not readable from the app)
--   venue_hosts_cfa  — whether a venue hosts CFA matches this season: the
--                      organiser's "ask the parents who play here" shows
--                      only where it can mean something. A yes or no, never
--                      a count of anyone (ADR-0051).

CREATE OR REPLACE FUNCTION public.my_follows()
RETURNS TABLE (
  team_id uuid,
  name text,
  category text,
  group_label text,
  venue_id uuid,
  venue_name text,
  plays boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'my_follows: sign in first' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT f.team_id, t.name, t.category, t.group_label, c.venue_id, v.name, f.plays
  FROM public.team_follows AS f
  INNER JOIN public.competition_teams AS t ON t.id = f.team_id
  INNER JOIN public.competitions AS c ON c.id = t.competition_id
  INNER JOIN public.venues AS v ON v.id = c.venue_id
  WHERE f.user_id = auth.uid()
  ORDER BY t.category, t.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.venue_hosts_cfa(p_venue_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'venue_hosts_cfa: sign in first' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.competitions AS c
    INNER JOIN public.competition_matches AS m ON m.competition_id = c.id AND m.elsewhere IS NULL
    WHERE
      c.venue_id = p_venue_id
      AND c.kind = 'cfa_grassroots'
      AND c.season = public.competition_season((now() AT TIME ZONE 'Europe/Nicosia')::date)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_follows() FROM public, anon;
REVOKE ALL ON FUNCTION public.venue_hosts_cfa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_follows() TO authenticated;
GRANT EXECUTE ON FUNCTION public.venue_hosts_cfa(uuid) TO authenticated;
