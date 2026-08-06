-- 14-gamification-indexes.sql
-- #362 dashboard motivation + org-leaderboard hub (XP + streaks).
--
-- There are NO XP / streak / leaderboard tables: XP, streaks, and both
-- leaderboard windows (all-time + current month) are DERIVED live from the
-- existing completion tables (lesson_progress, quiz_attempts, enrollments).
-- These read-only indexes make those derived aggregates cheap. Everything
-- here is additive and index-only — no data change, safe to apply any time.
--
-- Apply to prod directly, then fold into 01-schema.sql (standing rule, see
-- migration/azure/README.md). Idempotent; safe to re-run.
BEGIN;

-- Org-scoped completed-lesson aggregation, for both a member's own XP and the
-- org leaderboard. All-time scans the (org_id, status) slice; the "this month"
-- window range-seeks completed_at. user_id trails so the per-member GROUP BY
-- is served from the index.
CREATE INDEX IF NOT EXISTS idx_lesson_progress_org_completed
  ON public.lesson_progress (org_id, status, completed_at, user_id);

-- Global personal streak: the distinct Europe/Copenhagen activity-days for ONE
-- user across ALL orgs (a streak is a personal habit, not org-scoped). Partial
-- on completed lessons keeps the index small.
CREATE INDEX IF NOT EXISTS idx_lesson_progress_user_completed
  ON public.lesson_progress (user_id, completed_at)
  WHERE status = 'completed';

-- Org-scoped distinct-quiz-passed counting per member (finished_at trails for
-- the monthly window). Partial on passed attempts only.
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_org_passed
  ON public.quiz_attempts (org_id, user_id, quiz_id, finished_at)
  WHERE passed;

-- Org-scoped completed-course counting per member (completed_at trails for the
-- monthly window). Partial on completed enrollments only.
CREATE INDEX IF NOT EXISTS idx_enrollments_org_completed
  ON public.enrollments (org_id, user_id, completed_at)
  WHERE status = 'completed';

COMMIT;
