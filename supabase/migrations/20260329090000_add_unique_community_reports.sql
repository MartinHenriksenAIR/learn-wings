-- Prevent duplicate reports by the same user on the same target
CREATE UNIQUE INDEX IF NOT EXISTS community_reports_unique_reporter_target
ON public.community_reports (reporter_user_id, target_id, target_type);
