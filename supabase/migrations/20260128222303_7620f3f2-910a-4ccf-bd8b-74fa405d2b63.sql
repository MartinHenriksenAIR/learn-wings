-- Update the handle_new_user function to populate first_name and last_name
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_full_name text;
  v_first_name text;
  v_last_name text;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
  
  -- Split full_name into first_name and last_name
  IF position(' ' in v_full_name) > 0 THEN
    v_first_name := substring(v_full_name from 1 for position(' ' in v_full_name) - 1);
    v_last_name := substring(v_full_name from position(' ' in v_full_name) + 1);
  ELSE
    v_first_name := v_full_name;
    v_last_name := NULL;
  END IF;
  
  INSERT INTO public.profiles (id, full_name, first_name, last_name, is_platform_admin)
  VALUES (
    NEW.id,
    v_full_name,
    v_first_name,
    v_last_name,
    FALSE
  );
  RETURN NEW;
END;
$$;