-- 04-idea-priority-scores.sql
-- #118 opportunity prioritization: Value x Effort scores on ideas.
-- Idempotent; safe to re-run. Existing rows keep NULL (unscored).
ALTER TABLE public.ideas
  ADD COLUMN IF NOT EXISTS value_score  smallint,
  ADD COLUMN IF NOT EXISTS effort_score smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ideas_value_score_check') THEN
    ALTER TABLE public.ideas ADD CONSTRAINT ideas_value_score_check CHECK (value_score BETWEEN 1 AND 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ideas_effort_score_check') THEN
    ALTER TABLE public.ideas ADD CONSTRAINT ideas_effort_score_check CHECK (effort_score BETWEEN 1 AND 3);
  END IF;
END $$;
