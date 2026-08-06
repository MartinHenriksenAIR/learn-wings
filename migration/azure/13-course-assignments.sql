-- Additive, idempotent migration for #365 (mandatory/recommended training assignment).
-- Apply to prod directly, then fold into 01-schema.sql (standing rule, see README).
--
-- course_assignments records that an admin has assigned a course to a learner
-- (user_id set) or to a whole org (user_id NULL — applies to current AND future
-- active members, resolved at read time). mandatory=false means "recommended".
-- due_date is optional and purely informational (drives an overdue badge; nothing
-- is blocked after it passes).

BEGIN;

CREATE TABLE IF NOT EXISTS public.course_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES public.profiles(id) ON DELETE CASCADE,  -- NULL = whole-org (dynamic)
  course_id           uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  mandatory           boolean NOT NULL DEFAULT true,
  due_date            date,                                                    -- NULL = no deadline
  assigned_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.course_assignments.user_id   IS 'NULL = assigned to the whole org (applies to current + future active members, resolved at read time).';
COMMENT ON COLUMN public.course_assignments.mandatory IS 'true = mandatory, false = recommended.';
COMMENT ON COLUMN public.course_assignments.due_date  IS 'Optional deadline. NULL = none. Informational (drives an overdue badge); nothing is blocked.';

-- One individual assignment per (org, user, course).
CREATE UNIQUE INDEX IF NOT EXISTS course_assignments_individual_uniq
  ON public.course_assignments (org_id, user_id, course_id) WHERE user_id IS NOT NULL;
-- One whole-org assignment per (org, course).
CREATE UNIQUE INDEX IF NOT EXISTS course_assignments_org_uniq
  ON public.course_assignments (org_id, course_id) WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS course_assignments_org_idx    ON public.course_assignments (org_id);
CREATE INDEX IF NOT EXISTS course_assignments_user_idx   ON public.course_assignments (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS course_assignments_course_idx ON public.course_assignments (course_id);

COMMIT;
