-- 09-enrollment-last-accessed.sql
-- #339 recency ordering: when a learner was last active in a course. Stamped by
-- functions/touch-course (course opened) and functions/lesson-progress (lesson
-- activity); read by functions/learner-courses to order the catalog's enrolled
-- group most-recent-first. Nullable, no default — existing rows stay NULL until
-- first activity. Idempotent; safe to re-run.
-- MUST run on prod BEFORE the #339 deploy: the new function code SELECTs and
-- UPDATEs this column the moment it goes live.
-- Folded into 01-schema.sql after apply (see migration/azure/README.md).
BEGIN;
ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz;
COMMIT;
