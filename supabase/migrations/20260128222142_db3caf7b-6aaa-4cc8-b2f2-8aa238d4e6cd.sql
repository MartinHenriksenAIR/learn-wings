-- Add first_name, last_name, and department columns to profiles table
ALTER TABLE public.profiles
ADD COLUMN first_name text,
ADD COLUMN last_name text,
ADD COLUMN department text;

-- Migrate existing full_name data to first_name/last_name (best effort split on first space)
UPDATE public.profiles
SET 
  first_name = CASE 
    WHEN position(' ' in full_name) > 0 THEN substring(full_name from 1 for position(' ' in full_name) - 1)
    ELSE full_name
  END,
  last_name = CASE 
    WHEN position(' ' in full_name) > 0 THEN substring(full_name from position(' ' in full_name) + 1)
    ELSE NULL
  END
WHERE first_name IS NULL;