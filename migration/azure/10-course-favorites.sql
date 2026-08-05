-- 10-course-favorites.sql
-- #358 favorite a course: per-user, org-neutral course favorites. A favorite is
-- the pair (user_id, course_id); the PK makes it idempotent and is the natural
-- upsert conflict target. NO org_id — favorites belong to the user, not an org
-- (Global Constraints). Read and written by the #358 course-favorites endpoints;
-- the user_id index serves the per-user "my favorites" list.
-- MUST run on prod BEFORE the #358 deploy: the new function code reads and
-- writes this table the moment it goes live.
-- Folded into 01-schema.sql after apply (see migration/azure/README.md).
-- Idempotent; safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS public.course_favorites (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id  uuid NOT NULL REFERENCES public.courses(id)  ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

-- List "my favorites for org X" filters favorites by the caller then joins the
-- org-visible catalog; index the user_id lookup.
CREATE INDEX IF NOT EXISTS idx_course_favorites_user ON public.course_favorites(user_id);

COMMIT;
