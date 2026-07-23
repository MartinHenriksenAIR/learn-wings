-- 07-exercises.sql — Exercises interactive lesson family, Phase 1 (#227, ADR-0017).
-- Additive, idempotent. Apply to prod directly (owner-run), like 03-seat-requests.sql.
BEGIN;

-- 1. New lesson_type value (idempotent; PG12+ supports IF NOT EXISTS).
ALTER TYPE public.lesson_type ADD VALUE IF NOT EXISTS 'exercise';

-- 2. Exercise payload table.
CREATE TABLE IF NOT EXISTS public.exercises (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     uuid UNIQUE NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  exercise_kind text NOT NULL,
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT exercises_config_is_object CHECK (jsonb_typeof(config) = 'object')
);

-- 3. Feature flag (default off) — merge into the existing features row without
--    clobbering other keys. No-op if the key is already present.
UPDATE public.platform_settings
   SET value = value || '{"exercises_enabled": false}'::jsonb
 WHERE key = 'features'
   AND NOT (value ? 'exercises_enabled');

COMMIT;
