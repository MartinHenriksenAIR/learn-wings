-- 06-assessment.sql
-- #117 AI self-assessment: assessment_attempts table + profiles.assessment_level
-- / assessment_skipped_at. Idempotent; safe to re-run.
-- MUST run on prod BEFORE the #117 deploy: functions/user-context reads
-- assessment_level, assessment_skipped_at, and assessment_attempts on EVERY
-- login, so the objects must exist the moment the new function code goes live.
-- Folded into 01-schema.sql after apply (see migration/azure/README.md).
BEGIN;

CREATE TABLE IF NOT EXISTS public.assessment_attempts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  score                 integer NOT NULL,
  level                 public.course_level NOT NULL,
  answers               jsonb NOT NULL,
  questionnaire_version text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_user ON public.assessment_attempts (user_id, created_at DESC);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS assessment_level public.course_level;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS assessment_skipped_at timestamptz;

COMMIT;
