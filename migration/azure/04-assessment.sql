-- migration/azure/04-assessment.sql
-- Additive migration for #117 (AI self-assessment). IDEMPOTENT — safe to re-run.
-- Apply to prod via psql from Azure Cloud Shell with a temporary single-IP
-- firewall rule (see migration/azure/README.md "How to apply"). HUMAN-GATED.
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
