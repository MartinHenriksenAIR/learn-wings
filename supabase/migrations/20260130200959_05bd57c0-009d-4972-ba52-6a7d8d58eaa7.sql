-- Add preferred_language column to profiles
ALTER TABLE public.profiles 
ADD COLUMN preferred_language text DEFAULT 'en' CHECK (preferred_language IN ('en', 'da'));