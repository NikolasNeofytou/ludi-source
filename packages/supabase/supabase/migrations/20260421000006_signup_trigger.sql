-- 20260421000006_signup_trigger.sql
-- Auto-create a public.users row when a new auth.users row is created.
-- This is the canonical Supabase pattern. Profile fields are populated from
-- auth metadata where available; the app collects the rest on its onboarding
-- screen and UPDATEs the row.

-- The function runs as SECURITY DEFINER because the trigger fires on auth.users,
-- which a regular authenticated user does not own at insert time.  It must set a
-- safe search_path to prevent hijacking via schema manipulation.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_default_city_id uuid;
BEGIN
  -- Pick the first enabled city in display order as the default.
  -- At launch, that's Larnaca; later it's "the nearest" (geo-based, TBD).
  SELECT id INTO v_default_city_id
  FROM public.cities
  WHERE is_enabled
  ORDER BY display_order ASC, code ASC
  LIMIT 1;

  IF v_default_city_id IS NULL THEN
    RAISE EXCEPTION 'No enabled city found. Seed cities before allowing signups.';
  END IF;

  INSERT INTO public.users (
    id,
    first_name,
    last_name,
    city_id,
    preferred_locale,
    role
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'last_name',  ''),
    v_default_city_id,
    COALESCE(NEW.raw_user_meta_data ->> 'preferred_locale', 'en'),
    'player'
  );

  RETURN NEW;
END;
$$;

-- Drop the trigger first if it exists — makes the migration re-runnable in dev.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates a public.users profile row whenever a new auth.users row is inserted. Populated from raw_user_meta_data; app fills the rest on onboarding.';
