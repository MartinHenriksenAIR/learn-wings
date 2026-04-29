-- BUG-08: Allow reporters to SELECT their own community_reports rows.
--
-- Without this policy, the SELECT after INSERT in createReport() fails silently
-- (RLS returns empty set), causing the chained .select().single() to error.
-- The INSERT itself was succeeding (data was written), but the JS threw before
-- the success toast could fire, and the error was surfaced as a confusing
-- PGRST116 "no rows" error rather than a useful message.
--
-- Additionally, the duplicate-check query (maybeSingle before INSERT) now
-- correctly detects when the same user has already reported the same content.

CREATE POLICY "Reporters can view their own reports"
  ON public.community_reports FOR SELECT
  USING (reporter_user_id = auth.uid());
