-- 05-course-group-id.sql
-- #213 multilingual course identity: shared grouping tag linking language editions of one course.
-- Idempotent; safe to re-run. Existing rows keep NULL (standalone).
-- MUST run on prod BEFORE the #213 deploy: org-course-progress, enroll, enrollment-create,
-- org-course-enrollees, and org-course-org-breakdown all reference courses.course_group_id
-- unconditionally, so the column must exist the moment the new function code goes live.
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS course_group_id uuid;

-- Grouping/lookup index.
CREATE INDEX IF NOT EXISTS idx_courses_course_group_id
  ON public.courses (course_group_id);

-- At most one edition per language per group (partial: standalone NULL-group rows are exempt).
CREATE UNIQUE INDEX IF NOT EXISTS uq_courses_group_language
  ON public.courses (course_group_id, language)
  WHERE course_group_id IS NOT NULL;
